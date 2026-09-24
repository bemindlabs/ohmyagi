/**
 * Run records, and the rule that a kill switch may never guess.
 *
 * ## How this file signals, and why it is written this way
 *
 * Testing a thing that kills processes has an obvious way to go wrong, so every
 * case that sends a signal obeys three rules without exception:
 *
 * 1. **Every target is a process this file started**, through `Bun.spawn`, kept
 *    in {@link started} and killed in `afterEach` whatever happened.
 * 2. **Every target is checked to be a child of this test** — `procStat(pid).ppid
 *    === process.pid` — immediately before the signal, by {@link mine}. A pid
 *    that is not ours fails the test rather than being signalled.
 * 3. **Nothing is ever sent to a negative pid by this file.** `terminateRun`
 *    decides that for itself, and what it decided is read back out of the
 *    report rather than assumed.
 *
 * ## D-028 — nothing here asserts anything that depends on the machine
 *
 * There is no assertion about how long anything took. Waiting is a bounded poll
 * with a small sleep, and the bound exists to catch a structural break (a signal
 * that never goes at all), not a busy machine. Where a number was measured it is
 * **printed with the load average** rather than asserted, in the words
 * `test/scripts/cli-parity.test.ts` settled on.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import {
  RUN_SCHEMA,
  childrenOf,
  describeRun,
  livenessOf,
  manualCommand,
  procAvailable,
  procStat,
  readRuns,
  removeRunRecord,
  runRecordPath,
  runsDirFor,
  runsRoot,
  strangersInGroup,
  terminateRun,
  writeRunRecord,
  type ProcStat,
  type RunRecord,
} from "../../src/decide/runs.ts";
import { subjectId } from "../../src/types.ts";

const SUBJECT = subjectId("example");
const OTHER = subjectId("somebody-else");

const scratch: string[] = [];
const started: Bun.Subprocess[] = [];

afterEach(async () => {
  for (const child of started.splice(0)) {
    try {
      child.kill("SIGKILL");
      await child.exited;
    } catch {
      // Already gone, which is what most of these cases are about.
    }
  }
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function sandbox(): Promise<{ home: string; env: Record<string, string> }> {
  const home = await mkdtemp(join(tmpdir(), "om-agi-runs-"));
  scratch.push(home);
  return { home, env: { XDG_STATE_HOME: join(home, "state") } };
}

/**
 * A process of our own to signal, detached exactly as `cli-exec` starts one.
 *
 * `sleep` rather than a shell: `sh` is on `REFUSED_BINARIES` for the engine, and
 * a test that reached for one here would be measuring a different shape of child
 * from the one om-agi really creates.
 */
function spawnChild(detached: boolean): Bun.Subprocess {
  const child = Bun.spawn(["sleep", "30"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    ...(detached ? { detached: true } : {}),
  });
  started.push(child);
  return child;
}

/**
 * Assert this pid is a child of this test process, and hand it back.
 *
 * Rule 2 of the three at the top of this file, as a function, so that no case
 * can forget it: a signal aimed at something that is not ours is a test failure
 * before it is anything else.
 */
function mine(pid: number): number {
  const stat = procStat(pid);
  expect(stat, `pid ${pid} is not in /proc — refusing to signal it`).not.toBeNull();
  expect(stat!.ppid, `pid ${pid} is not a child of this test (ppid ${stat!.ppid})`).toBe(
    process.pid,
  );
  return pid;
}

/** Wait until `done()`, or give up. Bounded to catch a break, never timed. */
async function until(done: () => boolean, attempts = 200): Promise<boolean> {
  for (let i = 0; i < attempts && !done(); i += 1) {
    await Bun.sleep(10);
  }
  return done();
}

const settle = () => Bun.sleep(10);

describe("/proc, read the way a process table has to be read", () => {
  test("a name with spaces and brackets in it does not shift the fields", () => {
    // `comm` is parenthesised and may contain a `)`. A naive split reads the
    // wrong fields for most kernel threads, and reading the wrong field here
    // means comparing the wrong number before signalling.
    const self = procStat(process.pid);
    expect(self).not.toBeNull();
    expect(self!.pid).toBe(process.pid);
    expect(self!.ppid).toBeGreaterThan(0);
    expect(self!.startTicks).toBeGreaterThan(0);

    // Every process on this machine, read: if the parser were shifting fields
    // on some of them, the numbers would come back as NaN and `procStat` would
    // return null for a live pid. It is a sweep, not a sample.
    let read = 0;
    for (const name of require("node:fs").readdirSync("/proc") as string[]) {
      if (!/^\d+$/.test(name)) continue;
      const stat = procStat(Number(name));
      if (stat === null) continue; // exited between readdir and read — ordinary
      expect(Number.isFinite(stat.ppid), name).toBe(true);
      expect(Number.isFinite(stat.pgid), name).toBe(true);
      expect(Number.isFinite(stat.startTicks), name).toBe(true);
      read += 1;
    }
    expect(read).toBeGreaterThan(10);
  });

  test("a pid that is not there is null, not a throw", () => {
    // Callers loop over records; one missing process must not derail the rest.
    expect(procStat(0)).toBeNull();
    expect(procStat(2 ** 31)).toBeNull();
  });

  test("this machine has a /proc, which every case below depends on", () => {
    expect(procAvailable()).toBe(true);
  });
});

describe("a record is written before the turn and taken away after it", () => {
  test("it round-trips, carrying this process's own identity", async () => {
    const env = await sandbox();
    const record = describeRun({
      turnId: "11111111-1111-4111-8111-111111111111",
      subject: SUBJECT,
      backends: ["claude", "ollama"],
      at: new Date("2026-09-22T00:00:00.000Z"),
    });

    expect(record.schema).toBe(RUN_SCHEMA);
    expect(record.pid).toBe(process.pid);
    expect(record.pidStart).toBe(procStat(process.pid)!.startTicks);
    expect(record.pgid).toBe(procStat(process.pid)!.pgid);

    const path = await writeRunRecord(env, record);
    expect(path).toBe(runRecordPath(env, record));
    const back = await readRuns(env);
    expect(back.unreadable).toEqual([]);
    expect(back.runs.length).toBe(1);
    expect(back.runs[0]!.record).toEqual(record);
  });

  test("it is found whoever the subject is, because stop is not told one", () => {
    // Somebody reaching for a kill switch is not in a position to look an
    // identifier up, so `readRuns` reads every subject's directory.
    expect(runsDirFor({ home: "/h", env: {} }, SUBJECT)).not.toBe(
      runsDirFor({ home: "/h", env: {} }, OTHER),
    );
    expect(runsDirFor({ home: "/h", env: {} }, SUBJECT).startsWith(runsRoot({ home: "/h", env: {} }))).toBe(
      true,
    );
  });

  test("two subjects' turns are both found", async () => {
    const env = await sandbox();
    for (const [id, turn] of [
      [SUBJECT, "aaaaaaaa-1111-4111-8111-111111111111"],
      [OTHER, "bbbbbbbb-1111-4111-8111-111111111111"],
    ] as const) {
      await writeRunRecord(
        env,
        describeRun({ turnId: turn, subject: id, backends: ["ollama"], at: new Date() }),
      );
    }
    const back = await readRuns(env);
    expect(back.runs.map((entry) => entry.record.subject).sort()).toEqual([SUBJECT, OTHER].sort());
  });

  test("removing the last record takes the empty directories with it", async () => {
    const env = await sandbox();
    const record = describeRun({
      turnId: "cccccccc-1111-4111-8111-111111111111",
      subject: SUBJECT,
      backends: ["ollama"],
      at: new Date(),
    });
    const path = await writeRunRecord(env, record);
    await removeRunRecord(path);

    // An empty `runs/<subject>/` left behind is a trace of somebody having used
    // om-agi, kept for nothing.
    expect(await readdir(runsRoot(env)).catch(() => null)).toBeNull();
  });

  test("a second turn's directory survives the first one's cleanup", async () => {
    // The control for the line above: the `rmdir` is best-effort and must not
    // take a directory another turn is still using.
    const env = await sandbox();
    const first = await writeRunRecord(
      env,
      describeRun({ turnId: "d1", subject: SUBJECT, backends: [], at: new Date() }),
    );
    await writeRunRecord(
      env,
      describeRun({ turnId: "d2", subject: SUBJECT, backends: [], at: new Date() }),
    );
    await removeRunRecord(first);
    expect((await readRuns(env)).runs.length).toBe(1);
  });

  test("garbage under runs/ is reported, never parsed into a pid", async () => {
    const env = await sandbox();
    const dir = runsDirFor(env, SUBJECT);
    await writeRunRecord(
      env,
      describeRun({ turnId: "good", subject: SUBJECT, backends: [], at: new Date() }),
    );
    await writeFile(join(dir, "not-json.json"), "{{{");
    await writeFile(join(dir, "wrong-schema.json"), JSON.stringify({ schema: "something/else@1" }));
    await writeFile(join(dir, "no-pid.json"), JSON.stringify({ schema: RUN_SCHEMA, turnId: "x" }));

    const back = await readRuns(env);
    expect(back.runs.length).toBe(1);
    expect(back.unreadable.length).toBe(3);
    for (const bad of back.unreadable) expect(bad.reason.length).toBeGreaterThan(5);
  });

  test("no runs directory at all is an empty inventory, not an error", async () => {
    const env = await sandbox();
    expect(await readRuns(env)).toEqual({ runs: [], unreadable: [] });
  });
});

describe("pid reuse — the reason a start time is stored at all", () => {
  test("a record whose start time does not match a live pid is stale", () => {
    // Built against **this test process**, which is certainly alive, with a
    // start time that is certainly not its own. If `livenessOf` compared only
    // "does the pid exist", this would come back live and a real kill switch
    // would signal the test runner.
    const self = procStat(process.pid)!;
    const impostor: RunRecord = {
      schema: RUN_SCHEMA,
      turnId: "e1",
      subject: SUBJECT,
      backends: [],
      pid: process.pid,
      pgid: self.pgid,
      pidStart: self.startTicks + 1,
      startedAt: new Date().toISOString(),
    };
    expect(livenessOf(impostor)).toBe("stale");
  });

  test("a matching start time on a live pid is live", () => {
    const self = procStat(process.pid)!;
    expect(
      livenessOf({
        schema: RUN_SCHEMA,
        turnId: "e2",
        subject: SUBJECT,
        backends: [],
        pid: process.pid,
        pgid: self.pgid,
        pidStart: self.startTicks,
        startedAt: new Date().toISOString(),
      }),
    ).toBe("live");
  });

  test("a pid that is gone is stale, and a record with no start time is unverifiable", () => {
    const gone: RunRecord = {
      schema: RUN_SCHEMA,
      turnId: "e3",
      subject: SUBJECT,
      backends: [],
      pid: 2 ** 31,
      pgid: 2 ** 31,
      pidStart: 1,
      startedAt: new Date().toISOString(),
    };
    expect(livenessOf(gone)).toBe("stale");
    expect(livenessOf({ ...gone, pidStart: null })).toBe("unverifiable");
    // …and unverifiable even when the pid *is* there, which is the point: with
    // nothing to compare, "the pid exists" is not evidence about which process.
    expect(livenessOf({ ...gone, pid: process.pid, pidStart: null })).toBe("unverifiable");
  });

  test("a stale record is reported and NOT signalled — and this test survives to say so", async () => {
    const env = await sandbox();
    const self = procStat(process.pid)!;
    // The target is this very test process, with a start time one tick off. A
    // `terminateRun` that signalled on the pid alone would kill the runner, so
    // the fact that the rest of this file runs is itself the assertion.
    const record: RunRecord = {
      schema: RUN_SCHEMA,
      turnId: "e4",
      subject: SUBJECT,
      backends: ["claude"],
      pid: process.pid,
      pgid: self.pgid,
      pidStart: self.startTicks + 1,
      startedAt: new Date().toISOString(),
    };
    const path = await writeRunRecord(env, record);

    const report = await terminateRun({ path, record }, { settle, attempts: 2 });
    expect(report.liveness).toBe("stale");
    expect(report.signalled).toEqual([]);
    expect(report.survivors).toEqual([]);
    expect(report.refusal).toContain("a pid is reused");
    // Still here.
    expect(procStat(process.pid)).not.toBeNull();
  });

  test("an unverifiable record is refused too, with the manual command named", async () => {
    const env = await sandbox();
    const record: RunRecord = {
      schema: RUN_SCHEMA,
      turnId: "e5",
      subject: SUBJECT,
      backends: [],
      pid: process.pid,
      pgid: procStat(process.pid)!.pgid,
      pidStart: null,
      startedAt: new Date().toISOString(),
    };
    const report = await terminateRun(
      { path: await writeRunRecord(env, record), record },
      { settle, attempts: 2 },
    );
    expect(report.liveness).toBe("unverifiable");
    expect(report.signalled).toEqual([]);
    expect(report.refusal).toContain("no process start time");
    expect(manualCommand(record.pgid)).toBe(`kill -TERM -${record.pgid}`);
  });
});

describe("what a detached child buys, measured against one that is not", () => {
  test("detached makes the child its own group leader; without it, it inherits ours", async () => {
    const attached = spawnChild(false);
    const detached = spawnChild(true);
    expect(await until(() => procStat(attached.pid) !== null && procStat(detached.pid) !== null)).toBe(
      true,
    );

    const ours = procStat(process.pid)!;
    expect(procStat(attached.pid)!.pgid).toBe(ours.pgid);
    expect(procStat(detached.pid)!.pgid).toBe(detached.pid);

    // The consequence, which is the whole reason `cli-exec` passes `detached`:
    // the group om-agi would otherwise print is *this* process's group, and on
    // a machine where om-agi was started without job control that group holds
    // the shell and whatever else it is running. Printed rather than asserted:
    // what is in our group depends on what started this test run.
    const inOurGroup = (require("node:fs").readdirSync("/proc") as string[])
      .filter((name) => /^\d+$/.test(name))
      .map((name) => procStat(Number(name)))
      .filter((stat) => stat !== null && stat.pgid === ours.pgid).length;
    console.log(
      `  process group ${ours.pgid} currently holds ${inOurGroup} process(es) — ` +
        `load average ${loadavg()[0]!.toFixed(2)}. Not asserted: it depends on what started ` +
        `this run. It is the number \`kill -TERM -<pgid>\` would have reached before E5. ` +
        `Measured 2026-09-22 over nine shapes: 5-7 members under every shape with no ` +
        `controlling terminal (bash -c, the same piped, bash -ic with no tty, a direct ` +
        `spawn, npm exec), exactly 1 for a foreground job at a real terminal — where ` +
        `detached buys nothing — and 2 for a pipeline at a real terminal, where om-agi ` +
        `leads the group and \`cat\` is in it.`,
    );
  });

  test("childrenOf finds a child we started and does not claim one we did not", async () => {
    const child = spawnChild(true);
    expect(await until(() => procStat(child.pid) !== null)).toBe(true);
    const found = childrenOf(process.pid).map((stat) => stat.pid);
    expect(found).toContain(mine(child.pid));
    expect(found).not.toContain(process.pid);
  });
});

describe("terminateRun ends the turn, children first", () => {
  test("a detached child is signalled by its group, and the parent by itself", async () => {
    const env = await sandbox();
    const child = spawnChild(true);
    expect(await until(() => procStat(child.pid) !== null)).toBe(true);
    // Rules 1 and 2: we started it, and it is ours.
    mine(child.pid);

    const self = procStat(process.pid)!;
    const record: RunRecord = {
      schema: RUN_SCHEMA,
      turnId: "f1",
      subject: SUBJECT,
      backends: ["claude"],
      pid: process.pid,
      pgid: self.pgid,
      pidStart: self.startTicks,
      startedAt: new Date().toISOString(),
    };

    // The record names *this* process as the turn, so `terminateRun` would
    // signal the test runner. That is not something to do, so the signal seam
    // is replaced with one that records what would have been sent — and what
    // it records is the decision this case is about: the detached child gets
    // its group, the non-leader parent gets itself alone.
    //
    // Whether the test runner leads its own process group depends on what
    // started it — a wrapper that calls setsid makes it a leader, and then the
    // "non-leader parent" this case is about does not exist. So the runner's
    // stat is pinned to the non-leader shape rather than read off whatever
    // launched `bun test`; the leader shapes have cases of their own below.
    const nonLeader = { ...self, pgid: self.pgid === self.pid ? self.ppid : self.pgid };
    const sent: { pid: number; signal: string }[] = [];
    const report = await terminateRun(
      { path: await writeRunRecord(env, record), record },
      {
        settle,
        attempts: 1,
        io: {
          stat: (pid) => (pid === process.pid ? nonLeader : procStat(pid)),
          kill: (pid, signal) => {
            // Rule 3, checked rather than trusted: a negative pid may only ever
            // be a group whose leader we started.
            if (pid < 0) expect(-pid).toBe(child.pid);
            sent.push({ pid, signal });
          },
          listPids: () => [child.pid, process.pid],
        },
      },
    );

    expect(report.liveness).toBe("live");
    // Children first: killing the parent alone leaves the vendor CLI running
    // with its parent reassigned to init, which is the failure that makes a
    // kill switch a lie.
    // The fake delivers nothing, so both survive SIGTERM and get SIGKILL next
    // (D-044). This case is about the order and addressing of the first round.
    const term = sent.filter((entry) => entry.signal === "SIGTERM");
    expect(term[0]!.pid).toBe(-child.pid);
    expect(term.at(-1)!.pid).toBe(process.pid);
    expect(sent.slice(0, term.length).every((entry) => entry.signal === "SIGTERM")).toBe(true);

    const toChild = report.signalled.find((entry) => entry.pid === child.pid);
    expect(toChild!.how).toBe("group");
    const toSelf = report.signalled.find((entry) => entry.pid === process.pid);
    expect(toSelf!.how).toBe("process");
  });

  test("D-044: what survives SIGTERM gets SIGKILL — and a pid reused in between does not", async () => {
    const env = await sandbox();
    type Stat = { pid: number; ppid: number; pgid: number; startTicks: number };
    const table = new Map<number, Stat>([
      [5000, { pid: 5000, ppid: 1, pgid: 4000, startTicks: 100 }], // om-agi, not a leader
      [5001, { pid: 5001, ppid: 5000, pgid: 5001, startTicks: 101 }], // stubborn vendor, its own group
      [5002, { pid: 5002, ppid: 5000, pgid: 5002, startTicks: 102 }], // vendor whose pid gets reused
    ]);
    const record: RunRecord = {
      schema: RUN_SCHEMA, turnId: "k1", subject: SUBJECT, backends: ["claude"],
      pid: 5000, pgid: 4000, pidStart: 100, startedAt: new Date().toISOString(),
    };
    const sent: string[] = [];
    const report = await terminateRun(
      { path: await writeRunRecord(env, record), record },
      {
        settle,
        attempts: 2,
        io: {
          stat: (pid) => (table.get(pid) as never) ?? null,
          listPids: () => [...table.keys()],
          kill: (pid, signal) => {
            sent.push(`${signal} ${pid}`);
            const target = Math.abs(pid);
            if (signal === "SIGTERM" && target === 5000) table.delete(5000); // om-agi obeys
            if (signal === "SIGTERM" && target === 5002) {
              // Dies, and its number is handed to something else at once.
              table.set(5002, { pid: 5002, ppid: 1, pgid: 5002, startTicks: 999 });
            }
            if (signal === "SIGKILL") table.delete(target);
          },
        },
      },
    );

    expect(sent.filter((line) => line.startsWith("SIGKILL"))).toEqual(["SIGKILL -5001"]);
    expect(report.survivors).toEqual([]);
    expect(report.signalled.map((entry) => `${entry.signal} ${entry.pid}`)).toContain("SIGKILL 5001");
  });

  test("D-044: a process that outlives SIGKILL too is a survivor, with the KILL command", async () => {
    const env = await sandbox();
    const stuck = { pid: 6001, ppid: 6000, pgid: 6001, startTicks: 7 };
    const self = { pid: 6000, ppid: 1, pgid: 5999, startTicks: 6 };
    const record: RunRecord = {
      schema: RUN_SCHEMA, turnId: "k2", subject: SUBJECT, backends: ["claude"],
      pid: 6000, pgid: 5999, pidStart: 6, startedAt: new Date().toISOString(),
    };
    const report = await terminateRun(
      { path: await writeRunRecord(env, record), record },
      {
        settle,
        attempts: 1,
        io: {
          stat: (pid) => (pid === 6000 ? self : pid === 6001 ? stuck : null) as never,
          listPids: () => [6000, 6001],
          kill: () => undefined,
        },
      },
    );
    expect(report.survivors.map((s) => s.pid).sort()).toEqual([6000, 6001]);
    expect(manualCommand(6001, "KILL")).toBe("kill -KILL -6001");
  });

  test("a group leader with a sibling in its group is NOT addressed as a group", async () => {
    // The measurement that made this necessary: at an interactive shell,
    // `om-agi … | cat` makes om-agi the leader of a group that also holds
    // `cat`. Leading a group is not proof that the group is yours, so the
    // signal has to narrow to the process — and say that it did.
    //
    // Posed through the injected `SignalIo` rather than by building a real
    // pipeline: what is under test is the decision, and a real one would mean
    // this file owning a process it did not start.
    const leader = 4001;
    const sibling = 4002;
    const child = 4003;
    const table: Record<number, ProcStat> = {
      [leader]: { pid: leader, ppid: 3999, pgid: leader, startTicks: 10 },
      // Same group, different parent — the `cat` on the other side of the pipe.
      [sibling]: { pid: sibling, ppid: 3999, pgid: leader, startTicks: 11 },
      // Same group, and really the leader's child — this one is no stranger.
      [child]: { pid: child, ppid: leader, pgid: leader, startTicks: 12 },
    };
    const io = {
      stat: (pid: number) => table[pid] ?? null,
      kill: () => undefined,
      listPids: () => [leader, sibling, child],
    };

    expect(strangersInGroup(io, leader).map((s) => s.pid)).toEqual([sibling]);

    const env = await sandbox();
    const record: RunRecord = {
      schema: RUN_SCHEMA,
      turnId: "f4",
      subject: SUBJECT,
      backends: [],
      pid: leader,
      pgid: leader,
      pidStart: 10,
      startedAt: new Date().toISOString(),
    };

    const sent: number[] = [];
    const report = await terminateRun(
      { path: await writeRunRecord(env, record), record },
      {
        settle,
        attempts: 1,
        io: { ...io, kill: (pid) => void sent.push(pid) },
      },
    );

    // Rule 3, again: nothing negative went anywhere.
    expect(sent.every((pid) => pid > 0)).toBe(true);
    const toLeader = report.signalled.find((entry) => entry.pid === leader)!;
    expect(toLeader.how).toBe("process");
    expect(toLeader.narrowed).toContain("do not descend from it");
    expect(toLeader.narrowed).toContain(String(sibling));

    // The control: take the sibling out of the group and the same code uses
    // the group. Without this, the assertion above would pass over a `sendTo`
    // that had simply stopped group-signalling at all.
    const alone: Record<number, ProcStat> = {
      ...table,
      [sibling]: { ...table[sibling]!, pgid: 3999 },
    };
    expect(
      strangersInGroup({ ...io, stat: (pid: number) => alone[pid] ?? null }, leader),
    ).toEqual([]);
  });

  test("a process that is not a group leader is never addressed as a group", async () => {
    // The safety rule, at the level of the function that decides it. An
    // attached child's group belongs to whoever started the chain — on this
    // machine, to the test runner — and a group signal there would reach
    // processes om-agi never started.
    const env = await sandbox();
    const attached = spawnChild(false);
    expect(await until(() => procStat(attached.pid) !== null)).toBe(true);
    mine(attached.pid);
    expect(procStat(attached.pid)!.pgid).not.toBe(attached.pid);

    const self = procStat(process.pid)!;
    const record: RunRecord = {
      schema: RUN_SCHEMA,
      turnId: "f2",
      subject: SUBJECT,
      backends: [],
      pid: process.pid,
      pgid: self.pgid,
      pidStart: self.startTicks,
      startedAt: new Date().toISOString(),
    };

    const sent: number[] = [];
    await terminateRun(
      { path: await writeRunRecord(env, record), record },
      {
        settle,
        attempts: 1,
        io: {
          stat: procStat,
          kill: (pid) => {
            expect(pid, "no negative pid may be sent for a process that leads no group").toBeGreaterThan(0);
            sent.push(pid);
          },
          listPids: () => [attached.pid, process.pid],
        },
      },
    );
    expect(sent).toContain(attached.pid);
  });

  test("a real detached child really dies, and the survivors list is then empty", async () => {
    // The end-to-end one. The record names the *child* as the turn's process,
    // so nothing here signals the test runner: `terminateRun` looks for
    // children of the child (there are none) and then signals the child, which
    // is detached and therefore its own group.
    const env = await sandbox();
    const child = spawnChild(true);
    expect(await until(() => procStat(child.pid) !== null)).toBe(true);
    const stat = procStat(mine(child.pid))!;
    expect(stat.pgid).toBe(child.pid);

    const record: RunRecord = {
      schema: RUN_SCHEMA,
      turnId: "f3",
      subject: SUBJECT,
      backends: ["claude"],
      pid: child.pid,
      pgid: stat.pgid,
      pidStart: stat.startTicks,
      startedAt: new Date().toISOString(),
    };

    const report = await terminateRun({ path: await writeRunRecord(env, record), record }, { settle });

    expect(report.liveness).toBe("live");
    expect(report.signalled.some((entry) => entry.pid === child.pid && entry.how === "group")).toBe(
      true,
    );
    // Bounded, not timed: the bound is here to catch a signal that never went,
    // and a slow machine must not make it red (D-028).
    expect(await until(() => procStat(child.pid) === null || child.killed)).toBe(true);
    expect(report.survivors).toEqual([]);
    expect(report.refusal).toBeUndefined();
  });
});
