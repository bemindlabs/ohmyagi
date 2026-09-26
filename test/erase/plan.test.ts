/**
 * S7.2 end to end at the module level — plan, commit, re-read, decide.
 *
 * The fixture below is the point of this file. A subject with data in *every*
 * place om-agi can write to — a soul in a working tree, a derived `.dagi/`, a
 * capture tree under the personal directory, a month of ledger lines, a backup
 * of an instruction file, and an applied block inside that file — plus a second
 * subject with the same, so that I-3 is checked by comparing bytes rather than
 * by reading the code.
 *
 * Every assertion about "it is gone" is taken from the filesystem *after* the
 * deletion. None is derived from what the plan said it would do: the control in
 * `test/observer/purge.test.ts` showed exactly how a command that reports its
 * own plan back prints `0 remaining` over a file still sitting on disk, and
 * this command has four trees to get that wrong in instead of one.
 *
 * Three controls carry more weight than the happy path:
 *
 * - a planted identifier in the state root makes the verdict
 *   `erased-with-remainder`, so AC3's zero is falsifiable;
 * - something at the address D-014 reserves for a `not-built` place refuses the
 *   whole run, so AC1's "two of these do not exist" is enforced rather than
 *   printed;
 * - a dry run changes no byte, compared file by file.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { templateFiles } from "../../src/agent/template.ts";
import { commitErase, planErase, verifyErase, type EraseEnv } from "../../src/erase/plan.ts";
import { confirmationsPath, setConfirmation } from "../../src/decide/confirm.ts";
import { RAG_MARKER_FILE, ragDirFor, writeRagMarker } from "../../src/memory/marker.ts";
import { splice } from "../../src/soul/block.ts";
import type { LedgerEntry } from "../../src/ledger/entry.ts";
import { append, ledgerDir } from "../../src/ledger/store.ts";
import { UNREPORTED_USAGE, subjectId, type SubjectId } from "../../src/types.ts";

const SUBJECT = subjectId("example");
const OTHER = subjectId("somebody-else");

/** A string that exists nowhere else, planted so "not found" is evidence. */
const CANARY = "canary-4e19c2-erase";

const scratch: string[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function sandbox(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "om-agi-erase-plan-"));
  scratch.push(dir);
  return dir;
}

function envFor(home: string): EraseEnv {
  return {
    home,
    env: {
      XDG_STATE_HOME: join(home, "state"),
      XDG_DATA_HOME: join(home, "data"),
      // Port 9 (discard) on loopback: nothing listens, so the vector store is
      // unreachable and the run never asks the Qdrant on this machine anything.
      // With no marker that is a note, not a refusal (D-038).
      OM_AGI_QDRANT_URL: "http://127.0.0.1:9",
    },
    now: () => new Date("2026-09-21T10:00:00.000Z"),
  };
}

function entryFor(subject: SubjectId, text: string): LedgerEntry {
  return {
    v: 1,
    kind: "turn",
    id: `${subject}-1`,
    turn: `${subject}-turn`,
    at: "2026-09-21T09:00:00.000Z",
    subject,
    backend: "ollama",
    model: null,
    content: "full",
    prompt: text,
    prompt_bytes: text.length,
    text: "an answer",
    text_bytes: 9,
    confidence: "confirmed",
    exit: 0,
    duration_ms: 12,
    cost: null,
    usage: UNREPORTED_USAGE,
    identity: "system",
    soul_sha: null,
  };
}

/** Everything one subject can have on disk, in all five kinds of place. */
async function fixture(
  home: string,
  subject: SubjectId,
): Promise<{ agent: string; instruction: string }> {
  const env = envFor(home);
  const agent = join(home, "agents", subject);

  for (const file of templateFiles(subject, subject)) {
    await Bun.write(join(agent, file.path), file.content);
  }
  await Bun.write(join(agent, ".dagi", "soul", "rendered.md"), `# ${subject}\n${CANARY}\n`);
  await Bun.write(join(agent, ".dagi", "manifest.json"), `{"subject":"${subject}"}\n`);

  await Bun.write(
    join(home, "data", "om-agi", subject, "personal", "observer", "raw.jsonl"),
    `{"subject":"${subject}","what":"typed","note":"${CANARY}"}\n`,
  );

  await append(env, entryFor(subject, `a prompt holding ${CANARY}`));

  // An instruction file with this subject's block in it, and the backup
  // `soul apply` would have taken before writing it.
  // The human's own text deliberately does not mention the subject: what has
  // to survive the strip is somebody else's writing, and what has to disappear
  // is om-agi's block.
  const instruction = join(home, `.${subject}`, "CLAUDE.md");
  const spliced = splice("# my own notes\n\nkeep this.\n", {
    subject,
    body: `# identity\n\nsubject ${subject}`,
  });
  if (spliced.kind !== "spliced") throw new Error(spliced.reason);
  await Bun.write(instruction, spliced.next);

  const backup = join(home, "state", "om-agi", "backups", subject, "20260921T090000000Z");
  await Bun.write(join(backup, "1-CLAUDE.md"), spliced.next);
  await Bun.write(
    join(backup, "manifest.json"),
    JSON.stringify({ schema: "om-agi/soul-apply-backup@1", subject, files: [{ path: instruction }] }),
  );

  return { agent, instruction };
}

/** Every regular file under `root` that holds `needle`, as bytes. */
async function grepTree(root: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && (await Bun.file(path).text()).includes(needle)) hits.push(path);
    }
  };
  await walk(root);
  return hits;
}

function request(agent: string | null, instruction: string[], over: Partial<Parameters<typeof planErase>[1]> = {}) {
  return {
    subject: SUBJECT,
    agentDir: agent,
    scope: "all" as const,
    by: "the owner",
    needles: [] as readonly string[],
    instructionFiles: instruction,
    soulName: SUBJECT as string | null,
    personalValues: [] as readonly string[],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The whole thing
// ---------------------------------------------------------------------------

describe("a full erase", () => {
  test("everything om-agi can delete goes, and the recount is read off the disk", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);

    // The control for the control: the canary really is there to begin with.
    expect((await grepTree(home, CANARY)).length).toBeGreaterThan(0);

    const env = envFor(home);
    const plan = await planErase(env, request(mine.agent, [mine.instruction]));
    expect(plan.refusals).toEqual([]);
    // Eleven trees: the soul, the derived directory, the backups, the level-3
    // confirmations (D-042), the rag marker (D-038), the run records (S5.4),
    // the trigger fire times (S5.3), the A2A peers (D-063), the chat
    // allowlist (D-066), the basis records (D-077) and the personal directory. The block and the ledger lines are counted separately.
    expect(plan.trees.length).toBe(11);
    expect(plan.blocks.filter((block) => block.outcome === "strip").length).toBe(1);
    expect(plan.ledger.matched.length).toBe(1);

    const result = await commitErase(plan);
    const verification = await verifyErase(plan, result);

    expect(verification.search.scopes.flatMap((scope) => scope.hits)).toEqual([]);
    expect(verification.verdict).toBe("erased-and-verified");
    expect(verification.remainingFiles).toBe(0);
    expect(verification.failures).toBe(0);
    expect(verification.search.deletableHits).toBe(0);
    expect(verification.search.gitHits).toBe(0);

    // I-4's own words: search afterwards and the text is not there.
    expect(await grepTree(join(home, "state"), CANARY)).toEqual([]);
    expect(await grepTree(join(home, "data"), CANARY)).toEqual([]);
    expect(await grepTree(mine.agent, CANARY)).toEqual([]);

    // The three soul locations, each checked rather than assumed.
    expect(await Bun.file(join(mine.agent, "soul", "role.md")).exists()).toBe(false);
    expect(await Bun.file(join(mine.agent, ".dagi", "manifest.json")).exists()).toBe(false);
    expect(await Bun.file(mine.instruction).text()).toBe("# my own notes\n\nkeep this.\n");
    expect(await Bun.file(join(home, "state", "om-agi", "backups", SUBJECT)).exists()).toBe(false);
    expect(await Bun.file(ledgerDir(env, SUBJECT)).exists()).toBe(false);

    // And what is deliberately kept: the files that were never this subject's
    // to begin with, and the repository itself.
    expect(await Bun.file(join(mine.agent, "memory", "README.md")).exists()).toBe(true);
    expect(await Bun.file(join(mine.agent, ".gitignore")).exists()).toBe(true);
  }, 30_000);

  test("the empty directory that is only the subject's name goes too", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);

    const plan = await planErase(envFor(home), request(mine.agent, [mine.instruction]));
    await commitErase(plan);

    // `$XDG_DATA_HOME/om-agi/<subject>/` would otherwise be left behind: empty,
    // and still the identifier AC3 says must be findable nowhere.
    expect(await Bun.file(join(home, "data", "om-agi", SUBJECT)).exists()).toBe(false);
  }, 30_000);

  test("I-3 — the other subject's bytes are identical afterwards, everywhere", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    const theirs = await fixture(home, OTHER);

    const before = {
      soul: await Bun.file(join(theirs.agent, "soul", "role.md")).text(),
      capture: await Bun.file(
        join(home, "data", "om-agi", OTHER, "personal", "observer", "raw.jsonl"),
      ).text(),
      instruction: await Bun.file(theirs.instruction).text(),
      backups: await readdir(join(home, "state", "om-agi", "backups", OTHER)),
      ledger: await readdir(ledgerDir(envFor(home), OTHER)),
    };

    const plan = await planErase(
      envFor(home),
      // Both instruction files are offered, which is the interesting case: the
      // other subject's block must be recognised and left.
      request(mine.agent, [mine.instruction, theirs.instruction]),
    );
    const result = await commitErase(plan);

    expect(result.blocks.filter((block) => block.removed).map((block) => block.path)).toEqual([
      mine.instruction,
    ]);
    expect(await Bun.file(join(theirs.agent, "soul", "role.md")).text()).toBe(before.soul);
    expect(
      await Bun.file(join(home, "data", "om-agi", OTHER, "personal", "observer", "raw.jsonl")).text(),
    ).toBe(before.capture);
    expect(await Bun.file(theirs.instruction).text()).toBe(before.instruction);
    expect(await readdir(join(home, "state", "om-agi", "backups", OTHER))).toEqual(before.backups);
    expect(await readdir(ledgerDir(envFor(home), OTHER))).toEqual(before.ledger);
  }, 30_000);

  test("D-029 — a proposal is reached by the existing places, and a file outside personal/ is not", async () => {
    // The measurement D-029 asked for by name, and refused to let anybody
    // assume. S5.2's store is under `personal/proposals/` rather than being a
    // sixth `PlaceId`, so nothing in the type system says `erase` registered
    // it. What says so is this: a canary seeded in a proposal is gone, the
    // plan still has exactly five trees (no sixth place appeared), and the
    // control — the same bytes one directory higher, outside `personal/` —
    // survives, which is what makes "not found" evidence rather than a search
    // that looks nowhere.
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    const personal = join(home, "data", "om-agi", SUBJECT, "personal");

    await Bun.write(
      join(personal, "proposals", "11111111-1111-4111-8111-111111111111.json"),
      JSON.stringify({ schema: "om-agi/proposal@1", what: `delete ${CANARY}` }),
    );
    const control = join(home, "data", "om-agi", SUBJECT, "proposals", "outside.json");
    await Bun.write(control, JSON.stringify({ what: `delete ${CANARY}` }));

    const plan = await planErase(envFor(home), request(mine.agent, [mine.instruction]));
    // Still nine: the store is a subtree of a tree that was already planned.
    expect(plan.trees.length).toBe(11);
    const observed = plan.trees.find((tree) => tree.plan.dir === personal);
    expect(observed).toBeDefined();
    expect(observed!.plan.before.paths.some((path) => path.includes("proposals"))).toBe(true);
    // The label on the certificate names what goes, rather than only the place
    // id it is counted under.
    expect(observed!.label).toContain("proposal store");

    await commitErase(plan);

    expect(await grepTree(personal, CANARY)).toEqual([]);
    expect(await Bun.file(join(personal, "proposals")).exists()).toBe(false);
    // The control, which is the half that makes the line above mean something.
    expect(await Bun.file(control).exists()).toBe(true);
    expect(await Bun.file(control).text()).toContain(CANARY);
  }, 30_000);

  test("a dry run changes no byte — it is the absence of the second call", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);

    const snapshot = async (): Promise<Map<string, string>> => {
      const seen = new Map<string, string>();
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) await walk(path);
          else if (entry.isFile()) seen.set(path, await Bun.file(path).text());
        }
      };
      await walk(home);
      return seen;
    };

    const before = await snapshot();
    const plan = await planErase(envFor(home), request(mine.agent, [mine.instruction]));
    expect(plan.trees.length).toBe(11);
    const after = await snapshot();

    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, text] of before) expect(after.get(path), path).toBe(text);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The controls that make the verdict mean something
// ---------------------------------------------------------------------------

describe("the controls", () => {
  test("a planted identifier in the state root makes it erased-with-remainder", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    // Somewhere no deleter looks: a stray file directly under the state root.
    await Bun.write(join(home, "state", "om-agi", "stray.log"), `wore ${SUBJECT} once\n`);

    const plan = await planErase(envFor(home), request(mine.agent, [mine.instruction]));
    const verification = await verifyErase(plan, await commitErase(plan));

    expect(verification.verdict).toBe("erased-with-remainder");
    expect(verification.search.deletableHits).toBe(1);
    const hit = verification.search.scopes
      .flatMap((scope) => scope.hits)
      .find((found) => found.path.endsWith("stray.log"));
    expect(hit).toEqual({
      path: join(home, "state", "om-agi", "stray.log"),
      line: 1,
      needle: "subject id",
      inName: false,
    });
  }, 30_000);

  test("a hit in a git-tracked file is a remainder, and the file is not deleted", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    const note = join(mine.agent, "memory", "note.md");
    await Bun.write(note, `worked with ${SUBJECT} on the migration\n`);

    const plan = await planErase(envFor(home), request(mine.agent, [mine.instruction]));
    const verification = await verifyErase(plan, await commitErase(plan));

    expect(verification.verdict).toBe("erased-with-remainder");
    expect(verification.search.gitHits).toBe(1);
    // Deleting somebody's committed note on their behalf is not om-agi's call.
    expect(await Bun.file(note).text()).toBe(`worked with ${SUBJECT} on the migration\n`);
  }, 30_000);

  test("data at a reserved address refuses the run — nothing is deleted", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    await Bun.write(join(mine.agent, ".dagi", "adapters", "lora.bin"), "weights\n");

    const plan = await planErase(envFor(home), request(mine.agent, [mine.instruction]));

    expect(plan.refusals.length).toBe(1);
    expect(plan.refusals[0]).toContain("S6.3");
    expect(plan.refusals[0]).toContain("no deleter");
    // The caller is what stops; the plan itself still wrote nothing.
    expect(await Bun.file(join(mine.agent, "soul", "role.md")).exists()).toBe(true);
  }, 30_000);

  test("a hand-edited block refuses the run, and the backups stay", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    const written = await Bun.file(mine.instruction).text();
    await Bun.write(mine.instruction, written.replace("# identity", "# identity + my note"));

    const plan = await planErase(envFor(home), request(mine.agent, [mine.instruction]));

    expect(plan.refusals.length).toBe(1);
    expect(plan.refusals[0]).toContain("edited by hand");
    expect(
      await Bun.file(
        join(home, "state", "om-agi", "backups", SUBJECT, "20260921T090000000Z", "1-CLAUDE.md"),
      ).exists(),
    ).toBe(true);
  }, 30_000);

  test("the control: a file that cannot be unlinked keeps the count above zero", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    const locked = join(mine.agent, ".dagi", "locked");
    await Bun.write(join(locked, "stuck.bin"), `${CANARY}\n`);

    const plan = await planErase(envFor(home), request(mine.agent, [mine.instruction]));
    const { chmod } = await import("node:fs/promises");
    await chmod(locked, 0o500);
    try {
      const verification = await verifyErase(plan, await commitErase(plan));

      // A command that subtracted its own successes from its own plan would
      // print zero here, over a file that is still on disk.
      expect(verification.remainingFiles).toBeGreaterThan(0);
      expect(verification.failures).toBeGreaterThan(0);
      expect(verification.verdict).toBe("erased-with-remainder");
    } finally {
      await chmod(locked, 0o700);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// --personal (AC5)
// ---------------------------------------------------------------------------

describe("--personal", () => {
  test("person.md goes, role.md is byte-identical, and the ledger goes whole", async () => {
    const home = await sandbox();
    const env = envFor(home);
    const mine = await fixture(home, SUBJECT);
    const roleBefore = await Bun.file(join(mine.agent, "soul", "role.md")).text();
    const roleMode = (await stat(join(mine.agent, "soul", "role.md"))).mode;

    const plan = await planErase(
      env,
      request(mine.agent, [mine.instruction], {
        scope: "personal",
        personalValues: ["a phrase only person.md held"],
      }),
    );
    expect(plan.files).toEqual([join(mine.agent, "soul", "person.md")]);
    // Ten trees, not eleven: `soul/` stays, because `role.md` is in it.
    expect(plan.trees.length).toBe(10);

    const result = await commitErase(plan);
    expect(result.files).toEqual([{ path: join(mine.agent, "soul", "person.md"), removed: true }]);
    expect(await Bun.file(join(mine.agent, "soul", "person.md")).exists()).toBe(false);
    expect(await Bun.file(join(mine.agent, "soul", "role.md")).text()).toBe(roleBefore);
    expect((await stat(join(mine.agent, "soul", "role.md"))).mode).toBe(roleMode);
    expect(await Bun.file(join(mine.agent, "memory", "README.md")).exists()).toBe(true);
    expect(await Bun.file(ledgerDir(env, SUBJECT)).exists()).toBe(false);
  }, 30_000);

  test("the ledger note says it goes whole because it cannot be split", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);

    const plan = await planErase(
      envFor(home),
      request(mine.agent, [mine.instruction], { scope: "personal" }),
    );

    const note = plan.notes.find((line) => line.includes("whole ledger"))!;
    expect(note).toContain("cannot split it");
    expect(note).toContain("not because all of it is personal");
    expect(note).toContain("D-022");
  }, 30_000);

  test("a value person.md held, found in a file that was kept, is a remainder", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    // Separate files are not separate contents: the same phrase, in the file
    // `--personal` keeps.
    await Bun.write(join(mine.agent, "memory", "note.md"), "she always says ที่รัก first\n");

    const plan = await planErase(
      envFor(home),
      request(mine.agent, [mine.instruction], {
        scope: "personal",
        personalValues: ["ที่รัก"],
      }),
    );
    const verification = await verifyErase(plan, await commitErase(plan));

    expect(verification.personal).not.toBeNull();
    expect(verification.personal!.gitHits).toBe(1);
    expect(verification.verdict).toBe("erased-with-remainder");
    // Reported as file:line, never auto-deleted.
    expect(verification.personal!.scopes[0]!.hits[0]!.path).toBe(
      join(mine.agent, "memory", "note.md"),
    );
    expect(await Bun.file(join(mine.agent, "memory", "note.md")).exists()).toBe(true);
  }, 30_000);

  test("no personal values means no content check ran, rather than a check that passed", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);

    const plan = await planErase(
      envFor(home),
      request(mine.agent, [mine.instruction], { scope: "personal" }),
    );
    const verification = await verifyErase(plan, await commitErase(plan));
    expect(verification.personal).toBeNull();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Nothing to erase — I-4's other half
// ---------------------------------------------------------------------------

/** Plan, commit and verify, with the fixture's own defaults. */
async function eraseOnce(
  home: string,
  agent: string | null,
  instruction: readonly string[],
  over: Partial<Parameters<typeof planErase>[1]> = {},
) {
  const plan = await planErase(envFor(home), request(agent, [...instruction], over));
  const result = await commitErase(plan);
  return { plan, result, verification: await verifyErase(plan, result) };
}

describe("a subject that is not here", () => {
  test("an empty home gets `nothing-found`, and no certificate of erasure", async () => {
    const home = await sandbox();
    const { verification } = await eraseOnce(home, null, []);

    expect(verification.verdict).toBe("nothing-found");
    expect(verification.found.total).toBe(0);
    expect(verification.removed.total).toBe(0);
    expect(verification.filesRead).toBe(0);
  }, 30_000);

  test("the dangerous one: a mistyped id in a home holding another subject", async () => {
    // The case a rule keyed on `filesRead === 0` waves straight through, and
    // the reason the verdict is decided by what was found and removed instead.
    // Files are read here — plenty of them — and none of them is this id's.
    const home = await sandbox();
    const theirs = await fixture(home, OTHER);

    const before = {
      soul: await Bun.file(join(theirs.agent, "soul", "role.md")).text(),
      capture: await Bun.file(
        join(home, "data", "om-agi", OTHER, "personal", "observer", "raw.jsonl"),
      ).text(),
      instruction: await Bun.file(theirs.instruction).text(),
      backups: await readdir(join(home, "state", "om-agi", "backups", OTHER)),
      ledger: await readdir(ledgerDir(envFor(home), OTHER)),
    };

    // SUBJECT is not OTHER: the id being erased has never existed on this
    // machine, and the real data sits under a different spelling.
    const { verification } = await eraseOnce(home, null, [theirs.instruction]);

    expect(verification.verdict).toBe("nothing-found");
    expect(verification.filesRead).toBeGreaterThan(0);
    expect(verification.found.total).toBe(0);
    expect(verification.removed.total).toBe(0);

    // I-3, by bytes rather than by reading the code: the other subject is
    // untouched in all five kinds of place.
    expect(await Bun.file(join(theirs.agent, "soul", "role.md")).text()).toBe(before.soul);
    expect(
      await Bun.file(join(home, "data", "om-agi", OTHER, "personal", "observer", "raw.jsonl")).text(),
    ).toBe(before.capture);
    expect(await Bun.file(theirs.instruction).text()).toBe(before.instruction);
    expect(await readdir(join(home, "state", "om-agi", "backups", OTHER))).toEqual(before.backups);
    expect(await readdir(ledgerDir(envFor(home), OTHER))).toEqual(before.ledger);
  }, 30_000);

  test("erasing twice: the second run is `nothing-found`, and cannot say why", async () => {
    // The behaviour behind the sentence on the certificate. om-agi keeps no
    // record that a subject was erased — such a record is a trace of the
    // subject, and the next run's AC3 search would find it — so a second run
    // over a subject it removed an instant ago is byte-for-byte the same
    // situation as a subject that was never here, and says so rather than
    // inventing a distinction it cannot make.
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);

    const first = await eraseOnce(home, mine.agent, [mine.instruction]);
    expect(first.verification.verdict).toBe("erased-and-verified");
    expect(first.verification.found.total).toBeGreaterThan(0);
    expect(first.verification.removed.total).toBeGreaterThan(0);

    const second = await eraseOnce(home, mine.agent, [mine.instruction]);
    expect(second.verification.verdict).toBe("nothing-found");
    expect(second.verification.removed.total).toBe(0);
  }, 30_000);

  test("the sole subject erased with --no-agent still earns the verdict, reading nothing after", async () => {
    // The other direction of the same measurement. After this run both roots
    // are empty, so the search reads zero files — exactly the number the empty
    // home produces — and the verdict here is deserved, because something was
    // found before and something went.
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    // Everything of this subject's that lives outside a repository, and nothing
    // else on the machine.
    await rm(mine.agent, { recursive: true, force: true });
    await rm(mine.instruction, { force: true });

    const { verification } = await eraseOnce(home, null, []);

    expect(verification.verdict).toBe("erased-and-verified");
    expect(verification.filesRead).toBe(0);
    expect(verification.found.total).toBeGreaterThan(0);
    expect(verification.removed.total).toBeGreaterThan(0);
  }, 30_000);

  test("an empty directory named for the subject is a trace, and removing it counts", async () => {
    // Measured before it was decided: `census` cannot see such a directory at
    // all — empty and absent are both `0 files` — and the only evidence one was
    // there is that `commitPurge`'s `rmdir` succeeded. So `found` is zero here
    // and `removed` is not, which is what keeps this out of `nothing-found`.
    const home = await sandbox();
    await mkdir(join(home, "data", "om-agi", SUBJECT, "personal"), { recursive: true });
    await mkdir(join(home, "state", "om-agi", "backups", SUBJECT), { recursive: true });

    const { verification } = await eraseOnce(home, null, []);

    expect(verification.found.total).toBe(0);
    expect(verification.removed.files).toBe(0);
    expect(verification.removed.directories).toBeGreaterThan(0);
    expect(verification.verdict).toBe("erased-and-verified");
    // And the identifier really is gone from the path it was in.
    expect(await Bun.file(join(home, "data", "om-agi", SUBJECT)).exists()).toBe(false);
  }, 30_000);

  test("a scope that could not be read is not a scope that was found clean", async () => {
    // The same hole family as the one above, in the arm nobody surveyed:
    // `searchTree` answers "zero hits" for a root it could not open, exactly as
    // it does for a root that is not there. Only `unreadable` separates them,
    // and nothing used to look at it.
    const home = await sandbox();
    const { chmod } = await import("node:fs/promises");
    const state = join(home, "state", "om-agi");
    await mkdir(state, { recursive: true });
    await chmod(state, 0o000);
    try {
      const { verification } = await eraseOnce(home, null, []);

      expect(verification.unreadableScopes).toEqual(["state root"]);
      expect(verification.verdict).not.toBe("erased-and-verified");
      expect(verification.verdict).not.toBe("nothing-found");
    } finally {
      await chmod(state, 0o700);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// --no-agent
// ---------------------------------------------------------------------------

describe("--no-agent", () => {
  test("the two out-of-repository places still go, and the rest is recorded as not examined", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);

    const plan = await planErase(envFor(home), request(null, [mine.instruction]));

    // Backups, confirmations, run records, trigger fire times, A2A peers, the
    // chat allowlist, the basis records, the rag marker and the personal
    // directory need no repository; soul/ and .dagi/ are not visited at all.
    expect(plan.trees.length).toBe(9);
    expect(plan.git).toBeNull();
    expect(plan.notes.join("\n")).toContain("--no-agent");
    // The reserved addresses cannot be probed either, and that is said.
    expect(plan.reserved.every((probe) => probe.path === null)).toBe(true);

    await commitErase(plan);
    expect(await Bun.file(join(mine.agent, "soul", "role.md")).exists()).toBe(true);
    expect(await Bun.file(join(home, "state", "om-agi", "backups", SUBJECT)).exists()).toBe(false);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The vector collection (S4.1, D-038)
// ---------------------------------------------------------------------------

/**
 * A stand-in Qdrant on a real loopback socket. `erase` takes no fetch seam —
 * the commit takes no environment — so the stand-in has to be a server.
 */
function fakeQdrant(collections: Map<string, number>) {
  const asked: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      asked.push(`${req.method} ${url.pathname}`);
      const name = url.pathname.replace(/^\/collections\//, "");
      if (req.method === "GET") {
        const points = collections.get(name);
        return points === undefined
          ? new Response("{}", { status: 404 })
          : Response.json({ result: { points_count: points } });
      }
      if (req.method === "DELETE") {
        collections.delete(name);
        return Response.json({ result: true });
      }
      return new Response("", { status: 405 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, asked, stop: () => server.stop(true) };
}

async function withMarker(home: string, qdrantUrl: string): Promise<void> {
  const env = envFor(home);
  await writeRagMarker(ragDirFor(home, env.env, SUBJECT), SUBJECT, qdrantUrl, new Date());
}

describe("the vector collection", () => {
  test("found, dropped whole, asked again, and the verdict rests on the answer", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    const collections = new Map([["omagi__example", 12], ["docs", 400]]);
    const store = fakeQdrant(collections);
    try {
      await withMarker(home, store.url);
      const plan = await planErase(envFor(home), request(mine.agent, [mine.instruction]));
      expect(plan.refusals).toEqual([]);
      expect(plan.vector.url).toBe(store.url);
      expect(plan.vector.state).toEqual({ kind: "present", points: 12 });

      const result = await commitErase(plan);
      expect(result.vector).toEqual({ dropped: true });
      const verification = await verifyErase(plan, result);

      expect(verification.vectorAfter).toEqual({ kind: "absent" });
      expect(verification.found.collections).toBe(1);
      expect(verification.removed.collections).toBe(1);
      expect(verification.verdict).toBe("erased-and-verified");
      // D-007: the collection om-agi never wrote is untouched.
      expect(collections.get("docs")).toBe(400);
      expect(store.asked.filter((line) => line.startsWith("DELETE"))).toEqual([
        "DELETE /collections/omagi__example",
      ]);
    } finally {
      store.stop();
    }
  }, 30_000);

  test("the marker is where it looks, even when the environment points elsewhere", async () => {
    const home = await sandbox();
    const store = fakeQdrant(new Map([["omagi__example", 1]]));
    try {
      await withMarker(home, store.url);
      // envFor points OM_AGI_QDRANT_URL at a port nothing listens on.
      const plan = await planErase(envFor(home), request(null, []));
      expect(plan.vector.url).toBe(store.url);
      expect(plan.vector.state?.kind).toBe("present");
    } finally {
      store.stop();
    }
  }, 30_000);

  test("om-agi wrote vectors, and the store is down: refused, nothing certified", async () => {
    const home = await sandbox();
    await withMarker(home, "http://127.0.0.1:9");
    const plan = await planErase(envFor(home), request(null, []));
    expect(plan.refusals.join(" ")).toContain("cannot reach it now");
    expect(plan.refusals.join(" ")).toContain("omagi__example");
  }, 30_000);

  test("no marker and no store: a note, not a refusal — the bare container's case", async () => {
    const home = await sandbox();
    const plan = await planErase(envFor(home), request(null, []));
    expect(plan.refusals).toEqual([]);
    expect(plan.notes.join(" ")).toContain("did not answer");
    expect(plan.vector.state?.kind).toBe("unreachable");
  }, 30_000);

  test("an unreadable marker refuses: it says something was written, and not where", async () => {
    const home = await sandbox();
    const env = envFor(home);
    const dir = ragDirFor(home, env.env, SUBJECT);
    await mkdir(dir, { recursive: true });
    await Bun.write(join(dir, RAG_MARKER_FILE), "{ not json");
    const unset = { ...env, env: { ...env.env, OM_AGI_QDRANT_URL: "http://gpu-box:10300" } };
    const plan = await planErase(unset, request(null, []));
    expect(plan.refusals.join(" ")).toContain("cannot be read to say where");
  }, 30_000);

  test("a collection that is still there after the drop is a remainder, not a pass", async () => {
    const home = await sandbox();
    const mine = await fixture(home, SUBJECT);
    const collections = new Map([["omagi__example", 3]]);
    const store = fakeQdrant(collections);
    try {
      await withMarker(home, store.url);
      const plan = await planErase(envFor(home), request(mine.agent, [mine.instruction]));
      const result = await commitErase(plan);
      // Somebody writes it back between the drop and the re-read.
      collections.set("omagi__example", 3);
      const verification = await verifyErase(plan, result);
      expect(verification.vectorAfter?.kind).toBe("present");
      expect(verification.verdict).toBe("erased-with-remainder");
    } finally {
      store.stop();
    }
  }, 30_000);
});

describe("D-042's confirmations are this subject's data", () => {
  test("a level-3 confirmation goes with the subject, and another subject's stays", async () => {
    const home = await sandbox();
    const env = envFor(home);
    const mine = confirmationsPath(env, join(home, "agent", "soul"), SUBJECT);
    const theirs = confirmationsPath(env, join(home, "agent", "soul"), subjectId("somebody-else"));
    await setConfirmation(mine, "write", { by: "the owner", at: "t" });
    await setConfirmation(theirs, "write", { by: "someone", at: "t" });

    const plan = await planErase(env, request(null, []));
    expect(plan.trees.some((tree) => tree.label === "the level-3 confirmations")).toBe(true);
    await commitErase(plan);

    expect(await Bun.file(mine).exists()).toBe(false);
    expect(await Bun.file(theirs).exists()).toBe(true);
  }, 30_000);
});

