/**
 * `ohmyagi web` — the HTTP side (D-060). A page on this machine that a person
 * uses instead of typing commands, and that can do only what those commands
 * can do.
 *
 * Every action is the CLI run as a child (`turn`, `proposal decide`, `proposal
 * triage`, `stop`), handed in as `run` — so the page gets the same refusals,
 * notices and records as the terminal, and no second way to do anything. What
 * stays in the terminal on purpose: raising a category to 3, consenting to
 * capture, releasing the brake, erase. Each needs a phrase typed by the person
 * it concerns, and a button would be the easy path around that.
 *
 * Guarded three ways, because a server on 127.0.0.1 is reachable from any page
 * the same browser opens: a random token in the URL, sent back on every call
 * in a header a cross-site form cannot set; a Host check against DNS
 * rebinding; and loopback by default.
 */

import type { ViewState } from "./view.ts";
import { PAGE_HTML } from "./page.ts";

export const TOKEN_HEADER = "x-ohmyagi-token";

export interface WebDeps {
  readonly state: () => Promise<ViewState>;
  /** Run this engine with arguments; the result of the child. */
  readonly run: (args: readonly string[]) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
  /** The agent directory and subject every action is about. */
  readonly dir: string;
  readonly subject: string;
  readonly turnFlags?: readonly string[];
}

export interface WebServer {
  readonly url: string;
  readonly token: string;
  readonly stop: () => void;
}

const ID = /^[0-9a-f-]{8,64}$/;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/** The Host values this server answers to, and nothing else (DNS rebinding). */
export function allowedHosts(hostname: string, port: number): readonly string[] {
  const names = hostname === "127.0.0.1" || hostname === "localhost" ? ["127.0.0.1", "localhost"] : [hostname];
  return names.map((n) => `${n}:${port}`);
}

/** Last lines of a child's stderr, for a message a person can read. */
function said(stderr: string): string {
  return stderr
    .split("\n")
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").replace(/^ohmyagi:\s*/, "").trim())
    .filter((l) => l !== "")
    .slice(-4)
    .join("\n");
}

export function handler(deps: WebDeps, token: string, hosts: readonly string[]) {
  const place = [deps.dir, "--subject", deps.subject];
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (!hosts.includes(req.headers.get("host") ?? "")) return new Response("wrong host", { status: 421 });

    if (req.method === "GET" && url.pathname === "/") {
      return new Response(PAGE_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (!url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 });
    if (req.headers.get(TOKEN_HEADER) !== token) return json({ error: "this page's link has expired — open the address `ohmyagi web` printed" }, 401);

    if (req.method === "GET" && url.pathname === "/api/state") return json(await deps.state());
    if (req.method !== "POST") return json({ error: "not allowed" }, 405);

    let body: Record<string, unknown> = {};
    try {
      body = ((await req.json()) ?? {}) as Record<string, unknown>;
    } catch {
      // An empty body is fine for the actions that take none.
    }

    if (url.pathname === "/api/turn") {
      const prompt = typeof body["prompt"] === "string" ? body["prompt"].trim() : "";
      const proposal = typeof body["proposal"] === "string" && ID.test(body["proposal"]) ? body["proposal"] : undefined;
      if (prompt === "" || prompt.length > 20_000) return json({ error: "write a message first" }, 400);
      const args = ["turn", ...place, "--prompt", prompt, "--json", ...(deps.turnFlags ?? [])];
      if (proposal !== undefined) args.push("--proposal", proposal);
      const out = await deps.run(args);
      let answer: Record<string, unknown> | undefined;
      try {
        answer = JSON.parse(out.stdout) as Record<string, unknown>;
      } catch {
        answer = undefined;
      }
      if (answer === undefined) return json({ ok: false, error: said(out.stderr) || `it did not answer (exit ${out.code})` }, 200);
      return json({ ok: out.code === 0, text: answer["text"] ?? "", route: answer["route"] ?? "", proposals: answer["proposals"] ?? [], notes: said(out.stderr) });
    }

    const decide = /^\/api\/proposals\/([0-9a-f-]+)\/(approve|refuse|triage)$/.exec(url.pathname);
    if (decide !== null && ID.test(decide[1]!)) {
      const [, id, action] = decide;
      const args =
        action === "triage"
          ? ["proposal", "triage", id!, ...place]
          : ["proposal", "decide", id!, ...place, action === "approve" ? "--approve" : "--refuse"];
      const note = typeof body["note"] === "string" ? body["note"].trim().slice(0, 500) : "";
      if (action !== "triage" && note !== "") args.push("--note", note);
      const out = await deps.run(args);
      return json({ ok: out.code === 0, message: said(out.stderr) || said(out.stdout) });
    }

    if (url.pathname === "/api/stop") {
      const out = await deps.run(["stop", ...place]);
      return json({ ok: out.code === 0, message: said(out.stdout) || said(out.stderr) });
    }
    return json({ error: "not found" }, 404);
  };
}

/** Start listening. Loopback unless a host is named on purpose. */
export function startWeb(deps: WebDeps, options: { readonly port: number; readonly hostname?: string; readonly token?: string }): WebServer {
  const hostname = options.hostname ?? "127.0.0.1";
  const token = options.token ?? crypto.randomUUID().replace(/-/g, "");
  let hosts: readonly string[] = [];
  const server = Bun.serve({ hostname, port: options.port, fetch: (req) => handler(deps, token, hosts)(req) });
  const port = server.port ?? options.port;
  hosts = allowedHosts(hostname, port);
  return { url: `http://${hostname}:${port}/#t=${token}`, token, stop: () => server.stop(true) };
}
