/**
 * `ohmyagi proposal`, and the two things D-029 said had to be measured.
 *
 * ## The first: deleting this store changes exactly one thing
 *
 * D-022 says of the ledger that removing it must change *nothing*. This store
 * is the opposite case on purpose, and the difference is the whole reason it
 * exists separately: remove it and the agent forgets it was told no, which is
 * this store's job rather than a side effect. Both halves are measured here —
 * a refusal that stops a repeat, and stops stopping it once `rm -rf` has been
 * run; and a turn with no `--proposal` that is **byte-identical** before and
 * after, on stdout, on stderr through the declared normalisers, and on its exit
 * code. That second half is the shape `test/ledger/read-back.test.ts` uses for
 * the ledger, borrowed rather than reinvented, and it is what says the store is
 * not quietly in the path of ordinary work.
 *
 * ## The second: an approval is spent once
 *
 * `turn --proposal <id>` marks the record before the prompt goes out, and a
 * second turn naming the same id is refused with 4. The alternative — an
 * approval that keeps working — is how "I allowed it once" becomes "it has been
 * doing that ever since", and the owner decided against it on 2026-09-22.
 *
 * Nothing here touches the operator's home, spends a vendor turn, or reaches a
 * network: every run gets a temporary `HOME`, a `PATH` holding one symlink to
 * `bun` (checked by {@link expectNoVendorOn}), and a stub ollama on loopback.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PROPOSALS_DIR } from "../../src/decide/proposals.ts";
import { barePath, BUN, expectNoVendorOn } from "../support/bare-path.ts";
import { serveOllama } from "../support/stub-ollama.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const BIN = join(ROOT, "bin", "om-agi.ts");
const SOUL = join(ROOT, "test", "fixtures", "soul-valid");
const OTHER_SOUL = join(ROOT, "test", "fixtures", "soul-valid-b");
const SUBJECT = "example";
/** The subject `test/fixtures/soul-valid-b` really belongs to. */
const OTHER_SUBJECT = "other-example";

/** Exit 5 — already asked, and answered no (or still waiting). */
const REPEATED = 5;
/** Exit 4 — this machine has been told not to. Shared with the dial. */
const REFUSED = 4;

const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Box {
  readonly home: string;
  readonly env: Record<string, string>;
}

async function sandbox(): Promise<Box> {
  const home = await mkdtemp(join(tmpdir(), "om-agi-proposal-cli-"));
  scratch.push(home);
  const bare = await barePath(home);
  expectNoVendorOn(bare);
  return {
    home,
    env: {
      HOME: home,
      PATH: bare,
      XDG_STATE_HOME: join(home, "state"),
      XDG_DATA_HOME: join(home, "data"),
      CODEX_HOME: join(home, ".codex"),
      // A port nothing answers on, so no probe can reach a model unless a case
      // hands over a stub's URL itself.
      OLLAMA_HOST: "http://127.0.0.1:1",
    },
  };
}

async function run(box: Box, args: readonly string[], over: Record<string, string> = {}) {
  const child = Bun.spawn([BUN, "run", BIN, ...args], {
    cwd: ROOT,
    env: { ...box.env, ...over },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  await child.exited;
  return { code: child.exitCode ?? -1, stdout, stderr };
}

/** `$XDG_DATA_HOME/om-agi/<subject>/personal/proposals`. */
function storeIn(box: Box, subject = SUBJECT): string {
  return join(box.home, "data", "om-agi", subject, "personal", PROPOSALS_DIR);
}

/** File one, and hand back the id it printed on stdout. */
async function file(
  box: Box,
  what: string,
  extra: readonly string[] = [],
): Promise<{ id: string; code: number; stderr: string; stdout: string }> {
  const result = await run(box, [
    "proposal",
    "new",
    SOUL,
    "--subject",
    SUBJECT,
    "--what",
    what,
    "--why",
    "because the disk is full",
    "--impact",
    "files older than a year",
    ...extra,
  ]);
  return { id: result.stdout.trim(), ...result };
}

// ---------------------------------------------------------------------------
// Filing, and the memory of a refusal
// ---------------------------------------------------------------------------

describe("filing a proposal", () => {
  test("the id is the whole of stdout, and the record is under personal/", async () => {
    const box = await sandbox();
    const filed = await file(box, "delete the old logs");

    expect(filed.code).toBe(0);
    expect(filed.id).toMatch(/^[0-9a-f-]{36}$/);
    // stdout is the id and nothing else, so `id=$(ohmyagi proposal new …)` is a
    // command somebody can write.
    expect(filed.stdout).toBe(`${filed.id}\n`);
    expect(filed.stderr).toContain("filed:");

    const store = storeIn(box);
    expect(await readdir(store)).toEqual([`${filed.id}.json`]);
    const record = await Bun.file(join(store, `${filed.id}.json`)).json();
    expect(record.what).toBe("delete the old logs");
    expect(record.why).toBe("because the disk is full");
    expect(record.impact).toBe("files older than a year");
    expect(record.decision).toBeNull();
    expect(record.usedByTurn).toBeNull();

    // Free text about what the owner does: 0700 all the way down, and outside
    // every git repository (D-014, D-025).
    expect((await stat(store)).mode & 0o777).toBe(0o700);
    expect((await stat(join(store, `${filed.id}.json`))).mode & 0o777).toBe(0o600);
  }, 30_000);

  test("--from reads the three fields off stdin, so they are not in argv", async () => {
    const box = await sandbox();
    const document = JSON.stringify({
      what: "delete the old logs",
      why: "the disk is full",
      impact: "files older than a year",
    });
    const path = join(box.home, "proposal.json");
    await writeFile(path, document);

    const result = await run(box, [
      "proposal",
      "new",
      SOUL,
      "--subject",
      SUBJECT,
      "--from",
      path,
    ]);
    expect(result.code).toBe(0);
    const record = await Bun.file(join(storeIn(box), `${result.stdout.trim()}.json`)).json();
    expect(record.what).toBe("delete the old logs");

    // Both at once is refused: two documents is two proposals, and picking one
    // would be om-agi deciding which of them somebody meant.
    const both = await run(box, [
      "proposal", "new", SOUL, "--subject", SUBJECT, "--from", path, "--what", "something else",
    ]);
    expect(both.code).toBe(2);
    expect(both.stderr).toContain("two different proposals");

    // A document missing one of the three is refused as well: AC1 asks for
    // what, why and what it affects, and two of three is not a judgeable ask.
    const partial = join(box.home, "partial.json");
    await writeFile(partial, JSON.stringify({ what: "x", why: "y" }));
    const short = await run(box, ["proposal", "new", SOUL, "--subject", SUBJECT, "--from", partial]);
    expect(short.code).toBe(2);
    expect(short.stderr).toContain("AC1 asks for all three");
  }, 30_000);

  test("a refusal is remembered — the same `what` is exit 5 until --changed says what is new", async () => {
    const box = await sandbox();
    const first = await file(box, "delete the old logs");
    expect(first.code).toBe(0);

    // Pending blocks too: two copies of one unanswered question is not a
    // second question.
    const twice = await file(box, "delete the old logs");
    expect(twice.code).toBe(REPEATED);
    expect(twice.stderr).toContain("has not been answered yet");
    expect(await readdir(storeIn(box))).toHaveLength(1);

    const refused = await run(box, [
      "proposal", "decide", first.id, SOUL, "--subject", SUBJECT,
      "--refuse", "--note", "those logs are the only copy",
    ]);
    expect(refused.code).toBe(0);
    expect(refused.stdout).toContain("refused by");

    // The refusal now bites, through the normalisation and nothing wider.
    const again = await file(box, "Delete  the old   logs ");
    expect(again.code).toBe(REPEATED);
    expect(again.stderr).toContain("It was refused, and a refusal is remembered");
    expect(again.stderr).toContain("those logs are the only copy");
    expect(await readdir(storeIn(box))).toHaveLength(1);

    // …and --changed is the declared way past it, recorded against the old one.
    const changed = await file(box, "delete the old logs", [
      "--changed",
      "there is a copy on the backup drive now",
    ]);
    expect(changed.code).toBe(0);
    expect(changed.stderr).toContain(`supersedes ${first.id}`);
    const record = await Bun.file(join(storeIn(box), `${changed.id}.json`)).json();
    expect(record.supersedes).toBe(first.id);
    expect(record.changed).toBe("there is a copy on the backup drive now");

    // The hole, measured rather than described: one extra word is a new
    // proposal to an exact key, and this is why the refusals are printed on
    // every run instead of being matched against by something fuzzy.
    const reworded = await file(box, "delete the old logs quickly");
    expect(reworded.code).toBe(0);
    expect(reworded.stderr).toContain("this subject has been refused");
    expect(reworded.stderr).toContain("delete the old logs");
  }, 60_000);

  test("the refusals are printed on every run, filtered by nothing", async () => {
    const box = await sandbox();
    for (const what of ["delete the old logs", "restart the service"]) {
      const filed = await file(box, what);
      const refused = await run(box, [
        "proposal", "decide", filed.id, SOUL, "--subject", SUBJECT, "--refuse",
      ]);
      expect(refused.code).toBe(0);
    }

    // A proposal about something else entirely still prints both — a program
    // that showed only the "related" ones would be the loose comparison this
    // store refuses to make, moved somewhere less visible.
    const unrelated = await file(box, "write a summary of this week");
    expect(unrelated.code).toBe(0);
    expect(unrelated.stderr).toContain("2 thing(s) this subject has been refused");
    expect(unrelated.stderr).toContain("delete the old logs");
    expect(unrelated.stderr).toContain("restart the service");

    // And on the two commands a person reads before deciding.
    const shown = await run(box, ["proposal", "show", unrelated.id, SOUL, "--subject", SUBJECT]);
    expect(shown.stderr).toContain("2 thing(s) this subject has been refused");
    const listed = await run(box, ["proposal", "list", SOUL, "--subject", SUBJECT]);
    expect(listed.stderr).toContain("2 thing(s) this subject has been refused");
    expect(listed.stdout).toContain("write a summary of this week");
  }, 60_000);
});

describe("deciding", () => {
  test("a decision is written once, and a second one is refused rather than applied", async () => {
    const box = await sandbox();
    const filed = await file(box, "delete the old logs");

    const first = await run(box, [
      "proposal", "decide", filed.id, SOUL, "--subject", SUBJECT, "--approve",
    ]);
    expect(first.code).toBe(0);
    expect(first.stderr).toContain("Good for one turn");

    const second = await run(box, [
      "proposal", "decide", filed.id, SOUL, "--subject", SUBJECT, "--refuse",
    ]);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("was already approved");
    expect((await Bun.file(join(storeIn(box), `${filed.id}.json`)).json()).decision.outcome).toBe(
      "approved",
    );
  }, 30_000);

  test("neither flag, both flags, and an id nothing filed are each refused", async () => {
    const box = await sandbox();
    const filed = await file(box, "delete the old logs");

    const neither = await run(box, ["proposal", "decide", filed.id, SOUL, "--subject", SUBJECT]);
    expect(neither.code).toBe(2);
    expect(neither.stderr).toContain("exactly one of --approve and --refuse");

    const both = await run(box, [
      "proposal", "decide", filed.id, SOUL, "--subject", SUBJECT, "--approve", "--refuse",
    ]);
    expect(both.code).toBe(2);

    const nothing = await run(box, [
      "proposal", "decide", "not-an-id", SOUL, "--subject", SUBJECT, "--approve",
    ]);
    expect(nothing.code).toBe(1);
    expect(nothing.stderr).toContain("no proposal");
  }, 30_000);

  test("I-3 — one subject's store is not reachable through another's soul", async () => {
    const box = await sandbox();
    const filed = await file(box, "delete the old logs");

    // The other fixture's soul really is a different subject, so this is the
    // ordinary way somebody would ask: the directory is the answer and the
    // subject is the claim (I-3).
    const across = await run(box, [
      "proposal", "show", filed.id, OTHER_SOUL, "--subject", OTHER_SUBJECT,
    ]);
    expect(across.code).toBe(1);
    expect(across.stderr).toContain("no proposal");

    // And a subject that does not match the soul in that directory is refused
    // before the store is opened at all.
    const mismatched = await run(box, [
      "proposal", "list", SOUL, "--subject", "somebody-else",
    ]);
    expect(mismatched.code).toBe(1);
    expect(await Bun.file(storeIn(box, "somebody-else")).exists()).toBe(false);
  }, 30_000);

  test("usage errors name the four subcommands and write nothing", async () => {
    const box = await sandbox();
    for (const argv of [
      ["proposal"],
      ["proposal", "wat"],
      ["proposal", "new"],
      ["proposal", "new", SOUL, "--subject", SUBJECT],
      ["proposal", "list"],
      ["proposal", "show"],
      ["proposal", "decide"],
    ]) {
      const result = await run(box, argv);
      expect(result.code, argv.join(" ")).toBe(2);
      expect(result.stderr, argv.join(" ")).toContain("ohmyagi proposal");
    }
    expect(await Bun.file(join(box.home, "data")).exists()).toBe(false);
  }, 60_000);
});

describe("--json is one document on stdout", () => {
  test("list and show parse whole, and the refusals still go to stderr", async () => {
    const box = await sandbox();
    const filed = await file(box, "delete the old logs");
    await run(box, ["proposal", "decide", filed.id, SOUL, "--subject", SUBJECT, "--refuse"]);
    const second = await file(box, "restart the service");

    const listed = await run(box, ["proposal", "list", SOUL, "--subject", SUBJECT, "--json"]);
    expect(listed.code).toBe(0);
    const document = JSON.parse(listed.stdout);
    expect(document.schema).toBe("om-agi/proposal-list@1");
    expect(document.subject).toBe(SUBJECT);
    expect(document.proposals).toHaveLength(2);
    expect(listed.stderr).toContain("1 thing(s) this subject has been refused");

    // Every record is in that one document, which is why `show` has no --json
    // of its own: one JSON shape per command, and no second one to drift.
    expect(document.proposals.map((proposal: { id: string }) => proposal.id)).toContain(second.id);
    const shown = await run(box, ["proposal", "show", second.id, SOUL, "--subject", SUBJECT]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("restart the service");
    expect(shown.stdout).toContain("spent   no");
  }, 30_000);

  test("a file in the store that is not a proposal is reported and counted nowhere", async () => {
    const box = await sandbox();
    await file(box, "delete the old logs");
    await writeFile(join(storeIn(box), "junk.json"), "{ not json");

    const listed = await run(box, ["proposal", "list", SOUL, "--subject", SUBJECT, "--json"]);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout).proposals).toHaveLength(1);
    expect(listed.stderr).toContain("is not a proposal");
    // The sentence that matters: if that file was a refusal, this command has
    // forgotten it, and it says so rather than reporting a clean store.
    expect(listed.stderr).toContain("this command has forgotten it");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// D-029's measurements
// ---------------------------------------------------------------------------

describe("deleting the store changes one thing, and it is the thing the store is for", () => {
  test("the refusal is forgotten afterwards, and only the refusal", async () => {
    const box = await sandbox();
    const filed = await file(box, "delete the old logs");
    await run(box, ["proposal", "decide", filed.id, SOUL, "--subject", SUBJECT, "--refuse"]);
    expect((await file(box, "delete the old logs")).code).toBe(REPEATED);

    await rm(storeIn(box), { recursive: true, force: true });

    // `rm` is how an owner says "ask me again". Nothing else about om-agi
    // changed: the same command line that was refused a moment ago is accepted.
    const after = await file(box, "delete the old logs");
    expect(after.code).toBe(0);
    expect(after.stderr).toContain("Nothing has been refused for this subject yet");
  }, 60_000);

  test("a turn with no --proposal is byte-identical before and after the store is deleted", async () => {
    const box = await sandbox();
    const ollama = serveOllama();
    try {
      // A store with something in it, so "before" is a run with a populated
      // store rather than a run with none.
      const filed = await file(box, "delete the old logs");
      await run(box, ["proposal", "decide", filed.id, SOUL, "--subject", SUBJECT, "--refuse"]);
      expect(await Bun.file(join(storeIn(box), `${filed.id}.json`)).exists()).toBe(true);

      const turn = () =>
        run(
          box,
          [
            "turn", SOUL, "--subject", SUBJECT,
            "--prompt", "Reply with the token t5d029 and nothing else.",
            "--backend", "ollama", "--model", "stub",
          ],
          { OLLAMA_HOST: ollama.url },
        );

      const before = await turn();
      expect(before.code).toBe(0);
      expect(before.stdout.trim()).toBe("t5d029 from ollama with-soul");

      await rm(storeIn(box), { recursive: true, force: true });
      const after = await turn();

      // Byte for byte on stdout and on the exit code; stderr through the one
      // thing that legitimately differs between two runs — how long it took.
      const settle = (text: string) => text.replace(/\b\d+\.\d+s\b/g, "<took>");
      expect(after.stdout).toBe(before.stdout);
      expect(after.code).toBe(before.code);
      expect(settle(after.stderr)).toBe(settle(before.stderr));

      // And the backend was handed the same two things both times, which is
      // the half a comparison of om-agi's own output cannot see.
      expect(ollama.systems).toHaveLength(2);
      expect(ollama.systems[1]).toBe(ollama.systems[0]!);
      expect(ollama.prompts[1]).toBe(ollama.prompts[0]!);

      // A guard on the comparison: an empty stderr would make it agree about
      // nothing.
      expect(before.stderr).toContain("answered by ollama");
    } finally {
      await ollama.server.stop(true);
    }
  }, 60_000);
});

describe("turn --proposal spends an approval once", () => {
  test("approved runs and is spent; the same id a second time is refused", async () => {
    const box = await sandbox();
    const ollama = serveOllama();
    try {
      const filed = await file(box, "delete the old logs");
      await run(box, ["proposal", "decide", filed.id, SOUL, "--subject", SUBJECT, "--approve"]);

      const turn = (id: string) =>
        run(
          box,
          [
            "turn", SOUL, "--subject", SUBJECT,
            "--prompt", "Reply with the token t5spend and nothing else.",
            "--backend", "ollama", "--model", "stub", "--proposal", id,
          ],
          { OLLAMA_HOST: ollama.url },
        );

      const first = await turn(filed.id);
      expect(first.code).toBe(0);
      expect(first.stdout.trim()).toBe("t5spend from ollama with-soul");
      expect(first.stderr).toContain("is spent on this turn");

      const record = await Bun.file(join(storeIn(box), `${filed.id}.json`)).json();
      expect(record.usedByTurn).toMatch(/^[0-9a-f-]{36}$/);
      expect(record.usedAt).not.toBeNull();

      const second = await turn(filed.id);
      expect(second.code).toBe(REFUSED);
      expect(second.stderr).toContain("already spent by turn");
      // Nothing was sent the second time: one prompt reached the daemon, not two.
      expect(ollama.prompts).toHaveLength(1);
    } finally {
      await ollama.server.stop(true);
    }
  }, 60_000);

  test("pending, refused and unknown each stop the turn before anything is sent", async () => {
    const box = await sandbox();
    const ollama = serveOllama();
    try {
      const pending = await file(box, "delete the old logs");
      const refused = await file(box, "restart the service");
      await run(box, ["proposal", "decide", refused.id, SOUL, "--subject", SUBJECT, "--refuse", "--note", "not today"]);

      const turn = (id: string) =>
        run(
          box,
          [
            "turn", SOUL, "--subject", SUBJECT,
            "--prompt", "Reply with the token t5stop and nothing else.",
            "--backend", "ollama", "--model", "stub", "--proposal", id,
          ],
          { OLLAMA_HOST: ollama.url },
        );

      const waiting = await turn(pending.id);
      expect(waiting.code).toBe(REFUSED);
      expect(waiting.stderr).toContain("It has not been answered");

      const said = await turn(refused.id);
      expect(said.code).toBe(REFUSED);
      expect(said.stderr).toContain("It was refused: not today");

      // An id nothing filed is a usage error, not a refusal: a loop that
      // retried on 4 would otherwise retry a typo until somebody looked.
      const typo = await turn("not-an-id");
      expect(typo.code).toBe(2);
      expect(typo.stderr).toContain("no proposal");

      // …and `--proposal` with nothing after it is refused rather than read as
      // "no proposal was asked for". Running that as an ordinary turn is the
      // free pass this flag exists to prevent, arriving through a typo.
      const empty = await run(
        box,
        [
          "turn", SOUL, "--subject", SUBJECT,
          "--prompt", "Reply with the token t5stop and nothing else.",
          "--backend", "ollama", "--model", "stub", "--proposal",
        ],
        { OLLAMA_HOST: ollama.url },
      );
      expect(empty.code).toBe(2);
      expect(empty.stderr).toContain("--proposal takes the id of a proposal");

      // Nothing reached the backend on any of the three, and no ledger line
      // was written for a turn that never happened.
      expect(ollama.prompts).toEqual([]);
      expect(await Bun.file(join(box.home, "state", "om-agi", "ledger", SUBJECT)).exists()).toBe(
        false,
      );
    } finally {
      await ollama.server.stop(true);
    }
  }, 60_000);
});
