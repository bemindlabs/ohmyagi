/**
 * Vendor CLIs whose model is on this machine.
 *
 * These are variants, not new execution engines: the real `claude` and `grok`
 * binaries still run through {@link CliExec}, so their output, completion and
 * usage handling stay the measured vendor handling in `registry.ts`. This
 * layer owns the facts that differ: an om-agi home, a scrubbed child
 * environment, LiteLLM configuration, and D-118's mandatory fence.
 */

import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { stateRoot, STATE_DIR_MODE, STATE_FILE_MODE } from "../state.ts";
import { notLoopbackLiteral } from "../loopback.ts";
import type { Availability, ExecBackend, IdentityStrength, TurnRequest, TurnResult } from "./backend.ts";
import { CliExec, extractUsage } from "./cli-exec.ts";
import { vendor, type GrantSpec, type VendorSpec } from "./registry.ts";

export const LOCAL_BACKENDS = ["claude-local", "grok-local"] as const;
export type LocalCliId = (typeof LOCAL_BACKENDS)[number];

export const LOCAL_MODEL = "local-coder";
export const LITELLM_BASE_URL = "http://127.0.0.1:10400";
export const LITELLM_PORT = 10_400;
export const LITELLM_KEY_FILE_ENV = "OM_AGI_LITELLM_KEY_FILE";

const CLAUDE_LOCAL_GRANT: GrantSpec = {
  act2: ["--permission-mode", "acceptEdits", "--allowedTools", "Bash"],
  act3: ["--permission-mode", "acceptEdits", "--allowedTools", "Bash"],
  evidence:
    "the measured claude grant with WebFetch and WebSearch removed; D-118's kernel fence " +
    "is the boundary around Bash for every local turn",
};

/** The machine values this seam reads. Tests hand it a temporary home. */
export interface LocalCliContext {
  readonly home?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: () => string;
  readonly baseUrl?: string;
  readonly makeCli?: (spec: VendorSpec) => ExecBackend;
}

interface LocalPaths {
  readonly home: string;
  readonly scratch: string;
  readonly config: string;
}

/** `true` only for the two ids this file builds. */
export function isLocalCliId(id: string): id is LocalCliId {
  return (LOCAL_BACKENDS as readonly string[]).includes(id);
}

/**
 * Read one dotenv value without evaluating the file.
 *
 * The last assignment wins, as it would in a sourced env file. Quotes around
 * the whole value are removed; everything inside them, including `#` and `=`,
 * is data. No caller ever includes the returned value in an error.
 */
export function parseLiteLLMKey(source: string, name = "LITELLM_API_KEY"): string | undefined {
  let found: string | undefined;
  const assignment = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)\\s*$`);
  for (const line of source.split(/\r?\n/)) {
    const match = assignment.exec(line);
    if (match === null) continue;
    let value = match[1]!.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.startsWith("#") ? "" : value.replace(/\s+#.*$/, "").trim();
    }
    if (value !== "") found = value;
  }
  return found;
}

/** The configured source file; the credential itself is never returned here. */
export function liteLLMKeyFile(home: string, env: Readonly<Record<string, string | undefined>>): string {
  const configured = env[LITELLM_KEY_FILE_ENV];
  // A key of om-agi's own, not the proxy's master key (D-124): a master key can add routes and
  // callbacks to LiteLLM, which is not fenced, so a turn holding it could send data out through it.
  if (configured === undefined || configured === "") return join(home, ".secrets", ".env.om-agi-litellm");
  if (configured === "~") return home;
  if (configured.startsWith("~/")) return join(home, configured.slice(2));
  return configured;
}

function portOf(baseUrl: string): number | undefined {
  try {
    const url = new URL(baseUrl);
    if (url.port !== "") return Number(url.port);
    if (url.protocol === "http:") return 80;
    if (url.protocol === "https:") return 443;
  } catch {
    // The loopback check gives the useful refusal.
  }
  return undefined;
}

function pathsFor(id: LocalCliId, home: string, env: Readonly<Record<string, string | undefined>>): LocalPaths {
  const vendorHome = join(stateRoot(home, env), "vendors", id);
  return {
    home: vendorHome,
    scratch: join(vendorHome, "scratch"),
    config: id === "claude-local"
      ? join(vendorHome, ".claude", "settings.json")
      : join(vendorHome, ".grok", "config.toml"),
  };
}

const CLAUDE_SETTINGS = `${JSON.stringify(
  { pluginConfigs: { "agents-md@builtin": { options: { instructionFiles: "claude-md" } } } },
  null,
  2,
)}\n`;

function grokConfig(baseUrl: string): string {
  const api = `${baseUrl.replace(/\/+$/, "")}/v1`;
  return `# Managed by om-agi. The LiteLLM key is supplied only in the child environment.
disable_web_search = true

[cli]
auto_update = false
show_tips = false
use_leader = false
session_registry = false

[marketplace]
official_marketplace_auto_installed = true
default_skills_installs_purged = true

[models]
default = "local-coder"
allowed_models = ["local-coder"]
session_summary = "local-coder"
prompt_suggestion = "local-coder"

[model.local-coder]
model = "local-coder"
base_url = ${JSON.stringify(api)}
api_backend = "chat_completions"
name = "local-coder (LiteLLM)"
env_key = "LITELLM_API_KEY"
context_window = 131072
max_completion_tokens = 8192

[features]
telemetry = "off"
feedback = false
feedback_trace_card = false
codebase_indexing = false
lsp_tools = false
remote_fetch = false
managed_config = false
campaigns = false
session_recap = false
title_refresh = false
turn_summary = false
voice_mode = false
image_gen = false
video_gen = false
web_fetch = false
backend_tools = false
non_git_warning = false
support_permission = false

[telemetry]
events_url = ""
events_api_key = ""
mixpanel_token = ""
mixpanel_enabled = false
trace_upload = false
otel_enabled = false

[harness]
wait_for_uploads = false

[relay]
enabled = false

[managed_mcps]
enabled = false

[subagents]
enabled = false

[memory]
enabled = false

[ui]
fork_secondary_model = "local-coder"
prompt_suggestions = false
yolo = false

[compat.claude]
agents = false
hooks = false
mcps = false
rules = false
skills = false

[compat.cursor]
agents = false
hooks = false
mcps = false
rules = false
skills = false

[shell_environment_policy]
exclude = ["LITELLM_API_KEY"]
`;
}

/** Replace a managed config atomically and with the state root's private modes. */
async function writeManaged(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: STATE_DIR_MODE });
  await chmod(directory, STATE_DIR_MODE);
  const temporary = `${path}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temporary, content, { mode: STATE_FILE_MODE, flag: "wx" });
  try {
    await rename(temporary, path);
    await chmod(path, STATE_FILE_MODE);
  } catch (cause) {
    await unlink(temporary).catch(() => undefined);
    throw cause;
  }
}

function baseEnvironment(
  paths: LocalPaths,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return {
    HOME: paths.home,
    PATH: env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
    SHELL: env["SHELL"] ?? "/bin/bash",
    USER: env["USER"] ?? "om-agi",
    LOGNAME: env["LOGNAME"] ?? env["USER"] ?? "om-agi",
    TERM: env["TERM"] ?? "dumb",
    LANG: env["LANG"] ?? "C.UTF-8",
    LC_ALL: env["LC_ALL"] ?? "C.UTF-8",
    NO_COLOR: "1",
    TMPDIR: paths.scratch,
  };
}

function localSpec(
  id: LocalCliId,
  paths: LocalPaths,
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  baseUrl: string,
): VendorSpec {
  const base = vendor(id === "claude-local" ? "claude" : "grok");
  const common = baseEnvironment(paths, env);

  if (id === "claude-local") {
    const modelEnvironment = {
      ANTHROPIC_MODEL: LOCAL_MODEL,
      ANTHROPIC_DEFAULT_OPUS_MODEL: LOCAL_MODEL,
      ANTHROPIC_DEFAULT_SONNET_MODEL: LOCAL_MODEL,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: LOCAL_MODEL,
      ANTHROPIC_SMALL_FAST_MODEL: LOCAL_MODEL,
      CLAUDE_CODE_SUBAGENT_MODEL: LOCAL_MODEL,
    } as const;
    return {
      ...base,
      id,
      display: "Claude Code (local-coder via LiteLLM)",
      inheritEnv: false,
      grant: CLAUDE_LOCAL_GRANT,
      hardening: {
        args: base.hardening?.args ?? [],
        env: {
          ...common,
          ...base.hardening?.env,
          CLAUDE_CONFIG_DIR: join(paths.home, ".claude"),
          CLAUDE_CODE_TMPDIR: paths.scratch,
          ANTHROPIC_BASE_URL: baseUrl,
          ANTHROPIC_AUTH_TOKEN: key,
          ...modelEnvironment,
          CLAUDE_CODE_MODEL_CAPABILITIES:
            "local-coder=-mid_conv_system,-mid_conv_tool_change,-effort",
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: "8192",
          CLAUDE_CODE_MAX_CONTEXT_TOKENS: "118000",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          CLAUDE_CODE_ENABLE_TELEMETRY: "0",
          DISABLE_TELEMETRY: "1",
          DISABLE_ERROR_REPORTING: "1",
          DISABLE_AUTOUPDATER: "1",
        },
        why:
          "the child has an isolated home, only local-coder model aliases, bounded output/context, " +
          "and nonessential traffic, telemetry, error reporting and updates disabled",
      },
      headlessArgv: (request) => {
        const argv = base.headlessArgv({ ...request, model: LOCAL_MODEL });
        const settingSources = argv.indexOf("--setting-sources");
        if (settingSources >= 0 && argv[settingSources + 1] === "project,local") {
          argv[settingSources + 1] = "user";
        }
        return argv.map((part) => (part === "Bash,WebFetch,WebSearch" ? "Bash" : part));
      },
    };
  }

  return {
    ...base,
    id,
    display: "Grok CLI (local-coder via LiteLLM)",
    inheritEnv: false,
    hardening: {
      args: base.hardening?.args ?? [],
      env: {
        ...common,
        ...base.hardening?.env,
        GROK_HOME: join(paths.home, ".grok"),
        LITELLM_API_KEY: key,
        GROK_DEFAULT_MODEL: LOCAL_MODEL,
        GROK_DISABLE_AUTOUPDATER: "1",
        GROK_TELEMETRY_ENABLED: "0",
        GROK_FEEDBACK_ENABLED: "0",
        GROK_FEEDBACK_TRACE_CARD: "0",
        GROK_TELEMETRY_MIXPANEL_ENABLED: "0",
        GROK_TELEMETRY_TRACE_UPLOAD: "0",
        GROK_EXTERNAL_OTEL: "0",
        GROK_AGENT_DASHBOARD: "0",
        GROK_CAMPAIGNS: "0",
        GROK_MEMORY: "0",
        GROK_SUBAGENTS: "0",
        GROK_WEB_FETCH: "0",
        GROK_BACKEND_SEARCH: "0",
        GROK_PROMPT_SUGGESTIONS: "0",
        GROK_SESSION_RECAP: "0",
        GROK_TURN_SUMMARY: "0",
        GROK_TITLE_REFRESH: "0",
        GROK_VOICE_MODE: "0",
        GROK_LSP_TOOLS: "0",
        GROK_CLAUDE_RULES_ENABLED: "0",
        GROK_CURSOR_RULES_ENABLED: "0",
      },
      why:
        `${base.hardening?.why ?? "vendor hardening"}; the child also has an isolated home, ` +
        "a single LiteLLM model, and every measured telemetry/update/hosted feature disabled",
    },
    headlessArgv: (request) => base.headlessArgv({ ...request, model: LOCAL_MODEL }),
  };
}

/**
 * One local CLI backend. `prepare()` is public for wrappers that must decide
 * egress before calling `run`; `run` applies it again so no other caller can
 * accidentally start this backend unfenced.
 */
export class LocalCliExec implements ExecBackend {
  readonly kind = "cli" as const;
  readonly baseUrl: string;
  readonly port: number;
  private readonly ownerHome: string;
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly currentDirectory: () => string;
  private readonly makeCli: (spec: VendorSpec) => ExecBackend;
  private readonly paths: LocalPaths;

  constructor(readonly id: LocalCliId, context: LocalCliContext = {}) {
    this.ownerHome = context.home ?? homedir();
    this.environment = context.env ?? process.env;
    this.currentDirectory = context.cwd ?? (() => process.cwd());
    this.baseUrl = context.baseUrl ?? LITELLM_BASE_URL;
    this.port = portOf(this.baseUrl) ?? 0;
    this.makeCli = context.makeCli ?? ((spec) => new CliExec(spec));
    this.paths = pathsFor(id, this.ownerHome, this.environment);
  }

  get display(): string {
    return this.id === "claude-local"
      ? "Claude Code (local-coder via LiteLLM)"
      : "Grok CLI (local-coder via LiteLLM)";
  }

  get identityStrength(): IdentityStrength {
    return "system";
  }

  /** The real vendor binary must be installed; readiness never spends a model call. */
  available(): Promise<Availability> {
    return this.makeCli(localSpec(this.id, this.paths, this.environment, "", this.baseUrl)).available();
  }

  /** The exact request this local turn will run, including its non-optional fence. */
  prepare(request: TurnRequest): TurnRequest {
    const cwd = request.cwd ?? this.currentDirectory();
    const writable = [this.paths.home, this.paths.scratch];
    if (request.restraint.loosened) writable.push(cwd);
    return {
      ...request,
      cwd,
      env: {},
      fence: { writable, tcpPorts: [this.port] },
    };
  }

  async run(request: TurnRequest): Promise<TurnResult> {
    const startedAt = performance.now();
    const refuse = (reason: string): TurnResult => ({
      backend: this.id,
      text: "",
      confidence: "silent",
      identityStrength: "none",
      evidence: {
        source: this.id,
        prompt: request.prompt,
        raw: reason,
        durationMs: Math.round(performance.now() - startedAt),
        usage: extractUsage(vendor(this.id === "claude-local" ? "claude" : "grok"), "", ""),
      },
    });

    const loopbackProblem = notLoopbackLiteral(this.baseUrl);
    if (loopbackProblem !== undefined || this.port < 1 || this.port > 65_535) {
      return refuse(`refused local backend: ${loopbackProblem ?? "the LiteLLM URL has no usable TCP port"}`);
    }

    const keyPath = liteLLMKeyFile(this.ownerHome, this.environment);
    if (!isAbsolute(keyPath)) {
      return refuse(`${LITELLM_KEY_FILE_ENV} must name an absolute path or a path beginning ~/`);
    }

    let key: string | undefined;
    let masterOnly = false;
    try {
      const source = await readFile(keyPath, "utf8");
      key = parseLiteLLMKey(source);
      masterOnly = key === undefined && parseLiteLLMKey(source, "LITELLM_MASTER_KEY") !== undefined;
    } catch {
      return refuse(`the LiteLLM key file could not be read; configure ${LITELLM_KEY_FILE_ENV}`);
    }
    if (masterOnly) {
      return refuse(
        "the LiteLLM key file holds only LITELLM_MASTER_KEY — refused: a master key controls the whole " +
          "proxy, which is not fenced. Put a virtual key limited to local-coder in LITELLM_API_KEY (D-124).",
      );
    }
    if (key === undefined) {
      return refuse(`the LiteLLM key file has no non-empty LITELLM_API_KEY`);
    }

    try {
      await mkdir(this.paths.home, { recursive: true, mode: STATE_DIR_MODE });
      await chmod(this.paths.home, STATE_DIR_MODE);
      await mkdir(this.paths.scratch, { recursive: true, mode: STATE_DIR_MODE });
      await chmod(this.paths.scratch, STATE_DIR_MODE);
      await writeManaged(
        this.paths.config,
        this.id === "claude-local" ? CLAUDE_SETTINGS : grokConfig(this.baseUrl),
      );
    } catch (cause) {
      return refuse(`the isolated vendor home could not be prepared (${String(cause)})`);
    }

    const spec = localSpec(this.id, this.paths, this.environment, key, this.baseUrl);
    return this.makeCli(spec).run(this.prepare(request));
  }
}

/** Build one of the registered local variants. */
export function localCliBackend(id: string): LocalCliExec {
  if (!isLocalCliId(id)) {
    throw new Error(`unknown local backend ${JSON.stringify(id)} (known: ${LOCAL_BACKENDS.join(", ")})`);
  }
  return new LocalCliExec(id);
}
