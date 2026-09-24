/**
 * The registry — the file whose whole value is that its contents are true.
 *
 * `registry.ts` is data, and the usual answer to "how do you test data?" is
 * that you do not. That answer is wrong here for two reasons the file's own
 * header states: these values were read off each CLI's `--help` and they move
 * between vendor releases, and the failures a wrong value causes are *silent* —
 * a missing `--max-turns` makes grok answer the first sentence and exit 0, a
 * missing `--tools ""` lets a probe answer by reading a file instead of from
 * its context. Neither shows up as an error anywhere.
 *
 * So what is pinned here is not "the data is correct" — only a person with the
 * CLI installed can say that — but the invariants that hold across every
 * vendor, plus the handful of individual flags whose absence is known to cost
 * someone a debugging session. A vendor bump that drops one of them now has to
 * delete a line that says why it is there.
 *
 * `expandPath` and `isProjectScopedOnly` are already covered by
 * `test/soul/targets.test.ts` and are deliberately not repeated.
 *
 * ## The failure this file taught, which is not about this file
 *
 * An exact pin over a value that encodes a policy freezes the policy, holes
 * included. `expect(argv(vendor("kimi"))).toEqual(["-p", PROMPT,
 * "--output-format", "text"])` was here for months. It was true, it was
 * precise, it ran on every commit — and what it pinned was that kimi's turns
 * have no tool filter at all. An exact-argv assertion says *these flags and no
 * others*, so the day somebody added a limit, the suite would have gone red
 * and called the fix a regression. It looked like coverage and it was a lock
 * on a hole.
 *
 * The general form: **a test that pins a constant cannot tell "this is
 * deliberate" from "this is all we managed"**, and the second reading is
 * invisible precisely because the test is green. So where a value carries a
 * decision, pin the *declaration* of the decision and let the argv follow it —
 * here, `VendorSpec.readOnly` is the declaration, `readOnlyArgs` builds the
 * argv from it, and the assertions below check both directions against it.
 * Where an exact pin is still the right tool — claude's `--tools ""`, grok's
 * tool list — the line above it says what it would cost to change, so that
 * changing it is an argument rather than an accident.
 */

import { describe, expect, test } from "bun:test";
import {
  PHASE_A_BACKENDS,
  readonlyLimits,
  CLAUDE_GRANT,
  CODEX_GRANT,
  claudeIsolation,
  grantArgs,
  readOnlyArgs,
  readOnlySummary,
  VENDORS,
  vendor,
  type ReadOnlySpec,
  type VendorSpec,
} from "../../src/exec/registry.ts";
import type { Restraint } from "../../src/exec/restraint.ts";
import { atLevel, LOOSENED, RESTRAINED } from "../support/restraint.ts";

/** Argv for a vendor, for a prompt nothing would produce by accident. */
const PROMPT = "line one\nline two — with \"quotes\", a --flag and a 'tick'";

/**
 * @param restraint Which dial level to build the argv under. Defaults to the
 *   restrained one, because that is what every case here was written against:
 *   `readOnlyArgs` used to be spliced in unconditionally, and level 1 is the
 *   level at which it still is.
 */
function argv(spec: VendorSpec, model?: string, restraint: Restraint = RESTRAINED): string[] {
  return spec.headlessArgv(
    model === undefined ? { prompt: PROMPT, restraint } : { prompt: PROMPT, model, restraint },
  );
}

describe("vendor lookup", () => {
  test("an unknown id throws, and names what is known", async () => {
    // Throwing is right here — a typo in a backend id is a programmer error,
    // not a backend that happens to be missing — but an error that only says
    // "unknown" leaves the caller guessing at the spelling.
    expect(() => vendor("nonesuch")).toThrow('unknown vendor "nonesuch"');
    for (const spec of VENDORS) expect(() => vendor("nonesuch")).toThrow(spec.id);
    await Promise.resolve();
  });

  test("every id resolves to itself, and no id is claimed twice", () => {
    const ids = VENDORS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(vendor(id).id).toBe(id);
  });
});

describe("D-021 — the registry names nobody", () => {
  test("no binary is a path, and no instruction file is an absolute one", () => {
    for (const spec of VENDORS) {
      // A binary with a slash in it would be this machine's install, shipped
      // to everyone else's.
      expect(spec.binary).not.toContain("/");
      expect(spec.binary.length).toBeGreaterThan(0);

      for (const file of spec.identity.instructionFiles) {
        // Exactly three permitted shapes: `~/` for the home, `./` for the
        // working directory, `${VAR:-…}` for a vendor that relocates its own.
        expect(file).toMatch(/^(~\/|\.\/|\$\{[A-Z_][A-Z0-9_]*:-)/);
        expect(file).not.toStartWith("/");
      }
    }
  });

  test("nothing in the whole registry looks like somebody's home", async () => {
    // Cheaper and broader than the per-field checks above: the file itself is
    // read, so a path added in a comment or a trap is caught too.
    const source = await Bun.file(
      new URL("../../src/exec/registry.ts", import.meta.url).pathname,
    ).text();
    expect(source).not.toMatch(/\/home\/[a-z]/i);
    expect(source).not.toMatch(/\/Users\/[a-z]/i);
  });
});

describe("what every vendor's argv must do", () => {
  test("the prompt appears once, whole, as a single argument", () => {
    for (const spec of VENDORS) {
      const args = argv(spec);
      const occurrences = args.filter((arg) => arg === PROMPT);
      // Once: a prompt sent twice is a prompt a model may answer twice.
      // Whole: a prompt split across arguments is the truncation bug that
      // grok's own trap list already records, arriving by another road.
      expect(occurrences.length).toBe(1);
      expect(args.some((arg) => arg !== PROMPT && arg.includes(PROMPT.slice(0, 20)))).toBe(false);
    }
  });

  test("a model flag appears when a model is named, and never when one is not", () => {
    for (const spec of VENDORS) {
      const withModel = argv(spec, "some-model");
      const without = argv(spec);
      expect(withModel).toContain("some-model");
      expect(without).not.toContain("some-model");
      // The flag and its value, adjacent and in that order.
      const at = withModel.indexOf("some-model");
      expect(withModel[at - 1]).toMatch(/^(-m|--model)$/);
      // Naming a model adds exactly the flag and the value, nothing else.
      expect(withModel.length).toBe(without.length + 2);
    }
  });

  test("no vendor's argv carries a system prompt — that is the caller's job", () => {
    // `CliExec` appends `appendPromptFlag` itself, and only when a soul was
    // offered. A spec that baked one in would send it on every turn.
    for (const spec of VENDORS) {
      const flags = [spec.identity.appendPromptFlag, spec.identity.replacePromptFlag];
      for (const flag of flags) {
        if (flag !== undefined) expect(argv(spec, "m")).not.toContain(flag);
      }
    }
  });

  test("`replacePromptFlag` is recorded and never used", async () => {
    // Replacing a vendor's own system prompt removes its tool instructions,
    // and the result is a CLI that runs, exits 0, and quietly cannot use its
    // own tools. Recorded so nobody rediscovers it; unused so nobody ships it.
    const withReplace = VENDORS.filter((spec) => spec.identity.replacePromptFlag !== undefined);
    expect(withReplace.length).toBeGreaterThan(0);

    for (const dir of ["cli-exec.ts", "index.ts", "fallback.ts"]) {
      const source = await Bun.file(
        new URL(`../../src/exec/${dir}`, import.meta.url).pathname,
      ).text();
      expect(source).not.toContain("replacePromptFlag");
    }
  });

  test("an append flag exists exactly where the strength claims one does", () => {
    for (const spec of VENDORS) {
      if (spec.identity.appendPromptFlag !== undefined) {
        // A flag delivers a real system prompt. Claiming `user` while holding
        // one would under-report; claiming `system` without one would be the
        // dangerous direction — a soul reported as delivered at full strength
        // when it only ever reached a file.
        expect(spec.identity.strength).toBe("system");
      } else {
        expect(spec.identity.strength).toBe("user");
      }
    }
  });

  test("every spec says what it was measured against", () => {
    for (const spec of VENDORS) {
      expect(spec.measuredAgainst).toMatch(/^\d+\.\d+\.\d+$/);
      expect(spec.display.length).toBeGreaterThan(0);
    }
  });
});

describe("the individual flags that cost someone a debugging session", () => {
  test("claude asks for JSON and for no tools at all", () => {
    const args = argv(vendor("claude"));
    // `--strict-mcp-config` on every turn: no MCP server, so no way out the
    // dial does not govern (D-047). No `--setting-sources` here — this turn
    // carries no system field, so om-agi is not the one holding the identity.
    expect(args).toEqual(["-p", PROMPT, "--output-format", "json", "--tools", "", "--strict-mcp-config"]);
    // `--tools ""` removes every built-in tool. Without it a probe can answer
    // "what are your standing instructions?" by *reading the file* rather than
    // from its context — and `soul verify` would report an identity that
    // reached the model when it had not.
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(vendor("claude").replyPointers).toEqual(["/result"]);
  });

  test("codex runs read-only and skips the git check", () => {
    const args = argv(vendor("codex"));
    expect(args.slice(0, 4)).toEqual(["exec", "--skip-git-repo-check", "--sandbox", "read-only"]);
    // Trailing positional, not `-p`: this one takes the prompt last.
    expect(args.at(-1)).toBe(PROMPT);
    // `codex exec` writes progress to stderr and the final message to stdout,
    // so stdout is the reply and there is nothing to point at.
    expect(vendor("codex").replyPointers).toEqual([]);
  });

  test("grok caps its turns, because without a cap it half-answers and exits 0", () => {
    const args = argv(vendor("grok"));
    const at = args.indexOf("--max-turns");
    expect(at).toBeGreaterThan(-1);
    expect(Number(args[at + 1])).toBeGreaterThan(0);
    // Two shapes are tried because this vendor prints its reply under either.
    expect(vendor("grok").replyPointers).toEqual(["/text", "/result"]);
  });

  test("copilot denies the two tools that would let a read-only turn write", () => {
    const args = argv(vendor("copilot"));
    // `--allow-all-tools` is required for non-interactive mode; denials take
    // precedence over it, so these two are what actually keep the run safe.
    expect(args).toContain("--allow-all-tools");
    const denied = args.filter((_, index) => args[index - 1] === "--deny-tool");
    expect(denied.sort()).toEqual(["shell", "write"]);
  });

  test("kimi asks for plain text — and that is the whole of what its argv does", () => {
    // This assertion used to be `toEqual(["-p", PROMPT, "--output-format",
    // "text"])`, and it passed for months. It was also the strongest thing in
    // this repository keeping a security hole in place: kimi has no tool
    // filter, an exact-argv pin says *these flags and no others*, and so the
    // test that looked like coverage would have failed the day somebody added
    // a limit. A pinned constant cannot tell "this is deliberate" from "this
    // is all we managed" — it only says "do not change this", including when
    // changing it is the fix.
    //
    // The lesson is not about kimi. Any `toEqual` over a value that encodes a
    // policy freezes the policy, so what is pinned here is the *declaration*
    // (`readOnly.kind === "none"`, with the reason) rather than the bare list.
    // Close the hole and this test passes by following the declaration; leave
    // it open and `readonlyLimits()` says so out loud on every run.
    const spec = vendor("kimi");
    expect(argv(spec)).toEqual(["-p", PROMPT, "--output-format", "text"]);
    expect(spec.readOnly.kind).toBe("none");
    expect(readOnlyArgs(spec.readOnly)).toEqual([]);
  });

  test("every trap recorded is a sentence, not a shrug", () => {
    // Traps are read by humans in `ohmyagi backends`; an empty string or a
    // three-word note is worse than nothing there.
    for (const spec of VENDORS) {
      for (const trap of spec.traps) expect(trap.length).toBeGreaterThan(40);
    }
  });
});

/**
 * Every flag across these six CLIs that decides what a turn may do.
 *
 * Collected from the six `--help` outputs, including the spellings only one
 * vendor uses and the compat aliases two of them accept. The list exists for
 * one assertion — *no vendor's argv carries a permission flag it has not
 * declared* — and that assertion is the control that bites: the forward check
 * (the declared mechanism is in the argv) is true by construction now that
 * `headlessArgv` splices `readOnlyArgs` in, so on its own it would prove only
 * that the splice happened.
 */
const GOVERNING_FLAGS: readonly string[] = [
  "--tools",
  "--allow",
  "--deny",
  "--allowedTools",
  "--disallowedTools",
  "--allowed-tools",
  "--disallowed-tools",
  "--allow-tool",
  "--deny-tool",
  "--allow-all-tools",
  "--always-approve",
  "--permission-mode",
  "--approval-mode",
  "--ask-for-approval",
  "--sandbox",
  "--dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox",
  "--full-auto",
  "--yolo",
  "-y",
  "--auto",
  "--plan",
  "--no-plan",
];

describe("what stops a turn from writing, per vendor", () => {
  test("every vendor declares a mechanism, and the declaration is in the argv", () => {
    for (const spec of VENDORS) {
      const args = argv(spec);
      const expected = readOnlyArgs(spec.readOnly);
      if (expected.length === 0) {
        expect(spec.readOnly.kind).toBe("none");
        continue;
      }
      // Contiguous and in order, not merely present: `--deny-tool shell` and
      // `--deny-tool write` separated by something else is a different command
      // from the one that was measured.
      const joined = args.join("\u0000");
      expect(joined).toContain(expected.join("\u0000"));
    }
  });

  test("at level 2 the read-only flags are gone — the dial's only new power", () => {
    // The direction of S5.1, asserted rather than described. Before E5 every
    // `headlessArgv` spliced `readOnlyArgs` in unconditionally, so level 1 is
    // not a new restraint — it is the old behaviour, and the *loosened*
    // restraint is the thing that did not exist. If this test ever goes green
    // by the argvs being equal at both levels, the dial has stopped doing the
    // one thing it does.
    let vendorsThatDiffer = 0;
    for (const spec of VENDORS) {
      const restrained = argv(spec, undefined, RESTRAINED);
      const loosened = argv(spec, undefined, LOOSENED);
      const dropped = readOnlyArgs(spec.readOnly);

      // What was dropped is gone, and what the vendor is *granted* at 2
      // (D-047) is added — nothing else moves. A grant may reuse the same flag
      // with another value (codex: `--sandbox workspace-write`), so a dropped
      // token only has to be absent where the grant did not bring it back.
      const granted = grantArgs(spec.grant, LOOSENED);
      for (const flag of dropped) if (!granted.includes(flag)) expect(loosened).not.toContain(flag);
      expect(loosened.filter((part) => !granted.includes(part))).toEqual(
        restrained.filter((part) => !dropped.includes(part)),
      );
      for (const flag of granted) expect(loosened).toContain(flag);
      if (dropped.length > 0) vendorsThatDiffer += 1;
    }
    // Guards the assertion's own scope: a registry where every vendor declared
    // `none` would satisfy every line above and prove nothing.
    expect(vendorsThatDiffer).toBe(VENDORS.filter((s) => s.readOnly.kind !== "none").length);
    expect(vendorsThatDiffer).toBeGreaterThan(3);
  });

  test("no argv carries a permission flag the vendor has not declared", () => {
    // The direction that catches the real failure. A flag added to a
    // `headlessArgv` by hand — a `--permission-mode`, a `--yolo` someone put
    // there to get a run working — changes what the turn may do while the
    // registry, `ohmyagi backends` and `readonlyLimits()` all keep describing
    // the old command.
    for (const spec of VENDORS) {
      const mechanism = spec.readOnly;
      const declared = new Set(
        mechanism.kind === "none"
          ? []
          : [mechanism.flag, ...(mechanism.despite === undefined ? [] : [mechanism.despite.flag])],
      );
      const undeclared = argv(spec, "m").filter(
        (token) => GOVERNING_FLAGS.includes(token) && !declared.has(token),
      );
      expect({ id: spec.id, undeclared }).toEqual({ id: spec.id, undeclared: [] });
    }
  });

  test("a vendor with no mechanism carries no permission flag at all", () => {
    // The `none` arm's own control. Without this, "we have no mechanism" and
    // "we pass a flag and call it nothing" are the same green test.
    for (const spec of VENDORS) {
      if (spec.readOnly.kind !== "none") continue;
      expect(argv(spec, "m").filter((t) => GOVERNING_FLAGS.includes(t))).toEqual([]);
      expect(spec.readOnly.evidence).toBe("writes");
      // Long enough to say what was looked for and what it costs: this string
      // is printed to a human as the reason a vendor is unguarded.
      expect(spec.readOnly.why.length).toBeGreaterThan(120);
    }
  });

  test("grok's allow list is pinned by its contents, not by the flag being present", () => {
    // The previous version of this file asserted `args).toContain(
    // "--disallowed-tools")` and nothing about what followed it. What followed
    // it was `run_terminal_cmd` and `task` — names this vendor had renamed to
    // `run_terminal_command` and `spawn_subagent`. The flag was there, the
    // test was green, and a probe on 2026-09-21 asked the CLI to write a file
    // and it wrote one. A tool list is the contents; the flag is packaging.
    const mechanism = vendor("grok").readOnly;
    expect(mechanism.kind).toBe("allow-tools");
    if (mechanism.kind === "none") return;
    expect(mechanism.flag).toBe("--tools");
    expect(mechanism.values).toEqual(["read_file,grep,list_dir"]);
    for (const tool of mechanism.values.join(",").split(",")) {
      // Read-only by name is not a proof, but a tool called `write_file`
      // arriving in this list should stop somebody.
      expect(tool).not.toMatch(/write|edit|replace|terminal|exec|shell|patch|subagent/);
    }
  });

  test("claude's mechanism is the empty allow list, and codex's is the vendor's own sandbox", () => {
    const claude = vendor("claude").readOnly;
    expect(claude.kind).toBe("allow-tools");
    if (claude.kind !== "none") expect(claude.values).toEqual([""]);

    const codex = vendor("codex").readOnly;
    expect(codex.kind).toBe("sandbox");
    if (codex.kind !== "none") expect(codex.values).toEqual(["read-only"]);
  });

  test("the one-column answer keeps the three states apart", () => {
    // `no (measured)` and `no (on trust)` are not decoration. Printing both as
    // `no` would let one reading of a vendor's `--help` look identical to a
    // turn that was actually watched, which is the whole distinction this
    // story exists to make.
    const summaries = new Map(VENDORS.map((spec) => [spec.id, readOnlySummary(spec)]));
    for (const spec of VENDORS) {
      const summary = summaries.get(spec.id)!;
      if (spec.readOnly.kind === "none") expect(summary).toStartWith("yes");
      else if (spec.readOnly.evidence === "probed") expect(summary).toBe("no (measured)");
      else expect(summary).toBe("no (on trust)");
    }
    // Every vendor that is unguarded says so in the word a hurried reader
    // takes in first, not in a parenthesis at the end.
    expect([...summaries.values()].filter((s) => s.startsWith("yes")).length).toBe(
      VENDORS.filter((spec) => spec.readOnly.kind === "none").length,
    );
  });

  test("a loosening flag exists only where it is declared with a reason", () => {
    for (const spec of VENDORS) {
      const mechanism = spec.readOnly;
      const despite = mechanism.kind === "none" ? undefined : mechanism.despite;
      if (despite === undefined) continue;
      expect(argv(spec)).toContain(despite.flag);
      expect(despite.why.length).toBeGreaterThan(40);
    }
  });
});

describe("readonlyLimits()", () => {
  /** A vendor whose only interesting property is its mechanism. */
  function fake(id: string, readOnly: ReadOnlySpec): VendorSpec {
    return {
      ...vendor("kimi"),
      id,
      readOnly,
    };
  }

  const HOLE: ReadOnlySpec = {
    kind: "none",
    why: "a synthetic vendor with nothing to pass, used to check that this text is derived",
    evidence: "writes",
  };

  test("the real registry's holes are named, with the reason, in the printed text", () => {
    const printed = readonlyLimits().join("\n");
    for (const spec of VENDORS) {
      if (spec.readOnly.kind !== "none") continue;
      expect(printed).toContain(spec.id);
      expect(printed).toContain(spec.readOnly.why);
    }
    // Nothing here promises more than the flags do.
    expect(printed).not.toMatch(/cannot write|impossible|guaranteed/i);
  });

  test("close the hole and the sentence goes with it", () => {
    // The point of deriving this text rather than writing it. A second list —
    // prose in a document, a constant beside the registry — is right on the
    // day it is written and silently wrong afterwards, and the failure is
    // invisible because prose does not fail a test.
    const open = readonlyLimits([fake("example", HOLE)]).join("\n");
    expect(open).toContain(HOLE.why);

    const closed = readonlyLimits([
      fake("example", { kind: "sandbox", flag: "--sandbox", values: ["read-only"], evidence: "probed" }),
    ]).join("\n");
    expect(closed).not.toContain(HOLE.why);
    expect(closed).not.toContain("no read-only mechanism exists");
  });

  test("a vendor believed on its own documentation is named as believed", () => {
    const believed = readonlyLimits([
      fake("example", {
        kind: "approval-mode",
        flag: "--approval-mode",
        values: ["plan"],
        evidence: "documented",
      }),
    ]).join("\n");
    expect(believed).toContain("Believed rather than measured");
    expect(believed).toContain("readonly.real.test.ts");

    const probed = readonlyLimits([
      fake("example", { kind: "sandbox", flag: "--sandbox", values: ["ro"], evidence: "probed" }),
    ]).join("\n");
    expect(probed).not.toContain("Believed rather than measured");
  });

  test("two limits hold on every registry: the scope, and the channels no flag reaches", () => {
    const always = readonlyLimits([
      fake("example", { kind: "sandbox", flag: "--sandbox", values: ["ro"], evidence: "probed" }),
    ]).join("\n");
    // A CLI the owner starts is not covered, and the settings a CLI reads
    // before om-agi's argv arrives are not covered. Both survive a registry
    // with no holes at all, because neither is about a vendor.
    expect(always).toContain("turns om-agi itself starts");
    expect(always).toContain("MCP servers and session-start hooks");
  });
});

describe("where each vendor says it prints what a turn used", () => {
  test("every pointer is a pointer, and every JSON spec names at least one input field", () => {
    for (const spec of VENDORS) {
      const usage = spec.usage;
      if (usage === null || usage.shape !== "json") continue;
      // A pointer without a leading slash resolves against nothing and would
      // make every turn on this vendor read as `missing` — quietly, forever.
      for (const pointer of [...usage.input, usage.output, ...(usage.total ? [usage.total] : [])]) {
        expect(pointer).toStartWith("/");
        expect(pointer.length).toBeGreaterThan(1);
      }
      // An empty input list would sum to 0 and report it as a real count.
      expect(usage.input.length).toBeGreaterThan(0);
      expect(new Set(usage.input).size).toBe(usage.input.length);
    }
  });

  test("a text spec names a label with something in it", () => {
    for (const spec of VENDORS) {
      if (spec.usage === null || spec.usage.shape !== "text") continue;
      expect(spec.usage.totalAfterLine.trim().length).toBeGreaterThan(0);
    }
  });

  test("claude sums all three input fields, because one of them alone is a lie", () => {
    // Measured 2026-09-21 against 2.1.278: a turn of roughly 81,000 tokens
    // reported `input_tokens: 2`, with 80,951 under cache creation. A spec
    // that pointed at the first field alone would under-report by four orders
    // of magnitude and look like an unusually cheap turn.
    const usage = vendor("claude").usage;
    expect(usage?.shape).toBe("json");
    if (usage?.shape !== "json") return;
    expect([...usage.input].sort()).toEqual([
      "/usage/cache_creation_input_tokens",
      "/usage/cache_read_input_tokens",
      "/usage/input_tokens",
    ]);
    expect(usage.output).toBe("/usage/output_tokens");
    expect(usage.stream).toBe("stdout");
  });

  test("nothing in the registry reads a vendor's price", async () => {
    // The same response that carries claude's token counts carries
    // `total_cost_usd`, and it quoted $0.81 for a two-character answer —
    // almost all of it the list price of a cache write a subscription holder
    // is not billed for. It is not read, and it is not kept under another
    // name: a half-measure would become somebody's `cost` column later.
    const source = await Bun.file(
      new URL("../../src/exec/registry.ts", import.meta.url).pathname,
    ).text();
    expect(source).not.toContain("/total_cost_usd");
    expect(source).not.toContain("vendor_quoted_usd");
    for (const spec of VENDORS) expect(JSON.stringify(spec.usage)).not.toMatch(/usd|price|cost/i);
  });

  test("codex reads stderr, because that is where it prints and not where it answers", () => {
    const usage = vendor("codex").usage;
    expect(usage?.shape).toBe("text");
    expect(usage?.stream).toBe("stderr");
  });

  test("an unsurveyed vendor says `null` rather than claiming to report nothing", () => {
    // `null` here becomes `unreported` downstream — a statement about om-agi's
    // survey. Guessing a pointer from another vendor's spelling would produce
    // `missing` on every turn instead, which reads as a vendor that broke.
    for (const id of ["grok", "gemini", "copilot", "kimi"]) {
      expect(vendor(id).usage).toBeNull();
    }
  });
});

describe("PHASE_A_BACKENDS", () => {
  test("the local backend is in the list, not beside it", () => {
    // I-1 in one assertion: a default chain of commercial CLIs alone would
    // make "take them off PATH and the work still finishes" unpassable by
    // construction.
    expect(PHASE_A_BACKENDS).toContain("ollama");
    expect(PHASE_A_BACKENDS.at(-1)).toBe("ollama");
  });

  test("every other member is a vendor that resolves", () => {
    for (const id of PHASE_A_BACKENDS) {
      if (id === "ollama") continue;
      expect(vendor(id).id).toBe(id);
    }
    expect(new Set(PHASE_A_BACKENDS).size).toBe(PHASE_A_BACKENDS.length);
  });
});

describe("D-047 — grants and isolation", () => {
  test("levels 2 and 3 grant explicitly; below 2 nothing is granted", () => {
    expect(grantArgs(CLAUDE_GRANT, RESTRAINED)).toEqual([]);
    expect(grantArgs(CLAUDE_GRANT, LOOSENED)).toContain("acceptEdits");
    expect(grantArgs(CODEX_GRANT, LOOSENED)).toEqual(["--sandbox", "workspace-write"]);
    expect(grantArgs(CODEX_GRANT, atLevel(3))).toEqual(["--sandbox", "danger-full-access"]);
    expect(grantArgs(undefined, atLevel(3))).toEqual([]);
    expect(vendor("claude").grant).toBe(CLAUDE_GRANT);
    expect(vendor("codex").grant).toBe(CODEX_GRANT);
  });

  test("a claude turn that carries its own identity loads no user settings; every claude turn loads no MCP", () => {
    expect(claudeIsolation(undefined)).toEqual(["--strict-mcp-config"]);
    expect(claudeIsolation("# soul")).toEqual(["--setting-sources", "project,local", "--strict-mcp-config"]);
    const withSoul = vendor("claude").headlessArgv({ prompt: "p", restraint: RESTRAINED, system: "# soul" });
    expect(withSoul).toContain("project,local");
    expect(withSoul).toContain("--strict-mcp-config");
  });

  test("every governing flag a loosened argv carries is declared by its mechanism or its grant", () => {
    for (const spec of VENDORS) {
      const declared = new Set([
        ...(spec.readOnly.kind === "none" ? [] : [spec.readOnly.flag]),
        ...(spec.readOnly.kind !== "none" && spec.readOnly.despite !== undefined ? [spec.readOnly.despite.flag] : []),
        ...grantArgs(spec.grant, atLevel(3)).filter((t) => t.startsWith("--")),
      ]);
      for (const level of [LOOSENED, atLevel(3)]) {
        const undeclared = spec
          .headlessArgv({ prompt: "p", restraint: level })
          .filter((token) => GOVERNING_FLAGS.includes(token) && !declared.has(token));
        expect({ id: spec.id, undeclared }).toEqual({ id: spec.id, undeclared: [] });
      }
    }
  });
});
