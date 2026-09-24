/**
 * What each vendor CLI actually does — measured, not assumed.
 *
 * Every field was read off the CLI's own `--help` on a machine with all of
 * them installed; `docs/cli-matrix.md` records the survey and the versions.
 * Re-run it when a vendor updates, because these differences move between
 * releases and the failures they cause are silent.
 *
 * Nothing here names a person, a machine, or an account (D-021): paths are
 * written with `~` and expanded at call time, so this file is the same on
 * every install.
 *
 * Two measured facts shape everything above this file:
 *
 *   1. Only two of these CLIs accept a system prompt as a flag. The rest take
 *      an identity *only* as a file on disk. The file is therefore the
 *      universal channel and the flag is an optimisation for two vendors.
 *   2. The file channel is weaker. A flag lands the soul as a system prompt;
 *      a file lands it as user-level instructions, which a model may weigh
 *      less. om-agi reports that difference rather than flattening it.
 *   3. **Not one of these CLIs is read-only by default.** Each turn om-agi
 *      starts is an agent with a shell and a file-writing tool, and the only
 *      thing between that agent and the working directory is a flag in
 *      {@link VendorSpec.readOnly}. One vendor offers no such flag at all and
 *      says so in the registry rather than being left to look like the others.
 */

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { NonEmpty } from "../types.ts";
import type { IdentityStrength } from "./backend.ts";
// Type-only, and it has to stay that way: `restraint.ts` imports the two types
// below from here, so a value import in either direction would be a cycle.
import type { Restraint } from "./restraint.ts";

/** How an identity reaches one vendor, and how strongly. */
export interface IdentityChannel {
  readonly strength: IdentityStrength;
  /**
   * Files this CLI reads for user-level instructions, most authoritative
   * first. Written with a leading `~` for the user's home, or `./` for a
   * path resolved against the working directory.
   *
   * A `./` entry means the vendor has *no* home-scoped channel: the identity
   * can only be delivered per project. That is a vendor limitation om-agi
   * reports; it cannot fix it.
   */
  readonly instructionFiles: readonly string[];
  /** Flag that appends to the system prompt without replacing it. */
  readonly appendPromptFlag?: string;
  /**
   * Flag that replaces the entire system prompt.
   *
   * Recorded for completeness; om-agi does not use it. Replacing a vendor's
   * own system prompt removes its tool instructions, and the result is a CLI
   * that runs, exits 0, and quietly cannot use its own tools.
   */
  readonly replacePromptFlag?: string;
}

/**
 * Where one vendor prints what a turn used, and in what shape.
 *
 * Two shapes because the two vendors that were measured do genuinely different
 * things: claude puts its counts in the same JSON object as the reply, while
 * `codex exec` writes a line of prose to stderr. A single shape would have
 * meant inventing a parser general enough for both, which is the kind of
 * cleverness that turns a vendor's format change into a wrong number instead of
 * a missing one.
 *
 * Nothing here is derived. A spec names the fields the vendor prints; when one
 * of them is not there the result is {@link UsageStatus} `missing`.
 */
export type UsageSpec =
  | {
      readonly shape: "json";
      readonly stream: "stdout" | "stderr";
      /**
       * Pointers summed into `input`. Never partially: a vendor that splits
       * prompt tokens across fields has no single field that means "input",
       * and reporting one of them as if it did is how a 81,000-token turn gets
       * recorded as 2. At least one pointer, or the spec says nothing.
       */
      readonly input: readonly string[];
      readonly output: string;
      /** A total the vendor computes itself. Absent where it does not. */
      readonly total?: string;
    }
  | {
      readonly shape: "text";
      readonly stream: "stdout" | "stderr";
      /** Label line; the count is on the line after it, thousands separators and all. */
      readonly totalAfterLine: string;
    };

/**
 * How far a mechanism has actually been checked.
 *
 * Three states rather than a boolean, for the same reason {@link UsageSpec}
 * has three: "nobody looked" and "it held when somebody looked" are different
 * claims, and collapsing them is how a table gets a tick it has not earned.
 *
 * - `probed` — a real turn in a scratch directory was told to write a file and
 *   the directory stayed empty. `test/exec/readonly.real.test.ts` is that turn.
 * - `documented` — the vendor's own `--help` says the flag is read-only, and
 *   no turn has confirmed it on this machine. Believed, not measured.
 * - `writes` — a real turn was told to write a file and **the file appeared**.
 *   Only `none` carries this, and it is the honest end of the scale.
 */
export type ReadOnlyEvidence = "probed" | "documented" | "writes";

/**
 * What stops one vendor's turn from writing — or the statement that nothing does.
 *
 * Required on every vendor (see {@link VendorSpec.readOnly}) so that a seventh
 * CLI cannot be added without answering the question. `none` is a legal answer
 * and the point of the type: a vendor with no mechanism has to say so in a
 * field that `readonlyLimits()` prints, instead of quietly resembling the five
 * that do.
 *
 * The argv is built *from* this value by {@link readOnlyArgs} rather than
 * beside it. Two lists drift; one cannot.
 */
export type ReadOnlySpec =
  | {
      /**
       * `allow-tools` is the shape to prefer where a vendor offers both.
       * A deny list fails open — the day a vendor renames a tool, the old name
       * matches nothing and the tool comes back — and that is not a thought
       * experiment: grok's shell tool was denied as `run_terminal_cmd`, the
       * vendor renamed it `run_terminal_command`, and a probe wrote a file
       * through a flag that still looked like a fence. An allow list fails
       * closed: a drifted name costs the turn a tool it can no longer use.
       */
      readonly kind: "allow-tools" | "deny-tools" | "sandbox" | "approval-mode";
      readonly flag: string;
      /** One argv value per occurrence of the flag, in order. */
      readonly values: readonly string[];
      /**
       * A flag this vendor *requires* that loosens permissions, with the reason
       * it is safe here. Declared rather than merely present, so that the one
       * `--allow-all-tools` in this registry is a line somebody had to write
       * and a test can see, not a token hiding in an argv.
       */
      readonly despite?: { readonly flag: string; readonly why: string };
      readonly evidence: "probed" | "documented";
    }
  | {
      readonly kind: "none";
      /** What was looked for, what was found, and what it costs. Printed. */
      readonly why: string;
      readonly evidence: "writes";
    };

/** One vendor CLI: how to reach it, and what it gets wrong. */
export interface VendorSpec {
  readonly id: string;
  readonly display: string;
  /** Binary name, looked up on PATH. Never an absolute path. */
  readonly binary: string;
  readonly identity: IdentityChannel;
  /**
   * What keeps a turn on this vendor from writing.
   *
   * Required, with no default. A seventh CLI added without this field is a
   * `tsc` error, which is the only way this question gets asked reliably: the
   * alternative is an optional field nobody fills in and a table that reads as
   * if every vendor were covered.
   */
  readonly readOnly: ReadOnlySpec;
  /**
   * What levels 2 and 3 explicitly grant (D-047). Absent where om-agi has not
   * measured a grant: that vendor then runs at 2 and 3 with its own defaults,
   * which for some of them means it still cannot write — said in `backends`.
   */
  readonly grant?: GrantSpec;
  /**
   * Argv after the binary for a single-turn, text-only answer.
   *
   * **Read-only only if the dial says so**, and the {@link Restraint} is how it
   * says: every implementation below splices {@link restraintArgs} in, which is
   * `readOnlyArgs` at an acting level of 1 and *nothing at all* at 2 or above.
   * The parameter is required rather than optional, so a turn cannot be
   * composed by code that has not been through
   * `src/decide/effective.ts` — see `src/exec/restraint.ts` for why that is the
   * property worth having `tsc` enforce here rather than a reviewer.
   */
  headlessArgv(request: {
    readonly prompt: string;
    readonly model?: string;
    readonly restraint: Restraint;
    /** Present when om-agi carries the identity itself (D-047 isolates on it). */
    readonly system?: string;
  }): string[];
  /**
   * JSON pointers tried in order against stdout. Empty means stdout is the
   * reply verbatim.
   */
  readonly replyPointers: readonly string[];
  /**
   * Where this vendor prints what a turn used, or `null` when nobody has
   * looked.
   *
   * `null` is a statement about om-agi's survey, not about the vendor: it
   * produces `unreported`, which reads as "nobody reported" and never as "this
   * turn was free". Measuring a vendor means spending a real turn on it, so the
   * list of surveyed vendors grows slowly and on purpose.
   */
  readonly usage: UsageSpec | null;
  /** Vendor behaviours that cost someone a debugging session. */
  readonly traps: readonly string[];
  /** Version this entry was measured against. */
  readonly measuredAgainst: string;
}

/**
 * Where a path is resolved from.
 *
 * All three are injectable so that a test can resolve a registry path without
 * touching the real `$HOME` — which, for this registry in particular, is the
 * home of someone whose `CLAUDE.md` is in daily use.
 */
export interface PathContext {
  readonly home?: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** `${VAR:-fallback}`, and only at the very start of a spec. */
const ENV_PREFIX = /^\$\{([A-Z_][A-Z0-9_]*):-([^}]*)\}/;

/**
 * Expand a registry path against the user's home, environment, or cwd.
 *
 * Supports exactly three forms, because a registry is not a shell: a leading
 * `~`, a leading `${VAR:-fallback}`, and a relative path. `CODEX_HOME` is the
 * reason the second one exists — that variable relocates the only global
 * channel codex has, so a registry that ignored it would confidently report a
 * path the CLI does not read.
 */
export function expandPath(spec: string, context: PathContext = {}): string {
  const home = context.home ?? homedir();
  const env = context.env ?? process.env;
  const cwd = context.cwd ?? process.cwd();

  const match = spec.match(ENV_PREFIX);
  if (match !== null) {
    const value = env[match[1]!];
    const head = value !== undefined && value !== "" ? value : match[2]!;
    return expandPath(head + spec.slice(match[0].length), context);
  }

  if (spec.startsWith("~/")) return resolve(home, spec.slice(2));
  if (spec === "~") return home;
  if (isAbsolute(spec)) return spec;
  return resolve(cwd, spec);
}

/**
 * True when a vendor offers no home-scoped identity channel.
 *
 * Keyed on `./` rather than "does not start with `~`", because a spec may
 * begin with an environment variable that still resolves under the home.
 */
export function isProjectScopedOnly(spec: VendorSpec): boolean {
  return spec.identity.instructionFiles.every((f) => f.startsWith("./"));
}

/**
 * The flags one mechanism contributes to an argv.
 *
 * Every `headlessArgv` below splices this in rather than spelling its own
 * flags, so the declaration and the command are the same fact. A vendor whose
 * mechanism is `none` contributes nothing — and the emptiness is visible here,
 * in one line, instead of being an absence a reader has to notice.
 */
export function readOnlyArgs(spec: ReadOnlySpec): string[] {
  if (spec.kind === "none") return [];
  const required = spec.despite === undefined ? [] : [spec.despite.flag];
  return [...required, ...spec.values.flatMap((value) => [spec.flag, value])];
}

/**
 * The same flags, or **none of them**, according to the dial.
 *
 * This one line is the whole of what S5.1 changes about how a turn is run, and
 * it is worth being blunt about the direction: until E5 every `headlessArgv`
 * below called `readOnlyArgs` unconditionally, so every turn om-agi had ever
 * started was already restrained. The dial's only new power is to return `[]`
 * here. `DEFAULT_DIAL` — every category at 1 — reproduces the old behaviour
 * exactly, which is why a tree with no `autonomy.md` in it behaves today as it
 * did yesterday.
 *
 * It lives in this file rather than beside {@link Restraint} so that
 * `restraint.ts` can import from here with `import type` alone. A value import
 * in both directions would be a module cycle, and the one thing worse than a
 * cycle is a cycle around the code that decides whether a turn may write.
 */
export function restraintArgs(spec: ReadOnlySpec, restraint: Restraint): string[] {
  return restraint.loosened ? [] : readOnlyArgs(spec);
}

/**
 * What a vendor is explicitly *given* at levels 2 and 3 (D-047).
 *
 * Taking the read-only flag off was never the same as granting anything:
 * probed 2026-09-23, a claude `-p` turn with no grant and no user settings
 * wrote nothing and ran nothing, and codex's default sandbox is read-only. So
 * levels 2 and 3 used to "work" only where the owner's own vendor settings
 * happened to allow it. These are the flags that make the level true on its
 * own. `act3` — used when {@link Restraint.unfenced} — differs from `act2`
 * where the vendor has a difference to offer.
 */
export interface GrantSpec {
  readonly act2: readonly string[];
  readonly act3: readonly string[];
  /** What was measured, and against which version. */
  readonly evidence: string;
}

/** The grant for this turn's level, or nothing below 2. */
export function grantArgs(grant: GrantSpec | undefined, restraint: Restraint): string[] {
  if (grant === undefined || !restraint.loosened) return [];
  return [...(restraint.unfenced ? grant.act3 : grant.act2)];
}

// `--tools ""` is the empty allow list: every built-in tool removed. A probe
// must answer from its context, never by reading a file that happens to
// contain the answer — and it cannot write one either (measured 2026-09-21).
const CLAUDE_READONLY: ReadOnlySpec = {
  kind: "allow-tools",
  flag: "--tools",
  values: [""],
  evidence: "probed",
};

/** D-047 — without a grant a headless claude writes and runs nothing. */
export const CLAUDE_GRANT: GrantSpec = {
  act2: ["--permission-mode", "acceptEdits", "--allowedTools", "Bash,WebFetch,WebSearch"],
  act3: ["--permission-mode", "acceptEdits", "--allowedTools", "Bash,WebFetch,WebSearch"],
  evidence:
    "probed 2026-09-23 against 2.1.280: no grant = nothing written or run; Edit+Write with " +
    "acceptEdits = writes, cannot run; Bash allowed = writes and runs (a shell also writes)",
};

/**
 * D-047 — the flags that keep a claude turn to one identity and no MCP.
 *
 * `--setting-sources project,local` only when om-agi carries the identity
 * itself (the `system` field): it drops the owner's user settings — and with
 * them the owner's SessionStart hooks, which were measured putting another
 * persona into every ohmyagi turn — at the price of the user-level CLAUDE.md,
 * which is exactly the file a turn wearing a different soul must not read.
 * `--strict-mcp-config` always: MCP servers (claude.ai connectors among them)
 * are a way out of the machine the dial never governed.
 */
export function claudeIsolation(system: string | undefined): string[] {
  return [...(system === undefined ? [] : ["--setting-sources", "project,local"]), "--strict-mcp-config"];
}

const CLAUDE: VendorSpec = {
  id: "claude",
  display: "Claude Code",
  binary: "claude",
  identity: {
    strength: "system",
    instructionFiles: ["~/.claude/CLAUDE.md"],
    appendPromptFlag: "--append-system-prompt",
    replacePromptFlag: "--system-prompt",
  },
  readOnly: CLAUDE_READONLY,
  grant: CLAUDE_GRANT,
  headlessArgv: ({ prompt, model, restraint, system }) => [
    "-p",
    prompt,
    "--output-format",
    "json",
    ...restraintArgs(CLAUDE_READONLY, restraint),
    ...grantArgs(CLAUDE_GRANT, restraint),
    ...claudeIsolation(system),
    ...(model ? ["--model", model] : []),
  ],
  replyPointers: ["/result"],
  // Measured 2026-09-21 against 2.1.278, one turn, `--output-format json`.
  //
  // The three input pointers are one number, not three candidates. That turn
  // sent roughly 81,000 tokens and reported `input_tokens: 2`, with the other
  // 80,951 under `cache_creation_input_tokens` — reading the first field alone
  // would have under-reported by four orders of magnitude, quietly.
  //
  // The same response carried `total_cost_usd: 0.80962` for a two-character
  // answer. It is deliberately not read: see {@link Usage}.
  usage: {
    shape: "json",
    stream: "stdout",
    input: [
      "/usage/input_tokens",
      "/usage/cache_creation_input_tokens",
      "/usage/cache_read_input_tokens",
    ],
    output: "/usage/output_tokens",
  },
  traps: [
    "`usage.input_tokens` is only the part of the prompt that missed the " +
      "cache. A turn measured at ~81,000 tokens reported 2 there, with the " +
      "rest under cache_creation_input_tokens. Summing all three input " +
      "fields is the only reading that means anything.",
  ],
  measuredAgainst: "2.1.278",
};

// The only mechanism here that is the vendor's own process boundary rather
// than a list of tool names: the CLI refuses the write itself, in prose
// ("the workspace is read-only", measured 2026-09-21 on 0.155.1), so nothing
// depends on om-agi having spelled a tool id correctly.
const CODEX_READONLY: ReadOnlySpec = {
  kind: "sandbox",
  flag: "--sandbox",
  values: ["read-only"],
  evidence: "probed",
};

/** D-047 — codex's default sandbox is read-only; level 2 is sandboxed, level 3 is not. */
export const CODEX_GRANT: GrantSpec = {
  act2: ["--sandbox", "workspace-write"],
  act3: ["--sandbox", "danger-full-access"],
  evidence:
    "probed 2026-09-23 against 0.155.1 on kernel 7.0: default = read-only; workspace-write " +
    "refused both the write and the shell command on this machine; danger-full-access did both",
};

const CODEX: VendorSpec = {
  id: "codex",
  display: "Codex CLI",
  binary: "codex",
  identity: {
    strength: "user",
    // `CODEX_HOME` moves this whole directory, and the CLI stops reading the
    // default the moment it is set. Written as the variable so `soul apply`
    // and `backends` name the path this machine actually uses.
    instructionFiles: ["${CODEX_HOME:-~/.codex}/AGENTS.md"],
  },
  // `codex exec` writes progress to stderr and only the final message to
  // stdout, so stdout is the reply with no parsing needed.
  readOnly: CODEX_READONLY,
  grant: CODEX_GRANT,
  headlessArgv: ({ prompt, model, restraint }) => [
    "exec",
    "--skip-git-repo-check",
    ...restraintArgs(CODEX_READONLY, restraint),
    ...grantArgs(CODEX_GRANT, restraint),
    ...(model ? ["--model", model] : []),
    prompt,
  ],
  replyPointers: [],
  // Measured 2026-09-21 against 0.153.4, one `codex exec`: stderr carries a
  // line reading `tokens used` with the figure on the line after it, thousands
  // separated by commas (`2,243`). One total, never split into input and
  // output — `codex exec --json` does split them, and switching to it would
  // mean rebuilding the reply path this registry already pins as plain stdout.
  usage: { shape: "text", stream: "stderr", totalAfterLine: "tokens used" },
  traps: [
    "The token count goes to stderr while the answer goes to stdout, so any " +
      "wrapper that keeps stderr only when stdout came back empty throws the " +
      "count away on exactly the turns that used tokens.",
    "No system-prompt flag exists. $CODEX_HOME/AGENTS.md is the only global " +
      "channel, and CODEX_HOME relocates it wholesale.",
    "Tool names follow feature flags, not the vendor: with " +
      "features.unified_exec = true the shell tool is `unified_exec`, " +
      "otherwise `shell`. An allowlist written against one spelling silently " +
      "matches nothing under the other.",
  ],
  measuredAgainst: "0.153.4",
};

/**
 * An allow list, and the reason this registry now prefers that shape.
 *
 * Until 2026-09-21 this vendor was held with `--disallowed-tools
 * run_terminal_cmd,search_replace,web_search,web_fetch,task`. Two of those five
 * names no longer existed: 1.0.40 calls the shell tool `run_terminal_command`
 * and the subagent tool `spawn_subagent`, and nothing warned about either —
 * an unknown name in a tool list is accepted with exit 0. A probe asked the
 * CLI to write a file and it wrote one, through a flag that read like a fence
 * in the registry, in the tests, and in `ohmyagi backends`.
 *
 * The same probe under this allow list wrote nothing, and the model's own
 * reasoning said why: *I don't have a write tool.* The three names here are the
 * read-only ones from the vendor's own tool table; if one of them drifts too,
 * the turn loses a tool it cannot use rather than regaining one it must not.
 */
const GROK_READONLY: ReadOnlySpec = {
  kind: "allow-tools",
  flag: "--tools",
  values: ["read_file,grep,list_dir"],
  evidence: "probed",
};

const GROK: VendorSpec = {
  id: "grok",
  display: "Grok CLI",
  binary: "grok",
  identity: {
    strength: "system",
    // This vendor reads Anthropic's file on purpose — it documents the
    // behaviour as Claude Code compatibility. So an identity written for
    // `claude` already reaches `grok`, and that is precisely why it should
    // not be relied on: it is a courtesy, switchable with one env var
    // (GROK_CLAUDE_AGENTS_ENABLED=0), not a contract.
    instructionFiles: ["~/.claude/CLAUDE.md"],
    appendPromptFlag: "--rules",
    replacePromptFlag: "--system-prompt-override",
  },
  readOnly: GROK_READONLY,
  headlessArgv: ({ prompt, model, restraint }) => [
    "-p",
    prompt,
    "--output-format",
    "json",
    // Without an explicit cap this CLI answers the first sentence and exits 0
    // without ever entering its tool loop — a half-run that reads as success.
    "--max-turns",
    "2",
    ...restraintArgs(GROK_READONLY, restraint),
    ...(model ? ["--model", model] : []),
  ],
  replyPointers: ["/text", "/result"],
  // Not surveyed. This vendor prints JSON and very likely reports something,
  // but nobody has spent a turn to find out, and a pointer guessed from
  // another vendor's spelling would produce `missing` at best.
  usage: null,
  traps: [
    "`--permission-mode plan` in headless plans the work, then waits for an " +
      "approval nobody will give, and exits 0 having changed nothing.",
    "Tool ids are not the display names, and they move between releases: the " +
      "shell tool documented as `run_terminal_cmd` at 1.0.24 is " +
      "`run_terminal_command` at 1.0.40, and `task` is now `spawn_subagent`. " +
      "A deny list written against the old spelling matched nothing and let a " +
      "turn write a file. This is why the registry holds an allow list here.",
    "An unrecognised name in `--tools` is accepted silently — the run exits 0 " +
      "and answers. So a typo in an allow list costs the turn its tools " +
      "quietly, and a typo in a deny list costs the turn its limits quietly. " +
      "Only the first of those two failures is safe, which decides the shape.",
    "Large prompts are truncated in the middle without warning — the head and " +
      "tail arrive, the centre does not. Ask two questions at once, one about " +
      "the end and one about the whole, to detect it.",
    "`--sandbox` exists but names a profile defined in a config file this " +
      "registry does not write, and it refuses to start when it cannot build " +
      "its bubblewrap plan. It is a machine-level mechanism, not an argv one, " +
      "and om-agi does not reach for it.",
  ],
  measuredAgainst: "1.0.40",
};

// The one entry in this registry believed on the vendor's word. `--help` at
// 0.38.2 documents `plan` as read-only, and the probe that would have confirmed
// it could not run: this CLI refused to authenticate at all on 2026-09-21
// (`IneligibleTierError`, a tier being retired), so no turn was spent and none
// was faked. `readonlyLimits()` names it every run until one is.
const GEMINI_READONLY: ReadOnlySpec = {
  kind: "approval-mode",
  flag: "--approval-mode",
  values: ["plan"],
  evidence: "documented",
};

const GEMINI: VendorSpec = {
  id: "gemini",
  display: "Gemini CLI",
  binary: "gemini",
  identity: {
    strength: "user",
    instructionFiles: ["~/.gemini/GEMINI.md"],
  },
  readOnly: GEMINI_READONLY,
  headlessArgv: ({ prompt, model, restraint }) => [
    "-p",
    prompt,
    "-o",
    "text",
    ...restraintArgs(GEMINI_READONLY, restraint),
    ...(model ? ["-m", model] : []),
  ],
  replyPointers: [],
  // Not surveyed — see the note on grok.
  usage: null,
  traps: [
    "GEMINI.md is also where this CLI writes its own auto-saved memories, so " +
      "an identity placed there shares a file with vendor-generated text that " +
      "changes underneath it.",
    "`--allowed-tools` is deprecated in favour of a policy engine.",
  ],
  measuredAgainst: "0.38.2",
};

// The only entry that has to loosen something to work at all, so the loosening
// is a declared field rather than a token in an argv: `--allow-all-tools` is
// required for non-interactive mode, and denials outrank it. Measured
// 2026-09-21 — the probe was told to write a file and answered that it had no
// permission to.
const COPILOT_READONLY: ReadOnlySpec = {
  kind: "deny-tools",
  flag: "--deny-tool",
  values: ["shell", "write"],
  despite: {
    flag: "--allow-all-tools",
    why:
      "non-interactive mode refuses to run without it; `--deny-tool` takes " +
      "precedence over it, and a probe confirmed the denial still bites",
  },
  evidence: "probed",
};

const COPILOT: VendorSpec = {
  id: "copilot",
  display: "GitHub Copilot CLI",
  binary: "copilot",
  identity: {
    strength: "user",
    // Resolved from the working directory. There is no home-scoped file, so
    // an identity reaches this vendor per project or not at all.
    instructionFiles: ["./AGENTS.md"],
  },
  readOnly: COPILOT_READONLY,
  headlessArgv: ({ prompt, model, restraint }) => [
    "-p",
    prompt,
    "-s",
    ...restraintArgs(COPILOT_READONLY, restraint),
    ...(model ? ["--model", model] : []),
  ],
  replyPointers: [],
  // Not surveyed — see the note on grok.
  usage: null,
  traps: [
    "No home-scoped instruction file exists; identity is per-project by " +
      "construction.",
    "`--no-custom-instructions` disables the only channel there is.",
    "Permissions name kinds, not tools — shell(git:*), write, MyMCP(tool) — " +
      "so an allowlist copied from another vendor does not parse.",
  ],
  measuredAgainst: "0.0.367",
};

/**
 * The hole, written down as a hole.
 *
 * Measured 2026-09-21 against 2.0.2. `--help` offers no tool filter and no
 * sandbox: the three permission flags it has all loosen (`-y/--yolo`, `--auto`)
 * or are unavailable here — `--plan` exits 1 with *Cannot combine --prompt with
 * --plan*, so plan mode and headless mode are mutually exclusive on this
 * version. The control ran too: a plain headless turn asked to write a file
 * wrote it, and reported success.
 *
 * So there is no flag to add, and adding one that does nothing to make the
 * table look even would be worse than the gap. It is declared, printed by
 * `readonlyLimits()` on every `ohmyagi backends`, and it is the reason
 * `ReadOnlySpec` has a `none` arm at all.
 */
const KIMI_READONLY: ReadOnlySpec = {
  kind: "none",
  why:
    "2.0.2 has no tool filter and no sandbox flag; `--plan` is refused " +
    "together with `-p` (exit 1), and a headless turn told to write a file " +
    "wrote it. A turn om-agi starts here is an agent with a shell, and " +
    "nothing in this repository narrows it. The cost is not om-agi's alone: " +
    "any fallback chain that can land on this CLI inherits the same hole, " +
    "including chains in other tools on the same machine.",
  evidence: "writes",
};

const KIMI: VendorSpec = {
  id: "kimi",
  display: "Kimi Code CLI",
  binary: "kimi",
  identity: {
    strength: "user",
    instructionFiles: ["./AGENTS.md"],
  },
  readOnly: KIMI_READONLY,
  headlessArgv: ({ prompt, model, restraint }) => [
    "-p",
    prompt,
    "--output-format",
    "text",
    // Empty, and empty on purpose: see KIMI_READONLY.
    ...restraintArgs(KIMI_READONLY, restraint),
    ...(model ? ["-m", model] : []),
  ],
  replyPointers: [],
  // Not surveyed — see the note on grok.
  usage: null,
  traps: [
    "Headless support is newer than some tooling assumes: `-p` with " +
      "`--output-format text|stream-json` and `--auto` all exist in 2.x, so a " +
      "wrapper that reports this CLI as interactive-only is out of date.",
    "`--plan` and `-p` cannot be combined: the run exits 1 with `Cannot " +
      "combine --prompt with --plan` before a turn starts. The one flag that " +
      "sounds like it would make a headless turn read-only is the one flag a " +
      "headless turn may not have.",
    "A plain `-p` turn writes files. Asked for a file in a scratch directory " +
      "it created one and answered `Done` — this CLI is an agent with a shell " +
      "by default, and 2.0.2 offers no argv that narrows it.",
  ],
  measuredAgainst: "2.0.2",
};

/**
 * Every vendor CLI om-agi knows about, wired or not.
 *
 * {@link NonEmpty} for the same reason {@link import("../agent/derive.ts").DERIVATIONS}
 * is: `isProjectScopedOnly` is an `every` over this list's instruction files and
 * is vacuously true of nothing. Emptying it turns 152 tests red
 * (`notes/odd2-driver.ts`, `D-P3`) and used to leave `tsc` clean, so the
 * loudest signal a reader got was in a suite nobody runs before a type error.
 */
export const VENDORS: NonEmpty<VendorSpec> = [CLAUDE, CODEX, GROK, GEMINI, COPILOT, KIMI];

const BY_ID = new Map(VENDORS.map((v) => [v.id, v]));

/** Look up a vendor by id. Throws only on a programmer error. */
export function vendor(id: string): VendorSpec {
  const found = BY_ID.get(id);
  if (!found) {
    throw new Error(`unknown vendor ${JSON.stringify(id)} (known: ${[...BY_ID.keys()].join(", ")})`);
  }
  return found;
}

/**
 * One column's worth of answer to "can a turn on this vendor write?".
 *
 * Three answers, not two, for the reason the whole registry keeps three
 * states: a flag nobody has watched work is a different thing from one that
 * has been watched, and a table that prints both as `no` is a table that has
 * quietly promised something. Whatever this returns, `readonlyLimits()` is
 * printed under it.
 */
export function readOnlySummary(spec: VendorSpec): string {
  const mechanism = spec.readOnly;
  if (mechanism.kind === "none") return "yes — no limit";
  return mechanism.evidence === "probed" ? "no (measured)" : "no (on trust)";
}

/**
 * What the read-only flags do **not** cover — derived, never listed twice.
 *
 * Every sentence below is computed from {@link VENDORS} rather than written
 * beside it. That is the whole design: a second list of "vendors with a hole"
 * would be right on the day it was written and wrong on the day a vendor was
 * fixed or added, and nobody would find out, because prose does not fail a
 * test. Declare `none` in the registry and this text names the vendor by
 * itself; close the hole and the sentence disappears with it.
 *
 * Printed by `ohmyagi backends`, the same way `GUARD_LIMITS` is printed
 * wherever the guard speaks: the reader of a green table is exactly the person
 * about to believe it covers more than it does.
 */
export function readonlyLimits(vendors: readonly VendorSpec[] = VENDORS): readonly string[] {
  const named = (list: readonly VendorSpec[]) => list.map((spec) => spec.id).join(", ");
  const open = vendors.filter((spec) => spec.readOnly.kind === "none");
  const believed = vendors.filter(
    (spec) => spec.readOnly.kind !== "none" && spec.readOnly.evidence === "documented",
  );
  const denyLists = vendors.filter((spec) => spec.readOnly.kind === "deny-tools");
  const loosened = vendors.filter(
    (spec) => spec.readOnly.kind !== "none" && spec.readOnly.despite !== undefined,
  );

  const lines: string[] = [
    "What is covered is narrow and exact: the turns om-agi itself starts carry a flag that " +
      "asks the vendor to stay read-only. A CLI the owner runs by hand, or one another tool " +
      "spawns, is reached by nothing in this repository.",
    "The mechanism is the vendor's, not om-agi's. om-agi passes a flag and the vendor decides " +
      "what to do with it — so a release that renames a tool or stops honouring a flag fails " +
      "silently, and only a real turn against the real CLI notices.",
  ];

  for (const spec of open) {
    const mechanism = spec.readOnly;
    if (mechanism.kind !== "none") continue;
    lines.push(`${spec.id}: no read-only mechanism exists to pass. ${mechanism.why}`);
  }
  if (believed.length > 0) {
    lines.push(
      `Believed rather than measured: ${named(believed)} — the flag is read-only according to ` +
        "the vendor's own `--help`, and no turn here has watched it hold. " +
        "`OM_AGI_REAL_READONLY=1 bun test test/exec/readonly.real.test.ts` is what changes that.",
    );
  }
  if (denyLists.length > 0) {
    lines.push(
      `A deny list only denies the names the vendor still uses (${named(denyLists)}). That is ` +
        "how this check was wrong before it was written: a shell tool denied under a name the " +
        "vendor had renamed, and a turn that wrote a file through it.",
    );
  }
  if (loosened.length > 0) {
    lines.push(
      `${named(loosened)} needs a permissive flag to run headless at all, kept only because the ` +
        "denials outrank it. If that precedence ever changes, nothing in the argv will look " +
        "different.",
    );
  }
  lines.push(
    "MCP servers and session-start hooks configured in the owner's own vendor settings are " +
      "outside every flag here: they add tools and context to a turn before om-agi's argv is " +
      "read. No tool list can close that, and this line is not a plan to.",
  );
  return lines;
}

/**
 * The backends phase A wires end to end.
 *
 * `ollama` is not a vendor CLI and is deliberately in this list: it is the
 * one that has to keep working when the other two are taken off PATH (I-1).
 * A list of commercial CLIs alone would make that test unpassable by design.
 */
export const PHASE_A_BACKENDS = ["claude", "codex", "ollama"] as const;
