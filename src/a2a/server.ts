/**
 * S8.2 — the receiving side of A2A, and S8.1's card served (D-063).
 *
 * Off unless `ohmyagi a2a serve` runs (S8.3 AC5): there is no other way this
 * agent listens. On loopback unless a host is named. What arrives is refused
 * unless it carries the bearer token of a peer a person allowed (S8.4); what
 * is accepted is written to the ledger and then to the agent's inbox — it is
 * never run. A message from another agent is something the owner reads, and an
 * agent that acted on whatever arrived would be an agent anyone could steer.
 *
 * The second file allowed `Bun.serve`, beside the web page's (D-060).
 */

import { MAX_BODY_BYTES, RPC, ackFor, parseInbound, rpcError, rpcResult, type Inbound } from "./message.ts";
import { peerForBearer, type Peer } from "./peers.ts";

/** A2A 1.0.0's well-known path for the Agent Card. */
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";

export interface A2ADeps {
  readonly agentName: string;
  readonly card: () => Promise<unknown>;
  readonly peers: () => Promise<readonly Peer[]>;
  /** Ledger first, then the inbox. Throws if either cannot be written; the sender is then told. */
  readonly deliver: (peer: Peer, message: Inbound) => Promise<void>;
  /** Told of a call nobody allowed, with no content, so the owner can see who knocked. */
  readonly refused?: (reason: string) => void;
}

const json = (value: unknown, status = 200) => Response.json(value, { status });

export function a2aHandler(deps: A2ADeps) {
  const seen = new Set<string>();
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === AGENT_CARD_PATH) return json(await deps.card());
    if (req.method !== "POST" || url.pathname !== "/") return json(rpcError(null, RPC.invalidRequest, "not found"), 404);

    const length = Number(req.headers.get("content-length") ?? "0");
    if (length > MAX_BODY_BYTES) return json(rpcError(null, RPC.invalidRequest, "too large"), 413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(rpcError(null, RPC.invalidRequest, "too large"), 413);

    const peer = peerForBearer(await deps.peers(), req.headers.get("authorization"));
    if (peer === undefined) {
      deps.refused?.("a call without the token of an allowed peer");
      return json(rpcError(null, RPC.unauthorized, "unknown peer — the owner of this agent has not allowed you"), 401);
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(rpcError(null, RPC.parse, "not JSON"));
    }
    const parsed = parseInbound(body);
    if (!parsed.ok) return json(rpcError(parsed.id, parsed.code, parsed.error));

    const key = `${peer.name}\u0000${parsed.message.messageId}`;
    if (!seen.has(key)) {
      try {
        await deps.deliver(peer, parsed.message);
        seen.add(key);
      } catch (error) {
        return json(rpcError(parsed.message.id, -32603, `not delivered: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    return json(rpcResult(parsed.message.id, ackFor(parsed.message, deps.agentName)));
  };
}

export function startA2A(deps: A2ADeps, options: { readonly port: number; readonly hostname?: string }): { readonly url: string; readonly stop: () => void } {
  const hostname = options.hostname ?? "127.0.0.1";
  const server = Bun.serve({ hostname, port: options.port, fetch: a2aHandler(deps) });
  const port = server.port ?? options.port;
  return { url: `http://${hostname}:${port}/`, stop: () => server.stop(true) };
}
