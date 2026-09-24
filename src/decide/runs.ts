/**
 * Run records — the thing that makes a kill switch possible at all, and the
 * thing that makes the manual command possible when it is not.
 *
 * Before this file, a turn that was killed mid-flight left **nothing**: the
 * ledger is written after the vendor answers (`src/ledger/recording.ts`), and
 * nothing anywhere recorded that a turn had started. A process that died between
 * those two moments was invisible afterwards, and there was no number anybody
 * could have typed to stop it.
 *
 * ## `pid_start` is the whole of the safety
 *
 * A pid is reused. A record saying "pid 4812 is a turn" is, some hours later, a
 * record saying "kill whatever is now 4812", and what is now 4812 might be
 * anything at all. So every record also stores field 22 of `/proc/<pid>/stat` —
 * the process's start time in clock ticks since boot — and a record whose pid
 * exists with a *different* start time is classified `stale` and **never
 * signalled**.
 *
 * This is not the guess `src/ledger/store.ts` refuses to make about a lock
 * (*"om-agi does not guess that a lock is stale"*). A start time is a fact that
 * can be compared: either the process running under that number is the one the
 * record was written about, or it is not. A machine with no `/proc` cannot do
 * the comparison, and there the answer is to refuse to signal and print the
 * manual command instead — never to signal on a pid alone.
 *
 * ## Why the vendor child is spawned detached, and what it cost
 *
 * Measured 2026-09-22 on this runtime, over nine invocation shapes, and the
 * answer is **split** — which is worth saying plainly, because the one-line
 * version ("om-agi's process group belongs to the shell") is true of some
 * shapes and false of the one a person is most likely to be in:
 *
 * - **With a controlling terminal, a foreground job gets a group of its own.**
 *   Measured: `pgid` equal to its own pid, one member, om-agi. So for somebody
 *   typing `ohmyagi turn …` at a shell, the collision this file guards against
 *   **does not happen** and `detached` buys nothing at all.
 * - **Without one, every shape measured shared the caller's group.** A
 *   non-interactive `bash -c`, the same piped, `bash -ic` with no tty, a direct
 *   spawn with no shell between, and `npm exec` all came back with 5 to 7
 *   members of which exactly one was om-agi — the rest being the invoking
 *   harness, `npm`, `sh` and the shell. Printing that number under the words
 *   `kill -TERM -<pgid>` would hand somebody a command that kills their own
 *   session. These are also the shapes an unattended agent runs under, which is
 *   the case a kill switch exists for.
 * - **A pipeline puts a stranger in the group even with a terminal.** Measured:
 *   `om-agi … | cat` at an interactive shell makes om-agi the group *leader*
 *   with `cat` in the group beside it. Leading a group is therefore **not**
 *   proof that the group holds nothing but a process and its descendants — see
 *   {@link strangersInGroup}, which checks rather than assumes it.
 * - `Bun.spawn(..., { detached: true })` gives the child a group of its own with
 *   itself as leader, which makes `kill -TERM -<pgid>` exact.
 *
 * What it costs: a detached child no longer receives the terminal's Ctrl-C, so
 * om-agi has to pass a signal on itself, which is machinery that can break at the
 * same moment everything else does. That cost is acceptable for one measured
 * reason — Ctrl-C **was never reliable here anyway**. A grandchild started as a
 * shell background job ignores SIGINT by POSIX default and survived a group
 * SIGINT in measurement; the same process died on a group SIGTERM. The thing
 * being protected by staying attached does not work.
 *
 * ## Nothing in this file signals anything it has not identified first
 *
 * {@link terminateRun} sends to a *group* only when the target process leads
 * that group **and every other member of it descends from the target** — both
 * halves, because the measurement above found a shape where the first holds and
 * the second does not. A process that fails either test gets a signal addressed
 * to it alone, and is told so in the report. There is no path here that sends
 * to a negative pid taken on trust.
 */

import { mkdir, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR_MODE, STATE_FILE_MODE, stateRoot } from "../state.ts";
import type { SubjectId } from "../types.ts";

/** Schema tag every run record carries. */
export const RUN_SCHEMA = "om-agi/run@1";

/** The directory under the state root that holds them, one subdirectory per subject. */
export const RUNS_DIR = "runs";

/** Everything the run recorder is allowed to know about this machine. */
export interface RunEnv {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** `<stateRoot>/runs`. */
export function runsRoot(env: RunEnv): string {
  return join(stateRoot(env.home, env.env), RUNS_DIR);
}

/**
 * `<stateRoot>/runs/<subject>`.
 *
 * One directory per subject, the same shape the backup tree and the personal
 * directory already use — which is what lets `ohmyagi erase` remove one subject's
 * records with the walker it already has, instead of needing a filter.
 */
export function runsDirFor(env: RunEnv, subject: SubjectId): string {
  return join(runsRoot(env), subject);
}

/** A turn that had started and had not finished when this was written. */
export interface RunRecord {
  readonly schema: string;
  /** The same id the ledger records for this turn. */
  readonly turnId: string;
  readonly subject: SubjectId;
  /** The chain that was going to be tried, in order. */
  readonly backends: readonly string[];
  /** om-agi's own pid. The vendor children are found from it, not stored. */
  readonly pid: number;
  /**
   * om-agi's own process group — **recorded and printed, never signalled.**
   *
   * See the header: this number frequently belongs to the shell, not to om-agi.
   * It is here because a person looking at a stuck machine is entitled to it,
   * and because printing it beside the warning is more use than hiding it.
   */
  readonly pgid: number;
  /** Field 22 of `/proc/<pid>/stat`, or `null` where there is no `/proc`. */
  readonly pidStart: number | null;
  readonly startedAt: string;
}

/** One process, as `/proc` describes it. */
export interface ProcStat {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  /** Field 22: start time in clock ticks since boot. */
  readonly startTicks: number;
}

/**
 * Read one process's identity, or `null` when it is not there.
 *
 * The `comm` field is parenthesised and may itself contain a `)` — a process
 * can be named `(ಠ_ಠ)` — so the split is on the **last** `)` in the line. A
 * naive `split(" ")` reads the wrong fields for any process whose name has a
 * space in it, which is most kernel threads.
 */
export function procStat(pid: number): ProcStat | null {
  let raw: string;
  try {
    raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const close = raw.lastIndexOf(")");
  if (close === -1) return null;
  // After "<pid> (<comm>) " the fields are: state ppid pgrp session ...
  const fields = raw.slice(close + 2).split(" ");
  const ppid = Number(fields[1]);
  const pgid = Number(fields[2]);
  // Field 22 of the whole line is index 19 here: the first three (pid, comm,
  // state) are consumed by the slice and by `fields[0]`.
  const startTicks = Number(fields[19]);
  if (!Number.isFinite(ppid) || !Number.isFinite(pgid) || !Number.isFinite(startTicks)) return null;
  return { pid, ppid, pgid, startTicks };
}

/** Is there a `/proc` this code can read at all? Asked once, answered honestly. */
export function procAvailable(): boolean {
  return procStat(process.pid) !== null;
}

/** A record written for the turn this process is about to run. */
export function describeRun(options: {
  readonly turnId: string;
  readonly subject: SubjectId;
  readonly backends: readonly string[];
  readonly at: Date;
}): RunRecord {
  const self = procStat(process.pid);
  return {
    schema: RUN_SCHEMA,
    turnId: options.turnId,
    subject: options.subject,
    backends: [...options.backends],
    pid: process.pid,
    pgid: self?.pgid ?? process.pid,
    pidStart: self?.startTicks ?? null,
    startedAt: options.at.toISOString(),
  };
}

/** Where one record is written. */
export function runRecordPath(env: RunEnv, record: RunRecord): string {
  return join(runsDirFor(env, record.subject), `${record.turnId}.json`);
}

/**
 * Write the record, before the prompt goes anywhere.
 *
 * Before, and not after: the whole reason this exists is the turn that dies
 * mid-flight, and a record written at the end is a record that case never gets.
 */
export async function writeRunRecord(env: RunEnv, record: RunRecord): Promise<string> {
  const dir = runsDirFor(env, record.subject);
  await mkdir(dir, { recursive: true, mode: STATE_DIR_MODE });
  const path = runRecordPath(env, record);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { mode: STATE_FILE_MODE });
  return path;
}

/**
 * Take the record away, and the directories it needed, if they are now empty.
 *
 * Never throws: a turn must not fail over its own bookkeeping, and a kill
 * switch that can veto work is a worse failure than one that misses a turn.
 *
 * The two `rmdir`s are best-effort on purpose. A second turn for the same
 * subject running concurrently leaves its own record in there, `rmdir` fails
 * with ENOTEMPTY, and that is the correct outcome — the directory is still in
 * use. Removing them at all is only so that a machine that has run turns and
 * finished them looks like a machine that has not: an empty `runs/<subject>/`
 * left on disk is a trace of somebody having used om-agi, which is exactly the
 * kind of thing I-4 says should not accumulate for free.
 */
export async function removeRunRecord(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined);
  const subjectDir = dirname(path);
  await rmdir(subjectDir).catch(() => undefined);
  await rmdir(dirname(subjectDir)).catch(() => undefined);
}

/** A record read back off disk, with the path it came from. */
export interface StoredRun {
  readonly path: string;
  readonly record: RunRecord;
}

/** A file under `runs/` that is not a record om-agi wrote. */
export interface UnreadableRun {
  readonly path: string;
  readonly reason: string;
}

/** Everything under `runs/`, separated into what parsed and what did not. */
export interface RunInventory {
  readonly runs: readonly StoredRun[];
  readonly unreadable: readonly UnreadableRun[];
}

function asRecord(value: unknown): RunRecord | string {
  if (typeof value !== "object" || value === null) return "not a JSON object";
  const raw = value as Record<string, unknown>;
  if (raw["schema"] !== RUN_SCHEMA) return `schema is not ${RUN_SCHEMA}`;
  const pid = raw["pid"];
  const pgid = raw["pgid"];
  const turnId = raw["turnId"];
  const subject = raw["subject"];
  if (typeof pid !== "number" || typeof pgid !== "number") return "pid or pgid is not a number";
  if (typeof turnId !== "string" || typeof subject !== "string") return "turnId or subject is missing";
  const pidStart = raw["pidStart"];
  const backends = raw["backends"];
  return {
    schema: RUN_SCHEMA,
    turnId,
    subject: subject as SubjectId,
    backends: Array.isArray(backends) ? backends.filter((b): b is string => typeof b === "string") : [],
    pid,
    pgid,
    pidStart: typeof pidStart === "number" ? pidStart : null,
    startedAt: typeof raw["startedAt"] === "string" ? (raw["startedAt"] as string) : "",
  };
}

/**
 * Read every run record under the state root, for every subject.
 *
 * Every subject, because `ohmyagi stop` is the one command that must not need to
 * be told whose turn to stop: somebody reaching for it is not in a position to
 * look an identifier up.
 */
export async function readRuns(env: RunEnv): Promise<RunInventory> {
  const root = runsRoot(env);
  const runs: StoredRun[] = [];
  const unreadable: UnreadableRun[] = [];

  let subjects: string[];
  try {
    subjects = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return { runs, unreadable };
  }

  for (const subject of subjects) {
    const dir = join(root, subject);
    let names: string[];
    try {
      names = (await readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    } catch (cause) {
      unreadable.push({ path: dir, reason: String(cause) });
      continue;
    }
    for (const name of names) {
      const path = join(dir, name);
      try {
        const parsed = asRecord(JSON.parse(await readFile(path, "utf8")));
        if (typeof parsed === "string") unreadable.push({ path, reason: parsed });
        else runs.push({ path, record: parsed });
      } catch (cause) {
        unreadable.push({ path, reason: String(cause) });
      }
    }
  }

  runs.sort((a, b) => a.record.startedAt.localeCompare(b.record.startedAt));
  return { runs, unreadable };
}

/** What a record turned out to be about. Only `live` is ever signalled. */
export type Liveness =
  /** The pid is there and its start time matches. This really is that turn. */
  | "live"
  /** The pid is gone, or it is there and is somebody else now. Never signalled. */
  | "stale"
  /**
   * There is no `/proc`, or the record was written where there was none, so the
   * question cannot be asked. Never signalled — the manual command is printed.
   */
  | "unverifiable";

/**
 * Is this record about a process that is still the process it was about?
 *
 * The `unverifiable` arm is not a formality. Without a start time to compare,
 * "the pid exists" means only that *some* process has that number, and signalling
 * on that basis is how a kill switch kills the wrong thing — the exact failure
 * the switch exists to prevent, arriving by the tool meant to prevent it.
 */
export function livenessOf(record: RunRecord, stat: ProcStat | null = procStat(record.pid)): Liveness {
  if (record.pidStart === null) return "unverifiable";
  if (stat === null) return "stale";
  return stat.startTicks === record.pidStart ? "live" : "stale";
}

/** The seam every signal goes through, so a test can watch without a casualty. */
export interface SignalIo {
  readonly stat: (pid: number) => ProcStat | null;
  readonly kill: (pid: number, signal: NodeJS.Signals) => void;
  readonly listPids: () => readonly number[];
}

/** The real one: `/proc` and `process.kill`. */
export const REAL_SIGNALS: SignalIo = {
  stat: procStat,
  kill: (pid, signal) => process.kill(pid, signal),
  listPids: () => {
    // Synchronous rather than the promise form: the answer is a snapshot, and
    // awaiting in the middle of one invites the table to change under it.
    try {
      return readdirSync("/proc")
        .filter((name) => /^\d+$/.test(name))
        .map((name) => Number(name));
    } catch {
      return [];
    }
  },
};

/** Every process whose parent is `pid`, right now. */
export function childrenOf(pid: number, io: SignalIo = REAL_SIGNALS): readonly ProcStat[] {
  const found: ProcStat[] = [];
  for (const candidate of io.listPids()) {
    if (candidate === pid) continue;
    const stat = io.stat(candidate);
    if (stat !== null && stat.ppid === pid) found.push(stat);
  }
  return found;
}

/** One process a signal was sent to, and how it was addressed. */
export interface Signalled {
  readonly pid: number;
  /** `group` only when the target leads a group of its own descendants. */
  readonly how: "group" | "process";
  readonly signal: NodeJS.Signals;
  /** Set when the signal could not be delivered. */
  readonly failed?: string;
  /**
   * Why a group signal was narrowed to this process alone, when it was.
   *
   * Reported rather than done quietly: a person who asked om-agi to stop a turn
   * is entitled to know that part of it was left running because om-agi could
   * not show the group was safe to signal, and what was in the group instead.
   */
  readonly narrowed?: string;
}

/** What stopping one recorded turn did, and what it could not do. */
export interface TerminationReport {
  readonly record: RunRecord;
  readonly liveness: Liveness;
  readonly signalled: readonly Signalled[];
  /** Pids still alive when the poll gave up, with the command for a human. */
  readonly survivors: readonly { readonly pid: number; readonly pgid: number }[];
  /** Why nothing was signalled, when nothing was. */
  readonly refusal?: string;
}

/**
 * Everything in `leaderPid`'s process group that does not descend from it.
 *
 * The check the header's third measurement made necessary. Leading a group was
 * taken as proof that the group held nothing but the leader and its children,
 * and `om-agi … | cat` at an interactive shell is a counter-example: bash makes
 * the first process of a pipeline the group leader and puts the second in the
 * group beside it, a sibling rather than a descendant.
 *
 * Walks parents rather than children, because that is the direction `/proc`
 * answers in one field. The hop limit is not defensive rounding: `ppid` chains
 * are reparented while this loop runs, and a cycle read out of two inconsistent
 * snapshots would otherwise spin forever inside a kill switch.
 */
export function strangersInGroup(io: SignalIo, leaderPid: number): readonly ProcStat[] {
  const table = new Map<number, ProcStat>();
  for (const pid of io.listPids()) {
    const stat = io.stat(pid);
    if (stat !== null) table.set(pid, stat);
  }

  const descendsFromLeader = (from: ProcStat): boolean => {
    let cursor: ProcStat | undefined = from;
    for (let hops = 0; cursor !== undefined && hops < 128; hops += 1) {
      if (cursor.pid === leaderPid) return true;
      cursor = table.get(cursor.ppid);
    }
    return false;
  };

  return [...table.values()].filter(
    (stat) => stat.pgid === leaderPid && !descendsFromLeader(stat),
  );
}

/**
 * Address one process as safely as it can be addressed.
 *
 * A process gets its **group** only when both halves hold: it leads that group,
 * and every other member of the group descends from it. `detached: true`
 * produces exactly that shape, and an inherited group never does. Anything else
 * gets the signal addressed to itself alone, because its group may hold a shell
 * somebody is using — or, per the measurement in the header, the `cat` on the
 * other side of a pipe.
 *
 * Narrowing is the safe direction and it is also a *loss*: a vendor CLI's own
 * grandchildren are then out of reach. So it is reported, not swallowed, and
 * `ohmyagi stop` prints the manual command for what is left.
 */
function sendTo(io: SignalIo, stat: ProcStat, signal: NodeJS.Signals): Signalled {
  let how: "group" | "process" = "process";
  let narrowed: string | undefined;

  if (stat.pgid === stat.pid) {
    const strangers = strangersInGroup(io, stat.pid);
    if (strangers.length === 0) {
      how = "group";
    } else {
      narrowed =
        `pid ${stat.pid} leads process group ${stat.pgid}, but ${strangers.length} process(es) ` +
        `in that group do not descend from it (${strangers.map((s) => s.pid).join(", ")}) — a ` +
        `pipeline or a shell job puts a sibling there. The signal went to this process alone. ` +
        `Anything it started that outlives it is named below with the command to reach it.`;
    }
  }

  const target = how === "group" ? -stat.pid : stat.pid;
  try {
    io.kill(target, signal);
    return { pid: stat.pid, how, signal, ...(narrowed === undefined ? {} : { narrowed }) };
  } catch (cause) {
    return {
      pid: stat.pid,
      how,
      signal,
      failed: String(cause),
      ...(narrowed === undefined ? {} : { narrowed }),
    };
  }
}

/**
 * Stop one recorded turn: its vendor children first, then om-agi itself.
 *
 * Children first, and the order is measured rather than stylistic: killing the
 * parent alone leaves the vendor CLI running with its parent reassigned to init
 * (measured 2026-09-22), which is the failure that makes a kill switch a lie.
 *
 * @param settle Called between polls. Injected so a test can drive it without
 *   sleeping, and so nothing here asserts anything about how fast a machine is.
 */
export async function terminateRun(
  stored: StoredRun,
  options: {
    readonly io?: SignalIo;
    readonly attempts?: number;
    readonly settle: () => Promise<void>;
  },
): Promise<TerminationReport> {
  const io = options.io ?? REAL_SIGNALS;
  const attempts = options.attempts ?? 40;
  const record = stored.record;
  const self = io.stat(record.pid);
  const liveness = livenessOf(record, self);

  if (liveness !== "live" || self === null) {
    return {
      record,
      liveness,
      signalled: [],
      survivors: [],
      refusal:
        liveness === "stale"
          ? "the process this record names is gone, or the number now belongs to something " +
            "else. Nothing was signalled: a pid is reused, and a kill switch that guesses is " +
            "the thing it was built to prevent."
          : "this record carries no process start time, so om-agi cannot show that the pid " +
            "still means what it meant. Nothing was signalled. The command to run by hand is " +
            "printed above.",
    };
  }

  const signalled: Signalled[] = [];

  // The vendor children, each addressed by its own group where it leads one.
  const children = childrenOf(record.pid, io);
  for (const child of children) signalled.push(sendTo(io, child, "SIGTERM"));

  // Then om-agi itself, which has no handler and dies on the default action.
  signalled.push(sendTo(io, self, "SIGTERM"));

  // What was signalled, with its start time, so the second signal can prove it
  // is still addressing the same process and not a pid reused in between.
  const watched = [...children, self];
  const sameProcess = (stat: ProcStat): boolean => {
    const now = io.stat(stat.pid);
    return now !== null && now.startTicks === stat.startTicks;
  };
  const wait = async (among: readonly ProcStat[]): Promise<readonly ProcStat[]> => {
    let alive = among;
    for (let attempt = 0; attempt < attempts && alive.length > 0; attempt += 1) {
      await options.settle();
      alive = alive.filter(sameProcess);
    }
    return alive;
  };

  let alive = await wait(watched);

  // D-044 — SIGTERM was not enough. The owner decided a kill switch that a
  // hung or deliberately stubborn vendor can outlast is not a kill switch, so
  // what is still the same process gets SIGKILL, addressed by the same rule.
  if (alive.length > 0) {
    for (const stat of alive) signalled.push(sendTo(io, stat, "SIGKILL"));
    alive = await wait(alive);
  }

  return {
    record,
    liveness,
    signalled,
    survivors: alive.map((stat) => ({ pid: stat.pid, pgid: io.stat(stat.pid)?.pgid ?? stat.pgid })),
  };
}

/**
 * The command a person runs for what om-agi would not.
 *
 * A string rather than something om-agi executes, and that is the point: the
 * cases that reach here are the ones where om-agi could not show that the target
 * is what the record says it is. Handing the decision to somebody who can look
 * is better than a program acting on a number it does not trust.
 */
export function manualCommand(pgid: number, signal: "TERM" | "KILL" = "TERM"): string {
  return `kill -${signal} -${pgid}`;
}
