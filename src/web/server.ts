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

import type { MemoryEntry } from "./memories.ts";
import { readProfile, type Profile } from "../soul/profile.ts";
import type { AgentInfo, SettingsState, ViewState } from "./view.ts";
import { PAGE_HTML } from "./page.ts";

export const TOKEN_HEADER = "x-ohmyagi-token";

export interface WebDeps {
  readonly state: () => Promise<ViewState>;
  readonly settings: () => Promise<SettingsState>;
  readonly agent: () => Promise<AgentInfo>;
  readonly memories: () => Promise<readonly MemoryEntry[]>;
  readonly memory: (path: string) => Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string }>;
  /** The soul on every axis, or why it does not load. */
  readonly profile: () => Promise<{ readonly ok: true; readonly profile: Profile } | { readonly ok: false; readonly reason: string }>;
  /** `soul edit` with this profile — a dry run unless `write`. */
  readonly editProfile: (profile: Profile, write: boolean) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
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
const CATEGORIES = ["read", "write", "run", "reach"];
/** A backend chain as `turn --backend` takes it, and a model name — nothing a shell or a flag could be smuggled in. */
const BACKEND_CHAIN = /^[a-z][a-z0-9-]{0,20}(,[a-z][a-z0-9-]{0,20}){0,5}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/** The Host values this server answers to, and nothing else (DNS rebinding). */
export function allowedHosts(hostname: string, port: number, extra: readonly string[] = []): readonly string[] {
  const names = hostname === "127.0.0.1" || hostname === "localhost" ? ["127.0.0.1", "localhost"] : [hostname];
  return [...new Set([...names, ...extra.map((n) => n.toLowerCase())])].map((n) => `${n}:${port}`);
}

/**
 * This machine's names on a tailnet, from `tailscale status --self --json`:
 * the MagicDNS name and its first label. A page bound to the tailnet address
 * answers to them too — they point at the same address, and a person types
 * the name, not the number.
 */
export function tailnetNames(statusJson: string): readonly string[] {
  try {
    const dns = (JSON.parse(statusJson) as { Self?: { DNSName?: unknown } }).Self?.DNSName;
    if (typeof dns !== "string" || dns === "") return [];
    const full = dns.replace(/\.$/, "").toLowerCase();
    const short = full.split(".")[0]!;
    return short === full ? [full] : [full, short];
  } catch {
    return [];
  }
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
    if (req.method === "GET" && url.pathname === "/api/settings") return json(await deps.settings());
    if (req.method === "GET" && url.pathname === "/api/agent") return json(await deps.agent());
    if (req.method === "GET" && url.pathname === "/api/profile") return json(await deps.profile());
    if (req.method === "GET" && url.pathname === "/api/memories") return json(await deps.memories());
    if (req.method === "GET" && url.pathname === "/api/memory") {
      const read = await deps.memory(url.searchParams.get("path") ?? "");
      return read.ok ? json({ text: read.text }) : json({ error: read.reason }, 404);
    }
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
      // The page may name a backend and a model (Settings); anything that is not
      // one is ignored and the flags `ohmyagi web` was started with apply.
      const backend = typeof body["backend"] === "string" && BACKEND_CHAIN.test(body["backend"]) ? body["backend"] : undefined;
      const model = typeof body["model"] === "string" && MODEL.test(body["model"]) ? body["model"] : undefined;
      const flags = backend === undefined && model === undefined ? (deps.turnFlags ?? []) : [...(backend === undefined ? [] : ["--backend", backend]), ...(model === undefined ? [] : ["--model", model])];
      const args = ["turn", ...place, "--prompt", prompt, "--json", ...flags];
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

    // Settings. Each is the command a person would type; the page adds nothing.
    if (url.pathname === "/api/autonomy") {
      const category = body["category"];
      const level = body["level"];
      if (typeof category !== "string" || !CATEGORIES.includes(category)) return json({ error: "no such category" }, 400);
      // 3 is typed at a terminal (D-042); the child would refuse it anyway, and
      // the page should not even look like a way to try.
      if (level !== 0 && level !== 1 && level !== 2) return json({ error: "the page sets 0, 1 or 2 — a 3 is typed in a terminal" }, 400);
      const out = await deps.run(["autonomy", "set", category, String(level), ...place]);
      return json({ ok: out.code === 0, message: said(out.stderr) || said(out.stdout) });
    }
    if (url.pathname === "/api/chat-users/remove") {
      const platform = body["platform"];
      const userId = body["userId"];
      if (typeof platform !== "string" || !/^[a-z]{1,20}$/.test(platform) || typeof userId !== "string" || !/^[1-9]\d{0,15}$/.test(userId)) return json({ error: "no such person" }, 400);
      const out = await deps.run(["chat", "remove", platform, userId, "--subject", deps.subject]);
      return json({ ok: out.code === 0, message: said(out.stdout) || said(out.stderr) });
    }
    if (url.pathname === "/api/peers/remove") {
      const name = body["name"];
      if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) return json({ error: "no such peer" }, 400);
      const out = await deps.run(["a2a", "remove", name, "--subject", deps.subject]);
      return json({ ok: out.code === 0, message: said(out.stdout) || said(out.stderr) });
    }
    // D-074: the Profile wizard. `soul edit` checks the result loads — the
    // firewall included — and writes only when asked to.
    if (url.pathname === "/api/profile") {
      const read = readProfile(body["profile"]);
      if (!read.ok) return json({ ok: false, message: read.problems.join("\n") }, 400);
      const out = await deps.editProfile(read.profile, body["write"] === true);
      return json({ ok: out.code === 0, message: said(out.stdout) || said(out.stderr), problems: out.code === 0 ? "" : said(out.stderr) });
    }
    // Search by meaning is `memory search`: both indexes, each hit saying which found it.
    if (url.pathname === "/api/memory-search") {
      // Leading dashes off: a query is words, never a flag.
      const query = typeof body["query"] === "string" ? body["query"].trim().replace(/^-+\s*/, "") : "";
      if (query === "" || query.length > 500) return json({ error: "type what to look for" }, 400);
      const out = await deps.run(["memory", "search", ...place, "--limit", "8", query]);
      return json({ ok: out.code === 0, text: out.stdout.trim(), message: said(out.stderr) });
    }
    if (url.pathname === "/api/update-check") {
      const out = await deps.run(["update", "--check"]);
      return json({ ok: out.code === 0, message: said(out.stdout) || said(out.stderr) });
    }

    if (url.pathname === "/api/stop") {
      const out = await deps.run(["stop", ...place]);
      return json({ ok: out.code === 0, message: said(out.stdout) || said(out.stderr) });
    }
    return json({ error: "not found" }, 404);
  };
}

/** Start listening. Loopback unless a host is named on purpose. */
export function startWeb(
  deps: WebDeps,
  options: { readonly port: number; readonly hostname?: string; readonly token?: string; readonly names?: readonly string[]; readonly scheme?: "http" | "https" },
): WebServer {
  const hostname = options.hostname ?? "127.0.0.1";
  const token = options.token ?? crypto.randomUUID().replace(/-/g, "");
  let hosts: readonly string[] = [];
  const server = Bun.serve({ hostname, port: options.port, fetch: (req) => handler(deps, token, hosts)(req) });
  const port = server.port ?? options.port;
  hosts = allowedHosts(hostname, port, options.names ?? []);
  const shown = options.names?.[0] ?? hostname;
  return { url: `${options.scheme ?? "http"}://${shown}:${port}/#t=${token}`, token, stop: () => server.stop(true) };
}
