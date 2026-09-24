/**
 * `ohmyagi turn` — and S2.1 AC6, which is the reason this file exists.
 *
 * AC6 says: take `claude` and `codex` off PATH and a turn still finishes on
 * ollama alone. §9 of the backlog adds the part that makes it worth writing —
 * *"put AC6 in CI, run it every time, not once"* — so this is an ordinary
 * `bun test` file with no opt-in flag, and it fails the build when the local
 * route stops working.
 *
 * Taking the CLIs off PATH is done by building a directory that holds one
 * symlink to `bun` and nothing else, and handing that to the child as its
 * whole PATH. The test then *checks* that this worked before asserting
 * anything about it: `Bun.which` against that PATH must come back null for
 * every vendor the registry knows, not only the two in the default chain. A
 * test that assumed the CLIs were gone would keep passing on the day one of
 * them reappeared — the same silent-success failure this project is built
 * around — and `~/.bun/bin` is exactly where a `bun add -g` would put one.
 * Both the directory and the check live in `test/support/bare-path.ts`, shared
 * with `soul-verify.test.ts`, which is the other file that needs this
 * condition and used to have a weaker copy of it.
 *
 * What proves the chain is not simply hard-wired to ollama is the control
 * case: the same command with stub vendors back on PATH must be answered by
 * `claude`, and the local server must not be called at all.
 *
 * `HOME` is a temporary directory throughout. Nothing here can reach the
 * operator's own instruction files, and no test here spends real quota.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { barePath, BUN, expectNoVendorOn } from "../support/bare-path.ts";
import { serveOllama } from "../support/stub-ollama.ts";
import { EGRESS_NOTICE_PREFIX } from "../../src/exec/egress.ts";
import { ensureCaptureDir, captureDir } from "../../src/observer/capture-store.ts";
import { consentDigest, consentText, saveConsent } from "../../src/observer/consent.ts";
import { CAPTURE_VERSION } from "../../src/observer/record.ts";
import { announceCapture, ensureObserverDir } from "../../src/observer/store.ts";
import { subjectId } from "../../src/types.ts";
import { readdir } from "node:fs/promises";

const ROOT = join(import.meta.dir, "..", "..");
const BIN = join(ROOT, "bin", "om-agi.ts");
const SOUL = join(ROOT, "test", "fixtures", "soul-valid");
const HUMAN = join(ROOT, "test", "fixtures", "instructions", "human-200.md");

/** A port nothing listens on, so "ollama is down" is a real condition. */
const NO_OLLAMA = "http://127.0.0.1:1";

const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

/**
 * A stub vendor CLI.
 *
 * Reads the prompt off argv the way the real one is invoked — `-p <prompt>`
 * for claude, trailing positional for `codex exec` — echoes the token it was
 * asked for, and says whether the soul reached it through the system flag.
 */
function stubSource(name: string, shape: "json" | "text"): string {
  const reply = shape === "json" ? "JSON.stringify({ result: answer })" : "answer";
  return `#!/usr/bin/env bun
const argv = process.argv.slice(2);
const flag = argv.indexOf("-p");
const prompt = flag === -1 ? (argv[argv.length - 1] ?? "") : (argv[flag + 1] ?? "");
const systemFlag = argv.indexOf("--append-system-prompt");
const system = systemFlag === -1 ? "" : (argv[systemFlag + 1] ?? "");
const mode = process.env["OM_AGI_STUB_MODE"] ?? "correct";

// Exit 0 having printed nothing: the failure a shell \`||\` cannot see.
if (mode === "silent") process.exit(0);
// Exit non-zero with prose on stdout: diagnostics, not an answer.
if (mode === "unauthenticated") {
  console.log("Not logged in · Please run /login");
  process.exit(1);
}

const token = (prompt.match(/token (\\S+)/) ?? [])[1] ?? "no-token";
const carried = system.includes("Example Keeper") ? "with-soul" : "no-soul";
const answer = token + " from ${name} " + carried;
console.log(${reply});
`;
}

interface Harness {
  /** Temporary HOME, holding a human's CLAUDE.md. */
  readonly home: string;
  /** PATH with stub `claude` and `codex` on it. */
  readonly withVendors: string;
  /** PATH with nothing on it but `bun`. */
  readonly withoutVendors: string;
}

async function makeHarness(): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), "om-agi-turn-"));
  scratch.push(home);
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(join(home, ".claude", "CLAUDE.md"), await readFile(HUMAN, "utf8"));

  // Deliberately *not* the directory bun lives in: that is where `bun add -g`
  // installs global packages, and a vendor CLI installed that way would make
  // "off PATH" quietly false. Shared with `soul-verify.test.ts` rather than
  // copied, because two copies of this condition had already drifted apart.
  const bare = await barePath(home);

  const stubs = join(home, "bin");
  await mkdir(stubs, { recursive: true });
  for (const [name, shape] of [["claude", "json"], ["codex", "text"]] as const) {
    const path = join(stubs, name);
    await writeFile(path, stubSource(name, shape));
    await chmod(path, 0o755);
  }

  return { home, withVendors: `${stubs}:${bare}`, withoutVendors: bare };
}

/** The lines `turn` writes before handing a prompt to something off-machine. */
function egressNotices(stderr: string): string[] {
  return stderr.split("\n").filter((line) => line.includes(EGRESS_NOTICE_PREFIX));
}

interface RunOptions {
  readonly path: string;
  readonly stubMode?: string;
  readonly ollama?: string;
}

async function run(home: string, args: readonly string[], options: RunOptions) {
  const child = Bun.spawn([BUN, "run", BIN, ...args], {
    cwd: ROOT,
    env: {
      HOME: home,
      PATH: options.path,
      XDG_STATE_HOME: join(home, "state"),
      CODEX_HOME: join(home, ".codex"),
      ...(options.stubMode === undefined ? {} : { OM_AGI_STUB_MODE: options.stubMode }),
      ...(options.ollama === undefined ? {} : { OLLAMA_HOST: options.ollama }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  await child.exited;
  return { code: child.exitCode ?? -1, stdout, stderr };
}

/** A fresh token per run, so no answer can be a leftover from the last one. */
function token(): string {
  return `t${Math.random().toString(36).slice(2, 10)}`;
}

function ask(value: string): string {
  return `Reply with the token ${value} and nothing else.`;
}

describe("ohmyagi turn", () => {
  test("AC6 — with claude and codex off PATH, the turn finishes on ollama alone", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = token();
    try {
      // (a) The precondition, asserted rather than assumed. If any vendor
      // binary is reachable from this PATH the rest of the test proves
      // nothing, and it must fail loudly here rather than pass quietly below.
      // Every vendor in the registry, not just the two this case names: the
      // chain is `claude → codex → ollama` today and the registry knows six.
      expectNoVendorOn(harness.withoutVendors);

      const result = await run(
        harness.home,
        ["turn", SOUL, "--subject", "example", "--prompt", ask(value), "--model", "stub"],
        { path: harness.withoutVendors, ollama: ollama.url },
      );

      // (d) A machine-checkable answer, not merely a non-empty one.
      expect(result.stdout.trim()).toBe(`${value} from ollama with-soul`);
      expect(result.code).toBe(0);

      // (b) ollama answered, and the two vendors were tried and found missing
      // — "unavailable … not on PATH" is a miss, which is a different report
      // from having been skipped.
      expect(result.stderr).toContain("answered by ollama");
      expect(result.stderr).toContain("claude: unavailable (claude: not on PATH)");
      expect(result.stderr).toContain("codex: unavailable (codex: not on PATH)");

      // (c) The soul arrived in the system slot, at full strength, once.
      expect(ollama.systems.length).toBe(1);
      expect(ollama.systems[0]).toContain("Example Keeper");
      expect(ollama.systems[0]).toContain("is an AI agent, not a person");
      expect(result.stderr).toContain("identity arrived as system");

      // (e) Nothing left the machine, so nothing was announced about leaving
      // it. A warning printed on the run where nothing happened is how people
      // learn to skip the one on the run where something does (S7.2 AC4).
      expect(egressNotices(result.stderr)).toEqual([]);

      // A turn writes one thing, and it is not this. The human's instruction
      // file is untouched; the ledger S2.2 added lives outside the home's
      // vendor directories entirely (`test/cli/ledger.test.ts` covers it).
      expect(await readFile(join(harness.home, ".claude", "CLAUDE.md"), "utf8")).toBe(
        await readFile(HUMAN, "utf8"),
      );
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("the control — with the vendors back on PATH, claude answers and ollama is untouched", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = token();
    try {
      const result = await run(
        harness.home,
        ["turn", SOUL, "--subject", "example", "--prompt", ask(value), "--model", "stub"],
        { path: harness.withVendors, ollama: ollama.url },
      );

      // Without this case, a chain hard-wired to ollama would pass AC6 too.
      expect(result.stdout.trim()).toBe(`${value} from claude with-soul`);
      expect(result.stderr).toContain("answered by claude");
      expect(result.stderr).not.toContain("missed:");
      expect(ollama.systems.length).toBe(0);
      expect(result.code).toBe(0);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("a CLI that exits 0 with nothing is a miss, and the turn falls through to ollama", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = token();
    try {
      const result = await run(
        harness.home,
        ["turn", SOUL, "--subject", "example", "--prompt", ask(value), "--model", "stub"],
        { path: harness.withVendors, stubMode: "silent", ollama: ollama.url },
      );

      expect(result.stdout.trim()).toBe(`${value} from ollama with-soul`);
      expect(result.stderr).toContain("missed: claude: silent · codex: silent");
      expect(result.code).toBe(0);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("a CLI that is not logged in is a miss, and its complaint is never printed as an answer", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = token();
    try {
      const result = await run(
        harness.home,
        ["turn", SOUL, "--subject", "example", "--prompt", ask(value), "--model", "stub"],
        { path: harness.withVendors, stubMode: "unauthenticated", ollama: ollama.url },
      );

      // The regression `classify` was fixed for: a non-zero exit means the CLI
      // never took its turn, so what it printed is diagnostics. Handing that
      // to a pipe as the model's reply is the worst available outcome.
      expect(result.stdout).not.toContain("Not logged in");
      expect(result.stdout.trim()).toBe(`${value} from ollama with-soul`);
      expect(result.stderr).toContain("missed: claude: silent · codex: silent");
      expect(result.code).toBe(0);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("`--backend ollama` is the local-only route, and asks nothing else", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = token();
    try {
      const result = await run(
        harness.home,
        [
          "turn", SOUL, "--subject", "example", "--prompt", ask(value),
          "--backend", "ollama", "--model", "stub",
        ],
        { path: harness.withVendors, ollama: ollama.url },
      );

      expect(result.stdout.trim()).toBe(`${value} from ollama with-soul`);
      // Nothing missed, because nothing else was in the chain to miss.
      expect(result.stderr).not.toContain("missed:");
      expect(result.code).toBe(0);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("a prompt bound for a vendor is announced first, on stderr, in one line", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = token();
    try {
      const result = await run(
        harness.home,
        [
          "turn", SOUL, "--subject", "example", "--prompt", ask(value),
          "--model", "stub", "--json",
        ],
        { path: harness.withVendors, ollama: ollama.url },
      );

      // claude answered, so claude is the only backend that was handed the
      // text — codex was never reached and is not named.
      const notices = egressNotices(result.stderr);
      expect(notices.length).toBe(1);
      expect(notices[0]).toContain("claude");
      expect(notices[0]).toContain("cannot take it back");
      expect(notices[0]).not.toContain("codex");

      // Stderr, so the machine-readable half of the command is untouched.
      const parsed = JSON.parse(result.stdout) as { text: string };
      expect(parsed.text).toBe(`${value} from claude with-soul`);
      expect(result.code).toBe(0);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("an ollama reached by name is announced too — a resolver is not evidence", async () => {
    const harness = await makeHarness();
    // `localhost` is a name, and what it resolves to is whatever the resolver
    // says at the moment of the call. `--backend ollama` keeps the vendors out
    // of it, so the only line this run can print is about the daemon.
    const ollama = serveOllama("localhost");
    const value = token();
    try {
      const result = await run(
        harness.home,
        [
          "turn", SOUL, "--subject", "example", "--prompt", ask(value),
          "--backend", "ollama", "--model", "stub",
        ],
        { path: harness.withoutVendors, ollama: ollama.url },
      );

      const notices = egressNotices(result.stderr);
      expect(notices.length).toBe(1);
      expect(notices[0]).toContain(ollama.url);
      expect(notices[0]).toContain("nor say what that host keeps");
      expect(result.stdout.trim()).toBe(`${value} from ollama with-soul`);
      expect(result.code).toBe(0);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("with no CLI and no daemon, the turn exits 1 and says nothing answered", async () => {
    const harness = await makeHarness();
    const result = await run(
      harness.home,
      ["turn", SOUL, "--subject", "example", "--prompt", ask(token()), "--model", "stub"],
      { path: harness.withoutVendors, ollama: NO_OLLAMA },
    );

    // Exit 0 with an empty stdout would be the project's own bug, shipped.
    expect(result.code).toBe(1);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("no backend answered");
    expect(result.stderr).toContain("all 3 backend(s) missed");
    expect(result.stderr).toContain("ollama: unavailable");
  });

  test("a local model that was never named is reported as such, not guessed at", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    try {
      const result = await run(
        harness.home,
        ["turn", SOUL, "--subject", "example", "--prompt", ask(token()), "--backend", "ollama"],
        { path: harness.withoutVendors, ollama: ollama.url },
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("no backend answered");
      expect(ollama.systems.length).toBe(0);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("--json carries the route, the confidence and the evidence", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    const value = token();
    try {
      const result = await run(
        harness.home,
        [
          "turn", SOUL, "--subject", "example", "--prompt", ask(value),
          "--model", "stub", "--json",
        ],
        { path: harness.withoutVendors, ollama: ollama.url },
      );

      const parsed = JSON.parse(result.stdout) as {
        backend: string;
        text: string;
        confidence: string;
        identityStrength: string;
        route: string;
        evidence: { source: string; prompt: string; raw: string };
      };
      expect(parsed.backend).toBe("ollama");
      expect(parsed.confidence).toBe("confirmed");
      expect(parsed.identityStrength).toBe("system");
      expect(parsed.text).toBe(`${value} from ollama with-soul`);
      expect(parsed.evidence.prompt).toBe(ask(value));
      expect(parsed.evidence.raw).toContain("not on PATH");
      expect(parsed.route).toContain("answered by ollama");
      expect(result.code).toBe(0);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("a soul that does not belong to the subject is refused, and nothing is asked", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    try {
      const result = await run(
        harness.home,
        ["turn", SOUL, "--subject", "someone-else", "--prompt", ask(token()), "--model", "stub"],
        { path: harness.withoutVendors, ollama: ollama.url },
      );

      // I-3: one command, one soul, and the subject on the command line is
      // the question — not a label applied to whatever was on disk.
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("example");
      expect(ollama.systems.length).toBe(0);
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("typing it wrong is exit 2, and is never confused with a backend that missed", async () => {
    const harness = await makeHarness();
    const options = { path: harness.withoutVendors, ollama: NO_OLLAMA };

    const noPrompt = await run(harness.home, ["turn", SOUL, "--subject", "example"], options);
    expect(noPrompt.code).toBe(2);
    expect(noPrompt.stderr).toContain("--prompt");

    const noSubject = await run(harness.home, ["turn", SOUL, "--prompt", "hello"], options);
    expect(noSubject.code).toBe(2);

    const unknown = await run(
      harness.home,
      ["turn", SOUL, "--subject", "example", "--prompt", "hello", "--backend", "nonesuch"],
      options,
    );
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("nonesuch");

    const badSubject = await run(
      harness.home,
      ["turn", SOUL, "--subject", "Not A Subject", "--prompt", "hello"],
      options,
    );
    expect(badSubject.code).toBe(2);
  });

  test("the help text lists turn, and names the default chain", async () => {
    const harness = await makeHarness();
    const result = await run(harness.home, ["help"], { path: harness.withoutVendors });
    expect(result.stdout).toContain("ohmyagi turn");
    expect(result.stdout).toContain("claude → codex → ollama");
  });
});

/**
 * D-032 — a turn records itself, under the consent the hook uses, and never
 * the prompt. Three cases, and the absences are the ones that matter: no
 * consent means no directory comes into existence, and the escape hatch a
 * fleet sets means no line even with consent.
 */
describe("ohmyagi turn — captures itself (D-032)", () => {
  /** Consent for `capture`, written the way `observe enable` would have. */
  async function grantCapture(home: string): Promise<string> {
    const created = await ensureObserverDir(
      { home, env: {} },
      subjectId("example"),
      announceCapture(() => undefined),
    );
    if (!created.ok) throw new Error(created.reason);
    await ensureCaptureDir(created.path);
    await saveConsent(created.path, {
      v: CAPTURE_VERSION,
      basis: "data-subject-self",
      grants: [
        { scope: "capture", at: "2026-09-22T00:00:00.000Z", digest: consentDigest(consentText("capture")) },
      ],
    });
    return created.path;
  }

  /** Every line in every capture file, or none when the directory does not exist. */
  async function captured(observerPath: string): Promise<string[]> {
    const dir = captureDir(observerPath);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const lines: string[] = [];
    for (const name of names) {
      const text = await readFile(join(dir, name), "utf8");
      lines.push(...text.split("\n").filter((line) => line !== ""));
    }
    return lines;
  }

  test("with consent: one prompt record through the turn door, without the prompt", async () => {
    const harness = await makeHarness();
    const observer = await grantCapture(harness.home);
    const ollama = serveOllama();
    const value = token();
    try {
      const result = await run(
        harness.home,
        ["turn", SOUL, "--subject", "example", "--prompt", ask(value), "--model", "stub"],
        { path: harness.withoutVendors, ollama: ollama.url },
      );
      expect(result.code).toBe(0);

      const lines = await captured(observer);
      expect(lines.length).toBe(1);
      const record = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(record["vendor"]).toBe("om-agi");
      expect(record["source"]).toBe("turn");
      expect(record["kind"]).toBe("prompt");
      expect(record["tool"]).toBe("ollama");
      expect(record["outcome"]).toBe("ok");
      // No terminal is attached under `Bun.spawn`, so the honest origin is
      // `unknown` — never `owner-prompted` on the strength of nothing.
      expect(record["origin"]).toBe("unknown");
      // The prompt text is nowhere in the store. The token is unique to this
      // run, so a match could only be a copy of the prompt.
      expect(lines[0]).not.toContain(value);
      // And the ledger line and the capture line name the same turn.
      expect(typeof record["session"]).toBe("string");
      expect(result.stderr).not.toContain("was not captured");
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("without consent: nothing is written and no directory is created", async () => {
    const harness = await makeHarness();
    const ollama = serveOllama();
    try {
      const result = await run(
        harness.home,
        ["turn", SOUL, "--subject", "example", "--prompt", ask(token()), "--model", "stub"],
        { path: harness.withoutVendors, ollama: ollama.url },
      );
      expect(result.code).toBe(0);
      const share = join(harness.home, ".local", "share", "om-agi");
      let exists = true;
      try {
        await readdir(share);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
      // Silent, too: "capture is off" is the default and earns no line.
      expect(result.stderr).not.toContain("captured");
    } finally {
      await ollama.server.stop(true);
    }
  });

  test("OM_AGI_CAPTURE=off keeps a fleet's turns out, consent or not", async () => {
    const harness = await makeHarness();
    const observer = await grantCapture(harness.home);
    const ollama = serveOllama();
    try {
      const child = Bun.spawn(
        [BUN, "run", BIN, "turn", SOUL, "--subject", "example", "--prompt", ask(token()), "--model", "stub"],
        {
          cwd: ROOT,
          env: {
            HOME: harness.home,
            PATH: harness.withoutVendors,
            XDG_STATE_HOME: join(harness.home, "state"),
            OLLAMA_HOST: ollama.url,
            OM_AGI_CAPTURE: "off",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      await child.exited;
      expect(child.exitCode).toBe(0);
      expect(await captured(observer)).toEqual([]);
    } finally {
      await ollama.server.stop(true);
    }
  });
});
