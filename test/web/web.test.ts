/** D-060 — the page's words, and the server's guards and routes, with no real CLI behind it. */

import { afterEach, describe, expect, test } from "bun:test";
import { PAGE_HTML } from "../../src/web/page.ts";
import { allowedHosts, handler, startWeb, TOKEN_HEADER, type WebDeps } from "../../src/web/server.ts";
import { ago, excerpt, levelSentence, triageChips, type ViewState } from "../../src/web/view.ts";
import type { Triage } from "../../src/decide/triage.ts";

const STATE: ViewState = {
  agent: { name: "Keeper", role: "keeps things", subject: "example", dir: "/a" },
  autonomy: { title: "Asks you first", detail: "d", tone: "ask", levels: { read: 1, write: 1, run: 1, reach: 1 } },
  stopped: false,
  waiting: [],
  approved: [],
  triggers: [],
  recent: [],
  canTriage: false,
};

function fakeDeps() {
  const runs: (readonly string[])[] = [];
  const deps: WebDeps = {
    dir: "/a",
    subject: "example",
    turnFlags: ["--backend", "ollama"],
    state: async () => STATE,
    run: async (args) => {
      runs.push(args);
      if (args[0] === "turn") return { code: 0, stdout: JSON.stringify({ text: "hi", route: "answered by ollama", proposals: [] }), stderr: "" };
      return { code: 0, stdout: "", stderr: "ohmyagi: done\n" };
    },
  };
  return { deps, runs };
}

const HOSTS = allowedHosts("127.0.0.1", 30701);
const req = (path: string, init: RequestInit & { token?: string | null; host?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("host", init.host ?? "127.0.0.1:30701");
  if (init.token !== null) headers.set(TOKEN_HEADER, init.token ?? "tok");
  return new Request(`http://127.0.0.1:30701${path}`, { ...init, headers });
};

describe("words", () => {
  test("each level, and the brake above all of them", () => {
    expect(levelSentence(1, false).title).toBe("Asks you first");
    expect(levelSentence(0, false).tone).toBe("stop");
    expect(levelSentence(2, false).title).toBe("Acts, then tells you");
    expect(levelSentence(3, false).title).toBe("Acts on its own");
    const stopped = levelSentence(3, true);
    expect(stopped.title).toBe("Stopped");
    expect(stopped.detail).toContain("ohmyagi autonomy resume");
  });

  test("triage chips in plain words, with doubt said", () => {
    const t = (choice: Triage["risk"]["choice"], confidence: number, reversible: number, personal: number): Triage => ({
      proposal: "p", at: "", model: "m", risk: { choice, confidence, probabilities: {} }, reversible, personal,
    });
    expect(triageChips(t("destructive", 1, 0.1, 0.7)).map((c) => c.text)).toEqual(["Deletes or can't be undone", "Hard to undo", "Touches private info"]);
    expect(triageChips(t("read-only", 0.5, 0.9, 0.1)).map((c) => c.text)).toEqual(["Only looks (unsure)", "Can be undone"]);
    expect(triageChips(t("external", 0.9, 0.9, 0.1))[0]!.tone).toBe("care");
  });

  test("times as a person says them, and one-line excerpts", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(ago("2026-09-24T11:59:50Z", now)).toBe("just now");
    expect(ago("2026-09-24T11:30:00Z", now)).toBe("30 min ago");
    expect(ago("2026-09-24T09:00:00Z", now)).toBe("3 h ago");
    expect(ago("2026-09-23T10:00:00Z", now)).toBe("yesterday");
    expect(ago("2026-09-20T12:00:00Z", now)).toBe("4 days ago");
    expect(ago("2026-08-01T12:00:00Z", now)).toBe("2026-08-01");
    expect(ago("2026-09-24T12:10:00Z", now)).toBe("in 10 min");
    expect(ago("2026-09-25T12:00:00Z", now)).toBe("in 24 h");
    expect(ago("2026-09-30T12:00:00Z", now)).toBe("in 6 days");
    expect(ago("nonsense", now)).toBe("nonsense");
    expect(excerpt(null)).toBe("(not kept)");
    expect(excerpt("line one\nline two")).toBe("line one");
    expect(excerpt("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });

  test("the page puts server values in with textContent, never as HTML, and loads nothing remote", () => {
    expect(PAGE_HTML).not.toContain("innerHTML");
    expect(PAGE_HTML).not.toMatch(/(src|href)=["']https?:/);
    expect(PAGE_HTML).toContain("Only in the terminal");
  });
});

describe("guards", () => {
  test("a wrong Host is refused (DNS rebinding), and the API needs the token", async () => {
    const { deps } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    expect((await h(req("/api/state", { host: "evil.example:30701" }))).status).toBe(421);
    expect((await h(req("/api/state", { token: null }))).status).toBe(401);
    expect((await h(req("/api/state", { token: "wrong" }))).status).toBe(401);
    expect((await h(req("/api/state"))).status).toBe(200);
    expect(allowedHosts("100.1.2.3", 9)).toEqual(["100.1.2.3:9"]);
  });

  test("the page itself carries a strict content policy", async () => {
    const { deps } = fakeDeps();
    const res = await handler(deps, "tok", HOSTS)(req("/", { token: null }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("routes run the CLI and nothing else", () => {
  test("chat is a turn with --json and the page's backend flags; a proposal id is passed only when well formed", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    const res = await (await h(req("/api/turn", { method: "POST", body: JSON.stringify({ prompt: " hello " }) }))).json();
    expect(res).toMatchObject({ ok: true, text: "hi" });
    expect(runs[0]).toEqual(["turn", "/a", "--subject", "example", "--prompt", "hello", "--json", "--backend", "ollama"]);
    await h(req("/api/turn", { method: "POST", body: JSON.stringify({ prompt: "go", proposal: "0123abcd-0000" }) }));
    expect(runs[1]!.slice(-2)).toEqual(["--proposal", "0123abcd-0000"]);
    await h(req("/api/turn", { method: "POST", body: JSON.stringify({ prompt: "go", proposal: "--apply" }) }));
    expect(runs[2]).not.toContain("--proposal");
    expect((await h(req("/api/turn", { method: "POST", body: "{}" }))).status).toBe(400);
  });

  test("approve, refuse, triage and stop map to their commands; a bad id matches nothing", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    await h(req("/api/proposals/abcd1234-1/approve", { method: "POST", body: JSON.stringify({ note: "fine" }) }));
    await h(req("/api/proposals/abcd1234-1/refuse", { method: "POST" }));
    await h(req("/api/proposals/abcd1234-1/triage", { method: "POST" }));
    const stop = await (await h(req("/api/stop", { method: "POST" }))).json();
    expect(runs).toEqual([
      ["proposal", "decide", "abcd1234-1", "/a", "--subject", "example", "--approve", "--note", "fine"],
      ["proposal", "decide", "abcd1234-1", "/a", "--subject", "example", "--refuse"],
      ["proposal", "triage", "abcd1234-1", "/a", "--subject", "example"],
      ["stop", "/a", "--subject", "example"],
    ]);
    expect(stop).toEqual({ ok: true, message: "done" });
    expect((await h(req("/api/proposals/..%2Fx/approve", { method: "POST" }))).status).toBe(404);
    expect((await h(req("/api/state", { method: "DELETE" }))).status).toBe(405);
    expect((await h(req("/nope"))).status).toBe(404);
  });

  test("a turn that printed no JSON comes back as a sentence, not a crash", async () => {
    const deps: WebDeps = {
      ...fakeDeps().deps,
      run: async () => ({ code: 4, stdout: "", stderr: "ohmyagi: nothing was sent — the autonomy dial is at 0 for this turn.\n" }),
    };
    const res = await (await handler(deps, "tok", HOSTS)(req("/api/turn", { method: "POST", body: JSON.stringify({ prompt: "hi" }) }))).json();
    expect(res).toEqual({ ok: false, error: "nothing was sent — the autonomy dial is at 0 for this turn." });
  });
});

describe("listening", () => {
  const started: { stop: () => void }[] = [];
  afterEach(() => {
    for (const s of started.splice(0)) s.stop();
  });

  test("loopback by default, a fresh token each time, the token only in the fragment", async () => {
    const a = startWeb(fakeDeps().deps, { port: 0 });
    const b = startWeb(fakeDeps().deps, { port: 0 });
    started.push(a, b);
    expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#t=[0-9a-f]{32}$/);
    expect(a.token).not.toBe(b.token);
    const port = new URL(a.url).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { [TOKEN_HEADER]: a.token } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ViewState).agent.name).toBe("Keeper");
  });
});
