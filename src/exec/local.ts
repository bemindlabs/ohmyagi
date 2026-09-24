/**
 * The one door data flagged `personal` may leave by, and how wide it really is.
 *
 * S3.5 AC4 as written says *data flagged `personal` must never leave this
 * machine — only a local model may be chosen*. The second half is the half
 * that can be built. The first is a claim about a machine, and this file is
 * code on that machine; the honest version of the criterion, and the one the
 * engine and the docs now state, is:
 *
 * > a `Personal<T>` reaches a backend through exactly one function,
 * > {@link runPersonal}, which only accepts a backend {@link asLocal} minted —
 * > and `asLocal` mints only an ollama talking to a loopback **literal**.
 *
 * ## Why a type alone could never have done it
 *
 * `BackendKind` defines `"http"` as *"an HTTP endpoint on this machine **or a
 * reachable host**"*, and `OllamaExec` takes its host from `OLLAMA_HOST`
 * without checking it. So "ollama is the local backend" is a sentence that can
 * be false at run time, on a machine nobody has misconfigured on purpose —
 * `OLLAMA_HOST=http://gpu-box.internal:11434` is a normal thing to export.
 *
 * Locality is therefore a run-time fact, and a type can only ever hold
 * *evidence that it was checked*. That is exactly the pattern `SubjectId`
 * already uses: one constructor, one validation, a brand that means "this went
 * through it". {@link LocalBackend} is the same shape, and {@link asLocal} is
 * the only constructor.
 *
 * ## What `asLocal` accepts, and why each refusal
 *
 * - **`OllamaExec` only, by `instanceof`** — not by `id === "ollama"`. An id is
 *   a string any wrapper can copy, and one already does: `RecordingExec`
 *   forwards the wrapped backend's `id` verbatim, which is correct for a
 *   fallback trail and would be a forged passport here.
 * - **A loopback literal host** — `127.0.0.0/8` or `[::1]`. `localhost` is
 *   refused: it is a *name*, and a name is resolved by whatever `/etc/hosts`,
 *   NSS and the resolver say at the moment of the call.
 * - **Everything else refused outright** — `CliExec` spawns a vendor CLI whose
 *   whole purpose is to reach a cloud; `FallbackExec` is a chain that may end
 *   anywhere; `RecordingExec` writes to the state root, which is not the
 *   personal directory, and a prompt flagged personal landing in the ledger
 *   would be the leak with a record of itself.
 *
 * ## What this does not prove — stated here, in {@link LOCAL_LIMITS}, and
 * printed by `observe status`
 *
 * **Loopback is not the same thing as local.** `127.0.0.1:11434` can be an ssh
 * tunnel, a socat forward or a proxy, and om-agi cannot tell one from an
 * ollama. **An ollama can relay for you**: models whose names end `-cloud` are
 * served by the daemon forwarding the turn to a hosted endpoint, and from
 * inside this process that turn is indistinguishable from a local one.
 *
 * om-agi does **not** try to detect that, and the reason is a measurement
 * rather than an oversight. On 2026-09-21 the owner checked this machine's
 * ollama: it holds no `*-cloud` model at all, and `/api/show` for the local
 * models returns no field naming a remote or a host. A check written against
 * that shape could not have been fired once, and a guard that has never been
 * fired is a guard nobody knows the state of — which is the failure this whole
 * story is about. So the risk is declared and left visible instead.
 */

import { notLoopbackLiteral } from "../loopback.ts";
import type { Personal } from "../types.ts";
import { flagPersonal, unwrapPersonal } from "../types.ts";
import type { ExecBackend, TurnRequest, TurnResult } from "./backend.ts";
import { OllamaExec } from "./ollama-exec.ts";

/** Re-exported: callers that already import it from here keep working. */
export { notLoopbackLiteral };

/** Module-private, so the brand cannot be written by hand from outside. */
declare const VERIFIED_LOCAL: unique symbol;

/**
 * A backend that was checked, once, and found to be talking to a loopback
 * literal on this machine. Mint through {@link asLocal} and nowhere else.
 */
export type LocalBackend = ExecBackend & { readonly [VERIFIED_LOCAL]: "loopback-literal" };

/** One turn whose prompt is the owner's. The only shape {@link runPersonal} takes. */
export interface PersonalTurnRequest extends Omit<TurnRequest, "prompt"> {
  /** Boxed on purpose: `TurnRequest.prompt` is a `string` and this is not one. */
  readonly prompt: Personal<string>;
}


/** Why this backend is not usable for personal data, or `undefined` when it is. */
export function notLocal(backend: ExecBackend): string | undefined {
  if (!(backend instanceof OllamaExec)) {
    return (
      `${backend.id} is not an OllamaExec. Checked by instanceof rather than by id, because a ` +
      `wrapper can copy an id — RecordingExec forwards the one it wraps — and a copied id is ` +
      `not evidence of anything about where a turn goes.`
    );
  }
  return notLoopbackLiteral(backend.host);
}

/**
 * Mint a {@link LocalBackend}, or `undefined` with the reason on the side.
 *
 * Returns the same object it was handed, re-typed. There is nothing to wrap:
 * the value of this function is that it is the only place the check happens,
 * not that it builds something new.
 */
export function asLocal(backend: ExecBackend): LocalBackend | undefined {
  return notLocal(backend) === undefined ? (backend as LocalBackend) : undefined;
}

/**
 * Run one turn with the owner's own data in it.
 *
 * The reply is boxed too. A model asked about personal data answers *from* it,
 * and treating the answer as ordinary text would be a way to launder the
 * prompt in one hop — which is the shape most leaks actually take.
 */
export async function runPersonal(
  local: LocalBackend,
  request: PersonalTurnRequest,
): Promise<Personal<TurnResult>> {
  const result = await local.run({ ...request, prompt: unwrapPersonal(request.prompt) });
  return flagPersonal(result);
}

/**
 * What the door above does not close — printed by `observe status`, never only
 * written down here.
 *
 * Each line is something a reader could reasonably take "personal data cannot
 * leave this machine" to include, and which this code does not deliver.
 */
export const LOCAL_LIMITS: readonly string[] = [
  "loopback is not the same as local. 127.0.0.1:11434 can be an ssh tunnel, a socat forward or " +
    "a proxy, and nothing in this process can tell one of those from an ollama.",
  "an ollama can relay. A model whose name ends `-cloud` is served by the local daemon " +
    "forwarding the turn to a hosted endpoint, and that turn looks local from here. om-agi does " +
    "not check for it: measured on this machine 2026-09-21, no such model was installed and " +
    "/api/show returned no field naming a remote or a host — so a check written against that " +
    "shape could never have been fired, and an unfired guard is one nobody knows the state of.",
  "the flag stops at the door. Once `unwrapPersonal` has produced a string, it is a string: no " +
    "JavaScript type system follows it into a log line, a template or a JSON.stringify.",
  "a process running as this user can read the files directly. A vendor CLI om-agi spawns for " +
    "an ordinary turn has its own tools and the same uid; mode 0600 is not a boundary against it.",
];
