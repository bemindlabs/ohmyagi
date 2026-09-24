/**
 * `ohmyagi turn` writing a ledger, and `ohmyagi ledger` reading and ending it.
 *
 * End to end through the real binary, because the claims S2.2 makes are about
 * what ends up on a disk, not about what a function returned. Three of them
 * are only checkable from out here:
 *
 * - **The canary really leaves.** Every deletion test finishes by walking the
 *   whole temporary `XDG_STATE_HOME` looking for the string that was sent. A
 *   `forget` that reported success while the text sat in a file it had not
 *   thought of would pass every unit test in the suite.
 * - **`--private` never writes it in the first place.** Same walk, different
 *   moment: straight after the turn, before anything is deleted.
 * - **The things that cannot be deleted are printed.** I-4 says do not claim
 *   to delete what you cannot. That claim is only kept if the words reach the
 *   operator's terminal, so the words are asserted.
 *
 * `HOME` and `XDG_STATE_HOME` are temporary throughout. Nothing here can reach
 * a real state directory, and the only backend involved is a stub HTTP server
 * on a loopback port.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const BIN = join(ROOT, "bin", "om-agi.ts");
const SOUL = join(ROOT, "test", "fixtures", "soul-valid");
const SOUL_B = join(ROOT, "test", "fixtures", "soul-valid-b");
const BUN = Bun.which("bun") ?? "bun";

const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Harness {
  readonly home: string;
  readonly state: string;
  /** A PATH holding `bun` and nothing else — no vendor CLI can be reached. */
  readonly bare: string;
  /** A PATH that also holds a stub `claude`. */
  readonly withClaude: string;
}

/** A stub `claude` that exits 0 having printed nothing: asked, and silent. */
const SILENT_CLAUDE = `#!/usr/bin/env bun
process.exit(0);
`;

async function makeHarness(): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), "om-agi-ledger-cli-"));
  scratch.push(home);

  const bare = join(home, "bare-bin");
  await mkdir(bare, { recursive: true });
  await symlink(BUN, join(bare, "bun"));

  const stubs = join(home, "bin");
  await mkdir(stubs, { recursive: true });
  await writeFile(join(stubs, "claude"), SILENT_CLAUDE);
  await chmod(join(stubs, "claude"), 0o755);

  return { home, state: join(home, "state"), bare, withClaude: `${stubs}:${bare}` };
}

/** The ollama daemon, as far as `OllamaExec` can tell. */
function serveOllama() {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/tags") return Response.json({ models: [{ name: "stub" }] });
      if (url.pathname !== "/api/chat") return new Response("no", { status: 404 });
      const body = (await request.json()) as { messages: { role: string; content: string }[] };
      const prompt = body.messages.at(-1)?.content ?? "";
      // The counts a real daemon puts at the top level beside the durations.
      return Response.json({
        message: { content: `echo:${prompt}` },
        prompt_eval_count: 15,
        eval_count: 24,
      });
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}` };
}

interface RunOptions {
  readonly path?: string;
  readonly ollama?: string;
  readonly stdin?: string;
}

async function run(harness: Harness, args: readonly string[], options: RunOptions = {}) {
  const child = Bun.spawn([BUN, "run", BIN, ...args], {
    cwd: ROOT,
    env: {
      HOME: harness.home,
      PATH: options.path ?? harness.bare,
      XDG_STATE_HOME: harness.state,
      CODEX_HOME: join(harness.home, ".codex"),
      ...(options.ollama === undefined ? {} : { OLLAMA_HOST: options.ollama }),
    },
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  await child.exited;
  return { code: child.exitCode ?? -1, stdout, stderr };
}

/** Files under `dir` whose bytes contain `needle`. */
async function grepTree(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const item of entries) {
    const path = join(dir, item.name);
    if (item.isDirectory()) hits.push(...(await grepTree(path, needle)));
    else if ((await Bun.file(path).text()).includes(needle)) hits.push(path);
  }
  return hits;
}

function canary(): string {
  return `canary-${Math.random().toString(36).slice(2, 10)}`;
}

describe("ohmyagi ledger", () => {
  test("a turn is recorded, and `show` reports it without printing what was said", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = canary();
    try {
      const turn = await run(
        harness,
        ["turn", SOUL, "--subject", "example", "--prompt", value, "--backend", "ollama", "--model", "stub"],
        { ollama: ollama.url },
      );
      expect(turn.code).toBe(0);

      const shown = await run(harness, ["ledger", "show", "--subject", "example"]);
      expect(shown.code).toBe(0);
      expect(shown.stdout).toContain("ollama");
      expect(shown.stdout).toContain("confirmed");
      // I-6: metadata answers "when and who", and does not put the
      // conversation into scrollback or into whatever this was piped to.
      expect(shown.stdout).not.toContain(value);
      expect(shown.stdout).toContain("--content");

      const withContent = await run(harness, ["ledger", "show", "--subject", "example", "--content"]);
      expect(withContent.stdout).toContain(value);
      expect(withContent.stdout).toContain(`echo:${value}`);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("--json hides the text too unless --content is given", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = canary();
    try {
      await run(
        harness,
        ["turn", SOUL, "--subject", "example", "--prompt", value, "--backend", "ollama", "--model", "stub"],
        { ollama: ollama.url },
      );

      const plain = await run(harness, ["ledger", "show", "--subject", "example", "--json"]);
      const parsed = JSON.parse(plain.stdout) as {
        entries: { backend: string; prompt?: string; prompt_bytes: number }[];
      };
      expect(parsed.entries.length).toBe(1);
      expect(parsed.entries[0]!.backend).toBe("ollama");
      expect(parsed.entries[0]!.prompt).toBeUndefined();
      expect(parsed.entries[0]!.prompt_bytes).toBe(value.length);

      const full = await run(harness, ["ledger", "show", "--subject", "example", "--json", "--content"]);
      expect(JSON.parse(full.stdout).entries[0].prompt).toBe(value);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("--private records the turn and never writes the words anywhere", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = canary();
    try {
      const turn = await run(
        harness,
        [
          "turn", SOUL, "--subject", "example", "--prompt", value,
          "--backend", "ollama", "--model", "stub", "--private",
        ],
        { ollama: ollama.url },
      );
      expect(turn.code).toBe(0);
      expect(turn.stdout).toContain(`echo:${value}`);

      // The line is there and is still auditable.
      const shown = await run(harness, ["ledger", "show", "--subject", "example", "--content"]);
      expect(shown.stdout).toContain("ollama");
      expect(shown.stdout).toContain("--private");

      // And the text is not, which is the only guarantee deletion cannot give.
      expect(await grepTree(harness.state, value)).toEqual([]);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("a chain that fell through records every backend that was handed the prompt", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = canary();
    try {
      const turn = await run(
        harness,
        ["turn", SOUL, "--subject", "example", "--prompt", value, "--backend", "claude,ollama", "--model", "stub"],
        { path: harness.withClaude, ollama: ollama.url },
      );
      expect(turn.code).toBe(0);

      const shown = await run(harness, ["ledger", "show", "--subject", "example", "--json"]);
      const entries = (JSON.parse(shown.stdout) as { entries: { backend: string; turn: string; confidence: string }[] })
        .entries;
      // Two lines, one turn id. `claude` exited 0 having printed nothing — it
      // still received the prompt, which is the fact I-6 turns on.
      expect(entries.map((e) => e.backend).sort()).toEqual(["claude", "ollama"]);
      expect(new Set(entries.map((e) => e.turn)).size).toBe(1);
      expect(entries.find((e) => e.backend === "claude")!.confidence).toBe("silent");
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("a line says what the turn used, and never what it cost", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = canary();
    try {
      await run(
        harness,
        ["turn", SOUL, "--subject", "example", "--prompt", value, "--backend", "ollama", "--model", "stub"],
        { ollama: ollama.url },
      );

      const json = await run(harness, ["ledger", "show", "--subject", "example", "--json"]);
      const entry = (
        JSON.parse(json.stdout) as {
          entries: {
            cost: number | null;
            usage: { status: string; input: number | null; output: number | null; total: number | null };
          }[];
        }
      ).entries[0]!;

      // S2.1 AC1's fourth value, closed in tokens: read off the daemon's own
      // response, not derived, and with no total because ollama prints none.
      expect(entry.usage).toEqual({ status: "reported", input: 15, output: 24, total: null });
      // And the money column is still empty — by decision now, not by debt.
      expect(entry.cost).toBeNull();

      const shown = await run(harness, ["ledger", "show", "--subject", "example"]);
      expect(shown.stdout).toContain("15/24/-");
      expect(shown.stdout).toContain("reported");
      expect(shown.stdout).toContain("money is never recorded");
      // I-6 unchanged: the counts are metadata and the words still are not here.
      expect(shown.stdout).not.toContain(value);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("--private keeps the counts and still writes none of the words", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = canary();
    try {
      await run(
        harness,
        [
          "turn", SOUL, "--subject", "example", "--prompt", value,
          "--backend", "ollama", "--model", "stub", "--private",
        ],
        { ollama: ollama.url },
      );

      const json = await run(harness, ["ledger", "show", "--subject", "example", "--json"]);
      expect(JSON.parse(json.stdout).entries[0].usage.input).toBe(15);
      // A token count is coarser than the `prompt_bytes` a private line
      // already records, so keeping it gives away nothing the line did not.
      expect(await grepTree(harness.state, value)).toEqual([]);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("a backend nobody has surveyed says `unreported`, never a zero", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    try {
      await run(
        harness,
        [
          "turn", SOUL, "--subject", "example", "--prompt", canary(),
          "--backend", "claude,ollama", "--model", "stub",
        ],
        { path: harness.withClaude, ollama: ollama.url },
      );

      const json = await run(harness, ["ledger", "show", "--subject", "example", "--json"]);
      const entries = (
        JSON.parse(json.stdout) as { entries: { backend: string; usage: { status: string } }[] }
      ).entries;
      // The stub `claude` exits 0 having printed nothing, so the channel the
      // registry names is empty: a backend that usually reports and did not.
      expect(entries.find((e) => e.backend === "claude")!.usage.status).toBe("missing");
      expect(entries.find((e) => e.backend === "ollama")!.usage.status).toBe("reported");
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("I-3 — one subject's ledger is invisible to another's", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const mine = canary();
    try {
      await run(
        harness,
        ["turn", SOUL, "--subject", "example", "--prompt", mine, "--backend", "ollama", "--model", "stub"],
        { ollama: ollama.url },
      );
      await run(
        harness,
        ["turn", SOUL_B, "--subject", "other-example", "--prompt", canary(), "--backend", "ollama", "--model", "stub"],
        { ollama: ollama.url },
      );

      const other = await run(harness, ["ledger", "show", "--subject", "other-example", "--content"]);
      expect(other.stdout).not.toContain(mine);
      expect(other.stdout).toContain("1 line(s)");
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("forget is a dry run by default, and names who already has the text", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = canary();
    try {
      await run(
        harness,
        ["turn", SOUL, "--subject", "example", "--prompt", value, "--backend", "ollama", "--model", "stub"],
        { ollama: ollama.url },
      );

      const dry = await run(harness, ["ledger", "forget", "--subject", "example", "--all"]);
      expect(dry.code).toBe(0);
      expect(dry.stdout).toContain("1 line(s) to forget");
      expect(dry.stdout).toContain("Already received by");
      expect(dry.stdout).toContain("ollama");
      expect(dry.stdout).toContain("Nothing was removed");

      // Printed, not filed in a document: what deletion does not reach.
      expect(dry.stdout).toContain("shred");
      expect(dry.stdout).toContain("snapshot");
      expect(dry.stdout).toContain("~/.claude/projects");
      expect(dry.stdout).toContain("shell history");

      // A dry run is the absence of a write, so the line is still there.
      expect((await grepTree(harness.state, value)).length).toBe(1);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("forget --all --yes leaves nothing on disk to find", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = canary();
    try {
      await run(
        harness,
        ["turn", SOUL, "--subject", "example", "--prompt", value, "--backend", "ollama", "--model", "stub"],
        { ollama: ollama.url },
      );
      expect((await grepTree(harness.state, value)).length).toBe(1);

      const done = await run(harness, ["ledger", "forget", "--subject", "example", "--all", "--yes"]);
      expect(done.code).toBe(0);
      expect(done.stdout).toContain("removed 1 line(s)");
      // Still printed on the run that actually deletes, because that is the
      // run where the owner most needs to know what it did not do.
      expect(done.stdout).toContain("shred");

      expect(await grepTree(harness.state, value)).toEqual([]);

      const shown = await run(harness, ["ledger", "show", "--subject", "example"]);
      expect(shown.stdout).toContain("nothing recorded");
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("forget --id removes one line and leaves its neighbour alone", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const doomed = canary();
    const kept = canary();
    try {
      for (const value of [doomed, kept]) {
        await run(
          harness,
          ["turn", SOUL, "--subject", "example", "--prompt", value, "--backend", "ollama", "--model", "stub"],
          { ollama: ollama.url },
        );
      }

      const listed = await run(harness, ["ledger", "show", "--subject", "example", "--json", "--content"]);
      const entries = (JSON.parse(listed.stdout) as { entries: { id: string; prompt: string }[] }).entries;
      const target = entries.find((entry) => entry.prompt === doomed)!;

      const done = await run(
        harness,
        ["ledger", "forget", "--subject", "example", "--id", target.id, "--yes"],
      );
      expect(done.stdout).toContain("removed 1 line(s)");
      expect(await grepTree(harness.state, doomed)).toEqual([]);
      expect((await grepTree(harness.state, kept)).length).toBe(1);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("forget refuses to guess, and refuses to be told twice", async () => {
    const harness = await makeHarness();

    const none = await run(harness, ["ledger", "forget", "--subject", "example"]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("will not guess");

    const both = await run(
      harness,
      ["ledger", "forget", "--subject", "example", "--all", "--before", "2026-01-01"],
    );
    expect(both.code).toBe(2);

    const badDate = await run(
      harness,
      ["ledger", "forget", "--subject", "example", "--before", "last tuesday"],
    );
    expect(badDate.code).toBe(2);
    expect(badDate.stderr).toContain("--before");

    const unknown = await run(harness, ["ledger", "burn", "--subject", "example"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("show");
  });

  test("--prompt-file - takes the prompt off the command line", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = canary();
    try {
      const turn = await run(
        harness,
        ["turn", SOUL, "--subject", "example", "--prompt-file", "-", "--backend", "ollama", "--model", "stub"],
        { ollama: ollama.url, stdin: `${value}\n` },
      );
      expect(turn.code).toBe(0);
      // One trailing newline is dropped, so this asks the same question that
      // `--prompt <value>` would have — without putting it in shell history.
      expect(turn.stdout.trim()).toBe(`echo:${value}`);

      const shown = await run(harness, ["ledger", "show", "--subject", "example", "--json", "--content"]);
      expect(JSON.parse(shown.stdout).entries[0].prompt).toBe(value);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("--prompt and --prompt-file together are a usage error, not a silent winner", async () => {
    const harness = await makeHarness();
    const clash = await run(harness, [
      "turn", SOUL, "--subject", "example", "--prompt", "one", "--prompt-file", "-",
    ]);
    expect(clash.code).toBe(2);
    expect(clash.stderr).toContain("--prompt-file");

    const missing = await run(harness, [
      "turn", SOUL, "--subject", "example", "--prompt-file", join(harness.home, "nope.txt"),
    ]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("cannot read the prompt");
  });

  test("a ledger that cannot be written stops the turn before it is sent", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = canary();
    try {
      // A file where the subject's ledger directory needs to go.
      await mkdir(join(harness.state, "om-agi", "ledger"), { recursive: true });
      await writeFile(join(harness.state, "om-agi", "ledger", "example"), "in the way");

      const turn = await run(
        harness,
        ["turn", SOUL, "--subject", "example", "--prompt", value, "--backend", "ollama", "--model", "stub"],
        { ollama: ollama.url },
      );

      expect(turn.code).toBe(1);
      expect(turn.stdout).toBe("");
      expect(turn.stderr).toContain("Nothing was sent");
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("the help text says where the ledger is and which prompt route is safer", async () => {
    const harness = await makeHarness();
    const help = await run(harness, ["help"]);
    expect(help.stdout).toContain("ohmyagi ledger show");
    expect(help.stdout).toContain("ohmyagi ledger forget");
    expect(help.stdout).toContain("om-agi/ledger/<subject>");
    expect(help.stdout).toContain("--prompt-file -");
  });
});
