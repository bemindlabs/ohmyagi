/**
 * Running a turn on a vendor CLI — a subprocess that can lie about finishing.
 *
 * Everything defensive in this file exists because of one measured behaviour:
 * these CLIs fail by exiting 0 with nothing to show for it. A missing
 * `--max-turns`, a plan mode nobody can approve, a prompt truncated in the
 * middle — each produces a clean exit and an empty or half answer. So a zero
 * exit code is treated as a claim to be checked, never as a result.
 */

import type {
  Availability,
  ExecBackend,
  IdentityStrength,
  TurnRequest,
  TurnResult,
} from "./backend.ts";
import { classify } from "./backend.ts";
import type { UsageSpec, VendorSpec } from "./registry.ts";
import { restraintRefusal } from "./restraint.ts";
import { procStat } from "../decide/runs.ts";
import { spawnGuarded } from "../spawn.ts";
import { tokenCount, UNREPORTED_USAGE, type Usage } from "../types.ts";

/** Wall-clock ceiling for one turn when the caller names none. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Pull a value out of parsed JSON by a slash-delimited pointer. */
function resolvePointer(document: unknown, pointer: string): unknown {
  let current: unknown = document;
  for (const token of pointer.replace(/^\//, "").split("/")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

/**
 * Find the model's answer in whatever the CLI printed.
 *
 * Tolerant by design: a vendor that changes its JSON shape should degrade to
 * "we got text back", not to a crash that looks like the model failed.
 */
export function extractReply(spec: VendorSpec, stdout: string): string {
  const text = stdout.trim();
  if (text.length === 0 || spec.replyPointers.length === 0) return text;

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return text;
  }

  for (const pointer of spec.replyPointers) {
    const value = resolvePointer(document, pointer);
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return text;
}

/** A spec that named a channel, with nothing found in it. */
const MISSING_USAGE: Usage = Object.freeze({
  status: "missing",
  input: null,
  output: null,
  total: null,
});

/** Sum, or null the moment one part is absent — never a partial sum. */
function sumAll(parts: readonly (number | null)[]): number | null {
  let total = 0;
  for (const part of parts) {
    if (part === null) return null;
    total += part;
  }
  return total;
}

/** Counts out of a vendor that prints them as JSON. */
function jsonUsage(spec: UsageSpec & { shape: "json" }, stream: string): Usage {
  let document: unknown;
  try {
    document = JSON.parse(stream.trim());
  } catch {
    // The spec says there are numbers here and there is not even an object.
    // That is the turn that died before its summary, and it is `missing`.
    return MISSING_USAGE;
  }

  const input = sumAll(spec.input.map((pointer) => tokenCount(resolvePointer(document, pointer))));
  const output = tokenCount(resolvePointer(document, spec.output));
  const total = spec.total === undefined ? null : tokenCount(resolvePointer(document, spec.total));

  // Whatever was found is kept even when the set is incomplete — a half-read
  // line is still worth more to a human than an empty one — but the status
  // says it is incomplete, so nothing downstream can read it as the whole bill.
  const complete = input !== null && output !== null && (spec.total === undefined || total !== null);
  return { status: complete ? "reported" : "missing", input, output, total };
}

/** A count printed as prose: a label line, then the figure on the next line. */
function textUsage(spec: UsageSpec & { shape: "text" }, stream: string): Usage {
  const lines = stream.split("\n");
  // The last occurrence, not the first: a run that printed several summaries
  // ended on the one that counts.
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]!.includes(spec.totalAfterLine)) {
      at = i;
      break;
    }
  }
  if (at === -1 || at + 1 >= lines.length) return MISSING_USAGE;

  const figure = lines[at + 1]!.trim();
  // Tested before it is converted, because `Number("")` is 0 and an empty line
  // after the label would otherwise be recorded as a turn that used nothing.
  if (!/^\d[\d,]*$/.test(figure)) return MISSING_USAGE;
  const total = tokenCount(Number(figure.replace(/,/g, "")));
  if (total === null) return MISSING_USAGE;

  // One number, and the vendor's own: input and output stay null rather than
  // being split out of a total om-agi has no key to split.
  return { status: "reported", input: null, output: null, total };
}

/**
 * Read a turn's token counts out of whatever the CLI printed.
 *
 * Both streams, because the two surveyed vendors use one each, and independent
 * of the exit code, because a turn that failed halfway still spent what it
 * spent. The one property worth stating: **a wrong guess about a vendor's
 * shape produces `missing`, never a wrong number.** Every read goes through
 * {@link tokenCount}, and an incomplete set is labelled as one.
 */
export function extractUsage(spec: VendorSpec, stdout: string, stderr: string): Usage {
  const usage = spec.usage;
  if (usage === null) return UNREPORTED_USAGE;
  const stream = usage.stream === "stdout" ? stdout : stderr;
  return usage.shape === "json" ? jsonUsage(usage, stream) : textUsage(usage, stream);
}

/**
 * End a turn that has run out of time or been cancelled — and reach its
 * grandchildren, which `child.kill()` does not.
 *
 * Measured 2026-09-22: `Subprocess.kill()` signals the direct child only. A
 * vendor CLI that has started something of its own survives it with its parent
 * reassigned to init, which is a timeout that reports a stopped turn and leaves
 * a running one. Since {@link CliExec.run} now spawns detached, the child is its
 * own group leader and the whole group can be addressed — but only after that is
 * *checked*, because a negative pid sent to a group om-agi does not lead is the
 * accident this whole change exists to avoid.
 */
function endTurn(child: Bun.Subprocess<"ignore", "pipe", "pipe">): void {
  const stat = procStat(child.pid);
  if (stat !== null && stat.pgid === child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Gone between the check and the signal, or not permitted. Fall through
      // to the narrow form, which is never worse than doing nothing.
    }
  }
  child.kill();
}

/** A vendor CLI reached as a subprocess. */
export class CliExec implements ExecBackend {
  readonly kind = "cli" as const;

  constructor(private readonly spec: VendorSpec) {}

  get id(): string {
    return this.spec.id;
  }

  get display(): string {
    return this.spec.display;
  }

  get identityStrength(): IdentityStrength {
    return this.spec.identity.strength;
  }

  /**
   * Is the binary on PATH?
   *
   * Deliberately does not run the CLI: a readiness check that spends quota
   * cannot be called in a loop, and `ohmyagi backends` calls it for every
   * vendor on every run. `doctor` (S0.2) asks the same question through an
   * injected `which` seam rather than through this method — it has to be able
   * to describe a machine that does not exist — but the lookup is the same one,
   * and the vendor facts it reports still come from the registry.
   */
  async available(): Promise<Availability> {
    // `Bun.which` is a PATH lookup, not a subprocess — no shell, and nothing
    // to go wrong on a machine whose shell builtins differ.
    const path = Bun.which(this.spec.binary);
    if (path === null) {
      return { ok: false, detail: `${this.spec.binary}: not on PATH` };
    }
    return { ok: true, detail: path };
  }

  async run(request: TurnRequest): Promise<TurnResult> {
    const startedAt = performance.now();

    // The dial, before the argv rather than inside it. A vendor with no
    // read-only mechanism at an acting level of 1 is refused here and nothing
    // is spawned — which is the one case where the dial used to be silently
    // wrong, because there was no flag to add and nobody said so. See
    // `restraintRefusal`.
    const refused = restraintRefusal(this.spec, request.restraint);
    if (refused !== undefined) {
      return {
        backend: this.spec.id,
        text: "",
        confidence: "silent",
        // Nothing started, so the identity reached nowhere — the same answer a
        // failed spawn gives, and for the same reason.
        identityStrength: "none",
        evidence: {
          source: this.spec.id,
          prompt: request.prompt,
          raw: `refused by the autonomy dial: ${refused}`,
          durationMs: Math.round(performance.now() - startedAt),
          usage: extractUsage(this.spec, "", ""),
        },
      };
    }

    const argv = [this.spec.binary, ...this.spec.headlessArgv(request)];

    // Only two vendors accept a system prompt as a flag. For the rest the
    // identity has to already be on disk, and the result says so rather than
    // implying the turn carried it.
    const appendFlag = this.spec.identity.appendPromptFlag;
    const carriedAsFlag = request.system !== undefined && appendFlag !== undefined;
    if (carriedAsFlag) argv.push(appendFlag, request.system!);

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let stdout = "";
    let stderr = "";
    let exitCode: number | undefined;
    let timedOut = false;

    try {
      // Through the guard rather than `Bun.spawn` directly (S0.4 AC2). The
      // argv here is built at run time, which is exactly why the old gate —
      // a regular expression looking for `Bun.spawn(["…"` — could not see this
      // call at all. `spawnGuarded` inspects the argv that is really passed,
      // and always pipes both streams, which is what this call site wanted.
      const child = spawnGuarded(argv, {
        // A CLI resolves its instruction file from the working directory, so a
        // caller that names one means it.
        cwd: request.cwd ?? process.cwd(),
        // A CLI reading its own config is fine; what must not happen is this
        // process's identity leaking into a turn that belongs to a subject.
        // The subject goes last on purpose: a caller's overrides may aim the
        // turn at a different home, but they may not rename whose turn it is.
        env: { ...process.env, ...request.env, OM_AGI_SUBJECT: request.subject },
        // S5.4. Its own process group, so that both `ohmyagi stop` and the
        // command a human is handed reach this CLI *and its children* and
        // nothing else. Measured: without it the group belongs to whatever
        // shell started om-agi. See `GuardedSpawnOptions.detached`.
        detached: true,
      });

      const kill = setTimeout(() => {
        timedOut = true;
        endTurn(child);
      }, timeoutMs);

      const onAbort = () => endTurn(child);
      request.signal?.addEventListener("abort", onAbort, { once: true });

      try {
        [stdout, stderr] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        await child.exited;
        exitCode = child.exitCode ?? undefined;
      } finally {
        clearTimeout(kill);
        request.signal?.removeEventListener("abort", onAbort);
      }
    } catch (cause) {
      // Spawn itself failed — the binary vanished between `available()` and
      // here, the OS refused, or the guard refused (`SpawnRefused`, which
      // carries its reason into `raw` below). That is a failure to run, not a
      // bad answer.
      //
      // The strength is "none" whatever the argv was going to carry: no
      // process started, so the identity reached nowhere. Reporting the
      // channel it *would* have used describes a delivery that never
      // happened — the same shape of lie as reading a login error as the
      // model's answer.
      return {
        backend: this.spec.id,
        text: "",
        confidence: "silent",
        identityStrength: "none",
        evidence: {
          source: this.spec.id,
          prompt: request.prompt,
          raw: `spawn failed: ${String(cause)}`,
          durationMs: Math.round(performance.now() - startedAt),
          // No streams to read, so a vendor with a channel reports `missing`
          // and a vendor without one reports `unreported` — the same two
          // answers the mechanism gives everywhere else, with no special case
          // for "we know why it is empty".
          usage: extractUsage(this.spec, "", ""),
        },
      };
    }

    const durationMs = Math.round(performance.now() - startedAt);
    const text = extractReply(this.spec, stdout);

    // Read here, from both streams, before `raw` below narrows to one of them.
    // `raw` keeps stderr only when stdout came back empty, which is precisely
    // the case codex is not: it answers on stdout and prints its token count
    // on stderr, so anything reading the counts out of `raw` would find them
    // on failed turns and never on successful ones.
    const usage = extractUsage(this.spec, stdout, stderr);

    // A killed process reports no useful exit code, and its empty output is
    // not the model declining to answer — it is us cutting the call off.
    const confidence = timedOut ? "silent" : classify(text, exitCode);

    return {
      backend: this.spec.id,
      text,
      confidence,
      identityStrength: carriedAsFlag
        ? this.spec.identity.strength
        : request.system !== undefined
          ? "user"
          : "none",
      evidence: {
        source: this.spec.id,
        prompt: request.prompt,
        // Keep stderr when stdout is empty: for several of these CLIs the
        // reason a turn produced nothing is only ever on stderr.
        raw: timedOut
          ? `timed out after ${timeoutMs}ms\n${stderr}`.trim()
          : stdout.trim().length > 0
            ? stdout
            : stderr,
        durationMs,
        usage,
        ...(exitCode === undefined ? {} : { exitCode }),
      },
    };
  }
}
