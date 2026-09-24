/**
 * `ohmyagi erase <subject>` — compose the deleters that exist, and refuse to
 * certify what was not looked at.
 *
 * Three commands could already delete something before this story:
 * `ledger forget --all`, `observe purge`, and `soul apply`'s inverse
 * {@link import("../soul/block.ts").strip}. What was missing was not a fourth
 * deleter; it was the thing that runs all of them for one subject, counts what
 * is left **from disk**, searches for the identifier afterwards, and says out
 * loud which of AC1's five places it did not visit because they do not exist
 * yet. So this file writes no new deletion logic: every removal below goes
 * through `planPurgeDir`/`commitPurge`, `planForget`/`commitForget`, or
 * `strip`.
 *
 * ## Three functions, and the split is the safety property
 *
 * {@link planErase} reads and decides and writes nothing. {@link commitErase}
 * takes the plan and **no environment**, so it cannot act on a path the plan
 * never resolved. {@link verifyErase} runs afterwards and re-reads the
 * filesystem: every count in the report comes back off the disk rather than out
 * of the plan's own arithmetic, which is the difference between evidence and a
 * tautology (`test/observer/purge.test.ts` has the control that shows why).
 *
 * A dry run is the absence of the second call, exactly as in `soul apply`.
 *
 * ## What refuses the whole run
 *
 * `refusals` is non-empty and the command exits 1 **without a certificate**
 * when any of these holds:
 *
 * - a `not-built` place has something at the address D-014 reserves for it.
 *   om-agi has no deleter for a vector collection or an adapter, and a
 *   certificate that listed the place as handled would be the precise lie AC1
 *   invites;
 * - a vendor instruction file holds a block whose body was hand-edited, or a
 *   marker om-agi cannot read. `strip` refuses those, and so does this;
 * - a tree that has to go is a symlink, so deleting it would reach outside the
 *   path the certificate names.
 *
 * ## `--personal`, and the part the owner decided
 *
 * `--personal` (AC5, D-010) removes `person.md`, the whole personal directory,
 * the applied blocks, the backups, `.dagi/` — and **the whole ledger**. The
 * ledger has no per-record personal flag, so it cannot be split; D-022 records
 * that nothing reads it back into any behaviour, so nothing an agent does is
 * lost. That is a decision about what om-agi *cannot* separate, and the output
 * says so in those words rather than implying the ledger was personal.
 *
 * What stays: `role.md`, `memory/`, `consent/`. And then their contents are
 * *checked*, because separate files are not separate contents: the values
 * `person.md` held are searched for in what was kept, reported as `file:line`,
 * and never deleted for you (see {@link verifyErase}).
 */

import { rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runsDirFor } from "../decide/runs.ts";
import { historyFacts, historySentence, type HistoryFacts } from "../guard/history.ts";
import { personalDir } from "../guard/personal.ts";
import {
  commitForget,
  planForget,
  removeLedgerDirAt,
  type ForgetPlan,
  type ForgetResult,
  type LedgerEnv,
} from "../ledger/store.ts";
import {
  census,
  commitPurge,
  planPurgeDir,
  type Census,
  type PurgePlan,
} from "../observer/store.ts";
import { confirmationsDirFor } from "../decide/confirm.ts";
import { triggersDirFor } from "../decide/triggers.ts";
import { a2aDirFor } from "../a2a/peers.ts";
import { chatDirFor } from "../connectors/users.ts";
import { collectionFor } from "../memory/collection.ts";
import { ragDirFor, readRagMarker, type RagMarker } from "../memory/marker.ts";
import {
  collectionState,
  dropCollection,
  type CollectionState,
} from "../memory/store-admin.ts";
import { vectorEndpoints } from "../memory/endpoints.ts";
import { dataRoot, stateRoot } from "../state.ts";
import type { SubjectId } from "../types.ts";
import { notBuiltPlaces, type PlaceId } from "./places.ts";
import {
  searchScopes,
  searchTree,
  type Needle,
  type Scope,
  type SearchReport,
} from "./search.ts";
import {
  backupTree,
  commitBlocks,
  dagiTree,
  manifestTargets,
  personFile,
  planBlocks,
  soulTree,
  type BlockRemoval,
  type BlockRemovalResult,
} from "./soul.ts";

/** Everything the engine is allowed to know about this machine. */
export interface EraseEnv {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
}

/** Everything om-agi deletes, or only the personal half of it (AC5). */
export type EraseScope = "all" | "personal";

/** What the command line asked for, with nothing inferred. */
export interface EraseRequest {
  readonly subject: SubjectId;
  /**
   * The agent repository, or `null` for `--no-agent`.
   *
   * Required rather than inferred: there is no subject→repository registry, and
   * a directory name is a hint while an identity is a claim (I-3). `--no-agent`
   * is recorded on the certificate as *not examined, at the requester's word*.
   */
  readonly agentDir: string | null;
  readonly scope: EraseScope;
  /** Who asked, in their own words. Recorded as claimed; om-agi checks nothing. */
  readonly by: string;
  /** Extra text to look for. Counted on the certificate, never quoted. */
  readonly needles: readonly string[];
  /** Instruction files the vendor registry resolves. Unioned with the manifests. */
  readonly instructionFiles: readonly string[];
  /** The soul's display name, read before anything is deleted. */
  readonly soulName: string | null;
  /** Values `person.md` held, so AC5 can look for them in what is kept. */
  readonly personalValues: readonly string[];
}

/** One tree that goes whole, planned by the observer's walker. */
export interface TreeTarget {
  readonly place: PlaceId;
  readonly label: string;
  readonly plan: PurgePlan;
}

/** A reserved address for a place that has no deleter, and what is at it now. */
export interface ReservedProbe {
  readonly place: PlaceId;
  readonly owedBy: string;
  readonly path: string | null;
  readonly census: Census | null;
}

/**
 * The subject's vector collection, as the plan found it (S4.1, D-038).
 *
 * `url` is where the commit will drop it, resolved here so the commit takes no
 * environment. `null` when there is nowhere to ask: the environment names no
 * loopback store and om-agi holds no marker saying it ever wrote one.
 */
export interface VectorProbe {
  readonly collection: string;
  readonly url: string | null;
  /** The marker `memory index` leaves before it writes, or why it could not be read. */
  readonly marker: RagMarker | "unreadable" | null;
  /** `null` when {@link url} is. */
  readonly state: CollectionState | null;
}

/** Everything a run would do, worked out before anything is touched. */
export interface ErasePlan {
  readonly subject: SubjectId;
  readonly scope: EraseScope;
  readonly by: string;
  /** ISO instant the plan was made, from the injected clock. */
  readonly at: string;
  readonly agentDir: string | null;
  readonly stateRoot: string;
  readonly dataRoot: string;
  readonly trees: readonly TreeTarget[];
  /** Single files that go — `person.md` under `--personal`, nothing otherwise. */
  readonly files: readonly string[];
  /**
   * Directories left holding nothing but the subject's name.
   *
   * `$XDG_DATA_HOME/om-agi/<subject>/` is the case: its only child is
   * `personal/`, which goes whole, and what would be left is an empty directory
   * whose *name* is the identifier AC3 says must be findable nowhere. Removed
   * with a plain `rmdir`, which fails harmlessly if anything else is in there —
   * om-agi has then miscounted and leaving the evidence is the right move.
   */
  readonly emptyParents: readonly string[];
  readonly blocks: readonly BlockRemoval[];
  readonly ledger: ForgetPlan;
  readonly reserved: readonly ReservedProbe[];
  readonly vector: VectorProbe;
  /** Backup manifests that could not be read. Reported, never fatal. */
  readonly unreadableManifests: readonly string[];
  /** What the verification will look for. Built before deletion, on purpose. */
  readonly needles: readonly Needle[];
  /** AC5's needles: the values `person.md` held. Empty outside `--personal`. */
  readonly personalNeedles: readonly Needle[];
  readonly scopes: readonly Scope[];
  /**
   * What git already holds, counted locally and never searched.
   *
   * `null` under `--no-agent`, and **only** under `--no-agent`: "nobody asked"
   * and "asked, and git would not say" are two different things to tell the
   * person holding the certificate, so the second lives in
   * {@link HistoryFacts}'s own unreadable arm rather than in this `null`.
   *
   * The commit count is read with `git rev-list`, which is on `spawnGuarded`'s
   * allowlist and reaches no remote; the *contents* of the object database are
   * deliberately not grepped, because a zero there would take a history rewrite
   * to become true and om-agi does not rewrite history for anybody
   * (GIT_UNDELETABLE's last line).
   */
  readonly git: HistoryFacts | null;
  /** Non-empty means: do not delete, do not certify, exit 1. */
  readonly refusals: readonly string[];
  /** Things a reader is entitled to know that are not refusals. */
  readonly notes: readonly string[];
}

/** A subject id is not a word; the needle is, and this is how it is labelled. */
const SUBJECT_NEEDLE = "subject id";

/**
 * Decide what would happen, touching nothing.
 *
 * Read-only by construction: the only filesystem calls reachable from here are
 * `readdir`, `stat` and reads.
 */
export async function planErase(
  env: EraseEnv,
  request: EraseRequest,
): Promise<ErasePlan> {
  const { subject, agentDir, scope } = request;
  const state = stateRoot(env.home, env.env);
  const data = dataRoot(env.home, env.env);
  const refusals: string[] = [];
  const notes: string[] = [];

  // --- the trees, and the one file ---------------------------------------
  const wanted: { place: PlaceId; label: string; dir: string }[] = [];
  const files: string[] = [];

  if (agentDir === null) {
    notes.push(
      "--no-agent: no repository was examined. soul/, .dagi/ and the working tree are recorded " +
        "on the certificate as not examined, at the requester's word.",
    );
  } else {
    if (scope === "all") {
      wanted.push({ place: "soul", label: "the soul in git", dir: soulTree(agentDir) });
    } else {
      files.push(personFile(agentDir));
      notes.push(
        "--personal keeps role.md, memory/ and consent/. The soul will not load again until a " +
          "new person.md is written: a soul is two files and the loader requires both.",
      );
    }
    wanted.push({ place: "soul", label: "the derived directory", dir: dagiTree(agentDir) });
  }

  wanted.push({ place: "soul", label: "the apply backups", dir: backupTree(env, subject) });
  // Who confirmed level 3 for this subject's dial, and when (D-042). Keyed by
  // subject since the erase that would otherwise have walked past it.
  wanted.push({ place: "soul", label: "the level-3 confirmations", dir: confirmationsDirFor(env, subject) });

  // The record that a vector collection was written for this subject. It names
  // the subject, so it goes like any other tree; it is read first, below.
  const ragDir = ragDirFor(env.home, env.env, subject);
  wanted.push({ place: "rag", label: "the record of where vectors were written", dir: ragDir });

  // The run records (S5.4). Under the `ledger` place rather than a sixth id:
  // AC1 names five places and `src/erase/places.ts` is closed to exactly those
  // five, and these records belong to the same fact the ledger holds — a turn,
  // keyed by the same turn id, under the same state root, withdrawn by the same
  // request. What is different is only that these describe a turn *in flight*.
  //
  // It is not optional politeness: `verifyErase` searches the whole state root
  // for the identifier afterwards, so a record left behind would turn every
  // erase into `erased-with-remainder` — a true report of a mess this file made.
  wanted.push({
    place: "ledger",
    label: "run records for turns that were in flight",
    dir: runsDirFor(env, subject),
  });
  // When each scheduled trigger last fired (S5.3 AC6). Under `ledger` for the
  // reason the run records are: it is a fact about turns, keyed by subject.
  wanted.push({ place: "ledger", label: "when each trigger last fired", dir: triggersDirFor(env, subject) });
  // The A2A peer list (D-063): who this subject's agent may talk to, with the
  // tokens issued to them. Under `ledger` beside the other per-subject state;
  // the inbox itself is under the personal directory and goes with it.
  wanted.push({ place: "ledger", label: "the A2A peers and their tokens", dir: a2aDirFor(env, subject) });
  // Who the agent answers in chat apps, who has been told it is an AI, and
  // where each platform was read up to (D-066). The messages are in the ledger.
  wanted.push({ place: "ledger", label: "the chat allowlist and who has been told", dir: chatDirFor(env, subject) });

  const emptyParents: string[] = [];
  const personal = await personalDir(env, subject);
  if (!personal.ok) {
    refusals.push(`the personal directory cannot be resolved: ${personal.reason}`);
  } else {
    wanted.push({
      place: "observer",
      // Named for what goes, not for the place id it is counted under: the raw
      // capture tree and the proposal store (S5.2, D-029) are both subtrees of
      // this one directory, and a certificate that said "observer record" while
      // removing somebody's proposals would be claiming to have deleted less
      // than it deleted — which is I-4's second half read backwards.
      label: "the personal directory (raw capture and the proposal store live under it)",
      dir: personal.path,
    });
    emptyParents.push(dirname(personal.path));
  }

  const trees: TreeTarget[] = [];
  for (const target of wanted) {
    const planned = await planPurgeDir(subject, target.dir);
    if ("ok" in planned) {
      refusals.push(`${target.label}: ${planned.reason}`);
      continue;
    }
    trees.push({ place: target.place, label: target.label, plan: planned });
  }

  // --- the blocks ---------------------------------------------------------
  const manifests = await manifestTargets(backupTree(env, subject));
  const blocks = await planBlocks(
    [...request.instructionFiles, ...manifests.paths],
    subject,
  );
  for (const block of blocks) {
    if (block.outcome === "refused") {
      refusals.push(`${block.path}: ${block.reason ?? "refused"}`);
    }
  }

  // --- the ledger ---------------------------------------------------------
  const ledgerEnv: LedgerEnv = { home: env.home, env: env.env, now: env.now };
  const ledger = await planForget(ledgerEnv, subject, { kind: "all" });
  if (scope === "personal" && ledger.matched.length > 0) {
    notes.push(
      `the whole ledger goes (${ledger.matched.length} line(s)) because om-agi cannot split it, ` +
        `not because all of it is personal: a ledger line carries no per-record personal flag, ` +
        `so there is no query that would keep the work turns and drop the rest. D-022 records ` +
        `that nothing reads the ledger back into an agent's behaviour, so no work knowledge is ` +
        `lost with it — but conversations about work are in there and they are going too.`,
    );
  }

  // --- the vector collection (S4.1, D-038) --------------------------------
  const vector = await probeVector(env, subject, ragDir, refusals, notes);

  // --- the places that are not built --------------------------------------
  const reserved: ReservedProbe[] = [];
  for (const place of notBuiltPlaces()) {
    const path =
      agentDir === null || place.reserved === undefined ? null : join(agentDir, place.reserved);
    const counted = path === null ? null : await census(path);
    reserved.push({ place: place.id, owedBy: place.owedBy ?? "unassigned", path, census: counted });
    if (counted !== null && counted.files > 0) {
      refusals.push(
        `${path} holds ${counted.files} file(s), and the ${place.id} place has no deleter ` +
          `(${place.owedBy} owes it). om-agi will not certify a deletion over a directory ` +
          `nothing in this repository claims — remove it yourself, or land ${place.owedBy} first.`,
      );
    }
  }

  // --- what the verification will look for --------------------------------
  // Deduplicated by text. A soul whose display name is its subject id is
  // ordinary, and counting the same byte sequence twice would double every
  // number a reader is meant to act on.
  const needles: Needle[] = [];
  const addNeedle = (needle: Needle): void => {
    if (needle.text === "" || needles.some((seen) => seen.text === needle.text)) return;
    needles.push(needle);
  };
  addNeedle({ label: SUBJECT_NEEDLE, text: subject, boundary: true, quotable: true });
  if (request.soulName !== null) {
    addNeedle({ label: "soul name", text: request.soulName, boundary: false, quotable: false });
  }
  request.needles.forEach((text, index) => {
    addNeedle({ label: `--needle #${index + 1}`, text, boundary: false, quotable: false });
  });

  const personalNeedles: Needle[] =
    scope === "personal"
      ? request.personalValues
          .filter((value) => value !== "")
          .map((value, index) => ({
            label: `person.md value #${index + 1}`,
            text: value,
            boundary: false,
            quotable: false,
          }))
      : [];

  const scopes: Scope[] = [
    { label: "state root", kind: "deletable", tree: state },
    { label: "data root", kind: "deletable", tree: data },
    {
      label: "vendor instruction files",
      kind: "deletable",
      files: [...new Set([...request.instructionFiles, ...manifests.paths])],
    },
  ];
  if (agentDir !== null) {
    scopes.push({ label: "the agent working tree (minus .git)", kind: "git", tree: agentDir });
  }

  if (manifests.unreadable.length > 0) {
    notes.push(
      `${manifests.unreadable.length} backup manifest(s) could not be read, so any instruction ` +
        `file named only by them was not visited. They are deleted with the backup tree either ` +
        `way; the files they pointed at may still hold a block.`,
    );
  }
  // `null` means `--no-agent` — nobody was asked. It no longer doubles as
  // "asked, and the answer could not be read": `historyFacts` says that itself
  // now, because the `.catch(() => null)` here never fired (`runGuarded`
  // returns a non-zero code rather than throwing) and a certificate was
  // printing `0 commit(s) · no remote configured` about repositories git had
  // declined to read (odd2 H3).
  const git = agentDir === null ? null : await historyFacts(agentDir);
  if (git !== null) {
    notes.push(
      `om-agi does not commit and does not rewrite history (D-013, S0.4 AC2). Removing files ` +
        `from the working tree leaves the repository dirty, and every version already committed ` +
        `stays reachable — \`git log -p\` still prints what it held. ${historySentence(git)}.`,
    );
    if (git.readable && git.remotes.length > 0) {
      notes.push(
        `every copy those remotes hold is beyond this command, and om-agi cannot see what a ` +
          `remote it does not know about received.`,
      );
    }
    if (!git.readable && git.why === "unreadable") {
      notes.push(
        `this directory is a repository that git declined to read, so nothing below is a ` +
          `statement about its history. A count of zero would have been one.`,
      );
    }
    if (!git.readable && git.why === "no-git") {
      notes.push(
        `there is no git on this machine, so this directory was never asked whether it is a ` +
          `repository. The working tree was still visited and is still erased from; what a ` +
          `history here might hold is outside every number below, and so is whether there is ` +
          `one at all.`,
      );
    }
  }

  return {
    subject,
    scope,
    by: request.by,
    at: env.now().toISOString(),
    agentDir,
    stateRoot: state,
    dataRoot: data,
    trees,
    files,
    emptyParents,
    blocks,
    ledger,
    reserved,
    vector,
    unreadableManifests: manifests.unreadable,
    needles,
    personalNeedles,
    scopes,
    git,
    refusals,
    notes,
  };
}

/**
 * Find the collection, and decide whether this run may certify over it.
 *
 * The marker wins over the environment: it says where om-agi actually wrote,
 * and an `OM_AGI_QDRANT_URL` changed since then would otherwise send the
 * question to a store that was never written to and hear "absent".
 */
async function probeVector(
  env: EraseEnv,
  subject: SubjectId,
  ragDir: string,
  refusals: string[],
  notes: string[],
): Promise<VectorProbe> {
  const collection = collectionFor(subject);
  const marker = await readRagMarker(ragDir);
  const configured = vectorEndpoints(env.env);
  const url =
    marker !== null && marker !== "unreadable"
      ? marker.qdrantUrl
      : configured.ok
        ? configured.endpoints.qdrantUrl
        : null;

  if (url === null) {
    if (marker === "unreadable") {
      refusals.push(
        `${ragDir} records that vectors were written for this subject, and cannot be read to say ` +
          `where. Nothing was certified: the collection ${collection} may still exist.`,
      );
    } else if (!configured.ok) {
      notes.push(
        `no vector store was asked (${configured.reason}), and om-agi holds no record of writing ` +
          `one for this subject.`,
      );
    }
    return { collection, url: null, marker, state: null };
  }

  const state = await collectionState(url, subject);
  if (state.kind === "unreachable") {
    if (marker !== null) {
      refusals.push(
        `om-agi wrote vectors for this subject to ${url} and cannot reach it now ` +
          `(${state.reason}). Nothing was certified: the collection ${collection} may still hold ` +
          `their text. Run again when the store is up.`,
      );
    } else {
      notes.push(
        `the vector store at ${url} did not answer (${state.reason}). om-agi holds no record of ` +
          `writing to it for this subject, so this is reported rather than refused — a ` +
          `collection written there by something else is outside this run.`,
      );
    }
  }
  return { collection, url, marker, state };
}

/** One tree, after the deletions, counted again from disk. */
export interface TreeResult {
  readonly place: PlaceId;
  readonly label: string;
  readonly dir: string;
  readonly removed: number;
  readonly failed: readonly { readonly path: string; readonly reason: string }[];
  readonly remaining: Census;
  readonly dirRemoved: boolean;
}

/** What the run actually did. Every number here is observed, none derived. */
export interface EraseResult {
  readonly trees: readonly TreeResult[];
  readonly files: readonly { readonly path: string; readonly removed: boolean; readonly reason?: string }[];
  /** Directories whose only remaining content was the subject's own name. */
  readonly emptyParents: readonly { readonly path: string; readonly removed: boolean }[];
  readonly blocks: readonly BlockRemovalResult[];
  readonly ledger: ForgetResult;
  readonly ledgerDirRemoved: boolean;
  /** `null` when the plan found no collection to drop. */
  readonly vector: { readonly dropped: boolean; readonly reason?: string } | null;
}

/**
 * Carry out the plan.
 *
 * Takes no {@link EraseEnv}. Everything it needs was resolved by
 * {@link planErase}, which is what makes "the dry run and the write agree about
 * what would happen" a property of the code rather than a hope.
 *
 * @throws {Error} when the ledger lock is held. A partial deletion reported as
 *   a success is the worst outcome available here, so it is not swallowed.
 */
export async function commitErase(plan: ErasePlan): Promise<EraseResult> {
  const trees: TreeResult[] = [];
  for (const tree of plan.trees) {
    const result = await commitPurge(tree.plan);
    trees.push({
      place: tree.place,
      label: tree.label,
      dir: tree.plan.dir,
      removed: result.removed.length,
      failed: result.failed,
      remaining: result.remaining,
      dirRemoved: result.dirRemoved,
    });
  }

  const files: { path: string; removed: boolean; reason?: string }[] = [];
  for (const path of plan.files) {
    try {
      await unlink(path);
      files.push({ path, removed: true });
    } catch (cause) {
      files.push({ path, removed: false, reason: String(cause) });
    }
  }

  const blocks = await commitBlocks(plan.blocks);

  const emptyParents: { path: string; removed: boolean }[] = [];
  for (const path of plan.emptyParents) {
    emptyParents.push({
      path,
      removed: await rmdir(path).then(
        () => true,
        () => false,
      ),
    });
  }

  const ledger = await commitForget(plan.ledger);
  // The lock lives inside the directory, so it can only go once `commitForget`
  // has released it — the same order `ledger forget --all` uses.
  const ledgerDirRemoved =
    plan.ledger.matched.length > 0 ? await removeLedgerDirAt(plan.ledger.dir) : false;

  // The collection goes whole or not at all: D-035 measured per-point deletes
  // leaving the text on disk, and the client has no such call.
  const vector =
    plan.vector.url !== null && plan.vector.state?.kind === "present"
      ? await dropCollection(plan.vector.url, plan.subject)
      : null;

  return { trees, files, emptyParents, blocks, ledger, ledgerDirRemoved, vector };
}

/** The verdict. Never a boolean: "clean" and "clean enough" are different facts. */
export type EraseVerdict =
  /** Nothing was written. What is printed is what `--yes` would do. */
  | "dry-run"
  /**
   * Nothing of this subject was here, so nothing was erased.
   *
   * Not a certificate of erasure, and the certificate says so in words. It is
   * its own verdict rather than a flavour of `erased-and-verified` because the
   * two are different sentences: *this machine held nothing under that id* and
   * *what this machine held under that id is gone*. The first is also what a
   * mistyped id produces, with the real data sitting untouched one character
   * away, which is the failure I-4 is about.
   *
   * It does **not** distinguish "never existed here" from "an earlier run
   * erased it". Nothing can: both leave the same bytes on disk by design
   * (`search.ts` says so, `commitForget` leaves no tombstone, and the
   * certificate is issued and never kept). The only thing that could tell them
   * apart is a retained record that this subject was erased — itself a trace of
   * the subject, and one the next run's AC3 search would find.
   */
  | "nothing-found"
  /** Everything deletable went, and the identifier is findable nowhere in it. */
  | "erased-and-verified"
  /** It went, and something the owner has to decide about is still findable. */
  | "erased-with-remainder";

/**
 * What was there **before** anything was deleted, out of the plan.
 *
 * The plan is the only place this can come from: after the deletion these are
 * all zero on a run that worked and on a run that had nothing to do, which is
 * the very collapse this file exists to undo.
 */
export interface EraseFound {
  readonly files: number;
  readonly ledgerLines: number;
  /** 1 when the subject's vector collection existed, else 0. */
  readonly collections: number;
  /**
   * Applied blocks in vendor instruction files that are **this subject's**.
   *
   * `other-subject` is not counted, and the distinction is I-3's: a block
   * belonging to somebody else in a file this run happened to open is not a
   * trace of this subject, and counting it would let a machine full of other
   * people's identities turn a mistyped id into a run that "found" something.
   */
  readonly blocks: number;
  readonly total: number;
}

/**
 * What the run actually removed, counted from {@link EraseResult}.
 *
 * Directories are counted beside files, and that is a decision rather than
 * bookkeeping: `$XDG_DATA_HOME/om-agi/<subject>/` with nothing in it is still
 * the identifier AC3 says must be findable nowhere, and removing it is a real
 * removal. A `census` cannot see such a directory at all — an empty one and an
 * absent one are both `0 files, 0 directories` — so the *only* evidence that
 * one was there is that `rmdir` succeeded. Measured, not assumed:
 * `commitPurge`'s `dirRemoved` is true for a directory that existed and false
 * for one that never did.
 */
export interface EraseRemoved {
  readonly files: number;
  readonly directories: number;
  readonly ledgerLines: number;
  /** 1 when the collection was dropped, else 0. */
  readonly collections: number;
  readonly blocks: number;
  readonly total: number;
}

/** Add up what the plan saw, before a single unlink. */
export function whatWasFound(plan: ErasePlan): EraseFound {
  const files = plan.trees.reduce((total, tree) => total + tree.plan.before.files, 0);
  const ledgerLines = plan.ledger.matched.length;
  const blocks = plan.blocks.filter((block) => block.outcome === "strip").length;
  const collections = plan.vector.state?.kind === "present" ? 1 : 0;
  return { files, ledgerLines, collections, blocks, total: files + ledgerLines + collections + blocks };
}

/** Add up what really went, from the result and never from the plan. */
export function whatWasRemoved(result: EraseResult): EraseRemoved {
  const files =
    result.trees.reduce((total, tree) => total + tree.removed, 0) +
    result.files.filter((file) => file.removed).length;
  const directories =
    result.trees.filter((tree) => tree.dirRemoved).length +
    result.emptyParents.filter((parent) => parent.removed).length +
    (result.ledgerDirRemoved ? 1 : 0);
  const ledgerLines = result.ledger.removed;
  const blocks = result.blocks.filter((block) => block.removed).length;
  const collections = result.vector?.dropped === true ? 1 : 0;
  return {
    files,
    directories,
    ledgerLines,
    collections,
    blocks,
    total: files + directories + ledgerLines + collections + blocks,
  };
}

/** The re-read. Every number is taken from the filesystem after the deletions. */
export interface EraseVerification {
  readonly search: SearchReport;
  /** AC5: the values `person.md` held, looked for in the files that were kept. */
  readonly personal: SearchReport | null;
  /** Files still under a tree that was supposed to be emptied. */
  readonly remainingFiles: number;
  /** Files om-agi tried and failed to delete. */
  readonly failures: number;
  /**
   * The collection, asked about again after the drop. `null` when there was
   * nowhere to ask; otherwise what the store said *now*, never what the drop
   * returned.
   */
  readonly vectorAfter: CollectionState | null;
  /** What the plan saw before the deletion. The verdict turns on this. */
  readonly found: EraseFound;
  /** What the run removed. `erased-and-verified` requires this to be non-zero. */
  readonly removed: EraseRemoved;
  /**
   * Regular files whose bytes the search really read, over every scope.
   *
   * Evidence of *how much was looked at*, never a verdict on its own: a zero is
   * an empty machine **or** an id whose data is somewhere this run cannot see,
   * and a number above zero is a machine with other people's data on it and
   * nothing of this subject's — which is precisely what a mistyped id looks
   * like. It goes on the certificate so a reader can tell those apart; the
   * verdict is decided by {@link found} and {@link removed}.
   */
  readonly filesRead: number;
  /**
   * Scopes the search could not read at all, by label.
   *
   * `searchTree` answers zero hits for a root it could not open, exactly as it
   * does for a root that is not there, and only `unreadable` separates them. A
   * scope nobody could look into is not a scope that was found clean, so any
   * entry here keeps the verdict away from `erased-and-verified` **and** away
   * from `nothing-found`.
   */
  readonly unreadableScopes: readonly string[];
  readonly verdict: EraseVerdict;
}

/**
 * Read it all back, and decide.
 *
 * `erased-and-verified` needs five things at once: nothing left under any tree,
 * no deletion that failed, zero hits in every `deletable` scope, no scope that
 * could not be read — and **something actually removed**. A hit in the agent's
 * working tree — `memory/` naming its own subject is the ordinary case — is a
 * **remainder**: it is reported with `file:line`, it is never deleted, and it
 * makes the verdict `erased-with-remainder`. A real agent whose notes mention
 * the subject may never get a clean verdict, and that is the honest answer
 * rather than a gate that opens by not looking.
 *
 * ## Why `removed > 0` is in that list
 *
 * Every other arm is a count that reads zero for *clean* and zero for *there
 * was never anything here*, so a run over a subject this machine has never held
 * used to earn the full verdict having read no file at all. The discriminator
 * is not how much was read: a **mistyped id on a machine holding somebody
 * else's data** reads plenty of files, finds nothing, removes nothing, and is
 * the most dangerous shape this command has — a confident certificate while the
 * real data sits one character away, untouched. What separates a withdrawal
 * from a misfire is whether anything was *found before* and *went*, and both of
 * those are already known: {@link whatWasFound} from the plan, and
 * {@link whatWasRemoved} from the result.
 */
export async function verifyErase(
  plan: ErasePlan,
  result: EraseResult,
): Promise<EraseVerification> {
  const search = await searchScopes(plan.scopes, plan.needles);

  let personal: SearchReport | null = null;
  if (plan.personalNeedles.length > 0 && plan.agentDir !== null) {
    const kept = await searchTree(
      "files kept by --personal (role.md, memory/, consent/)",
      plan.agentDir,
      plan.personalNeedles,
    );
    personal = { scopes: [{ ...kept, kind: "git" }], deletableHits: 0, gitHits: kept.hits.length };
  }

  // Counted from disk rather than from `result`: a commit that subtracted its
  // own successes from its own plan would report zero on a run where a file it
  // never managed to unlink is still sitting there.
  let remainingFiles = 0;
  for (const tree of plan.trees) {
    remainingFiles += (await census(tree.plan.dir)).files;
  }

  const vectorAfter =
    plan.vector.url === null || plan.vector.state?.kind === "unreachable"
      ? null
      : await collectionState(plan.vector.url, plan.subject);
  const vectorLeft = vectorAfter !== null && vectorAfter.kind !== "absent";

  const failures =
    (result.vector !== null && !result.vector.dropped ? 1 : 0) +
    result.files.filter((file) => !file.removed).length +
    result.blocks.filter((block) => block.outcome === "refused").length +
    result.trees.reduce((total, tree) => total + tree.failed.length, 0);

  const filesRead = search.scopes.reduce((total, scope) => total + scope.filesRead, 0);
  const unreadableScopes = [...search.scopes, ...(personal?.scopes ?? [])]
    .filter((scope) => scope.unreadable !== undefined)
    .map((scope) => scope.label);

  const found = whatWasFound(plan);
  const removed = whatWasRemoved(result);

  const clean =
    !vectorLeft &&
    remainingFiles === 0 &&
    failures === 0 &&
    search.deletableHits === 0 &&
    search.gitHits === 0 &&
    unreadableScopes.length === 0 &&
    (personal === null || personal.gitHits === 0);

  // The order is the argument. Anything not clean is a remainder whatever else
  // happened; a clean run that removed something is a withdrawal; a clean run
  // that found nothing and removed nothing is a run over a subject that is not
  // here. The last line is the state that should not occur — the plan saw
  // something, nothing went, and nothing was left to find — and it is given the
  // conservative verdict rather than the flattering one.
  const verdict: EraseVerdict = !clean
    ? "erased-with-remainder"
    : removed.total > 0
      ? "erased-and-verified"
      : found.total === 0
        ? "nothing-found"
        : "erased-with-remainder";

  return {
    search,
    personal,
    remainingFiles,
    failures,
    vectorAfter,
    found,
    removed,
    filesRead,
    unreadableScopes,
    verdict,
  };
}
