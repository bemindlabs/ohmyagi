/**
 * `ohmyagi autonomy` — S5.1's four acceptance criteria, and the three things the
 * owner asked to be said **at the moment of setting** rather than later.
 *
 * Two halves, deliberately. `bin/dial.ts` is called in-process, because reading,
 * deciding and writing the dial can all be done against a temporary directory
 * and a helper that can only be tested through a subprocess is a helper nobody
 * checks. The command itself is spawned, because it reads `homedir()` and
 * `process.env` on its way and prints to two streams.
 *
 * Nothing here touches the real home: `HOME` and `XDG_STATE_HOME` are temporary
 * directories in every spawned case.
 */

import { subjectId } from "../../src/types.ts";
import { confirmationsPath, readConfirmations, setConfirmation } from "../../src/decide/confirm.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTONOMY_FILE,
  AUTONOMY_MAX_ENV,
  DEFAULT_DIAL,
  serializeDial,
  type Dial,
} from "../../src/decide/index.ts";
import {
  DIAL_REFUSED,
  decideDial,
  dialBody,
  dialEnv,
  dialLine,
  dialPath,
  heldNote,
  readDial,
  vendorsWithNoMechanism,
  whoIsSetting,
  writeDial,
} from "../../bin/dial.ts";
import { defaultEffective } from "../../src/decide/effective.ts";
import { VENDORS, vendor, type VendorSpec } from "../../src/exec/registry.ts";
import { sayDial } from "../../bin/commands/autonomy.ts";
import { BUN } from "../support/bare-path.ts";

/**
 * A vendor with nothing to pass. None is left in the real registry since S12.6
 * (D-120), so the refusal is exercised on a synthetic one — the sentence has to
 * keep working for the next vendor that declares `none`.
 */
const HOLE: VendorSpec = {
  ...vendor("kimi"),
  id: "example",
  readOnly: {
    kind: "none",
    why: "a synthetic vendor with no tool filter and no sandbox, used to keep the refusal honest",
    evidence: "writes",
  },
};

/** What `sayDial` prints, as one string. */
function said(verdict: Parameters<typeof sayDial>[1], vendors: readonly VendorSpec[]): string {
  const lines: string[] = [];
  sayDial({ line: (text = "") => lines.push(text), dim: (s) => s, bold: (s) => s }, verdict, vendors);
  return lines.join("\n");
}

const ROOT = join(import.meta.dir, "..", "..");
const BIN = join(ROOT, "bin", "om-agi.ts");

const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function sandbox(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "om-agi-autonomy-"));
  scratch.push(home);
  return home;
}

async function runCli(home: string, args: readonly string[], extra: Record<string, string> = {}) {
  const child = Bun.spawn([BUN, "run", BIN, ...args], {
    cwd: ROOT,
    env: {
      HOME: home,
      PATH: process.env["PATH"] ?? "",
      XDG_STATE_HOME: join(home, "state"),
      XDG_DATA_HOME: join(home, "data"),
      ...extra,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  await child.exited;
  return { code: child.exitCode ?? -1, stdout, stderr, all: `${stdout}\n${stderr}` };
}

// ---------------------------------------------------------------------------
// bin/dial.ts, in process
// ---------------------------------------------------------------------------

describe("reading the dial off disk", () => {
  test("no directory at all is the default, and says so", async () => {
    const read = await readDial(null);
    expect(read.source).toBe("default");
    expect(read.stored).toEqual(DEFAULT_DIAL);
    expect(read.path).toBeNull();
    expect(read.issues).toEqual([]);
  });

  test("a directory with no autonomy.md is the default (AC3)", async () => {
    const home = await sandbox();
    const read = await readDial(home);
    expect(read.source).toBe("default");
    expect(read.stored).toEqual(DEFAULT_DIAL);
    expect(read.path).toBe(dialPath(home));
  });

  test("a file that parses is what it says", async () => {
    const home = await sandbox();
    const dial: Dial = { read: 2, write: 2, run: 1, reach: 1, setBy: "a test", setAt: "2026-09-22T00:00:00.000Z" };
    await writeFile(dialPath(home), serializeDial(dial, dialBody()));
    const read = await readDial(home);
    expect(read.source).toBe("file");
    expect(read.stored).toEqual(dial);
  });

  test("a file that does not parse is `file-unreadable`, never the default", async () => {
    const home = await sandbox();
    await writeFile(dialPath(home), "+++\nthis is not toml = = =\n+++\n");
    const read = await readDial(home);
    expect(read.source).toBe("file-unreadable");
    expect(read.issues.length).toBeGreaterThan(0);
    // The stored value is not read back from a broken file — `effectiveDial`
    // turns this source into silence, and the test for that is in
    // `test/decide/effective.test.ts`.
    expect(read.source).not.toBe("default");
  });
});

describe("writing it back", () => {
  test("what is written reads back as what was asked for", async () => {
    const home = await sandbox();
    const dial: Dial = { read: 3, write: 2, run: 2, reach: 2, setBy: "a test", setAt: "2026-09-22T00:00:00.000Z" };
    const path = await writeDial(home, dial);
    expect(path).toBe(dialPath(home));
    expect((await readDial(home)).stored).toEqual(dial);
  });

  test("the body explains the direction, in the file somebody will open", async () => {
    // A reader who meets a file called `autonomy.md` will assume it adds
    // restraint. The body is where that gets corrected for the person who
    // opened the file rather than the command.
    const body = dialBody();
    expect(body).toContain("min(write, run, reach)");
    expect(body).toContain("what om-agi has always done");
    expect(body).toContain("**not sent**");
    expect(await Bun.file(await writeDial(await sandbox(), DEFAULT_DIAL)).text()).toContain(body);
  });
});

describe("deciding: the file, the ceiling and the brake together", () => {
  test("no file, no ceiling and no brake is the default", async () => {
    const home = await sandbox();
    const verdict = await decideDial(home, { home, env: { XDG_STATE_HOME: join(home, "state") } });
    expect(verdict.source).toBe("default");
    expect(verdict.effective.act).toBe(1);
    expect(verdict.effective.stopped).toBe(false);
    expect(verdict.stopPath).toContain("STOP");
  });

  test("the brake outranks a file that says 2", async () => {
    const home = await sandbox();
    const env = { home, env: { XDG_STATE_HOME: join(home, "state") } };
    await writeDial(home, { read: 2, write: 2, run: 2, reach: 2, setBy: null, setAt: null });
    expect((await decideDial(home, env)).effective.act).toBe(2);

    await mkdir(join(home, "state", "om-agi"), { recursive: true });
    await writeFile(join(home, "state", "om-agi", "STOP"), "");
    const stopped = await decideDial(home, env);
    expect(stopped.effective.stopped).toBe(true);
    expect(stopped.effective.act).toBe(0);
    // The file still says 2 — it is the *effective* dial that is 0, and both
    // numbers are kept so the report can print them side by side.
    expect(stopped.stored.write).toBe(2);
  });

  test("the ceiling comes from the environment it is handed, not from this process", async () => {
    // Injected rather than read, for the reason `src/state.ts` gives: a test
    // that had to reach the operator's real environment would be testing their
    // machine.
    const home = await sandbox();
    await writeDial(home, { read: 3, write: 2, run: 2, reach: 2, setBy: null, setAt: null });
    const verdict = await decideDial(home, {
      home,
      env: { XDG_STATE_HOME: join(home, "state"), [AUTONOMY_MAX_ENV]: "1" },
    });
    expect(verdict.effective.ceiling).toBe(1);
    expect(verdict.effective.act).toBe(1);
  });

  test("the default environment is this machine, read and never written", () => {
    // `dialEnv` is the one place the real home is looked at. Asserted to be
    // exactly that and nothing more: a home and an environment, no side effect.
    const env = dialEnv();
    expect(env.home).toBe(homedir());
    expect(env.env).toBe(process.env);
  });
});

describe("who set it, for AC4", () => {
  test("a directory with no git configuration still produces a name, not a crash", async () => {
    const who = await whoIsSetting(await sandbox());
    expect(typeof who).toBe("string");
    expect(who.length).toBeGreaterThan(0);
  });
});

describe("the summary line and the vendors with no mechanism", () => {
  test("the line names every category and the level a turn acts at", () => {
    const line = dialLine(defaultEffective());
    for (const category of ["read", "write", "run", "reach"]) expect(line).toContain(category);
    expect(line).toContain("acts at 1");
    expect(line).not.toContain("held by");
  });

  test("a dial whose categories disagree names the one in force (D-052)", () => {
    const base = defaultEffective();
    const dial = { ...base.dial, write: 2 as const, run: 1 as const, reach: 2 as const };
    expect(dialLine({ ...base, dial })).toContain("acts at 1 (held by run");
    expect(heldNote(dial)).toContain("one shell does all three");
  });

  test("exactly the vendors the registry declares `none` are named", () => {
    // Derived from the registry rather than listed here: close the hole in a
    // vendor and this list shortens by itself, which is the whole design of
    // `readonlyLimits`. S12.6 closed the last one (D-120).
    expect(vendorsWithNoMechanism()).toEqual([]);
    expect(vendorsWithNoMechanism([...VENDORS, HOLE])).toEqual(["example"]);
  });
});

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

describe("ohmyagi autonomy show", () => {
  test("with no file every category is 1, and the direction is stated", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "show", home, "--subject", "example"]);

    expect(result.code).toBe(0);
    for (const category of ["read", "write", "run", "reach"]) {
      expect(result.stdout).toContain(`${category.padEnd(6)} set 1   in force 1`);
    }
    expect(result.stdout).toContain("min(write, run, reach) = 1");
    // The sentence a reader gets backwards if nobody writes it down.
    expect(result.stdout).toContain("which is what om-agi has always done");
  });

  test("`read` is shown with the admission that nothing enforces it", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "show", home, "--subject", "example"]);
    expect(result.stdout).toContain("not separable");
  });

  test("the per-backend table and its limits come from the same place `backends` uses", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "show", home, "--subject", "example"]);
    expect(result.stdout).toContain("kimi     writes? no (measured)");
    expect(result.stdout).toContain("gemini   writes? no (on trust)");
    expect(result.stdout).toContain("claude   writes? no (measured)");
    // `readonlyLimits()` — the one `ohmyagi backends` prints, not a second copy.
    expect(result.stdout).toContain("The mechanism is the vendor's, not om-agi's");
  });

  test("with no directory it shows the machine's half and says that is all it is", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "show"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("no directory given");
    expect(result.stdout).toContain("the brake:");
  });

  test("an unreadable file shows every category at 0 and exits 1", async () => {
    const home = await sandbox();
    await writeFile(dialPath(home), "+++\nthis is not toml = = =\n+++\n");
    const result = await runCli(home, ["autonomy", "show", home, "--subject", "example"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("min(write, run, reach) = 0");
    expect(result.stdout).toContain(`${AUTONOMY_FILE} could not be read`);
    expect(result.stdout).toContain("not a fall back to the default");
  });

  test("the environment ceiling is reported as a ceiling", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "show", home, "--subject", "example"], {
      [AUTONOMY_MAX_ENV]: "0",
    });
    expect(result.stdout).toContain("a ceiling, never a floor");
    expect(result.stdout).toContain("min(write, run, reach) = 0");
  });
});

describe("ohmyagi autonomy set", () => {
  test("it writes the category, records who and when, and re-reads the result", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "set", "write", "2", home, "--subject", "example"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("write is now 2");
    // AC4's provenance, in the file rather than only in the message.
    expect(result.stdout).toContain("recorded as set by");
    const written = await Bun.file(dialPath(home)).text();
    expect(written).toContain("write = 2");
    expect(written).toContain("set_by");
    expect(written).toContain("set_at");
  });

  test("a number that will not take effect is said AT THE MOMENT OF SETTING", async () => {
    // The owner's rule, and the reason it is a rule: a dial that quietly
    // divides your number by something is still a dial that lies. `write = 3`
    // with `reach = 1` does nothing, and the person setting it is told so
    // before they walk away believing otherwise.
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "set", "write", "2", home, "--subject", "example"]);

    expect(result.stdout).toContain("Numbers that do not mean what they say:");
    expect(result.stdout).toContain("You set write to 2. What is in force is 1.");
    expect(result.stdout).toContain("min(write, run, reach)");
    expect(result.stdout).toContain("I-6");
  });

  test("…and nothing is said when the number does take effect — the control", async () => {
    const home = await sandbox();
    for (const [category, level] of [["reach", "2"], ["run", "2"], ["write", "2"]] as const) {
      await runCli(home, ["autonomy", "set", category, level, home, "--subject", "example"]);
    }
    const result = await runCli(home, ["autonomy", "show", home, "--subject", "example"]);
    expect(result.stdout).not.toContain("Numbers that do not mean what they say:");
    expect(result.stdout).toContain("min(write, run, reach) = 2");
    expect(result.stdout).toContain("the vendor's read-only flag is NOT sent");
  });

  test("a refusal is said while setting, not when it is too late", async () => {
    // The other half of the owner's rule. A person who lowers the dial should
    // learn now that a backend cannot honour level 1 — not in the middle of a
    // turn that has already been dispatched to it. Exercised on a synthetic
    // vendor: the real registry has none left to refuse (D-120).
    const verdict = await decideDial(null, { home: await sandbox(), env: {} });
    const refusing = said(verdict, [...VENDORS, HOLE]);
    expect(refusing).toContain("At level 1, a turn that lands on example is REFUSED, not run hopefully.");
    expect(refusing).toContain("--backend example");
    expect(refusing).toContain(HOLE.readOnly.kind === "none" ? HOLE.readOnly.why : "unreachable");
    // And the control: with every vendor holding a mechanism, nothing is said.
    expect(said(verdict, VENDORS)).not.toContain("REFUSED");
  });

  test("setting level 1 on the real registry refuses no backend, and still names the believed one", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "set", "write", "1", home, "--subject", "example"]);
    expect(result.stdout).not.toContain("REFUSED");
    expect(result.stdout).toContain("kimi     writes? no (measured)");
    // gemini's `documented` reading, from `readonlyLimits()`.
    expect(result.stdout).toContain("Believed rather than measured: gemini");
    // kimi's profile file is named for what it is, not passed off as a sandbox.
    expect(result.stdout).toContain("is held by a profile file om-agi writes");
  });

  test("level 3 outside a terminal is refused, and says there is no --yes", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "set", "write", "3", home, "--subject", "example"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("has to be typed at a terminal");
    expect(result.stderr).toContain("no --yes");
    // Nothing was written.
    expect(await Bun.file(dialPath(home)).exists()).toBe(false);
  });

  test("reach 3 is refused outright, whatever the terminal says", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "set", "reach", "3", home, "--subject", "example"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("reach may not be 3");
    expect(result.stderr).toContain("I-6");
  });

  test("a level is compared as text, so `3abc` and ` 2` are refused", async () => {
    const home = await sandbox();
    for (const value of ["3abc", " 2", "03", "-1", "4", ""]) {
      const result = await runCli(home, ["autonomy", "set", "write", value, home, "--subject", "example"]);
      expect(result.code, JSON.stringify(value)).toBe(2);
    }
    expect(await Bun.file(dialPath(home)).exists()).toBe(false);
  });

  test("an unknown category names the four that exist", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "set", "sideways", "1", home, "--subject", "example"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("read, write, run, reach");
  });

  test("it refuses to overwrite a file it could not read", async () => {
    // Overwriting a file om-agi could not understand would throw away whatever
    // whoever wrote it meant — and an unreadable dial already holds every
    // category at 0, so nothing is lost by declining.
    const home = await sandbox();
    await writeFile(dialPath(home), "+++\nthis is not toml = = =\n+++\n");
    const result = await runCli(home, ["autonomy", "set", "write", "2", home, "--subject", "example"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("could not be read");
    expect(await Bun.file(dialPath(home)).text()).toContain("this is not toml");
  });
});

describe("ohmyagi autonomy resume", () => {
  test("with no brake on there is nothing to do, and it exits 0", async () => {
    const home = await sandbox();
    const result = await runCli(home, ["autonomy", "resume"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("the brake is not set");
  });

  test("with the brake on, outside a terminal, it refuses and names `rm`", async () => {
    const home = await sandbox();
    await mkdir(join(home, "state", "om-agi"), { recursive: true });
    await writeFile(join(home, "state", "om-agi", "STOP"), "");

    const result = await runCli(home, ["autonomy", "resume"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("has to be typed at a terminal");
    expect(result.stderr).toContain("no --yes");
    // om-agi does not pretend to own a file it cannot defend.
    expect(result.stderr).toContain("rm ");
    // …and the brake is still on.
    expect(await Bun.file(join(home, "state", "om-agi", "STOP")).exists()).toBe(true);
  });
});

describe("the exit code a loop can act on", () => {
  test("a refused turn is 4, which is not `that one failed, try again`", async () => {
    // Its own number so a script running turns in a loop can stop for a brake
    // instead of retrying against it forever.
    expect(DIAL_REFUSED).toBe(4);
    expect(DIAL_REFUSED).not.toBe(1);
    expect(DIAL_REFUSED).not.toBe(2);
  });
});

describe("D-042 — a 3 typed into the file is not a 3", () => {
  test("a hand edit to 3 is shown as set 3, in force 2, with the reason", async () => {
    const home = await sandbox();
    // Stands up a valid file the way `set` would, then edits it the way an
    // agent with write access could.
    await runCli(home, ["autonomy", "set", "write", "2", home, "--subject", "example"]);
    const path = dialPath(home);
    await Bun.write(path, (await Bun.file(path).text()).replace("write = 2", "write = 3"));

    const result = await runCli(home, ["autonomy", "show", home, "--subject", "example"]);

    expect(result.stdout).toContain(`${"write".padEnd(6)} set 3   in force`);
    expect(result.stdout).not.toContain(`${"write".padEnd(6)} set 3   in force 3`);
    expect(result.stdout).toContain("never confirmed at a terminal");
  });

  test("setting a category below 3 withdraws any confirmation it had", async () => {
    const home = await sandbox();
    const env = { home, env: { XDG_STATE_HOME: join(home, "state") } };
    const record = confirmationsPath(env, home, subjectId("example"));
    await setConfirmation(record, "write", { by: "someone", at: "2026-09-23T00:00:00Z" });
    expect(Object.keys(await readConfirmations(record))).toEqual(["write"]);

    await runCli(home, ["autonomy", "set", "write", "1", home, "--subject", "example"]);

    expect(await readConfirmations(record)).toEqual({});
  });
});

/**
 * S5.1 AC4 — the terminal path itself, driven through a real pseudo-terminal.
 *
 * `script` (util-linux) gives the command a pty whose input is what this test
 * writes, so `process.stdin.isTTY` and `isatty(1)` are both true for it. This
 * is a test of the code at the prompt, in a sandbox HOME — not a way round the
 * prompt on anybody's real dial. Skipped, and said, where `script` is missing.
 */
describe("AC4 at a real terminal", () => {
  const script = Bun.which("script");

  async function atTerminal(home: string, soul: string, typed: string) {
    const env = { HOME: home, XDG_STATE_HOME: join(home, "state"), XDG_DATA_HOME: join(home, "data") };
    const command = [BUN, "run", BIN, "autonomy", "set", "write", "3", soul, "--subject", "example"]
      .map((part) => `'${part.replace(/'/g, "'\\''")}'`)
      .join(" ");
    const child = Bun.spawn([script!, "-qec", command, "/dev/null"], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdin: new TextEncoder().encode(`${typed}\n`),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(child.stdout).text();
    await child.exited;
    return { code: child.exitCode ?? -1, out };
  }

  test.skipIf(script === null)("the exact phrase sets 3 and records the confirmation outside git", async () => {
    const home = await sandbox();
    const phrase = `let write act on its own in ${home}`;
    const result = await atTerminal(home, home, phrase);

    expect(result.out).toContain("To agree, type exactly:");
    expect(result.out).toContain("write is now 3");
    expect(await Bun.file(dialPath(home)).text()).toContain("write = 3");
    const record = confirmationsPath({ home, env: { XDG_STATE_HOME: join(home, "state") } }, home, subjectId("example"));
    expect(Object.keys(await readConfirmations(record))).toEqual(["write"]);
  }, 60_000);

  test.skipIf(script === null)("anything else writes nothing and records nothing", async () => {
    const home = await sandbox();
    const result = await atTerminal(home, home, "yes");

    expect(result.out).toContain("that was not");
    expect(result.out).toContain("nothing was written");
    expect(await Bun.file(dialPath(home)).exists()).toBe(false);
    const record = confirmationsPath({ home, env: { XDG_STATE_HOME: join(home, "state") } }, home, subjectId("example"));
    expect(await readConfirmations(record)).toEqual({});
  }, 60_000);
});
