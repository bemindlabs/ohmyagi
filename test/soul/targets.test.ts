/**
 * Where an identity would land, resolved against a home that is not real.
 *
 * Every test here injects `home`, `env`, `cwd` and `which`. That is the whole
 * reason those are parameters: the default resolution points at the operator's
 * live instruction files, and a test that used it would be a test that plans
 * a write into a file being read by the session running it.
 *
 * The case worth naming is `PATH` being empty. I-1 says the local path must
 * keep working when the commercial CLIs are gone, so "no vendor CLI installed"
 * has to be an ordinary outcome that still leaves `ollama` a first-class
 * target — not an error, and not an empty list.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { expandPath, isProjectScopedOnly, vendor } from "../../src/exec/registry.ts";
import { isKnownBackend, resolveTargets, type FileTarget } from "../../src/soul/targets.ts";

const HOME = "/nowhere/home";

function context(options: { readonly env?: Record<string, string>; readonly installed?: readonly string[] } = {}) {
  const installed = new Set(options.installed ?? ["claude", "codex"]);
  return {
    home: HOME,
    cwd: "/nowhere/project",
    env: options.env ?? {},
    which: (binary: string) => Promise.resolve(installed.has(binary)),
  };
}

function fileTargets(targets: readonly { kind: string }[]): readonly FileTarget[] {
  return targets.filter((t): t is FileTarget => t.kind === "file");
}

describe("expandPath", () => {
  test("resolves ~ against the home it is given, not the real one", () => {
    expect(expandPath("~/.claude/CLAUDE.md", { home: HOME })).toBe(join(HOME, ".claude/CLAUDE.md"));
    expect(expandPath("~", { home: HOME })).toBe(HOME);
  });

  test("resolves ./ against the cwd it is given", () => {
    expect(expandPath("./AGENTS.md", { cwd: "/nowhere/project" })).toBe("/nowhere/project/AGENTS.md");
  });

  test("leaves an absolute path alone", () => {
    expect(expandPath("/etc/example.md", { home: HOME })).toBe("/etc/example.md");
  });

  test("honours ${VAR:-default}, which is how CODEX_HOME moves the file", () => {
    const spec = vendor("codex").identity.instructionFiles[0]!;
    expect(spec).toContain("CODEX_HOME");

    expect(expandPath(spec, { home: HOME, env: {} })).toBe(join(HOME, ".codex/AGENTS.md"));
    expect(expandPath(spec, { home: HOME, env: { CODEX_HOME: "/opt/codex" } })).toBe("/opt/codex/AGENTS.md");
    // An empty variable means unset, the way a shell would read it.
    expect(expandPath(spec, { home: HOME, env: { CODEX_HOME: "" } })).toBe(join(HOME, ".codex/AGENTS.md"));
  });

  test("a vendor whose file lives under an env var is not 'per project only'", () => {
    expect(isProjectScopedOnly(vendor("codex"))).toBe(false);
    expect(isProjectScopedOnly(vendor("copilot"))).toBe(true);
  });
});

describe("resolveTargets", () => {
  test("names a file for each vendor and a field for ollama", async () => {
    const targets = await resolveTargets(["claude", "codex", "ollama"], context());
    expect(targets.map((t) => t.backend)).toEqual(["claude", "codex", "ollama"]);

    const [claude, codex] = fileTargets(targets);
    expect(claude!.path).toBe(join(HOME, ".claude/CLAUDE.md"));
    expect(codex!.path).toBe(join(HOME, ".codex/AGENTS.md"));

    const ollama = targets.find((t) => t.backend === "ollama")!;
    expect(ollama.kind).toBe("system-field");
    // The local backend has the *stronger* channel, which is worth stating.
    expect(ollama.strength).toBe("system");
  });

  test("reports a vendor that is not installed as unreachable, not as an error", async () => {
    const targets = await resolveTargets(["claude", "codex", "ollama"], context({ installed: [] }));
    expect(targets.length).toBe(3);
    for (const target of fileTargets(targets)) expect(target.reachable).toBe(false);
    expect(targets.find((t) => t.backend === "ollama")).toBeDefined();
  });

  test("CODEX_HOME moves the codex target", async () => {
    const targets = await resolveTargets(["codex"], context({ env: { CODEX_HOME: "/opt/codex" } }));
    expect(fileTargets(targets)[0]!.path).toBe("/opt/codex/AGENTS.md");
  });

  test("two vendors reading one file give one target that names both", async () => {
    const targets = await resolveTargets(["claude", "grok"], context({ installed: ["claude", "grok"] }));
    expect(targets.length).toBe(1);
    const [only] = fileTargets(targets);
    expect(only!.backend).toBe("claude");
    expect(only!.alsoReadBy).toContain("grok");
  });

  test("a single vendor still reports who else reads its file", async () => {
    const targets = await resolveTargets(["claude"], context());
    expect(fileTargets(targets)[0]!.alsoReadBy).toContain("grok");
  });
});

describe("isKnownBackend", () => {
  test("accepts every vendor and the local backend, and nothing else", () => {
    expect(isKnownBackend("claude")).toBe(true);
    expect(isKnownBackend("codex")).toBe(true);
    expect(isKnownBackend("ollama")).toBe(true);
    expect(isKnownBackend("nonesuch")).toBe(false);
  });
});
