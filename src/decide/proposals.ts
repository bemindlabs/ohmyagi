/**
 * Proposals — what was asked for before it was done, and the refusals nobody is
 * allowed to forget.
 *
 * ## Why this is not in the ledger (D-029)
 *
 * S5.2 AC2 asks for a memory: *การปฏิเสธถูกจำ — ไม่เสนอเรื่องเดิมซ้ำโดยไม่มีอะไรใหม่*.
 * A memory is something read back into the next decision, and the ledger is the
 * one store in om-agi that may never be read back into one (S2.2 AC5, D-022):
 * `ledger forget` would otherwise bring back every proposal the owner had
 * already said no to. The owner decided on 2026-09-22 (D-029) that proposals and
 * their outcomes get a **store of their own**, D-022 is not relaxed, and the
 * guard over it (`test/ledger/read-back.test.ts`) is not touched.
 *
 * So nothing here imports `src/ledger/`, and nothing in `src/ledger/` knows this
 * file exists. The two record different things: the ledger records that a turn
 * *happened*, this records what was *asked and answered*.
 *
 * ## The address, and why it is not a sixth place
 *
 * `$XDG_DATA_HOME/om-agi/<subject>/personal/proposals/<id>.json` — under
 * {@link import("../guard/personal.ts").personalDir}, the same tree raw capture
 * lives in (D-025). `what`, `why` and `impact` are free text about what the
 * owner does, which is the one category that may not be in git at all (S3.2 AC5,
 * D-014), and three properties come with that address rather than being
 * re-implemented here: the path is refused outright if it resolves inside a git
 * repository, the pre-commit scan's `personal-path` rule blocks anything staged
 * under a `personal/` directory at any depth, and the tree is created 0700.
 *
 * It is deliberately *not* a sixth `PlaceId`. S7.2 AC1 names five places and
 * `src/erase/places.ts` is closed to exactly those five; D-025 refused to put a
 * personal record outside `personal/` for this reason, and the same argument
 * applies here word for word. The cost is that `tsc` would not go red if
 * somebody moved this store out from under `personal/` — so
 * `test/decide/proposals.test.ts` asserts the containment, and
 * `test/erase/plan.test.ts` measures the consequence: a canary seeded here is
 * gone after `erase`, and a control file placed outside `personal/` is not.
 *
 * ## Deleting this store is allowed to change something
 *
 * Unlike the ledger, whose whole promise is that removing it changes nothing,
 * removing this one makes the agent forget that it was told no. That is not a
 * side effect — it is this store's entire job, and `rm` is how an owner says
 * *ask me again*. One file per proposal, so that is true of one refusal too.
 *
 * ## "The same thing" is exact, and the miss is said out loud
 *
 * {@link proposalKey} is NFC, trim, collapse runs of whitespace, lower-case.
 * That is all of it, and it is describable in one sentence on purpose: a fuzzy
 * comparison decides for the owner which two requests are "really" the same, and
 * gets it wrong in both directions without saying so. The cost is real and is
 * not hidden — **change one word in `what` and the refusal no longer bites**. It
 * is paid for at the other end: every command that files or decides a proposal
 * prints the subject's refusals in full, every time, so that the wide comparison
 * is made by a person looking at the list rather than by a regular expression
 * pretending to.
 *
 * `--changed <text>` is the declared way past a refusal, and it is recorded:
 * {@link Proposal.supersedes} names the proposal it is answering and
 * {@link Proposal.changed} says what is new. Somebody who wants to slip a
 * refused idea through can still reword `what`; the difference is that this way
 * leaves a record saying they did.
 *
 * ## An approval is spent once
 *
 * The owner's decision, 2026-09-22: *"อนุมัติต่อ proposal และใช้ได้ครั้งเดียว"* —
 * per proposal, and good for one turn. A standing approval is how "I allowed it
 * once" becomes "it has been doing that ever since", with nothing to show when
 * the old permission was used again. {@link spendProposal} writes the turn id
 * into the record, and {@link spendability} refuses a second one.
 *
 * ## Paths are never built from an argument
 *
 * A caller looks a proposal up by reading the directory and matching
 * {@link Proposal.id}, never by joining the id onto a path — see
 * {@link findProposal}. The only id this module ever puts in a filename is one
 * it was handed for a record it is writing, and `proposal new` generates that
 * with `crypto.randomUUID()`. `../../etc/passwd` is therefore not a filename
 * here; it is an id that matches no record.
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ensurePersonalDir,
  personalDir,
  type PersonalDir,
  type PersonalEnv,
} from "../guard/personal.ts";
import { STATE_DIR_MODE, STATE_FILE_MODE } from "../state.ts";
import type { SubjectId } from "../types.ts";

/** Schema tag every proposal file carries. Bumped when the shape changes. */
export const PROPOSAL_SCHEMA = "om-agi/proposal@1";

/** The directory under a subject's personal directory. One word, declared once. */
export const PROPOSALS_DIR = "proposals";

/** The machine facts this store may see — all of them arguments, as ever. */
export type ProposalEnv = PersonalEnv;

/**
 * `personalDir(subject)/proposals/`, if that is outside git — resolved, not created.
 *
 * Split from {@link ensureProposalsDir} for the reason `personalDir` is split:
 * `proposal list` prints a path and must not bring it into existence by being
 * asked where it would be.
 */
export async function proposalsDir(env: ProposalEnv, subject: SubjectId): Promise<PersonalDir> {
  const parent = await personalDir(env, subject);
  if (!parent.ok) return parent;
  return { ok: true, path: join(parent.path, PROPOSALS_DIR) };
}

/** The same directory, created 0700 under a personal directory created 0700. */
export async function ensureProposalsDir(
  env: ProposalEnv,
  subject: SubjectId,
): Promise<PersonalDir> {
  const parent = await ensurePersonalDir(env, subject);
  if (!parent.ok) return parent;
  const path = join(parent.path, PROPOSALS_DIR);
  await mkdir(path, { recursive: true, mode: STATE_DIR_MODE });
  return { ok: true, path };
}

/** What an owner said. There is no third answer, and no "not yet" that is not `null`. */
export type Outcome = "approved" | "refused";

/** One answer, with who gave it and when. */
export interface Decision {
  readonly outcome: Outcome;
  /** ISO 8601, UTC. */
  readonly at: string;
  /**
   * Who decided, as the caller reports it.
   *
   * A parameter rather than something read from the machine here: nothing under
   * `src/` reads `process.env` or `userInfo()` (D-021), so the CLI supplies the
   * name the same way `autonomy set` records one.
   */
  readonly by: string;
  /** Why, in the decider's own words. Free text, so it stays in `personal/`. */
  readonly note: string | null;
}

/** One proposal: the three things AC1 asks for, and what happened to it. */
export interface Proposal {
  readonly schema: string;
  readonly id: string;
  readonly subject: SubjectId;
  /** When it was filed. ISO 8601, UTC. */
  readonly at: string;
  /** What would be done. */
  readonly what: string;
  /** Why it would be done. */
  readonly why: string;
  /** What it would affect. */
  readonly impact: string;
  /** {@link proposalKey} of `what`, stored so a reader can see what was compared. */
  readonly key: string;
  /** The proposal this one is a second attempt at, when `--changed` was given. */
  readonly supersedes: string | null;
  /** What is new since that one — the owner's reason for letting it be asked again. */
  readonly changed: string | null;
  /** `null` until somebody answers. */
  readonly decision: Decision | null;
  /** The turn that spent this approval. An approval is good for one (D-029, I-6). */
  readonly usedByTurn: string | null;
  readonly usedAt: string | null;
  /**
   * Who wrote it: a person at `proposal new`, or the agent in a level-1 turn
   * (D-045). A record from before the field existed was filed by a person.
   */
  readonly filedBy: "person" | "agent";
  /** The turn whose answer it came out of, when the agent filed it. */
  readonly fromTurn: string | null;
}

/**
 * The comparison key: NFC, trimmed, inner whitespace collapsed, lower-cased.
 *
 * Unicode normalisation first, because two visually identical Thai or accented
 * strings can be different byte sequences and telling somebody their proposal is
 * "new" on that basis would be nonsense. Everything after it is the ordinary
 * shape of a typed-twice sentence: a stray trailing space, a double space, a
 * capital at the start.
 *
 * What it deliberately does not do: stem, strip punctuation, drop stop words, or
 * measure a distance. Each of those would make the key match things the owner
 * did not say were the same, and the failure would be silent in the direction
 * that matters — a proposal refused as a repeat of something it is not.
 */
export function proposalKey(what: string): string {
  return what.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Everything {@link describeProposal} needs, with nothing inferred from the machine. */
export interface NewProposal {
  readonly id: string;
  readonly subject: SubjectId;
  readonly at: Date;
  readonly what: string;
  readonly why: string;
  readonly impact: string;
  readonly supersedes?: string | null;
  readonly changed?: string | null;
  readonly filedBy?: "person" | "agent";
  readonly fromTurn?: string | null;
}

/** A proposal record, before it has been anywhere near a disk. */
export function describeProposal(options: NewProposal): Proposal {
  return {
    schema: PROPOSAL_SCHEMA,
    id: options.id,
    subject: options.subject,
    at: options.at.toISOString(),
    what: options.what,
    why: options.why,
    impact: options.impact,
    key: proposalKey(options.what),
    supersedes: options.supersedes ?? null,
    changed: options.changed ?? null,
    decision: null,
    usedByTurn: null,
    usedAt: null,
    filedBy: options.filedBy ?? "person",
    fromTurn: options.fromTurn ?? null,
  };
}

/**
 * Where one record is written.
 *
 * Only ever called with an id this module minted or read back off disk — see the
 * header. It is exported so a test can assert the containment that `tsc` cannot.
 */
export function proposalPath(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

/**
 * Write a record, whole or not at all.
 *
 * Through a temporary file in the same directory and a rename, like
 * `commitBlocks`: `decide` rewrites a record that already exists, and a record
 * truncated by a crash is a proposal whose outcome cannot be read — which this
 * store would then report as `pending` and let somebody answer a second time.
 */
export async function writeProposal(dir: string, proposal: Proposal): Promise<string> {
  const path = proposalPath(dir, proposal.id);
  const temp = `${path}.om-agi-${process.pid}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(proposal, null, 2)}\n`, { mode: STATE_FILE_MODE });
    await rename(temp, path);
  } catch (cause) {
    await unlink(temp).catch(() => undefined);
    throw cause;
  }
  return path;
}

/** A record read back off disk, with the path it came from. */
export interface StoredProposal {
  readonly path: string;
  readonly proposal: Proposal;
}

/** A file under `proposals/` that is not a record om-agi wrote. */
export interface UnreadableProposal {
  readonly path: string;
  readonly reason: string;
}

/** Everything under `proposals/`, separated into what parsed and what did not. */
export interface ProposalInventory {
  /** Newest first — the order every list is printed in. */
  readonly proposals: readonly StoredProposal[];
  readonly unreadable: readonly UnreadableProposal[];
}

/** A decision read off disk, or the reason that file is not one. */
function asDecision(value: unknown): Decision | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const outcome = raw["outcome"];
  if (outcome !== "approved" && outcome !== "refused") return null;
  return {
    outcome,
    at: typeof raw["at"] === "string" ? raw["at"] : "",
    by: typeof raw["by"] === "string" ? raw["by"] : "",
    note: typeof raw["note"] === "string" ? raw["note"] : null,
  };
}

/**
 * A record off disk, or a sentence saying why that file is not one.
 *
 * Refuses rather than repairs, for the reason `parseDial` gives: a file this
 * program cannot understand is not a file whose meaning may be guessed, and here
 * the guess would be about whether somebody said yes.
 */
export function asProposal(value: unknown): Proposal | string {
  if (typeof value !== "object" || value === null) return "not a JSON object";
  const raw = value as Record<string, unknown>;
  if (raw["schema"] !== PROPOSAL_SCHEMA) return `schema is not ${PROPOSAL_SCHEMA}`;
  const id = raw["id"];
  const subject = raw["subject"];
  const what = raw["what"];
  if (typeof id !== "string" || id === "") return "id is missing";
  if (typeof subject !== "string" || subject === "") return "subject is missing";
  if (typeof what !== "string" || what === "") return "what is missing";

  const text = (key: string): string => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  const orNull = (key: string): string | null =>
    typeof raw[key] === "string" && raw[key] !== "" ? (raw[key] as string) : null;

  return {
    schema: PROPOSAL_SCHEMA,
    id,
    subject: subject as SubjectId,
    at: text("at"),
    what,
    why: text("why"),
    impact: text("impact"),
    // Recomputed rather than trusted: the key is what decides whether a later
    // proposal is a repeat, and a file that carries a key which does not match
    // its own `what` would answer that question with something hand-edited.
    key: proposalKey(what),
    supersedes: orNull("supersedes"),
    changed: orNull("changed"),
    decision: asDecision(raw["decision"]),
    usedByTurn: orNull("usedByTurn"),
    usedAt: orNull("usedAt"),
    filedBy: raw["filedBy"] === "agent" ? "agent" : "person",
    fromTurn: orNull("fromTurn"),
  };
}

/**
 * Read every proposal for one subject.
 *
 * Never throws, and reports what it could not read instead of skipping it: a
 * file in here that does not parse may be a refusal, and silently not counting
 * one is how this store would go back on the only promise it makes. A missing
 * directory is an empty inventory — nothing has been proposed yet.
 */
export async function readProposals(dir: string): Promise<ProposalInventory> {
  const proposals: StoredProposal[] = [];
  const unreadable: UnreadableProposal[] = [];

  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return { proposals, unreadable };
  }

  for (const name of names) {
    const path = join(dir, name);
    try {
      const parsed = asProposal(JSON.parse(await readFile(path, "utf8")));
      if (typeof parsed === "string") unreadable.push({ path, reason: parsed });
      else proposals.push({ path, proposal: parsed });
    } catch (cause) {
      unreadable.push({ path, reason: String(cause) });
    }
  }

  proposals.sort((a, b) => b.proposal.at.localeCompare(a.proposal.at));
  return { proposals, unreadable };
}

/**
 * One proposal by id, matched against what is on disk.
 *
 * The only lookup there is, and the reason there is no `readProposal(dir, id)`:
 * an id that came off a command line must never become a path segment.
 */
export function findProposal(
  inventory: ProposalInventory,
  id: string,
): StoredProposal | undefined {
  return inventory.proposals.find((stored) => stored.proposal.id === id);
}

/** Every proposal this subject has had refused, newest first. */
export function refusedProposals(inventory: ProposalInventory): readonly Proposal[] {
  return inventory.proposals
    .map((stored) => stored.proposal)
    .filter((proposal) => proposal.decision?.outcome === "refused");
}

/**
 * The proposal that stops this one being filed, if there is one.
 *
 * A key that was **refused** or is still **pending**. An *approved* twin does
 * not block: an approval is spent once (see {@link spendability}), so asking
 * again is asking again rather than a repeat of something already answered no —
 * and the whole point of a single-use approval is that the second time has to be
 * asked for.
 */
export function blockingProposal(
  inventory: ProposalInventory,
  key: string,
): Proposal | undefined {
  return inventory.proposals
    .map((stored) => stored.proposal)
    .find(
      (proposal) =>
        proposal.key === key &&
        (proposal.decision === null || proposal.decision.outcome === "refused"),
    );
}

/**
 * Answer a proposal, or say why it cannot be answered.
 *
 * A second decision is refused rather than overwritten. Changing a recorded
 * "no" into a "yes" in place would leave no trace that the question was ever
 * answered differently, and the owner's memory of having refused something is
 * the one thing this store exists to keep.
 */
export function decideProposal(
  proposal: Proposal,
  decision: Decision,
): Proposal | string {
  if (proposal.decision !== null) {
    return (
      `${proposal.id} was already ${proposal.decision.outcome} at ${proposal.decision.at} by ` +
      `${proposal.decision.by}. A decision is not edited in place — file it again, with ` +
      `--changed saying what is different this time.`
    );
  }
  return { ...proposal, decision };
}

/** Whether an approval is there to be spent, and if not, what is in the way. */
export type Spendability =
  /** Approved, and not yet used by a turn. */
  | { readonly kind: "ready" }
  /** Nobody has answered it yet. */
  | { readonly kind: "undecided" }
  /** It was refused. */
  | { readonly kind: "refused" }
  /** It was approved and a turn has already had it. */
  | { readonly kind: "spent"; readonly turn: string };

/** Can this proposal pay for a turn? */
export function spendability(proposal: Proposal): Spendability {
  if (proposal.decision === null) return { kind: "undecided" };
  if (proposal.decision.outcome === "refused") return { kind: "refused" };
  if (proposal.usedByTurn !== null) return { kind: "spent", turn: proposal.usedByTurn };
  return { kind: "ready" };
}

/**
 * Mark an approval as spent by one turn.
 *
 * The caller writes this **before** the prompt goes out, for the same reason
 * `turn` checks the ledger first: a turn that has been sent cannot be un-sent,
 * and an approval whose use was recorded afterwards is an approval that a crash
 * turns back into an unused one.
 */
export function spendProposal(proposal: Proposal, turnId: string, at: Date): Proposal {
  return { ...proposal, usedByTurn: turnId, usedAt: at.toISOString() };
}

/**
 * One line describing a proposal, for a list a person reads.
 *
 * Here rather than in the command, because `turn` prints it too when it refuses
 * one — and two accounts of the same record are two things to keep honest.
 */
export function proposalLine(proposal: Proposal): string {
  const state =
    proposal.decision === null
      ? "pending"
      : proposal.usedByTurn === null
        ? proposal.decision.outcome
        : `${proposal.decision.outcome}, spent`;
  const by = proposal.filedBy === "agent" ? "  (filed by the agent)" : "";
  return `${proposal.id}  ${proposal.at}  ${state.padEnd(16)}  ${proposal.what}${by}`;
}
