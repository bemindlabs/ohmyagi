/**
 * `ohmyagi doctor` — what is installed, what is missing, and what has gone stale.
 *
 * S0.2, and the one command whose whole value is that it never flatters the
 * machine it runs on. Everything here is a read: file reads, `--version` on a
 * binary already on PATH, and two HTTP GETs to loopback. No turn is spent, and
 * no personal data is opened — the data root is not reachable from this file
 * at all, because none of the seven questions AC1-AC7 asks needs it.
 *
 * **om-agi writes nothing here, and that is narrower than "this run changes
 * nothing".** `--version` starts six other programs, and a vendor CLI writes
 * its own cache and config into the home it is given: a sweep on 2026-09-21
 * created three directories under a fresh home, none of them om-agi's. That is
 * in {@link DOCTOR_LIMITS}, `test/cli/doctor.test.ts` measures both halves of
 * it, and `--no-version` is the way out.
 *
 * ## The four decisions that shape it
 *
 * **The exit code is narrow, and narrow on purpose (AC7).** Exit 1 means *the
 * local route is broken*: no ollama, no models, a named model that is not
 * there, or less free VRAM than a named model needs. A commercial CLI that is
 * not installed is a `warn` and nothing more, because I-1 says the route that
 * has to work is the local one — a machine with fewer hands is not a broken
 * machine. The honest demo table already reads that way, with claude and codex
 * silent and the run still counted as a pass.
 *
 * **A version is checked, not just printed.** Every vendor spec carries a
 * {@link VendorSpec.measuredAgainst}, and the registry's own header says those
 * facts move between releases and fail silently when they do. That is not a
 * hypothesis: on 2026-09-21 grok moved 1.0.24 → 1.0.40, renamed two tools, and
 * a deny list that read like a fence in three places stopped being one without
 * anybody finding out. So `doctor` runs `<binary> --version` — the one probe
 * that spends no quota and starts no turn — and reports *drift* as a warning,
 * rather than printing two version strings and leaving the comparison to a
 * reader.
 *
 * **No model id is hard-coded.** `scripts/demo-bare-container.sh` already says
 * why: a model id is a fact about one machine. So the requirement arrives as
 * `--model`, and the only built-in rule is that *some* model must be pulled —
 * zero models is a local route that cannot answer anything.
 *
 * **Nothing is asked of a host.** A remote is reported because it exists, never
 * because om-agi knows what it is. {@link REMOTE_VISIBILITY_LIMIT} is the same
 * sentence `guard status` prints, imported rather than re-written, which is the
 * precedent S0.4 AC1 set when "the repo is private" turned out to be
 * unenforceable.
 *
 * Every machine fact arrives through {@link DoctorEnv} — the home, the
 * environment, `which`, the subprocess runner, the JSON fetcher, both hosts.
 * A test therefore never touches the real machine, and D-021 holds by
 * construction: there is no path, name or account in this file.
 */

import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { dagiStatus } from "./agent/rebuild.ts";
import { enclosingGitRepo } from "./agent/repo.ts";
import {
  notLoopbackLiteral,
  readOnlySummary,
  VENDORS,
  type VendorSpec,
} from "./exec/index.ts";
import { searchTree, type Needle } from "./erase/search.ts";
import { historyFacts, historySentence } from "./guard/history.ts";
import { subjectOfCollection } from "./memory/collection.ts";
import { resolveTargets } from "./soul/targets.ts";
import { formatWorn, wearsOnly, wornReport } from "./soul/worn.ts";
import { REMOTE_VISIBILITY_LIMIT, spawnGuarded } from "./spawn.ts";
import type { SubjectId } from "./types.ts";

/** Where ollama listens when nothing says otherwise. Same default as `OllamaExec`. */
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

/**
 * Where the vector store on this class of machine listens (D-007).
 *
 * A port, not an account: the decision that produced this number recorded a
 * store with one shared collection and no delete, and AC4 asks `doctor` to say
 * so out loud. Overridable, because the next machine's is somewhere else.
 */
export const DEFAULT_QDRANT_HOST = "http://127.0.0.1:10300";

/** Long enough for a cold CLI to print its own version, short enough to fail fast. */
export const PROBE_TIMEOUT_MS = 15_000;
/** Loopback, so anything slower than this is not answering. */
export const HTTP_TIMEOUT_MS = 3_000;

/** Bytes in one MiB — the unit AC3 asks for. */
const MIB = 1024 * 1024;

/**
 * How bad one finding is.
 *
 * Three, not two, and the middle one carries most of the report: `warn` is
 * "true, and you probably want to know", `missing` is "AC7's exit 1". Keeping
 * them apart is what stops a laptop with no GPU from failing a health check it
 * was never going to pass.
 */
export type Severity = "ok" | "warn" | "missing";

/** One thing `doctor` looked at, and what it found. */
export interface Finding {
  /** Stable slug, so `--json` can be matched on without parsing prose. */
  readonly id: string;
  readonly severity: Severity;
  /** Short left-hand label — a backend id, a host, a path. */
  readonly label: string;
  /** One line a human can act on. */
  readonly detail: string;
}

/** One question, its findings, and anything that qualifies them. */
export interface DoctorSection {
  readonly title: string;
  readonly findings: readonly Finding[];
  /** Printed under the findings; never a substitute for one. */
  readonly notes: readonly string[];
}

/** The whole answer. Serialisable as it stands — `--json` prints exactly this. */
export interface DoctorReport {
  readonly sections: readonly DoctorSection[];
  /** {@link DOCTOR_LIMITS}, carried in the report so `--json` gets them too. */
  readonly limits: readonly string[];
}

/** What a short-lived probe produced. */
export interface ProbeRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the process was killed for taking too long. */
  readonly timedOut: boolean;
}

/** What one loopback GET produced: a parsed body, or the reason there is none. */
export type JsonProbe =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * Everything `doctor` is allowed to know about this machine.
 *
 * `which` and `run` are seams rather than direct calls to `Bun.which` and
 * `CliExec.available()` for one reason: a test of this module must be able to
 * describe a machine that does not exist. The default implementations below
 * ({@link pathLookup}, {@link runProbe}, {@link fetchJson}) are what `bin/`
 * passes, and they are the same one-line PATH lookup `CliExec.available()`
 * makes — the vendor facts themselves still come from the registry, so there is
 * no second list of CLIs anywhere.
 */
export interface DoctorEnv {
  readonly home: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * Root of the engine's own checkout — scanned for hard-coded paths (D-021).
   *
   * `undefined` when there is no checkout to scan, which is the ordinary case
   * for the compiled binary: its modules live inside the executable and there
   * is no directory to walk. Required rather than optional so that a caller
   * has to say which it has — passing a path that is not there produced a
   * green `ok clean, 0 file(s)` for as long as this property was a `string`.
   */
  readonly engineRoot: string | undefined;
  readonly which: (binary: string) => string | null;
  readonly run: (argv: readonly string[], timeoutMs: number) => Promise<ProbeRun>;
  readonly getJson: (url: string, timeoutMs: number) => Promise<JsonProbe>;
  readonly ollamaHost: string;
  readonly qdrantHost: string;
  /** Models this machine is required to have. Empty means "any, but at least one". */
  readonly models: readonly string[];
  /** Backend ids whose instruction files are read for AC5. */
  readonly backends: readonly string[];
  /**
   * Whether to ask each installed CLI for its version.
   *
   * A flag rather than always-on, because starting somebody else's program has
   * a cost that was measured rather than guessed: a single `--version` sweep on
   * 2026-09-21 left three new directories under the home it was given — a
   * vendor unpacking native modules into a cache, another writing a projects
   * file, a third creating its config directory. om-agi writes nothing either
   * way; the programs it starts are not om-agi. Turning this off costs the
   * drift check, and the report says so where the versions would have been.
   */
  readonly probeVersions: boolean;
  /** An agent repository to check, when one was named. */
  readonly agent?: string;
  /** Required with `agent`, and what AC5 is asked about when given. */
  readonly subject?: SubjectId;
}

/**
 * What `doctor` does **not** check — printed on every run, never filed away.
 *
 * The rule the rest of this repository already follows: the person reading a
 * green report is exactly the person about to believe it covers more than it
 * does. Every line here is something somebody could reasonably take "the
 * machine is ready" to include, and which this command does not deliver.
 */
export const DOCTOR_LIMITS: readonly string[] = [
  "a version is not a behaviour. `--version` says which release is installed; it does not " +
    "re-measure what that release does with a flag. `ohmyagi soul verify` is the command that " +
    "spends a real turn, and `docs/cli-matrix.md` says how to re-survey a vendor by hand.",
  "the VRAM check is an estimate. It compares free MiB against the size ollama reports for a " +
    "model's own files, and counts neither the KV cache nor the context window — both of which " +
    "grow with the length of a turn. Nor does it know what else is about to load on that GPU.",
  "the store probe is reachability and a list of names. Nothing is read out of a collection, " +
    "nobody is asked who else writes to one, and a collection that is not om-agi's is reported " +
    "as present and nothing more.",
  "hooks are not checked here. `ohmyagi guard status <dir>` is the command that answers whether " +
    "an agent repository's pre-commit and pre-push hooks are installed.",
  "nothing personal is read. `doctor` never opens the data root, a transcript, a captured " +
    "record or a ledger line — none of the questions it answers needs one.",
  "om-agi writes nothing here, and that is not the same as leaving the machine untouched: " +
    "`--version` starts six other programs, and a vendor CLI writes its own cache and config " +
    "into the home it is given. Measured 2026-09-21 — one sweep created three directories under " +
    "a fresh home, none of them om-agi's. `--no-version` skips every one of those probes, and " +
    "costs the drift check with them.",
  "exit 1 is narrow: the local route only (I-1). A vendor CLI that is missing, out of date or " +
    "unable to be held read-only is a warning, because a machine with fewer hands still works. " +
    "`ohmyagi backends` prints what each vendor's read-only flag does and does not cover.",
  "which identity is worn is reported here, not decided here. `ohmyagi worn` is the command " +
    "whose exit code answers that question, and it exits 1 on a half-finished switch.",
  "the engine scan needs the engine's own source on disk, and the compiled binary has none — " +
    "its modules live inside the executable. Run from a binary, that check reports `not " +
    "checked` and says why. Until 2026-09-21 it reported a clean scan of zero files instead, " +
    "which is the shape every check here is written to avoid: a pass earned by looking at nothing.",
  REMOTE_VISIBILITY_LIMIT,
];

// ---------------------------------------------------------------------------
// Parsers — pure, so the arguing happens in a unit test
// ---------------------------------------------------------------------------

/**
 * The first version-shaped token in whatever a CLI printed.
 *
 * Deliberately not per-vendor. Six CLIs print six shapes — `2.1.278 (Claude
 * Code)`, `codex-cli 0.155.1`, `grok 1.0.40 (eb1a2256660d) [stable]`, a bare
 * `0.38.2` — and six little parsers would be six things to keep right for a
 * signal that is only ever a warning. A shape nobody anticipated yields
 * `undefined`, which is reported as "could not read a version", never as drift.
 */
export function parseVersion(text: string): string | undefined {
  // No leading `\b`: `v1.2.3` has no word boundary between the `v` and the `1`,
  // and a vendor that prefixes its version would otherwise read as unparseable.
  // The suffix class excludes `.` so that a four-part version reads as three
  // parts and a leftover rather than as a pre-release nobody published.
  const match = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/.exec(text);
  return match === null ? undefined : match[0];
}

/** One GPU as `nvidia-smi --query-gpu` reports it, in MiB. */
export interface GpuInfo {
  readonly name: string;
  readonly freeMib: number;
  readonly totalMib: number;
}

/**
 * Read `name, free, total` CSV rows, dropping anything that is not three
 * fields and two numbers.
 *
 * Lenient about rows and strict about values: a driver that adds a column
 * should cost this check one GPU, not produce a free-memory figure read out of
 * the wrong field.
 */
export function parseNvidiaSmi(text: string): readonly GpuInfo[] {
  const gpus: GpuInfo[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length !== 3) continue;
    const freeMib = Number(parts[1]);
    const totalMib = Number(parts[2]);
    if (!Number.isFinite(freeMib) || !Number.isFinite(totalMib)) continue;
    if (parts[0] === "") continue;
    gpus.push({ name: parts[0]!, freeMib, totalMib });
  }
  return gpus;
}

/** One model the local daemon holds, and how big its files are. */
export interface OllamaModel {
  readonly name: string;
  /** Bytes as the daemon reports them, or `null` where it reported none. */
  readonly bytes: number | null;
}

/**
 * Read `/api/tags`, or `undefined` when the body is not a model list.
 *
 * `undefined` rather than an empty array, because the two mean opposite
 * things: an empty list is a daemon with nothing pulled (exit 1 — the local
 * route cannot answer), and an unreadable body is a daemon that answered in a
 * shape om-agi does not know. Collapsing them would report a proxy's HTML
 * error page as "no models installed".
 */
export function parseOllamaTags(body: unknown): readonly OllamaModel[] | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return undefined;

  const out: OllamaModel[] = [];
  for (const entry of models) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { name?: unknown; size?: unknown };
    if (typeof record.name !== "string" || record.name === "") continue;
    const size = record.size;
    out.push({
      name: record.name,
      bytes: typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : null,
    });
  }
  return out;
}

/** Collection names out of a Qdrant `/collections` body, or `undefined`. */
export function parseQdrantCollections(body: unknown): readonly string[] | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const result = (body as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return undefined;
  const collections = (result as { collections?: unknown }).collections;
  if (!Array.isArray(collections)) return undefined;

  const names: string[] = [];
  for (const entry of collections) {
    if (typeof entry !== "object" || entry === null) continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name === "string" && name !== "") names.push(name);
  }
  return names;
}

/** Bytes as whole MiB, rounded up — a model that needs 1.5 MiB needs 2. */
export function asMib(bytes: number): number {
  return Math.ceil(bytes / MIB);
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

function ok(id: string, label: string, detail: string): Finding {
  return { id, severity: "ok", label, detail };
}
function warn(id: string, label: string, detail: string): Finding {
  return { id, severity: "warn", label, detail };
}
function missing(id: string, label: string, detail: string): Finding {
  return { id, severity: "missing", label, detail };
}

/** What one vendor's `--version` probe turned into. */
function versionFinding(spec: VendorSpec, path: string, run: ProbeRun): Finding {
  const writes = `writes? ${readOnlySummary(spec)}`;

  if (run.timedOut) {
    return warn(
      `cli.${spec.id}.version`,
      spec.id,
      `installed at ${path}, and did not answer \`--version\` within ${PROBE_TIMEOUT_MS}ms — ` +
        `om-agi cannot tell whether the registry's reading of ${spec.measuredAgainst} still ` +
        `applies · ${writes}`,
    );
  }

  const printed = parseVersion(`${run.stdout}\n${run.stderr}`);
  if (run.code !== 0 || printed === undefined) {
    return warn(
      `cli.${spec.id}.version`,
      spec.id,
      `installed at ${path}, and \`--version\` printed nothing om-agi could read a version out ` +
        `of (exit ${run.code}) · the registry was measured against ${spec.measuredAgainst} · ${writes}`,
    );
  }

  if (printed !== spec.measuredAgainst) {
    return warn(
      `cli.${spec.id}.drift`,
      spec.id,
      `${printed} is installed; the registry was measured against ${spec.measuredAgainst}. ` +
        `Flags, tool names and output shapes move between releases and fail silently when they ` +
        `do — re-survey this vendor (docs/cli-matrix.md, "How to re-measure") before trusting ` +
        `its row · ${writes}`,
    );
  }

  return ok(`cli.${spec.id}`, spec.id, `${printed} at ${path} · ${writes}`);
}

/**
 * AC1 — the CLIs, whether each one answers, and whether the registry's reading
 * of it is still current.
 *
 * The count comes from the registry plus the local daemon's own binary, never
 * from a literal: the backlog's "expect 7" is a reading of one machine on one
 * day, and a test that pinned 7 could not tell a deliberate seventh CLI from an
 * accidental one. What is pinned is the sentence; the number follows it.
 */
async function checkClis(env: DoctorEnv): Promise<DoctorSection> {
  const probes = await Promise.all(
    VENDORS.map(async (spec) => {
      const path = env.which(spec.binary);
      return {
        spec,
        path,
        run:
          path === null || !env.probeVersions
            ? undefined
            : await env.run([spec.binary, "--version"], PROBE_TIMEOUT_MS),
      };
    }),
  );

  const findings: Finding[] = [];
  // Counted as "this binary answered", which is a different question from
  // "the registry's reading of it is current": a vendor that has drifted is
  // still reachable, and reporting it as absent would hide the drift behind a
  // number that looked like a different problem.
  let reachable = 0;
  for (const probe of probes) {
    if (probe.path === null) {
      findings.push(
        warn(
          `cli.${probe.spec.id}.absent`,
          probe.spec.id,
          `${probe.spec.binary} is not on PATH. om-agi works without it — the route that has ` +
            `to keep working is the local one (I-1) — but this vendor cannot be reached from here.`,
        ),
      );
      continue;
    }
    reachable++;
    if (probe.run === undefined) {
      // `--no-version`. Reported in the row rather than silently omitted: an
      // absent check that looks like a passing one is the whole failure mode
      // this command exists to catch.
      findings.push(
        warn(
          `cli.${probe.spec.id}.unchecked`,
          probe.spec.id,
          `installed at ${probe.path}, and not asked for its version (--no-version) — so om-agi ` +
            `cannot say whether the registry's reading of ${probe.spec.measuredAgainst} still ` +
            `applies · writes? ${readOnlySummary(probe.spec)}`,
        ),
      );
      continue;
    }
    findings.push(versionFinding(probe.spec, probe.path, probe.run));
  }

  // The daemon's own binary, which is a different question from whether the
  // daemon is answering — that is the next section's.
  const ollamaPath = env.which("ollama");
  if (ollamaPath === null) {
    findings.push(
      warn(
        "cli.ollama.absent",
        "ollama",
        "not on PATH. That is not fatal by itself: om-agi speaks to the daemon over HTTP and " +
          "never runs this binary, so what matters is the next section.",
      ),
    );
  } else {
    reachable++;
    const printed = env.probeVersions
      ? parseVersion(
          await env
            .run(["ollama", "--version"], PROBE_TIMEOUT_MS)
            .then((run) => `${run.stdout}\n${run.stderr}`),
        )
      : undefined;
    findings.push(
      ok(
        "cli.ollama",
        "ollama",
        `${printed ?? "version not asked for"} at ${ollamaPath} · om-agi reaches the daemon ` +
          `over HTTP, not through this binary`,
      ),
    );
  }

  const expected = VENDORS.length + 1;

  return {
    title: `CLIs — ${reachable} of ${expected} reachable`,
    findings,
    notes: [
      `${expected} is the size of the registry plus the local daemon, not a number typed into ` +
        `this file. Adding a vendor to \`src/exec/registry.ts\` moves it.`,
      "a missing commercial CLI is a warning and never an exit 1: I-1 says the capability that " +
        "must survive is the local one.",
      ...(env.probeVersions
        ? [
            "asking six other programs for their version is not free: each one may write its " +
              "own cache or config into this home. `--no-version` skips the probes and the " +
              "drift check together.",
          ]
        : []),
    ],
  };
}

/** What `checkOllama` found, plus the model list `checkGpu` needs. */
interface OllamaOutcome {
  readonly section: DoctorSection;
  readonly models: readonly OllamaModel[];
}

/**
 * AC2 — the daemon, its models, and the ones the caller says are required.
 *
 * The only section that can produce `missing`, together with the VRAM rule
 * below. That follows from I-1 rather than from taste: if this route is down,
 * there is no capability left that om-agi can promise on its own.
 */
async function checkOllama(env: DoctorEnv): Promise<OllamaOutcome> {
  const findings: Finding[] = [];
  const notes: string[] = [];

  const offMachine = notLoopbackLiteral(env.ollamaHost);
  if (offMachine !== undefined) {
    findings.push(
      warn(
        "ollama.host",
        "host",
        `${env.ollamaHost} is not a loopback literal, so a turn sent here leaves this machine ` +
          `as far as om-agi can tell — ${offMachine}`,
      ),
    );
  }

  const probe = await env.getJson(`${env.ollamaHost}/api/tags`, HTTP_TIMEOUT_MS);
  if (!probe.ok) {
    findings.push(
      missing(
        "ollama.unreachable",
        "daemon",
        `${env.ollamaHost} did not answer /api/tags — ${probe.reason}. This is the route I-1 ` +
          `says must work, so it is the reason this command exits 1.`,
      ),
    );
    return { section: { title: "ollama — the local route", findings, notes }, models: [] };
  }

  const models = parseOllamaTags(probe.body);
  if (models === undefined) {
    findings.push(
      missing(
        "ollama.unreadable",
        "daemon",
        `${env.ollamaHost} answered, but not with a model list om-agi can read. Something is ` +
          `listening on that port; om-agi cannot say it is an ollama.`,
      ),
    );
    return { section: { title: "ollama — the local route", findings, notes }, models: [] };
  }

  if (models.length === 0) {
    findings.push(
      missing(
        "ollama.empty",
        "daemon",
        `${env.ollamaHost} is answering and holds no model at all. A local route with nothing ` +
          `pulled cannot answer anything: \`ollama pull <model>\` first.`,
      ),
    );
    return { section: { title: "ollama — the local route", findings, notes }, models };
  }

  findings.push(
    ok("ollama.daemon", "daemon", `${env.ollamaHost} · ${models.length} model(s) pulled`),
  );

  const byName = new Map(models.map((model) => [model.name, model]));
  for (const wanted of env.models) {
    const found = byName.get(wanted);
    if (found === undefined) {
      findings.push(
        missing(
          `ollama.model.${wanted}`,
          "model",
          `${wanted} was asked for with --model and this daemon does not have it. ` +
            `Pulled here: ${models.map((model) => model.name).join(", ")}`,
        ),
      );
      continue;
    }
    const size = found.bytes === null ? "size unreported" : `${asMib(found.bytes)} MiB on disk`;
    findings.push(ok(`ollama.model.${wanted}`, "model", `${wanted} · ${size}`));
  }

  if (env.models.length === 0) {
    notes.push(
      "no --model was named, so the only rule applied is that at least one model is pulled. " +
        "om-agi does not hold a list of model ids: a model id is a fact about one machine, and " +
        "hard-coding one here would put a machine's configuration in the engine (D-021).",
    );
  }

  return { section: { title: "ollama — the local route", findings, notes }, models };
}

/**
 * AC3 — free VRAM in MiB, and a warning when a named model will not fit.
 *
 * A machine with no NVIDIA GPU is a supported machine, not a broken one, so the
 * absence of `nvidia-smi` is a warning that says what cannot be measured rather
 * than a failure. The requirement only exists when `--model` named one: without
 * a named model there is no number to compare against, and inventing one would
 * be the hard-coding this command refuses everywhere else.
 */
async function checkGpu(env: DoctorEnv, models: readonly OllamaModel[]): Promise<DoctorSection> {
  const findings: Finding[] = [];
  const notes: string[] = [];

  const path = env.which("nvidia-smi");
  if (path === null) {
    return {
      title: "GPU",
      findings: [
        warn(
          "gpu.unmeasurable",
          "nvidia-smi",
          "not on PATH, so om-agi cannot measure VRAM on this machine. A machine without an " +
            "NVIDIA GPU is a supported machine: ollama will answer from whatever it has, more " +
            "slowly.",
        ),
      ],
      notes,
    };
  }

  const run = await env.run(
    ["nvidia-smi", "--query-gpu=name,memory.free,memory.total", "--format=csv,noheader,nounits"],
    PROBE_TIMEOUT_MS,
  );
  const gpus = run.timedOut || run.code !== 0 ? [] : parseNvidiaSmi(run.stdout);

  if (gpus.length === 0) {
    return {
      title: "GPU",
      findings: [
        warn(
          "gpu.unreadable",
          "nvidia-smi",
          `${path} answered with nothing om-agi could read as a GPU row (exit ${run.code}` +
            `${run.timedOut ? ", timed out" : ""}). VRAM is unmeasured rather than zero.`,
        ),
      ],
      notes,
    };
  }

  let freest = 0;
  for (const gpu of gpus) {
    freest = Math.max(freest, gpu.freeMib);
    // The name leads, and the figure follows. A card with nothing free is a
    // real reading, but an `ok` line that opens with `0 ` reads exactly like
    // one that counted nothing because it looked at nothing — which is what
    // the engine check did from the binary until 2026-09-21. No row here
    // begins with a zero, so that shape means one thing wherever it appears.
    findings.push(
      ok(
        `gpu.${gpu.name}`,
        "free",
        `${gpu.name} · ${gpu.freeMib} MiB free of ${gpu.totalMib} MiB`,
      ),
    );
  }

  // The requirement, when there is one: the largest of the named models, sized
  // by what the daemon itself reports about its own files.
  let needMib = 0;
  let needName = "";
  for (const wanted of env.models) {
    const model = models.find((candidate) => candidate.name === wanted);
    if (model === undefined || model.bytes === null) continue;
    const mib = asMib(model.bytes);
    if (mib > needMib) {
      needMib = mib;
      needName = wanted;
    }
  }

  if (needMib === 0) {
    notes.push(
      env.models.length === 0
        ? "no --model was named, so there is no requirement to check this against. Pass " +
            "`--model <id>` to have the free figure compared with what that model's files weigh."
        : "none of the named models has a size the daemon reported, so the free figure above " +
          "stands on its own.",
    );
    return { title: "GPU", findings, notes };
  }

  findings.push(
    freest >= needMib
      ? ok(
          "gpu.fits",
          "headroom",
          `${freest} MiB free ≥ ${needMib} MiB, the size ollama reports for ${needName} — an ` +
            `estimate, see the limits below`,
        )
      : missing(
          "gpu.short",
          "headroom",
          `${freest} MiB free < ${needMib} MiB, the size ollama reports for ${needName}. The ` +
            `model asked for will not fit in what is free — and this figure counts neither the ` +
            `KV cache nor the context window, so the real requirement is larger.`,
        ),
  );

  return { title: "GPU", findings, notes };
}

/**
 * AC4 — the store, and the collection that is not om-agi's.
 *
 * Unreachable is a warning and never an exit 1: recall is S4.1, om-agi is
 * required to work without it, and a machine with no vector store is a machine
 * with one capability fewer. What AC4 actually asks for is the sentence about
 * `docs`, and that sentence is D-007 written down: one shared collection, no
 * per-subject namespace, and an app in front of it with no delete at all.
 */
async function checkQdrant(env: DoctorEnv): Promise<DoctorSection> {
  const notes: string[] = [];
  const probe = await env.getJson(`${env.qdrantHost}/collections`, HTTP_TIMEOUT_MS);

  if (!probe.ok) {
    return {
      title: "vector store",
      findings: [
        warn(
          "qdrant.unreachable",
          "store",
          `${env.qdrantHost} did not answer /collections — ${probe.reason}. om-agi is required ` +
            `to work without recall, so this is a capability that is absent, not a fault.`,
        ),
      ],
      notes,
    };
  }

  const names = parseQdrantCollections(probe.body);
  if (names === undefined) {
    return {
      title: "vector store",
      findings: [
        warn(
          "qdrant.unreadable",
          "store",
          `${env.qdrantHost} answered, but not with a collection list om-agi can read.`,
        ),
      ],
      notes,
    };
  }

  const findings: Finding[] = [
    ok(
      "qdrant.reachable",
      "store",
      // `no collection yet`, in the words `checkAgent` already uses for `no
      // commit yet`, rather than `0 collection(s)`. The rule in
      // `test/cli/binary.test.ts` — no `ok` finding may carry a zero — is not
      // narrowed by a character to let this through: a reachable store holding
      // nothing is the ordinary state of a machine that has just installed one,
      // and the honest thing to print there is a sentence, not a count. This
      // was the one `ok`-with-a-zero left in the whole of `src/` and `bin/`
      // (odd2 §2); the other four are guarded, and `agent.dagi`'s went with
      // `DERIVATIONS` becoming non-empty.
      `${env.qdrantHost} · ${names.length === 0 ? "no collection yet" : `${names.length} collection(s)`}`,
    ),
  ];

  const mine = names.filter((name) => subjectOfCollection(name) !== undefined);
  const theirs = names.filter((name) => subjectOfCollection(name) === undefined);

  for (const name of theirs) {
    findings.push(
      warn(
        `qdrant.foreign.${name}`,
        "not ours",
        `${name} is on this store and is not om-agi's. Nothing personal may be ingested into a ` +
          `collection om-agi did not name: it has no per-subject namespace, and the app in ` +
          `front of this store has no delete at all — so what goes in cannot be withdrawn ` +
          `(D-007, I-4).`,
      ),
    );
  }

  if (mine.length === 0) {
    findings.push(
      warn(
        "qdrant.none-of-ours",
        "none ours",
        `no collection om-agi named is on this store. That is expected today: nothing in this ` +
          `program writes to a store, and S4.1 owes the code that would create one. It is not a ` +
          `fault.`,
      ),
    );
  }
  for (const name of mine) {
    findings.push(ok(`qdrant.ours.${name}`, "ours", `${name} · subject ${subjectOfCollection(name)}`));
  }

  return { title: "vector store", findings, notes };
}

/**
 * AC5 — which identity this machine is wearing.
 *
 * Every line of the answer comes from `src/soul/worn.ts`, which S1.6 built and
 * `ohmyagi worn` already prints. Re-deriving it here would create a second
 * answer to a question that must have exactly one, and "a switch that did not
 * finish" is precisely the shape two answers take on disk (I-3).
 */
async function checkWorn(env: DoctorEnv): Promise<DoctorSection> {
  const targets = await resolveTargets(env.backends, {
    home: env.home,
    cwd: env.cwd,
    env: env.env,
    which: (binary) => Promise.resolve(env.which(binary) !== null),
  });
  const report = await wornReport(targets);

  // The headline comes from `formatWorn` rather than being phrased again here:
  // `ohmyagi worn` prints that exact sentence, and two commands answering the
  // same question in two voices is how a reader ends up comparing them.
  const [headline = ""] = formatWorn(report);
  const findings: Finding[] = [
    report.verdict === "one"
      ? ok("worn.verdict", "wearing", headline)
      : warn("worn.verdict", "wearing", headline),
  ];

  for (const place of report.places) {
    findings.push({
      id: `worn.${place.backend}`,
      severity: place.state === "worn" || place.state === "system-field" ? "ok" : "warn",
      label: place.backend,
      detail:
        place.path === undefined
          ? `${place.state} · ${place.detail}`
          : `${place.state} · ${place.path} — ${place.detail}`,
    });
  }

  if (env.subject !== undefined) {
    const wears = wearsOnly(report, env.subject);
    findings.push(
      wears
        ? ok("worn.asked", "asked", `${env.subject} is what this machine is wearing, everywhere om-agi looked`)
        : warn("worn.asked", "asked", `${env.subject} is not what this machine is wearing`),
    );
  }

  return {
    title: "identity",
    findings,
    notes: [
      ...report.caveats,
      "this is reported, not decided, here: `ohmyagi worn` is the command whose exit code " +
        "answers it, and doctor's own exit code is about the local route (AC7).",
      "two vendors that read the same file are one row. grok reads Anthropic's `CLAUDE.md` by " +
        "design, and copilot and kimi share the working directory's `AGENTS.md` — writing that " +
        "file twice would be a bug, and naming one reader would hide where the identity went.",
    ],
  };
}

/**
 * D-014 and AC6 — is this agent's derived state current, and what remotes exist.
 *
 * Both halves are existing functions: {@link dagiStatus} is the read-only half
 * of `rebuild` (D-014's "doctor must be able to say whether `.dagi/` is
 * stale"), and {@link historyFacts} is what `guard status` counts commits and
 * lists remotes with. Every remote is reported, and the sentence beside it is
 * imported from `src/spawn.ts` rather than written again: om-agi cannot see
 * whether a remote is public, so what it says is that it cannot see.
 *
 * Whether the directory is a repository at all is asked first, and separately.
 * {@link historyFacts} answers 0 commits for a repository that has none and for
 * a directory git refused to read, and an `ok` line carrying the second is the
 * same failure as a clean engine scan of nothing.
 */
async function checkAgent(agent: string, subject: SubjectId): Promise<DoctorSection> {
  const findings: Finding[] = [];
  const notes = [
    REMOTE_VISIBILITY_LIMIT,
    "`.dagi/` is derived and safe to delete at any time (I-2). `stale` costs one " +
      `\`ohmyagi rebuild ${agent} --subject ${subject}\`, not a recovery.`,
  ];

  const status = await dagiStatus(agent, subject);
  findings.push({
    id: "agent.dagi",
    severity: status.state === "fresh" ? "ok" : "warn",
    label: status.state,
    detail: `${agent} — ${status.reason}`,
  });
  for (const path of status.unowned) {
    findings.push(
      warn(
        `agent.unowned.${path}`,
        "unowned",
        `${path} — no derivation produces this; a rebuild would remove it`,
      ),
    );
  }

  // Asked with a `stat` walk rather than a second subprocess — that is what
  // `enclosingGitRepo` is — and asked before the counting, so that a zero can
  // only ever mean "counted, and it was none".
  const repo = await enclosingGitRepo(agent);
  if (repo !== resolve(agent)) {
    findings.push(
      warn(
        "agent.notrepo",
        "not a repo",
        `${agent} is not a git repository${repo === undefined ? "" : `; the nearest one is ${repo}`}. ` +
          `A commit count and a remote list read out of it would both come back empty whether or ` +
          `not that was true, so neither is reported. \`ohmyagi new\` creates the repository.`,
      ),
    );
    return { title: `agent — ${agent}`, findings, notes };
  }

  try {
    const facts = await historyFacts(agent);
    // `enclosingGitRepo` above says this path *is* a repository, so a refusal
    // here means git could not read one that is there — a corrupt config, or
    // `safe.directory` declining a checkout owned by another uid. Reporting
    // that as `ok commits: no commit yet` is what `historyFacts` used to make
    // this function do, and it is a warning rather than an ok (odd2 H3).
    if (!facts.readable) {
      findings.push(warn("agent.git", "git", `${agent} — ${historySentence(facts)}`));
      return { title: `agent — ${agent}`, findings, notes };
    }

    findings.push(
      ok(
        "agent.commits",
        "commits",
        // Never `0 commit(s)`: a repository before its first commit is the
        // expected state after `ohmyagi new`, and it deserves the sentence that
        // says why rather than a zero that looks like a failed count.
        facts.commits === 0
          ? "no commit yet — the first commit is the owner's to make (D-013)"
          : `${facts.commits} commit(s) in this repository`,
      ),
    );
    if (facts.remotes.length === 0) {
      findings.push(ok("agent.remotes", "remotes", "none configured. om-agi never adds one."));
    }
    for (const remote of facts.remotes) {
      findings.push(
        warn(
          `agent.remote.${remote.name}`,
          "remote",
          `${remote.name} → ${remote.url} — an agent repository holds personal data (D-021), ` +
            `and once a commit has been pushed no deletion here can reach the copy on the host.`,
        ),
      );
    }
  } catch (cause) {
    findings.push(
      warn(
        "agent.git",
        "git",
        `${agent} could not be read as a git repository: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }

  return { title: `agent — ${agent}`, findings, notes };
}

/** The engine's own code, in the order it is scanned. */
const ENGINE_TREES: readonly string[] = ["src", "bin", "scripts"];

/**
 * The two that have to be there for a scan to have looked at the engine at all.
 *
 * `scripts/` is not in `package.json`'s `files`, so an installed copy has none
 * and its absence proves nothing. `src/` and `bin/` are the engine.
 */
const REQUIRED_TREES: readonly string[] = ["src", "bin"];

/** A directory on disk, or false for anything else — including what is not there. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * D-021 #4 — a path under this machine's home, hard-coded in the engine.
 *
 * The needle is the home `doctor` was given, never a literal: an engine that
 * named one machine's home in order to look for it would be the very thing it
 * was checking for. The needle text is also never echoed, for the reason
 * `guard scan` never echoes what it matched — a finding printed into a
 * terminal, a CI log and whatever the output was piped to is a finding nobody
 * can take back.
 *
 * ## Why this check can say "not checked"
 *
 * It said `ok clean, 0 file(s)` from the compiled binary for as long as it
 * existed, and the reason is worth keeping written down. `bun build --compile`
 * flattens every module into the executable, `import.meta.dir` becomes a
 * virtual path, and {@link searchTree} counts a root that is not there as zero
 * files and zero hits — correct for `erase`, where "it was deleted" and "it was
 * never there" really are the same fact, and wrong here, where nothing read is
 * nothing known. Three gates now stand between this and the word `ok`: a root
 * the caller could not supply, a root with no `src/` and `bin/` under it, and a
 * scan that read no files. Each of them is a `warn`, never an exit 1 (AC7):
 * a binary that cannot scan itself is not a broken machine, it is a check that
 * has to be run somewhere else.
 */
async function checkEngine(env: DoctorEnv): Promise<DoctorSection> {
  const notes = [
    "the needle is the home this command was given, and it is never printed. A hit is reported " +
      "as a file and a line so that a reader can go and look.",
    "this scans the engine's own `src/`, `bin/` and `scripts/`. An agent repository is the " +
      "place paths and names are *allowed* to be, and is not scanned here.",
    "a scan that read no files is reported as `not checked`, never as clean — the whole value " +
      "of this command is that it does not flatter the machine it runs on.",
  ];

  const unchecked = (detail: string): DoctorSection => ({
    title: "engine",
    findings: [warn("engine.unchecked", "not checked", detail)],
    notes,
  });

  // No checkout: the ordinary case for the compiled binary, whose modules are
  // inside the executable and have no directory to walk.
  if (env.engineRoot === undefined) {
    return unchecked(
      "the engine's own source is not on disk for this process to read — a compiled binary " +
        "carries its modules inside the executable, where there is no directory to walk. " +
        "Nothing was scanned, so nothing here is called clean. Run `doctor` from a checkout of " +
        "the engine to have this answered.",
    );
  }

  // A home of `/`, or none at all, would match every absolute path in the
  // tree. Saying so beats reporting several hundred findings.
  if (env.home === "" || env.home === "/" || basename(env.home) === "") {
    return {
      title: "engine",
      findings: [
        warn(
          "engine.unscannable",
          "home",
          `the home given (${JSON.stringify(env.home)}) is too short to search for — every ` +
            `absolute path in the engine would match it.`,
        ),
      ],
      notes,
    };
  }

  // A root that exists but is not the engine's source. Checked before the walk
  // rather than inferred from the count afterwards, so that the report can say
  // which half is missing.
  const absent: string[] = [];
  for (const where of REQUIRED_TREES) {
    if (!(await isDirectory(join(env.engineRoot, where)))) absent.push(`${where}/`);
  }
  if (absent.length > 0) {
    return unchecked(
      `${absent.join(" and ")} ${absent.length === 1 ? "is" : "are"} not a directory under ` +
        `${env.engineRoot}, so whatever is there is not the engine's source. Nothing was scanned.`,
    );
  }

  const needle: Needle = {
    label: "this machine's home path",
    text: env.home,
    boundary: false,
    // Never echoed: it names the owner of this machine (D-021).
    quotable: false,
  };

  const findings: Finding[] = [];
  let filesRead = 0;
  for (const where of ENGINE_TREES) {
    const scope = await searchTree(where, join(env.engineRoot, where), [needle]);
    filesRead += scope.filesRead;
    for (const hit of scope.hits) {
      findings.push(
        warn(
          `engine.hardcoded.${hit.path}:${hit.line}`,
          "hard-coded",
          `${hit.path}:${hit.line} holds this machine's home path. The engine is designed to be ` +
            `openable (D-021): a path, a name or an account belongs in an agent repository or ` +
            `in configuration, never here.`,
        ),
      );
    }
  }

  // Both trees are there and not one file came out of them. Whatever that is,
  // it is not evidence that the engine is clean.
  if (filesRead === 0) {
    return unchecked(
      `${REQUIRED_TREES.map((where) => `${where}/`).join(" and ")} exist under ` +
        `${env.engineRoot} and hold no file this command could read. Nothing was scanned.`,
    );
  }

  if (findings.length === 0) {
    findings.push(
      ok(
        "engine.clean",
        "clean",
        `${filesRead} file(s) under ${env.engineRoot} hold no path under this machine's home`,
      ),
    );
  }

  return { title: "engine", findings, notes };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** Run every probe and collect what they found. Writes nothing, anywhere. */
export async function runDoctor(env: DoctorEnv): Promise<DoctorReport> {
  const clis = await checkClis(env);
  const ollama = await checkOllama(env);
  const gpu = await checkGpu(env, ollama.models);
  const qdrant = await checkQdrant(env);
  const worn = await checkWorn(env);
  const engine = await checkEngine(env);

  const sections: DoctorSection[] = [clis, ollama.section, gpu, qdrant, worn];
  if (env.agent !== undefined && env.subject !== undefined) {
    sections.push(await checkAgent(env.agent, env.subject));
  }
  sections.push(engine);

  return { sections, limits: DOCTOR_LIMITS };
}

/** Every finding that makes this machine unready, in report order. */
export function blockers(report: DoctorReport): readonly Finding[] {
  return report.sections.flatMap((section) =>
    section.findings.filter((finding) => finding.severity === "missing"),
  );
}

/**
 * AC7 — 0 when this machine can work, 1 when something required is absent.
 *
 * "Required" is the local route and nothing else, which is the whole of the
 * decision: I-1 names that route as the one that has to survive, and a gate
 * that failed on a missing commercial CLI would fail on every machine that is
 * behaving exactly as designed.
 */
export function doctorExit(report: DoctorReport): 0 | 1 {
  return blockers(report).length > 0 ? 1 : 0;
}

const MARK: Record<Severity, string> = { ok: "ok  ", warn: "warn", missing: "FAIL" };

/** The report as lines. Separate from printing so a test can read it. */
export function renderDoctor(report: DoctorReport): readonly string[] {
  const lines: string[] = [];

  for (const section of report.sections) {
    lines.push(section.title);
    for (const finding of section.findings) {
      lines.push(`  ${MARK[finding.severity]} ${finding.label.padEnd(10)} ${finding.detail}`);
    }
    for (const note of section.notes) lines.push(`       - ${note}`);
    lines.push("");
  }

  const stopping = blockers(report);
  lines.push(
    stopping.length === 0
      ? "ready — everything the local route needs is here"
      : `not ready — ${stopping.length} thing(s) the local route needs are missing:`,
  );
  for (const finding of stopping) lines.push(`  ${finding.label}: ${finding.detail}`);

  lines.push("");
  lines.push("What this does not check:");
  for (const limit of report.limits) lines.push(`  - ${limit}`);
  return lines;
}

// ---------------------------------------------------------------------------
// The default seams — what `bin/` passes, and the only code here that touches
// this machine
// ---------------------------------------------------------------------------

/** A PATH lookup, no subprocess: the same one `CliExec.available()` makes. */
export function pathLookup(binary: string): string | null {
  return Bun.which(binary);
}

/**
 * Run a short read-only command and collect both streams.
 *
 * Through {@link spawnGuarded}, like every other subprocess in the engine, and
 * with a timeout of its own because `runGuarded` has none — a CLI that hangs
 * on `--version` would otherwise hang `doctor`.
 */
export async function runProbe(argv: readonly string[], timeoutMs: number): Promise<ProbeRun> {
  let child;
  try {
    child = spawnGuarded(argv);
  } catch (cause) {
    return { code: -1, stdout: "", stderr: String(cause), timedOut: false };
  }

  let timedOut = false;
  const kill = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await child.exited;
    return { code: child.exitCode ?? -1, stdout, stderr, timedOut };
  } finally {
    clearTimeout(kill);
  }
}

/** One loopback GET, parsed, with the reason kept when there is no body. */
export async function fetchJson(url: string, timeoutMs: number): Promise<JsonProbe> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    return { ok: true, body: await response.json() };
  } catch (cause) {
    return { ok: false, reason: String(cause) };
  }
}
