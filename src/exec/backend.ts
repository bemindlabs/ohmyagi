/**
 * The hand om-agi works with — and the seam that keeps it unowned.
 *
 * I-1 says every capability must have a local path that really works. That is
 * only true if nothing above this file knows whether a turn was served by a
 * vendor CLI over a pipe or by a model on this machine over HTTP. So the
 * interface is written for the *harder* of the two (a subprocess that can
 * hang, exit 0 with nothing, or write its answer to the wrong stream) and the
 * HTTP path conforms to it, rather than the other way round.
 *
 * The acceptance test for this seam is blunt (S0.1 → A5/AC6): take
 * `claude` and `codex` off PATH and the work still finishes on a local model
 * alone.
 */

import type { Confidence, Evidence, SubjectId } from "../types.ts";
import type { Restraint } from "./restraint.ts";

/** How a backend is reached. Callers should not branch on this; reporting may. */
export type BackendKind =
  /** A subprocess: argv, stdio, exit code. */
  | "cli"
  /** An HTTP endpoint on this machine or a reachable host. */
  | "http"
  /**
   * Inference inside the om-agi process (D-002's "grow into native"). Reserved:
   * nothing in `src/` implements it yet. It is here so the day one does, it
   * fits `ExecBackend` as it stands — `test/exec/native-stub.test.ts` compiles
   * and runs a stub against the trait to keep that true (S2.1 AC5).
   */
  | "native";

/**
 * How strongly a backend can carry an identity.
 *
 * Measured per vendor, not assumed. Only some CLIs accept a system prompt on
 * the command line; the rest read a file and treat it as user-level text,
 * which a model may weigh less. om-agi reports the difference instead of
 * pretending the backends are equivalent.
 */
export type IdentityStrength =
  /** Delivered as a real system prompt through a documented flag or field. */
  | "system"
  /** Delivered as user-level instructions in a file the vendor reads. */
  | "user"
  /** No channel at this scope at all. */
  | "none";

/** One turn to run, always on behalf of exactly one subject (AC4). */
export interface TurnRequest {
  /** Whose identity this turn belongs to. Never implicit. */
  readonly subject: SubjectId;
  /** What to ask. Sent verbatim. */
  readonly prompt: string;
  /**
   * Proof that the autonomy dial decided this turn's level (S5.1).
   *
   * Required, with no default, and the requirement is the whole mechanism. A
   * `Restraint` can only be minted by `restrain()` from an `EffectiveDial`, so
   * a turn cannot be composed by code that skipped the file, the environment
   * ceiling, the stop flag and the minimum — `tsc` refuses it rather than a
   * reviewer noticing. The direction is the one that surprises people: the
   * restraint is on by default and this value is what can take it off. See
   * `src/exec/restraint.ts`.
   *
   * Backends that are not a vendor CLI still carry it. They have no read-only
   * flag to drop, but level 0 means *do not run this turn*, and that is a
   * decision about the turn rather than about the vendor.
   */
  readonly restraint: Restraint;
  /**
   * Identity text to carry as a system prompt, when the backend has a channel
   * for it. Backends with `identityStrength === "user"` ignore this and rely
   * on the file `ohmyagi soul apply` wrote; they must say so in the result.
   */
  readonly system?: string;
  /** Vendor model id. Omitted means the backend's own default. */
  readonly model?: string;
  /** Hard wall-clock ceiling. A backend that blows it is `silent`, not `failed`. */
  readonly timeoutMs?: number;
  /** Lets a caller cancel without waiting out the timeout. */
  readonly signal?: AbortSignal;
  /**
   * Environment overrides for a backend that spawns a process.
   *
   * Exists for one measurable reason: the file a vendor CLI reads is chosen by
   * `$HOME` (and `$CODEX_HOME`) at spawn time, so a caller that wants to ask
   * "did the identity in *this* home arrive?" has to be able to say which home.
   * Without it, a turn would silently read the operator's real instruction file
   * while the report talked about another one. Backends reached over HTTP
   * ignore this.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Working directory for a backend that spawns a process.
   *
   * Two of the vendors here resolve their only instruction file against the
   * working directory, so this is part of the same question as `env`.
   */
  readonly cwd?: string;
}

/**
 * What came back, plus enough evidence for a human to disagree with it.
 *
 * S2.1 AC1 asks this interface for `(output, exit_code, duration, cost)`. The
 * first three are `text`, `evidence.exitCode` and `evidence.durationMs`. The
 * fourth is `evidence.usage`, and it is counted in **tokens rather than
 * money** — a decision, not a gap left for later.
 *
 * Money was measurable and was rejected. claude prints `total_cost_usd` and it
 * came back at $0.81 for a two-character answer, nearly all of it the list
 * price of writing 81,000 tokens into a cache that a subscription holder is
 * not billed for. codex quotes API rates the same way. A local model has no
 * bill at all, and writing `0` there would claim that electricity and a
 * GPU-hour are free. Each of those numbers is true for some readers and false
 * for others, with nothing in the line to say which — so none of them is
 * recorded, and the ledger's `cost` field stays null by decision.
 *
 * Tokens survive that test because they are read rather than priced: they are
 * what the backend itself printed about its own turn.
 */
export interface TurnResult {
  readonly backend: string;
  /** The model's answer, extracted from whatever shape the vendor printed. */
  readonly text: string;
  /**
   * Note that `silent` is a distinct outcome from `failed`: a CLI that exits 0
   * having printed nothing has not failed at the task, it has failed to run,
   * and the two need different fixes.
   */
  readonly confidence: Confidence;
  readonly evidence: Evidence;
  /** How the identity actually reached this turn. */
  readonly identityStrength: IdentityStrength;
}

/** Whether a backend can be used right now, and why not when it cannot. */
export interface Availability {
  readonly ok: boolean;
  /** One line a human can act on. */
  readonly detail: string;
  /** Vendor version string when cheaply obtainable. */
  readonly version?: string;
}

/**
 * A place a turn can be sent.
 *
 * Implementations must not throw for an unavailable backend or a failed turn —
 * both are results. Throwing is reserved for programmer error, so that a
 * caller looping over every backend cannot be derailed by one of them missing.
 */
export interface ExecBackend {
  readonly id: string;
  readonly display: string;
  readonly kind: BackendKind;
  /** The strongest channel this backend offers for identity. */
  readonly identityStrength: IdentityStrength;

  /** Cheap readiness check. Must not run a turn or spend quota. */
  available(): Promise<Availability>;

  /** Run one turn. Never throws for an ordinary failure. */
  run(request: TurnRequest): Promise<TurnResult>;
}

/**
 * Classify what a backend produced — as far as this layer can honestly tell.
 *
 * This layer can distinguish "a reply arrived" from "nothing did". It cannot
 * tell whether a reply is *right*: that needs to know what was asked, which
 * only the caller does. So `failed` is never returned here. A caller that can
 * judge the content narrows `confirmed` to `failed` itself.
 *
 * The return type says so as well as the prose does. It is deliberately
 * narrower than `Confidence`: a rule a comment states is a rule a test has to
 * catch after the fact, and this one is worth having `tsc` refuse.
 *
 * A non-zero exit means the CLI did not finish its turn. Whatever it printed
 * is diagnostics — "Not logged in", a usage error, a stack trace — not an
 * answer, and reading it as one is the mistake this function used to make:
 * an unauthenticated CLI was reported as a model that answered wrongly, and
 * the report went on to blame the identity channel for a login problem. Two
 * different faults, two different fixes, and the wrong one named.
 */
export function classify(text: string, exitCode: number | undefined): "confirmed" | "silent" {
  if (exitCode !== undefined && exitCode !== 0) return "silent";
  if (text.trim().length === 0) return "silent";
  return "confirmed";
}
