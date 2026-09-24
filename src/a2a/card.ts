/**
 * The Agent Card — what another agent learns about this one before talking
 * to it (S8.1, A2A 1.0.0, D-016).
 *
 * Built from the soul, never written by hand (AC1), and built from **half** of
 * it: `role.md` only. `person.md` is personal traits and, since D-046, the
 * name of whoever the identity inherits from — none of it goes on a card that
 * anyone who can reach the URL may read (AC2, I-6). The card says the agent is
 * an AI in its description and in a skill tag (I-5), because a peer reading
 * only one of them should not miss it.
 *
 * Nothing here serves the card. E8's gate (S8.3, the egress filter) is not
 * built, and A2A stays off until it is; this module only computes the JSON.
 */

import { renderSoul } from "../soul/render.ts";
import { sha256 } from "../soul/block.ts";
import type { Soul } from "../soul/schema.ts";

/** The protocol version om-agi speaks — the same pin bwoc-a2a has. */
export const A2A_PROTOCOL_VERSION = "1.0.0";

/** Where the card is served, relative to the agent's base URL. */
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";

/** The loopback default in om-agi's port block (D-005: 30700–30799). */
export const DEFAULT_A2A_URL = "http://127.0.0.1:30700";

/** A2A 1.0.0 AgentCard, the subset om-agi fills. */
export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly version: string;
  readonly protocolVersion: string;
  readonly capabilities: { readonly streaming: boolean; readonly pushNotifications: boolean };
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  readonly skills: readonly { readonly id: string; readonly name: string; readonly description: string; readonly tags: readonly string[] }[];
}

/** The sentence every card carries (I-5). */
export const AI_DISCLOSURE = "An AI agent, not a person.";

/**
 * Compute the card. Pure.
 *
 * `version` is the first 12 hex of the rendered soul's sha256: a peer can see
 * the identity changed without being told what it holds.
 */
export function agentCard(soul: Soul, url: string = DEFAULT_A2A_URL): AgentCard {
  const role = soul.role;
  return {
    name: role.name,
    description: `${AI_DISCLOSURE} ${role.role}`,
    url,
    version: sha256(renderSoul(soul)).slice(0, 12),
    protocolVersion: A2A_PROTOCOL_VERSION,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "role",
        name: role.role,
        description: `Does: ${role.scope.does}. Does not: ${role.scope.does_not}.`,
        tags: ["ai-agent", "om-agi"],
      },
    ],
  };
}
