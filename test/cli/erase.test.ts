/**
 * `ohmyagi erase`, as a person types it.
 *
 * This is the sequence the plan's verification section describes, run as a real
 * process rather than as function calls: make an agent, ask to erase it, read
 * what it says it will do, do it, and then search the two roots by hand for the
 * identifier. The exit codes are here for the same reason `rebuild --check`'s
 * are — they are meant to be usable from a script, and an exit code is not
 * visible from inside the function that decided it.
 *
 * `HOME`, `XDG_STATE_HOME` and `XDG_DATA_HOME` are temporary directories in
 * every invocation and the agent is created under `$TMPDIR`, which is not
 * inside any git repository. Nothing here can reach the real home.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BUN } from "../support/bare-path.ts";

const ROOT = join(import.meta.dir, "..", "..");
const BIN = join(ROOT, "bin", "om-agi.ts");
const SUBJECT = "demo";

const scratch: string[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function sandbox(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

async function run(home: string, args: readonly string[]) {
  const child = Bun.spawn([BUN, "run", BIN, ...args], {
    cwd: home,
    env: {
      HOME: home,
      PATH: `${dirname(BUN)}:${process.env["PATH"] ?? ""}`,
      XDG_STATE_HOME: join(home, "state"),
      XDG_DATA_HOME: join(home, "data"),
      // Nothing listens on port 9: the run never asks this machine's Qdrant.
      OM_AGI_QDRANT_URL: "http://127.0.0.1:9",
      CODEX_HOME: join(home, ".codex"),
      USER: "the-test",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  await child.exited;
  return { code: child.exitCode ?? -1, stdout, stderr };
}

/** A home, an agent beside it, and a rebuilt `.dagi/` so all three soul places exist. */
async function makeAgent(): Promise<{ home: string; agent: string }> {
  const home = await sandbox("om-agi-erase-home-");
  const parent = await sandbox("om-agi-erase-agents-");
  const created = await run(home, ["new", SUBJECT, "--subject", SUBJECT, "--dir", parent]);
  expect(created.code, created.stderr).toBe(0);

  const agent = join(parent, SUBJECT);
  expect((await run(home, ["rebuild", agent, "--subject", SUBJECT])).code).toBe(0);
  return { home, agent };
}

/** Every regular file under `root` holding `needle`. The check AC3 is written as. */
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

// ---------------------------------------------------------------------------
// AC4 — said before, not discovered at deletion time
// ---------------------------------------------------------------------------

describe("ohmyagi new prints all five places", () => {
  test("including the one that does not exist, and who owes it", async () => {
    const home = await sandbox("om-agi-erase-home-");
    const parent = await sandbox("om-agi-erase-agents-");
    const created = await run(home, ["new", SUBJECT, "--subject", SUBJECT, "--dir", parent]);

    expect(created.code, created.stderr).toBe(0);
    expect(created.stdout).toContain("The five places a subject's data can end up");
    for (const id of ["soul", "observer", "rag", "ledger", "lora"]) {
      expect(created.stdout, id).toContain(id);
    }
    // The weights list, which has no other home and is useless after training.
    expect(created.stdout).toContain("cannot have one person subtracted from it");
    // And the vector store's, measured before it was written (D-035).
    expect(created.stdout).toContain("inversion attacks");
    expect(created.stdout).toContain("S6.3");
    // And git's, which was already printed here before this story.
    expect(created.stdout).toContain("Rewriting history");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The sequence
// ---------------------------------------------------------------------------

describe("ohmyagi erase", () => {
  test("a dry run says what would go, prints both lists, and removes nothing", async () => {
    const { home, agent } = await makeAgent();

    const dry = await run(home, ["erase", SUBJECT, "--agent", agent, "--by", "a reviewer"]);

    expect(dry.code, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("4 of 4 places that exist were visited");
    expect(dry.stdout).toContain("1 of 5 are not built");
    expect(dry.stdout).toContain("verdict      dry-run");
    expect(dry.stdout).toContain("What it does not search, and therefore does not certify:");
    expect(dry.stdout).toContain("vendor transcripts");
    expect(dry.stdout).toContain("Nothing was removed.");
    // The string this command exists not to print.
    expect(dry.stdout).not.toContain("5 of 5");

    expect(await Bun.file(join(agent, "soul", "role.md")).exists()).toBe(true);
    expect(await Bun.file(join(agent, ".dagi", "manifest.json")).exists()).toBe(true);
  }, 60_000);

  test("--yes deletes, recounts from disk, and the identifier is findable nowhere", async () => {
    const { home, agent } = await makeAgent();

    const erased = await run(home, [
      "erase",
      SUBJECT,
      "--agent",
      agent,
      "--by",
      "a reviewer",
      "--yes",
      "--json",
    ]);

    expect(erased.code, erased.stderr).toBe(0);
    // The whole of stdout, from byte zero. Until odd3 this line read
    // `JSON.parse(stdout.slice(stdout.indexOf("{")))` — a test that had been
    // shaped around the defect instead of reporting it: `erase --json` printed
    // the human plan first, so the document could not be parsed whole and
    // `erase --json | jq` failed for everybody. The slice made it pass here
    // from S7.2's first commit, through odd2 and fix1, with nobody noticing.
    // Parse the whole stream or the contract is untested.
    const cert = JSON.parse(erased.stdout);
    // The literal, on purpose and only here: this is the contract a consumer of
    // `--json` reads, and the tag moving is a thing that has to be noticed.
    // `@3` since fix2: `agent.commits` narrowed from "0 means none" to "null
    // whenever it was not counted", and a document that keeps the old tag over
    // a changed meaning is the reason anybody reads tags (D-026 item 6).
    // `@4` since dod1: `agent.history` gained a fifth value, `no-git`, for a
    // machine with no git on it. Nothing already there changed meaning — the
    // bump is for the reader that switches on the four it knew and meets one it
    // does not, which is the state that says *there may be history nobody
    // counted*.
    expect(cert.schema).toBe("om-agi/erase-certificate@4");
    expect(cert.verdict).toBe("erased-and-verified");
    expect(cert.by.claimed).toBe("a reviewer");
    expect(cert.by.observed).toBe("the-test");
    expect(cert.verification.deletableHits).toBe(0);
    expect(cert.verification.gitHits).toBe(0);

    // The check AC3 is written as, run by hand rather than read off the report.
    expect(await grepTree(join(home, "state"), SUBJECT)).toEqual([]);
    expect(await grepTree(join(home, "data"), SUBJECT)).toEqual([]);

    expect(await Bun.file(join(agent, "soul", "role.md")).exists()).toBe(false);
    expect(await Bun.file(join(agent, ".dagi")).exists()).toBe(false);
    // What was never this subject's to delete is still there, and git is intact.
    expect(await Bun.file(join(agent, "memory", "README.md")).exists()).toBe(true);
    expect(await Bun.file(join(agent, ".git", "HEAD")).exists()).toBe(true);
  }, 60_000);

  test("--out writes the machine form, and om-agi keeps no copy of its own", async () => {
    const { home, agent } = await makeAgent();
    const elsewhere = await sandbox("om-agi-erase-out-");
    const out = join(elsewhere, "certificate.json");

    const erased = await run(home, [
      "erase",
      SUBJECT,
      "--agent",
      agent,
      "--by",
      "a reviewer",
      "--out",
      out,
      "--yes",
    ]);

    expect(erased.code, erased.stderr).toBe(0);
    const written = JSON.parse(await readFile(out, "utf8"));
    expect(written.verdict).toBe("erased-and-verified");
    // The document is issued, never kept: a stored certificate is a record that
    // this subject existed, and it would sit in the tree the next run searches.
    expect(await grepTree(join(home, "state"), "erase-certificate")).toEqual([]);
    expect(await grepTree(join(home, "data"), "erase-certificate")).toEqual([]);
  }, 60_000);

  test("a planted identifier makes it exit 1 and say where — AC3 bites", async () => {
    const { home, agent } = await makeAgent();
    // Somewhere under the state root that no deleter looks at — which is how a
    // real leftover would arrive.
    await Bun.write(join(home, "state", "om-agi", "stray.log"), `wore ${SUBJECT} once\n`);

    const erased = await run(home, [
      "erase",
      SUBJECT,
      "--agent",
      agent,
      "--by",
      "a reviewer",
      "--yes",
    ]);

    expect(erased.code).toBe(1);
    expect(erased.stdout).toContain("verdict      erased-with-remainder");
    expect(erased.stdout).toContain("stray.log:1");
    expect(erased.stderr).toContain("erased-with-remainder");
  }, 60_000);

  test("something at a reserved address exits 1 and issues no certificate", async () => {
    const { home, agent } = await makeAgent();
    await Bun.write(join(agent, ".dagi", "adapters", "weights.safetensors"), "not really\n");

    const erased = await run(home, [
      "erase",
      SUBJECT,
      "--agent",
      agent,
      "--by",
      "a reviewer",
      "--yes",
    ]);

    expect(erased.code).toBe(1);
    expect(erased.stderr).toContain("S6.3");
    expect(erased.stderr).toContain("no certificate was issued");
    expect(erased.stdout).not.toContain("erase certificate");
    // Nothing was deleted, either.
    expect(await Bun.file(join(agent, "soul", "role.md")).exists()).toBe(true);
  }, 60_000);

  test("--personal keeps role.md byte-identical and says why the ledger went whole", async () => {
    const { home, agent } = await makeAgent();
    const before = await readFile(join(agent, "soul", "role.md"), "utf8");

    const erased = await run(home, [
      "erase",
      SUBJECT,
      "--agent",
      agent,
      "--by",
      "a reviewer",
      "--personal",
      "--yes",
    ]);

    expect(await Bun.file(join(agent, "soul", "person.md")).exists()).toBe(false);
    expect(await readFile(join(agent, "soul", "role.md"), "utf8")).toBe(before);
    expect(await Bun.file(join(agent, "memory", "README.md")).exists()).toBe(true);
    expect(erased.stdout).toContain("keeps role.md, memory/ and consent/");
    expect(erased.stdout).toContain("will not load again until a new person.md is written");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Nothing to erase — the exit code a script reads
// ---------------------------------------------------------------------------

describe("ohmyagi erase over a subject this machine does not hold", () => {
  test("--yes exits 3, and the document is not a certificate of erasure", async () => {
    const home = await sandbox("om-agi-erase-home-");

    const erased = await run(home, [
      "erase",
      "never-existed",
      "--no-agent",
      "--by",
      "a reviewer",
      "--yes",
      "--json",
    ]);

    // Not 0: `&&` and a CI job read this, and nothing was withdrawn. Not 1
    // either: 1 from this command means something of the subject survived, and
    // re-running an erase is a legitimate thing for a script to do.
    expect(erased.code, erased.stderr).toBe(3);
    // Whole, for the reason given at the other `JSON.parse` above: the slice
    // this used to do is how a broken `--json` stayed green for three tasks.
    const cert = JSON.parse(erased.stdout);
    expect(cert.verdict).toBe("nothing-found");
    expect(cert.verification.filesRead).toBe(0);
    expect(cert.statement.join("\n")).toContain("NOTHING WAS ERASED");
    expect(erased.stderr).toContain("Exit 3, not 0");
    expect(erased.stderr).toContain("cannot tell a subject that was never here");
  }, 60_000);

  test("the human form prints the sentences, not just the verdict word", async () => {
    const home = await sandbox("om-agi-erase-home-");

    const erased = await run(home, ["erase", "never-existed", "--no-agent", "--by", "x", "--yes"]);

    expect(erased.code).toBe(3);
    expect(erased.stdout).toContain("verdict      nothing-found");
    expect(erased.stdout).toContain("This document is not a certificate of erasure");
    expect(erased.stdout).toContain("found        before deletion: 0 file(s)");
    expect(erased.stdout).toContain("removed      0 thing(s)");
    expect(erased.stdout).not.toContain("erased-and-verified");
  }, 60_000);

  test("a dry run over nothing still exits 0, and says what --yes would do", async () => {
    // A dry run claims nothing, so there is nothing here for it to be wrong
    // about — but somebody reading "Re-run with --yes" alone would expect a
    // certificate at the end of it, and there will not be one.
    const home = await sandbox("om-agi-erase-home-");

    const dry = await run(home, ["erase", "never-existed", "--no-agent", "--by", "x"]);

    expect(dry.code, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("Nothing was found to remove.");
    expect(dry.stdout).toContain("would issue no erasure verdict");
    expect(dry.stdout).toContain("verdict      dry-run");
  }, 60_000);

  test("a real erase of a real agent still exits 0 — the verdict was narrowed, not broken", async () => {
    // The control beside the three above: `erased-and-verified` still happens,
    // and still exits 0, so the new verdict cannot be passing by refusing
    // everybody.
    const { home, agent } = await makeAgent();

    const erased = await run(home, ["erase", SUBJECT, "--agent", agent, "--by", "x", "--yes"]);

    expect(erased.code, erased.stderr).toBe(0);
    expect(erased.stdout).toContain("verdict      erased-and-verified");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The refusals, all of which happen before anything is deleted
// ---------------------------------------------------------------------------

describe("what erase refuses to do", () => {
  test("--by is required, because the certificate records who asked", async () => {
    const { home, agent } = await makeAgent();
    const result = await run(home, ["erase", SUBJECT, "--agent", agent]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--by");
    expect(result.stderr).toContain("claimed");
  }, 60_000);

  test("exactly one of --agent and --no-agent, never both and never neither", async () => {
    const { home, agent } = await makeAgent();

    const neither = await run(home, ["erase", SUBJECT, "--by", "x"]);
    expect(neither.code).toBe(2);
    expect(neither.stderr).toContain("exactly one");

    const both = await run(home, ["erase", SUBJECT, "--agent", agent, "--no-agent", "--by", "x"]);
    expect(both.code).toBe(2);
    expect(both.stderr).toContain("exactly one");
  }, 60_000);

  test("I-3 — a repository whose role.md names another subject is refused", async () => {
    const { home, agent } = await makeAgent();

    const result = await run(home, ["erase", "somebody-else", "--agent", agent, "--by", "x"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("role.md");
    expect(await Bun.file(join(agent, "soul", "role.md")).exists()).toBe(true);
  }, 60_000);

  test("an --out inside the state root is refused before anything is deleted", async () => {
    const { home, agent } = await makeAgent();

    const result = await run(home, [
      "erase",
      SUBJECT,
      "--agent",
      agent,
      "--by",
      "x",
      "--out",
      join(home, "state", "om-agi", "certificate.json"),
      "--yes",
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("would fail the check it certifies");
    expect(await Bun.file(join(agent, "soul", "role.md")).exists()).toBe(true);
  }, 60_000);

  test("an agent directory with no soul in it is refused, not guessed at", async () => {
    const home = await sandbox("om-agi-erase-home-");
    const empty = await sandbox("om-agi-erase-empty-");

    const result = await run(home, ["erase", SUBJECT, "--agent", empty, "--by", "x"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--no-agent");
  }, 60_000);

  test("help lists the command and what it will not claim", async () => {
    const home = await sandbox("om-agi-erase-home-");
    const result = await run(home, ["help"]);

    expect(result.stdout).toContain("ohmyagi erase <subject>");
    expect(result.stdout).toContain("1 of 5 are not built");
    expect(result.stdout).toContain("three places, not one");
  }, 60_000);
});
