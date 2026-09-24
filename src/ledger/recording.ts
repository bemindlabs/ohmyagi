/**
 * The seam where a turn becomes a line.
 *
 * A wrapper around one backend rather than a hook inside `FallbackExec`, for a
 * reason that is the whole design of S2.2: `run` is called exactly when a
 * prompt is really handed over. A backend the chain found `unavailable` never
 * had the text and gets no line; a chain that tried three backends and got an
 * answer from the third produces three lines only if three of them were
 * actually asked. "Who received this prompt?" is the question I-6 turns on,
 * and wrapping `run` is the only place where the answer is a fact rather than
 * an inference from the shape of the chain.
 *
 * Nothing here imports anything from `src/exec/` but types. The ledger must
 * stay provably free of network access (AC4), and a test walks this file's
 * import graph looking for exactly that.
 */

import type { ExecBackend, TurnRequest, TurnResult } from "../exec/backend.ts";
import type { Availability, BackendKind, IdentityStrength } from "../exec/backend.ts";
import { byteLength, LEDGER_VERSION, type LedgerContent, type LedgerEntry } from "./entry.ts";
import { append, type LedgerEnv } from "./store.ts";
import { UNREPORTED_USAGE } from "../types.ts";

export interface RecordingOptions {
  readonly ledger: LedgerEnv;
  /** Shared by every line this one `ohmyagi turn` writes. */
  readonly turnId: string;
  /** Unique per line. Injected so a test does not have to accept a uuid it cannot predict. */
  readonly newId: () => string;
  /** `withheld` is `--private`: the line is written, the text is not. */
  readonly content: LedgerContent;
  /** Model named on the command line, or null when the backend used its own default. */
  readonly model: string | null;
  /** sha256 of the rendered soul this turn wore. */
  readonly soulSha: string | null;
  /**
   * Where a failed write goes.
   *
   * Not a thrown error: {@link ExecBackend} promises never to throw for an
   * ordinary failure, and a caller looping over a chain must not be derailed.
   * Not swallowed either — the caller is expected to print these and exit
   * non-zero, because a turn that happened with no record of it is precisely
   * what S2.2 exists to prevent.
   */
  readonly onWriteFailure: (error: Error) => void;
}

/** One backend, plus a line in the ledger for every prompt it is handed. */
export class RecordingExec implements ExecBackend {
  constructor(
    private readonly inner: ExecBackend,
    private readonly options: RecordingOptions,
  ) {}

  // Every identifying property is the wrapped backend's, so a fallback trail
  // reads `claude: unavailable (…)` and not `recording(claude): …`. Recording
  // is not a backend an operator chose and should not appear as one.
  get id(): string {
    return this.inner.id;
  }
  get display(): string {
    return this.inner.display;
  }
  get kind(): BackendKind {
    return this.inner.kind;
  }
  get identityStrength(): IdentityStrength {
    return this.inner.identityStrength;
  }

  /** Delegated, and never recorded: a readiness probe sends no prompt. */
  available(): Promise<Availability> {
    return this.inner.available();
  }

  async run(request: TurnRequest): Promise<TurnResult> {
    // Taken before the call, so the line says when the prompt left rather than
    // when the answer came back.
    const at = this.options.ledger.now().toISOString();
    const result = await this.inner.run(request);

    try {
      await append(this.options.ledger, this.entryFor(at, request, result));
    } catch (cause) {
      this.options.onWriteFailure(cause instanceof Error ? cause : new Error(String(cause)));
    }
    return result;
  }

  private entryFor(at: string, request: TurnRequest, result: TurnResult): LedgerEntry {
    const withheld = this.options.content === "withheld";
    return {
      v: LEDGER_VERSION,
      kind: "turn",
      id: this.options.newId(),
      turn: this.options.turnId,
      at,
      subject: request.subject,
      // The wrapped backend's id, not `result.backend`: a `FallbackExec` above
      // this one rewrites that field to name the chain, and the line has to
      // say which single backend held the text.
      backend: this.inner.id,
      model: this.options.model,
      content: this.options.content,
      prompt: withheld ? null : request.prompt,
      prompt_bytes: byteLength(request.prompt),
      text: withheld ? null : result.text,
      text_bytes: byteLength(result.text),
      confidence: result.confidence,
      exit: result.evidence.exitCode ?? null,
      duration_ms: result.evidence.durationMs ?? null,
      // See `LedgerEntry.cost`: no figure in a currency is recorded, because
      // every one available is true for some owners and false for others.
      cost: null,
      // A backend that reported nothing still gets a usage object rather than
      // an absent field, so that "written before counts existed" (absent) and
      // "written by a backend nobody surveyed" (`unreported`) stay two
      // different facts a reader can tell apart.
      usage: result.evidence.usage ?? UNREPORTED_USAGE,
      identity: result.identityStrength,
      soul_sha: this.options.soulSha,
    };
  }
}
