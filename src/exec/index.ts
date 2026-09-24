/**
 * Assembling hands out of the pieces.
 *
 * Two factories and the re-exports, nothing else. The fallback chain used to
 * live here and no longer does: ninety lines of decision-making sat behind a
 * coverage exemption that called this file a re-export barrel, which it was
 * not. It is in `fallback.ts` now, where the gate can see it.
 */

import type { ExecBackend } from "./backend.ts";
import { CliExec } from "./cli-exec.ts";
import { OllamaExec } from "./ollama-exec.ts";
import { VENDORS, vendor } from "./registry.ts";

export * from "./backend.ts";
export * from "./registry.ts";
export {
  loosenedNote,
  probeRestraint,
  restrain,
  restraintRefusal,
  type Restraint,
} from "./restraint.ts";
export { CliExec, extractReply } from "./cli-exec.ts";
export { OllamaExec } from "./ollama-exec.ts";
export { FallbackExec, fallbackTrail } from "./fallback.ts";
export {
  AnnouncedExec,
  announceEgress,
  dispatchAnnounced,
  EGRESS_LIMITS,
  EGRESS_NOTICE_PREFIX,
  egressLine,
  egressTarget,
  turnChain,
  type EgressNotice,
  type EgressOptions,
  type EgressTarget,
} from "./egress.ts";
export {
  asLocal,
  LOCAL_LIMITS,
  notLocal,
  notLoopbackLiteral,
  runPersonal,
  type LocalBackend,
  type PersonalTurnRequest,
} from "./local.ts";

/** Build a backend by id. `ollama` is local; everything else is a vendor CLI. */
export function backend(id: string, options: { readonly model?: string } = {}): ExecBackend {
  if (id === "ollama") {
    return new OllamaExec(options.model === undefined ? {} : { defaultModel: options.model });
  }
  return new CliExec(vendor(id));
}

/** Every backend om-agi can build, local one included. */
export function allBackends(): ExecBackend[] {
  return [new OllamaExec(), ...VENDORS.map((spec) => new CliExec(spec))];
}
