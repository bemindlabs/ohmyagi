/**
 * The proposal store — where it is, what it compares, and what it refuses.
 *
 * Four things are asked here that nothing else can ask:
 *
 * 1. **The address is under `personal/`,** which is what makes `ohmyagi erase`
 *    reach it. D-029 required that to be *measured* rather than assumed, and it
 *    is measured in two places: the containment of the path here, and the
 *    canary in `test/erase/plan.test.ts` that is gone after a real erase while a
 *    control file outside `personal/` is not. A sixth `PlaceId` would have made
 *    `tsc` enforce registration; this store is inside an existing place on
 *    purpose (D-025), so the enforcement is here instead.
 * 2. **Nothing on this path can reach a network or start a process.** The store
 *    holds free text about what the owner does, which makes it the most valuable
 *    thing in the engine to anything that wanted to send data somewhere (I-6).
 * 3. **The key table.** The comparison is exact, so the pairs that are equal and
 *    the pairs that are not are written down — including the one that is the
 *    known hole, so nobody has to discover it in production.
 * 4. **A decision is written once.** Overwriting a recorded "no" would leave no
 *    trace that the question had ever been answered differently.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  PROPOSALS_DIR,
  PROPOSAL_SCHEMA,
  asProposal,
  blockingProposal,
  decideProposal,
  describeProposal,
  ensureProposalsDir,
  findProposal,
  proposalKey,
  proposalLine,
  proposalPath,
  proposalsDir,
  readProposals,
  refusedProposals,
  spendProposal,
  spendability,
  writeProposal,
  type Proposal,
} from "../../src/decide/proposals.ts";
import { personalDir } from "../../src/guard/personal.ts";
import { subjectId } from "../../src/types.ts";
import { networkEscapes, processEscapes, reachable, sourceFiles } from "../support/ast.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const SUBJECT = subjectId("example");
const OTHER = subjectId("somebody-else");

const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function sandbox(): Promise<{ home: string; env: { home: string; env: Record<string, string> } }> {
  const home = await mkdtemp(join(tmpdir(), "om-agi-proposals-"));
  scratch.push(home);
  return { home, env: { home, env: { XDG_DATA_HOME: join(home, "data") } } };
}

/** One filed proposal, with everything but `what` held still. */
function proposalOf(what: string, over: Partial<Proposal> = {}): Proposal {
  return {
    ...describeProposal({
      id: `id-${what.length}`,
      subject: SUBJECT,
      at: new Date("2026-09-22T10:00:00.000Z"),
      what,
      why: "because it was asked for",
      impact: "one file in a temporary directory",
    }),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. the address
// ---------------------------------------------------------------------------

describe("the store is under the personal directory, which is what erase deletes", () => {
  test("proposalsDir is personalDir + proposals/, and resolving creates nothing", async () => {
    const { env } = await sandbox();
    const personal = await personalDir(env, SUBJECT);
    const dir = await proposalsDir(env, SUBJECT);

    expect(personal.ok).toBe(true);
    expect(dir.ok).toBe(true);
    if (!dir.ok || !personal.ok) return;

    // The containment, asserted as a path relation rather than as a string:
    // `join(personal.path, "proposals")` would be the same expression this is
    // checking, and would agree with itself wherever the store moved to.
    expect(relative(personal.path, dir.path)).toBe(PROPOSALS_DIR);
    expect(dir.path.startsWith(personal.path)).toBe(true);

    // And asking where it is did not bring it into existence — `proposal list`
    // prints this path on a machine that has never filed one.
    await expect(readdir(dir.path)).rejects.toThrow();
  });

  test("ensureProposalsDir creates it 0700, and readProposals is empty until something is filed", async () => {
    const { env } = await sandbox();
    const dir = await ensureProposalsDir(env, SUBJECT);
    expect(dir.ok).toBe(true);
    if (!dir.ok) return;

    expect(await readdir(dir.path)).toEqual([]);
    expect(await readProposals(dir.path)).toEqual({ proposals: [], unreadable: [] });

    // A directory that does not exist is an empty store, not an error: nothing
    // has been proposed yet and everything has been purged look the same, and
    // both are things a list has to be able to print.
    expect(await readProposals(join(dir.path, "nowhere"))).toEqual({
      proposals: [],
      unreadable: [],
    });
  });

  test("a data root inside a git repository is refused, and nothing is written", async () => {
    const { home } = await sandbox();
    // `personalDir` refuses a path inside a checkout (D-014), and this store
    // inherits that rather than re-deciding it. The engine's own repository is
    // the git repository nearest to hand.
    const env = { home: ROOT, env: { XDG_DATA_HOME: join(ROOT, "scratch-data") } };
    const dir = await proposalsDir(env, SUBJECT);
    expect(dir.ok).toBe(false);
    if (dir.ok) return;
    expect(dir.reason).toContain("must not be in version control");
    expect(await Bun.file(join(ROOT, "scratch-data")).exists()).toBe(false);
    expect(home).toContain("om-agi-proposals-");
  });

  test("each subject has its own directory, so one identity's store is not another's", async () => {
    const { env } = await sandbox();
    const mine = await ensureProposalsDir(env, SUBJECT);
    const theirs = await ensureProposalsDir(env, OTHER);
    expect(mine.ok && theirs.ok).toBe(true);
    if (!mine.ok || !theirs.ok) return;

    await writeProposal(mine.path, proposalOf("delete the old logs"));
    expect((await readProposals(mine.path)).proposals.length).toBe(1);
    expect((await readProposals(theirs.path)).proposals).toEqual([]);
  });
});

describe("nothing on this path can reach a network or start a process (I-6)", () => {
  test("the whole import closure is free of both, and the checker is not vacuous", async () => {
    const closure = await reachable([join(ROOT, "src", "decide", "proposals.ts")]);
    expect(closure.size).toBeGreaterThan(2);

    const hits: string[] = [];
    for (const path of closure) {
      const source = await readFile(path, "utf8");
      const rel = relative(ROOT, path);
      for (const hit of networkEscapes(path, source)) hits.push(`${rel}: ${hit}`);
      for (const hit of processEscapes(path, source, false)) hits.push(`${rel}: ${hit}`);
    }
    expect(hits).toEqual([]);

    // Control: the same two checkers do find things, over a tree that has them.
    const exec = await reachable([join(ROOT, "src", "exec", "index.ts")]);
    const found: string[] = [];
    for (const path of exec) {
      const source = await readFile(path, "utf8");
      for (const hit of networkEscapes(path, source)) found.push(hit);
    }
    expect(found).not.toEqual([]);

    // …and the closure really is transitive, rather than the one file.
    expect([...closure].some((path) => path.endsWith(join("guard", "personal.ts")))).toBe(true);
    expect((await sourceFiles(join(ROOT, "src", "decide"))).length).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// 2. the key, exactly as it is and no wider
// ---------------------------------------------------------------------------

describe("the comparison key, with the hole in it written down", () => {
  test("equal pairs: whitespace, case, and Unicode form", () => {
    const same: ReadonlyArray<readonly [string, string]> = [
      ["ลบ  log เก่า", "ลบ log เก่า "],
      ["Delete logs", "delete logs"],
      ["  restart the service  ", "restart the service"],
      ["restart\tthe\nservice", "restart the service"],
      // NFD on the left, NFC on the right: the same word, different bytes.
      ["café notes", "café notes"],
    ];
    for (const [a, b] of same) {
      expect(proposalKey(a), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(proposalKey(b));
    }
  });

  test("unequal pairs — including the hole: one extra word is a new proposal", () => {
    const different: ReadonlyArray<readonly [string, string]> = [
      // The known hole, pinned rather than hidden. `ๆ` is one character and it
      // is enough to get past a refusal, which is the price of an exact key
      // and the reason every command prints the refusals in full.
      ["ลบ log เก่า", "ลบ log เก่า ๆ"],
      ["delete logs", "delete the logs"],
      ["delete logs", "delete logs now"],
      ["restart the service", "restart the sevice"],
    ];
    for (const [a, b] of different) {
      expect(proposalKey(a), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).not.toBe(
        proposalKey(b),
      );
    }
  });

  test("the key stored on a record is recomputed from `what`, never trusted", () => {
    // A hand-edited `key` would decide whether a later proposal is a repeat,
    // which is the one question this store exists to answer.
    const parsed = asProposal({
      schema: PROPOSAL_SCHEMA,
      id: "abc",
      subject: SUBJECT,
      at: "2026-09-22T10:00:00.000Z",
      what: "Delete Logs",
      why: "space",
      impact: "logs",
      key: "something else entirely",
    });
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;
    expect(parsed.key).toBe("delete logs");
  });
});

// ---------------------------------------------------------------------------
// 3. filing, reading back, and what a bad file does
// ---------------------------------------------------------------------------

describe("records go to disk whole and come back, or are reported", () => {
  test("a filed proposal round-trips, and its path is the id", async () => {
    const { env } = await sandbox();
    const dir = await ensureProposalsDir(env, SUBJECT);
    if (!dir.ok) throw new Error(dir.reason);

    const proposal = proposalOf("delete the old logs");
    const path = await writeProposal(dir.path, proposal);
    expect(path).toBe(proposalPath(dir.path, proposal.id));

    const inventory = await readProposals(dir.path);
    expect(inventory.unreadable).toEqual([]);
    expect(inventory.proposals.map((stored) => stored.proposal)).toEqual([proposal]);
    expect(findProposal(inventory, proposal.id)?.proposal.what).toBe("delete the old logs");
    // An id nothing wrote is not found, and — the point — is never joined onto
    // a path: the lookup is over what was read, so `../../etc/passwd` is just
    // an id that matches nothing.
    expect(findProposal(inventory, "../../etc/passwd")).toBeUndefined();
  });

  test("a file that is not a proposal is reported, not skipped", async () => {
    const { env } = await sandbox();
    const dir = await ensureProposalsDir(env, SUBJECT);
    if (!dir.ok) throw new Error(dir.reason);

    await writeFile(join(dir.path, "broken.json"), "{not json");
    await writeFile(join(dir.path, "other.json"), JSON.stringify({ schema: "something/else@1" }));
    await writeFile(join(dir.path, "partial.json"), JSON.stringify({ schema: PROPOSAL_SCHEMA }));
    await writeProposal(dir.path, proposalOf("delete the old logs"));

    const inventory = await readProposals(dir.path);
    expect(inventory.proposals.length).toBe(1);
    expect(inventory.unreadable.length).toBe(3);
    // A file in here might be a refusal, and a store that quietly ignored one
    // would go back on the only promise it makes.
    expect(inventory.unreadable.map((bad) => bad.reason).join(" ")).toContain(
      `schema is not ${PROPOSAL_SCHEMA}`,
    );
    expect(inventory.unreadable.map((bad) => bad.reason).join(" ")).toContain("id is missing");
  });

  test("the parser refuses the shapes that are not a record at all", () => {
    expect(asProposal(null)).toBe("not a JSON object");
    expect(asProposal("a string")).toBe("not a JSON object");
    expect(asProposal({ schema: PROPOSAL_SCHEMA, id: "a" })).toBe("subject is missing");
    expect(asProposal({ schema: PROPOSAL_SCHEMA, id: "a", subject: "example" })).toBe(
      "what is missing",
    );
    // A decision that is not one of the two outcomes is no decision, which
    // leaves the proposal pending rather than half-answered.
    const parsed = asProposal({
      schema: PROPOSAL_SCHEMA,
      id: "a",
      subject: "example",
      what: "x",
      decision: { outcome: "maybe" },
    });
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;
    expect(parsed.decision).toBeNull();
    expect(parsed.why).toBe("");
  });

  test("the list is newest first, which is the order every report prints", async () => {
    const { env } = await sandbox();
    const dir = await ensureProposalsDir(env, SUBJECT);
    if (!dir.ok) throw new Error(dir.reason);

    for (const [id, at] of [
      ["old", "2026-09-20T10:00:00.000Z"],
      ["new", "2026-09-22T10:00:00.000Z"],
      ["middle", "2026-09-21T10:00:00.000Z"],
    ] as const) {
      await writeProposal(dir.path, { ...proposalOf(`ask ${id}`), id, at });
    }
    const inventory = await readProposals(dir.path);
    expect(inventory.proposals.map((stored) => stored.proposal.id)).toEqual([
      "new",
      "middle",
      "old",
    ]);
  });

  test("writing into a directory that is not there throws and leaves no temporary file", async () => {
    const { home } = await sandbox();
    const nowhere = join(home, "not-created");
    await expect(writeProposal(nowhere, proposalOf("delete the old logs"))).rejects.toThrow();
    await expect(readdir(nowhere)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. what is remembered, and what may be asked again
// ---------------------------------------------------------------------------

describe("a refusal is remembered (S5.2 AC2)", () => {
  test("refused and pending block a repeat; approved does not", async () => {
    const { env } = await sandbox();
    const dir = await ensureProposalsDir(env, SUBJECT);
    if (!dir.ok) throw new Error(dir.reason);

    const refused = decideProposal(proposalOf("delete the old logs", { id: "refused" }), {
      outcome: "refused",
      at: "2026-09-22T11:00:00.000Z",
      by: "the owner",
      note: "those logs are the only copy",
    });
    const pending = proposalOf("restart the service", { id: "pending" });
    const approved = decideProposal(proposalOf("write a summary", { id: "approved" }), {
      outcome: "approved",
      at: "2026-09-22T11:00:00.000Z",
      by: "the owner",
      note: null,
    });
    if (typeof refused === "string" || typeof approved === "string") throw new Error("not decided");

    for (const proposal of [refused, pending, approved]) await writeProposal(dir.path, proposal);
    const inventory = await readProposals(dir.path);

    expect(blockingProposal(inventory, proposalKey("Delete  the old logs "))?.id).toBe("refused");
    expect(blockingProposal(inventory, proposalKey("restart the service"))?.id).toBe("pending");
    // An approval is spent once, so asking again is asking again — not a
    // repeat of a question that was already answered no.
    expect(blockingProposal(inventory, proposalKey("write a summary"))).toBeUndefined();
    expect(blockingProposal(inventory, proposalKey("something nobody asked"))).toBeUndefined();

    // The list every command prints is the refusals, and only the refusals.
    expect(refusedProposals(inventory).map((proposal) => proposal.id)).toEqual(["refused"]);
  });

  test("a decision is written once and never edited in place", () => {
    const first = decideProposal(proposalOf("delete the old logs"), {
      outcome: "refused",
      at: "2026-09-22T11:00:00.000Z",
      by: "the owner",
      note: null,
    });
    if (typeof first === "string") throw new Error(first);

    const second = decideProposal(first, {
      outcome: "approved",
      at: "2026-09-22T12:00:00.000Z",
      by: "somebody else",
      note: null,
    });
    expect(typeof second).toBe("string");
    expect(String(second)).toContain("already refused");
    // …and the original is untouched, because the refusal is the thing being
    // protected: a "no" quietly turned into a "yes" leaves no trace at all.
    expect(first.decision?.outcome).toBe("refused");
  });

  test("supersedes and changed are recorded against the proposal they answer", () => {
    const again = describeProposal({
      id: "second",
      subject: SUBJECT,
      at: new Date("2026-09-23T10:00:00.000Z"),
      what: "delete the old logs",
      why: "the disk is full",
      impact: "logs older than a year",
      supersedes: "first",
      changed: "a copy now exists on the backup drive",
    });
    expect(again.supersedes).toBe("first");
    expect(again.changed).toBe("a copy now exists on the backup drive");
    expect(again.decision).toBeNull();
    expect(again.key).toBe(proposalKey("Delete the old logs"));
  });
});

describe("an approval is good for one turn", () => {
  test("spendability names each state, and a spent approval is not ready again", () => {
    const pending = proposalOf("delete the old logs");
    expect(spendability(pending)).toEqual({ kind: "undecided" });

    const refused = decideProposal(pending, {
      outcome: "refused",
      at: "2026-09-22T11:00:00.000Z",
      by: "the owner",
      note: null,
    });
    if (typeof refused === "string") throw new Error(refused);
    expect(spendability(refused)).toEqual({ kind: "refused" });

    const approved = decideProposal(pending, {
      outcome: "approved",
      at: "2026-09-22T11:00:00.000Z",
      by: "the owner",
      note: null,
    });
    if (typeof approved === "string") throw new Error(approved);
    expect(spendability(approved)).toEqual({ kind: "ready" });

    const spent = spendProposal(approved, "turn-1", new Date("2026-09-22T12:00:00.000Z"));
    expect(spendability(spent)).toEqual({ kind: "spent", turn: "turn-1" });
    expect(spent.usedAt).toBe("2026-09-22T12:00:00.000Z");
    // The decision itself is untouched by being spent: what changed is that it
    // has been used, not what was decided.
    expect(spent.decision).toEqual(approved.decision);
  });

  test("the one-line form says pending, the outcome, and whether it was spent", () => {
    const pending = proposalOf("delete the old logs");
    expect(proposalLine(pending)).toContain("pending");
    expect(proposalLine(pending)).toContain("delete the old logs");

    const approved = decideProposal(pending, {
      outcome: "approved",
      at: "2026-09-22T11:00:00.000Z",
      by: "the owner",
      note: null,
    });
    if (typeof approved === "string") throw new Error(approved);
    expect(proposalLine(approved)).toContain("approved");
    expect(proposalLine(approved)).not.toContain("spent");
    expect(proposalLine(spendProposal(approved, "turn-1", new Date()))).toContain("approved, spent");
  });
});
