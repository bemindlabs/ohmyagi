/**
 * "Which identity is on?" — and the four ways that answer goes wrong.
 *
 * The verdict is derived from the markers on disk and from nothing else, which
 * is what these tests are really about. Each case writes bytes into a temporary
 * file and asks what om-agi reads back, so a change to the marker format, to
 * the hash check, or to how a half-finished switch is classified shows up here
 * rather than in a report somebody trusted.
 *
 * The one that matters most is `mixed`. A's block in one file and B's in
 * another is the shape I-3 fails in, and reporting it as "wearing A" — because
 * A's file was read first — would be a confident answer about a machine that is
 * in neither state.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../../src/soul/block.ts";
import type { FieldTarget, FileTarget } from "../../src/soul/targets.ts";
import {
  formatWorn,
  residue,
  wearsOnly,
  WORN_LIMITS,
  wornReport,
} from "../../src/soul/worn.ts";
import { subjectId } from "../../src/types.ts";

const ALPHA = subjectId("alpha-keeper");
const BETA = subjectId("beta-keeper");

const scratch: string[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function sandbox(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "om-agi-worn-"));
  scratch.push(dir);
  return dir;
}

/** A file target for `path`, with the registry fields a report does not read. */
function fileTarget(backend: string, path: string): FileTarget {
  return {
    kind: "file",
    backend,
    display: backend,
    path,
    declaredAs: "~/fixture",
    strength: "user",
    alsoReadBy: [],
    alsoReads: [],
    reachable: true,
  };
}

const FIELD: FieldTarget = {
  kind: "system-field",
  backend: "ollama",
  display: "Ollama",
  strength: "system",
};

/** A file holding one well-formed block for `subject`, as `splice` would write it. */
async function withBlock(dir: string, name: string, subject: string, body: string): Promise<string> {
  const path = join(dir, name);
  const marker = `<!-- om-agi:soul:begin subject=${subject} sha256=${sha256(body)} lead=0 tail=1 -->`;
  await writeFile(path, `human text\n\n${marker}\n${body}\n<!-- om-agi:soul:end -->\n`);
  return path;
}

describe("what is worn", () => {
  test("nothing, when no file holds a block", async () => {
    const dir = await sandbox();
    const plain = join(dir, "CLAUDE.md");
    await writeFile(plain, "a file somebody else wrote\n");

    const report = await wornReport([
      fileTarget("claude", plain),
      fileTarget("codex", join(dir, "never-written.md")),
    ]);

    expect(report.verdict).toBe("none");
    expect(report.subject).toBeUndefined();
    expect(report.subjects).toEqual([]);
    expect(report.places.map((p) => p.state)).toEqual(["absent", "missing"]);
    expect(wearsOnly(report, ALPHA)).toBe(false);
  });

  test("one identity, when every block names the same subject", async () => {
    const dir = await sandbox();
    const first = await withBlock(dir, "CLAUDE.md", ALPHA, "# Alpha Keeper\n");
    const second = await withBlock(dir, "AGENTS.md", ALPHA, "# Alpha Keeper\n");

    const report = await wornReport([fileTarget("claude", first), fileTarget("codex", second)]);

    expect(report.verdict).toBe("one");
    expect(report.subject).toBe(ALPHA);
    expect(report.places.every((p) => p.state === "worn")).toBe(true);
    expect(wearsOnly(report, ALPHA)).toBe(true);
    expect(wearsOnly(report, BETA)).toBe(false);
    expect(residue(report, BETA)).toEqual([]);
    expect(residue(report, ALPHA)).toHaveLength(2);
  });

  test("mixed, when a switch only reached one of the files (AC3)", async () => {
    const dir = await sandbox();
    const switched = await withBlock(dir, "CLAUDE.md", BETA, "# Beta Keeper\n");
    const stale = await withBlock(dir, "AGENTS.md", ALPHA, "# Alpha Keeper\n");

    const report = await wornReport([fileTarget("claude", switched), fileTarget("codex", stale)]);

    expect(report.verdict).toBe("mixed");
    expect(report.subject).toBeUndefined();
    expect(report.subjects).toEqual([ALPHA, BETA]);
    // Neither one is "what this machine is wearing", and both are refused.
    expect(wearsOnly(report, ALPHA)).toBe(false);
    expect(wearsOnly(report, BETA)).toBe(false);

    // The point of `residue`: which file still has the old identity in it.
    expect(residue(report, ALPHA).map((p) => p.path)).toEqual([stale]);
    expect(report.caveats[0]).toContain("switch that did not finish");
  });

  test("a hand-edited block still names its subject, and is not called worn", async () => {
    const dir = await sandbox();
    const path = join(dir, "CLAUDE.md");
    const marker = `<!-- om-agi:soul:begin subject=${ALPHA} sha256=${sha256("# Alpha Keeper\n")} lead=0 tail=1 -->`;
    // The body no longer hashes to what the marker claims: a human wrote here.
    await writeFile(path, `${marker}\n# Alpha Keeper, and a line somebody added\n<!-- om-agi:soul:end -->\n`);

    const report = await wornReport([fileTarget("claude", path)]);

    expect(report.places[0]!.state).toBe("edited");
    expect(report.places[0]!.subject).toBe(ALPHA);
    // Still counted, because the file still has this identity's name in it —
    // and still not `wearsOnly`, because what the model reads is unknown.
    expect(report.verdict).toBe("one");
    expect(wearsOnly(report, ALPHA)).toBe(false);
    expect(residue(report, ALPHA)).toHaveLength(1);
    expect(report.caveats.join(" ")).toContain("edited by hand");
  });

  test("a marker om-agi cannot read is unreadable, not empty", async () => {
    const dir = await sandbox();
    const path = join(dir, "CLAUDE.md");
    await writeFile(path, "<!-- om-agi:soul:begin something-else -->\nbody\n");

    const report = await wornReport([fileTarget("claude", path)]);

    expect(report.places[0]!.state).toBe("unreadable");
    expect(report.verdict).toBe("none");
    // "om-agi found no identity here" and "om-agi could not look" are different
    // facts, and only the second one needs a human.
    expect(report.caveats.join(" ")).toContain("cannot read this file");
    expect(wearsOnly(report, ALPHA)).toBe(false);
  });

  test("a backend with no file at all is reported as such, never as bare", async () => {
    const dir = await sandbox();
    const path = await withBlock(dir, "CLAUDE.md", ALPHA, "# Alpha Keeper\n");

    const report = await wornReport([fileTarget("claude", path), FIELD]);

    expect(report.places[1]!.state).toBe("system-field");
    expect(report.places[1]!.subject).toBeUndefined();
    expect(report.places[1]!.detail).toContain("system field");
    // It does not drag the verdict down: there is no block to be missing.
    expect(report.verdict).toBe("one");
    expect(wearsOnly(report, ALPHA)).toBe(true);
  });
});

describe("what the answer does not cover", () => {
  test("the limits travel with every report, in every verdict", async () => {
    const dir = await sandbox();
    const report = await wornReport([fileTarget("claude", join(dir, "nothing.md"))]);

    for (const limit of WORN_LIMITS) expect(report.caveats).toContain(limit);
    expect(WORN_LIMITS.join(" ")).toContain("I-4");
  });

  test("reading what is worn creates nothing", async () => {
    const dir = await sandbox();
    const path = join(dir, "CLAUDE.md");

    await wornReport([fileTarget("claude", path), FIELD]);

    expect(await Bun.file(path).exists()).toBe(false);
  });
});

describe("how it prints", () => {
  test("the headline names the verdict, and every place gets a line", async () => {
    const dir = await sandbox();
    const path = await withBlock(dir, "CLAUDE.md", BETA, "# Beta Keeper\n");

    const lines = formatWorn(await wornReport([fileTarget("claude", path), FIELD]));

    expect(lines[0]).toBe(`wearing ${BETA}`);
    expect(lines.join("\n")).toContain(path);
    expect(lines.join("\n")).toContain("system-field");
  });

  test("mixed prints both names rather than picking one", async () => {
    const dir = await sandbox();
    const first = await withBlock(dir, "CLAUDE.md", ALPHA, "# Alpha Keeper\n");
    const second = await withBlock(dir, "AGENTS.md", BETA, "# Beta Keeper\n");

    const lines = formatWorn(await wornReport([fileTarget("claude", first), fileTarget("codex", second)]));

    expect(lines[0]).toContain("2 identities at once");
    expect(lines[0]).toContain(ALPHA);
    expect(lines[0]).toContain(BETA);
  });

  test("nothing worn says so, rather than printing an empty name", async () => {
    const dir = await sandbox();
    const lines = formatWorn(await wornReport([fileTarget("claude", join(dir, "absent.md"))]));
    expect(lines[0]).toBe("wearing nothing — no om-agi block in any file that was read");
  });
});
