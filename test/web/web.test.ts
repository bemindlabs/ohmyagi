/** D-060 — the page's words, and the server's guards and routes, with no real CLI behind it. */

import { afterEach, describe, expect, test } from "bun:test";
import { PAGE_HTML } from "../../src/web/page.ts";
import { allowedHosts, handler, startWeb, tailnetNames, TOKEN_HEADER, type WebDeps } from "../../src/web/server.ts";
import { ago, excerpt, levelSentence, remoteForPage, triageChips, type AgentInfo, type SettingsState, type ViewState } from "../../src/web/view.ts";
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
  engine: { chain: ["claude", "codex", "ollama"], localModel: "qwen3.8:27b", judge: "qwen3.8:27b", last: { backend: "claude", model: null, when: "just now" } },
};

const SETTINGS: SettingsState = {
  levels: { read: 1, write: 3, run: 0, reach: 1 },
  stopped: false,
  backends: [{ id: "ollama", available: true }, { id: "claude", available: false }],
  defaultTurn: { backend: "ollama", model: null },
  chatUsers: [{ platform: "telegram", userId: "42", label: "me", told: true, added: "just now" }],
  peers: [{ name: "fern", endpoint: "http://127.0.0.1:1/", added: "yesterday" }],
  guards: { judge: "qwen", triage: false, needles: 2 },
  version: { current: "0.4.0", latest: "0.4.0", checked: "just now" },
};

const AGENT: AgentInfo = {
  ok: true, problems: [], name: "Keeper", role: "keeps things", subject: "example", dir: "/a",
  repo: { remote: null, web: null, head: "abc1234", lastCommit: "first", lastCommitAt: "just now" },
  prohibitions: ["never lies"], scope: { does: "d", doesNot: "n" },
  person: { tone: ["warm"], addressesUserAs: "you", refersToSelfAs: ["I"], principles: ["p"], inheritsFrom: [] },
  roleNotes: "r", personNotes: "q", stats: { memories: 1, turns: 0, lastTurn: null, byBackend: [] },
};

const PROFILE = { name: "Keeper", role: "keeps", does: "d", doesNot: "n", prohibitions: ["never lies"], tone: ["warm"], addressesUserAs: "you", refersToSelfAs: ["I"], principles: [], inheritsFrom: [], roleNotes: "", personNotes: "" };

function fakeDeps() {
  const runs: (readonly string[])[] = [];
  const deps: WebDeps = {
    dir: "/a",
    subject: "example",
    turnFlags: ["--backend", "ollama"],
    state: async () => STATE,
    settings: async () => SETTINGS,
    agent: async () => AGENT,
    memories: async () => [{ path: "memory/a.md", title: "A", description: "d", type: "project", bytes: 10, modified: "t" }],
    memoryImport: async (source, write) => {
      runs.push(["memory", "import", source.kind === "url" ? source.url : `${source.name}:${new TextDecoder().decode(source.bytes)}`, write ? "--yes" : "(dry)"]);
      return { code: 0, stdout: "new memory/imported/x.md", stderr: "" };
    },
    models: async () => ({ backends: [{ id: "claude", available: true }, { id: "ollama", available: true }, { id: "kimi", available: false }], chain: ["claude", "codex", "ollama"], defaultTurn: { backend: null, model: null }, models: { claude: ["opus", "sonnet", "haiku"], ollama: ["qwen3.8:27b"], kimi: [] } }),
    memoryGraph: async () => ({ nodes: [{ path: "memory/a.md", title: "A", type: "project", bytes: 10 }, { path: "memory/b.md", title: "B", type: "", bytes: 5 }], edges: [[0, 1, 2]], dangling: 1 }),
    memory: async (path) => (path === "memory/a.md" ? { ok: true, text: "hello" } : { ok: false, reason: "not a memory file" }),
    memoryWrite: async (path, content) => {
      runs.push(["memory", "write", path, content]);
      return { code: 0, stdout: "written", stderr: "" };
    },
    privacy: async () => ({ capture: { on: true, lines: ["capture: on since x"] }, keptIn: [{ when: "now", at: "t", backend: "claude", why: "personal needle #1" }], keptInTotal: 1, needles: 9, judge: "qwen", basis: [{ id: "d858fe8c", basis: "owner", uses: ["memory"], approvedBy: "me", at: "2026-09-25", expires: null, state: "active", note: "" }] }),
    turnDetail: async (tid) => (tid === "11111111-2222-3333-4444-555555555555" ? { asked: "q", answer: "a", backend: "claude", model: null, when: "just now", content: "full" } : undefined),
    profile: async () => ({ ok: true, profile: PROFILE }),
    editProfile: async (profile, write) => {
      runs.push(["soul", "edit", write ? "--yes" : "(dry)", profile.name]);
      return { code: 0, stdout: write ? "Written: name." : "would change: name", stderr: "" };
    },
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
    expect(allowedHosts("100.1.2.3", 9, ["Box.tail1.ts.net", "box", "100.1.2.3"])).toEqual(["100.1.2.3:9", "box.tail1.ts.net:9", "box:9"]);
    const named = handler(deps, "tok", allowedHosts("100.1.2.3", 30701, ["box.tail1.ts.net"]));
    expect((await named(req("/api/state", { host: "box.tail1.ts.net:30701" }))).status).toBe(200);
    expect((await named(req("/api/state", { host: "other.tail1.ts.net:30701" }))).status).toBe(421);
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

describe("tailnet names", () => {
  test("the MagicDNS name and its first label; anything else is none", () => {
    expect(tailnetNames(JSON.stringify({ Self: { DNSName: "Box.tail1.ts.net." } }))).toEqual(["box.tail1.ts.net", "box"]);
    expect(tailnetNames(JSON.stringify({ Self: { DNSName: "box" } }))).toEqual(["box"]);
    expect(tailnetNames(JSON.stringify({ Self: {} }))).toEqual([]);
    expect(tailnetNames("not json")).toEqual([]);
  });

  test("startWeb shows the first name in the link", () => {
    const { deps } = fakeDeps();
    const server = startWeb(deps, { port: 0, names: ["box.tail1.ts.net"] });
    try {
      expect(server.url).toMatch(/^http:\/\/box\.tail1\.ts\.net:\d+\/#t=/);
      const tls = startWeb(deps, { port: 0, names: ["box.tail1.ts.net"], scheme: "https" });
      expect(tls.url).toMatch(/^https:\/\/box\.tail1\.ts\.net:\d+\/#t=/);
      tls.stop();
    } finally {
      server.stop();
    }
  });
});

describe("Settings (the page sets only what a command could, and nothing that needs a phrase)", () => {
  const post = (path: string, body: unknown) => req(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  test("GET /api/settings, behind the token", async () => {
    const { deps } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    expect(await (await h(req("/api/settings"))).json()).toEqual(SETTINGS);
    expect((await h(req("/api/settings", { token: null }))).status).toBe(401);
  });

  test("a level of 0–2 is `autonomy set`; 3, or a category that is not one, runs nothing", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    const ok = (await (await h(post("/api/autonomy", { category: "write", level: 2 }))).json()) as { ok: boolean };
    expect(ok.ok).toBe(true);
    expect(runs).toEqual([["autonomy", "set", "write", "2", "/a", "--subject", "example"]]);
    for (const bad of [{ category: "write", level: 3 }, { category: "write", level: "2" }, { category: "all", level: 1 }, { category: "write" }]) {
      expect((await h(post("/api/autonomy", bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(runs).toHaveLength(1);
  });

  test("removing a chat user or a peer is the remove command; adding has no route", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    await h(post("/api/chat-users/remove", { platform: "telegram", userId: "42" }));
    await h(post("/api/peers/remove", { name: "fern" }));
    expect(runs).toEqual([
      ["chat", "remove", "telegram", "42", "--subject", "example"],
      ["a2a", "remove", "fern", "--subject", "example"],
    ]);
    expect((await h(post("/api/chat-users/remove", { platform: "telegram", userId: "--subject" }))).status).toBe(400);
    expect((await h(post("/api/peers/remove", { name: "../x" }))).status).toBe(400);
    expect((await h(post("/api/chat-users/allow", { platform: "telegram", userId: "7" }))).status).toBe(404);
    expect((await h(post("/api/peers/allow", { name: "x" }))).status).toBe(404);
    expect(runs).toHaveLength(2);
  });

  test("update-check asks; the page's backend and model replace the start flags only when they are names", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    await h(post("/api/update-check", {}));
    expect(runs[0]).toEqual(["update", "--check"]);
    await h(post("/api/turn", { prompt: "hi", backend: "claude,ollama", model: "qwen3.8:27b" }));
    expect(runs[1]!.slice(-4)).toEqual(["--backend", "claude,ollama", "--model", "qwen3.8:27b"]);
    await h(post("/api/turn", { prompt: "hi", backend: "ollama --yes", model: "-x" }));
    expect(runs[2]!.slice(-2)).toEqual(["--backend", "ollama"]);
  });

  test("the page has a Settings tab, and no button that sets a 3", () => {
    expect(PAGE_HTML).toContain('id="tabSettings"');
    expect(PAGE_HTML).toContain('const LEVELS = ["Never", "Ask me first", "Do it, then tell me"];');
    expect(PAGE_HTML).not.toContain("/api/chat-users/allow");
  });
});

describe("Agent and Memories (read-only)", () => {
  test("GET /api/agent, /api/memories and /api/memory; a path that is not a memory is 404", async () => {
    const { deps } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    expect(((await (await h(req("/api/agent"))).json()) as AgentInfo).name).toBe("Keeper");
    expect(((await (await h(req("/api/memories"))).json()) as unknown[]).length).toBe(1);
    expect(await (await h(req("/api/memory?path=memory%2Fa.md"))).json()).toEqual({ text: "hello" });
    expect((await h(req("/api/memory?path=..%2Fsoul%2Fperson.md"))).status).toBe(404);
    expect((await h(req("/api/memory", { token: null }))).status).toBe(401);
  });

  test("search by meaning is `memory search`, and a query cannot become a flag", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    const post = (body: unknown) => req("/api/memory-search", { method: "POST", body: JSON.stringify(body) });
    await h(post({ query: "where is vllm" }));
    await h(post({ query: "--subject other" }));
    expect(runs).toEqual([
      ["memory", "search", "/a", "--subject", "example", "--limit", "8", "where is vllm"],
      ["memory", "search", "/a", "--subject", "example", "--limit", "8", "subject other"],
    ]);
    expect((await h(post({ query: "  " }))).status).toBe(400);
  });

  test("a remote is shown without credentials, and linked when it is a forge", () => {
    expect(remoteForPage("git@github.com:o/r.git")).toEqual({ remote: "git@github.com:o/r.git", web: "https://github.com/o/r" });
    expect(remoteForPage("https://u:secret@github.com/o/r.git")).toEqual({ remote: "https://github.com/o/r.git", web: "https://github.com/o/r" });
    expect(remoteForPage("/srv/git/r.git")).toEqual({ remote: "/srv/git/r.git", web: null });
  });

  test("the page has the four tabs and carries the mascot, which is the file in docs/", async () => {
    for (const id of ["tabHome", "tabAgent", "tabMemories", "tabSettings"]) expect(PAGE_HTML).toContain(`id="${id}"`);
    const { MASCOT_SVG, MASCOT_DATA_URI } = await import("../../src/web/mascot.ts");
    expect(MASCOT_SVG).toBe(await Bun.file(new URL("../../docs/assets/mascot.svg", import.meta.url)).text());
    expect(PAGE_HTML).toContain(MASCOT_DATA_URI);
  });
});

describe("Profile wizard (D-074)", () => {
  const post = (body: unknown) => req("/api/profile", { method: "POST", body: JSON.stringify(body) });
  test("GET the profile; POST is `soul edit`, a dry run unless write is true; a malformed profile runs nothing", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    expect(((await (await h(req("/api/profile"))).json()) as { profile: { name: string } }).profile.name).toBe("Keeper");
    expect(((await (await h(post({ profile: { ...PROFILE, name: "Two" } }))).json()) as { message: string }).message).toBe("would change: name");
    await h(post({ profile: { ...PROFILE, name: "Two" }, write: true }));
    expect(runs).toEqual([["soul", "edit", "(dry)", "Two"], ["soul", "edit", "--yes", "Two"]]);
    expect((await h(post({ profile: { ...PROFILE, disclosesAi: false } }))).status).toBe(400);
    expect((await h(post({ profile: "x" }))).status).toBe(400);
    expect(runs).toHaveLength(2);
    expect(PAGE_HTML).toContain('id="tabProfile"');
  });
});

describe("the console (D-078): a rail on a desk, a bottom bar on a phone, and who answers always shown", () => {
  test("layout, contrast and the engine box", () => {
    expect(PAGE_HTML).toContain('name="viewport" content="width=device-width, initial-scale=1"');
    expect(PAGE_HTML).toContain('<aside class="rail">');
    expect(PAGE_HTML).toContain("@media (max-width:760px)");
    // The bottom bar is fixed to the screen: nothing above it may create a containing block for it.
    const phone = PAGE_HTML.slice(PAGE_HTML.indexOf("@media (max-width:760px)"));
    expect(phone).toMatch(/nav\.tabs\{position:fixed;left:0;right:0;bottom:0/);
    expect(phone.slice(0, phone.indexOf("nav.tabs{position:fixed"))).not.toContain("backdrop-filter");
    expect(PAGE_HTML).toContain('"Show all " + list.length');
    expect(PAGE_HTML).toContain("--onbrand:#1a1200");
    for (const id of ["engChain", "engLocal", "engJudge", "engLast", "engineLine", "statusDot"]) expect(PAGE_HTML).toContain(`id="${id}"`);
    expect(STATE.engine.chain).toEqual(["claude", "codex", "ollama"]);
    // Full width: no cap on main, and the home page laid out by areas — status across, chat beside what waits.
    expect(PAGE_HTML).not.toMatch(/main\{[^}]*max-width/);
    // D-080: the chat holds the left column top to bottom and stays put; everything else scrolls beside it.
    expect(PAGE_HTML).toContain('grid-template-areas:"chat status" "chat wait" "chat recent" "chat sched" "chat term"');
    expect(PAGE_HTML).toMatch(/\.chatpanel\{[^}]*position:sticky;top:16px;height:calc\(100vh - 32px\)/);
    // On a phone the message box sits above the tab bar.
    expect(PAGE_HTML).toMatch(/\.composer\{position:fixed;left:0;right:0;bottom:calc\(62px/);
    expect(PAGE_HTML).toContain('grid-template-areas:"chat" "status" "wait" "recent" "sched" "term"');
  });
});

describe("gaps closed (D-079)", () => {
  test("1: what waits can be filtered and decided in bulk, and a poll does not wipe a note being typed", () => {
    for (const id of ["waitFilter", "waitWho", "waitSelectAll", "bulkBar", "bulkYes", "bulkNo"]) expect(PAGE_HTML).toContain(`id="${id}"`);
    expect(PAGE_HTML).toContain("if (!force && sig === waitSig) return;");
    expect(PAGE_HTML).toContain('confirm("Decline " + ids.length');
  });
});

describe("gaps closed (D-079), 2", () => {
  test("a turn from the ledger by id; anything that is not an id is 404; the chat is kept in this browser", async () => {
    const { deps } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    expect(await (await h(req("/api/turn-detail?id=11111111-2222-3333-4444-555555555555"))).json()).toMatchObject({ asked: "q", answer: "a" });
    expect((await h(req("/api/turn-detail?id=ffffffff-ffff-ffff-ffff-ffffffffffff"))).status).toBe(404);
    expect((await h(req("/api/turn-detail?id=../x"))).status).toBe(404);
    expect((await h(req("/api/turn-detail?id=11111111-2222-3333-4444-555555555555", { token: null }))).status).toBe(401);
    expect(PAGE_HTML).toContain('const CHAT_KEY = "ohmyagi-chat";');
    expect(PAGE_HTML).toContain('id="chatClear"');
  });
});

describe("gaps closed (D-079), 3", () => {
  test("Privacy: GET the picture; revoking a basis is `basis revoke`; recording one has no route", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    expect(((await (await h(req("/api/privacy"))).json()) as { needles: number }).needles).toBe(9);
    const post = (path: string, body: unknown) => req(path, { method: "POST", body: JSON.stringify(body) });
    await h(post("/api/basis/revoke", { id: "d858fe8c" }));
    expect(runs).toEqual([["basis", "revoke", "d858fe8c", "--subject", "example"]]);
    expect((await h(post("/api/basis/revoke", { id: "--subject" }))).status).toBe(400);
    expect((await h(post("/api/basis/record", { basis: "owner" }))).status).toBe(404);
    expect(PAGE_HTML).toContain('id="tabPrivacy"');
  });
});

describe("gaps closed (D-079), 4", () => {
  test("persona review on the page: show is persona show --json, an answer is persona decide, writing is persona adopt", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    await h(req("/api/persona"));
    const post = (path: string, body: unknown) => req(path, { method: "POST", body: JSON.stringify(body) });
    await h(post("/api/persona/decide", { claim: "abcd1234", answer: "yes" }));
    await h(post("/api/persona/adopt", {}));
    await h(post("/api/persona/adopt", { write: true }));
    expect(runs).toEqual([
      ["persona", "show", "--subject", "example", "--json"],
      ["persona", "decide", "abcd1234", "--subject", "example", "--yes"],
      ["persona", "adopt", "/a", "--subject", "example"],
      ["persona", "adopt", "/a", "--subject", "example", "--yes"],
    ]);
    for (const bad of [{ claim: "--yes", answer: "yes" }, { claim: "abcd1234", answer: "maybe" }]) expect((await h(post("/api/persona/decide", bad))).status).toBe(400);
    expect(PAGE_HTML).toContain('id="draftList"');
  });
});

describe("2K audit", () => {
  test("type grows with the screen, cards flow as a masonry wall, bubbles keep a readable width", () => {
    expect(PAGE_HTML).toContain("@media (min-width:1920px){html{font-size:16px}");
    expect(PAGE_HTML).toContain("@media (min-width:2400px){html{font-size:17.5px}");
    expect(PAGE_HTML).toContain(".set{columns:30rem;column-gap:18px}");
    expect(PAGE_HTML).toContain("break-inside:avoid");
    expect(PAGE_HTML).toContain("max-width:min(88%,62rem)");
  });
});

describe("Memories CRUD (D-081)", () => {
  test("save is memory write; delete is memory forget, shown first; a path outside memory/ runs nothing", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    const post = (path: string, body: unknown) => req(path, { method: "POST", body: JSON.stringify(body) });
    expect(((await (await h(post("/api/memory/write", { path: "memory/notes/a.md", content: "# a" }))).json()) as { ok: boolean }).ok).toBe(true);
    await h(post("/api/memory/delete", { path: "memory/notes/a.md" }));
    await h(post("/api/memory/delete", { path: "memory/notes/a.md", write: true }));
    expect(runs).toEqual([
      ["memory", "write", "memory/notes/a.md", "# a"],
      ["memory", "forget", "/a", "--subject", "example", "--file", "memory/notes/a.md"],
      ["memory", "forget", "/a", "--subject", "example", "--file", "memory/notes/a.md", "--yes"],
    ]);
    for (const bad of [{ path: "soul/role.md", content: "x" }, { path: "memory/../x.md", content: "x" }, { path: "memory/a.md" }]) expect((await h(post("/api/memory/write", bad))).status).toBe(400);
    expect((await h(post("/api/memory/delete", { path: "../x" }))).status).toBe(400);
    expect(runs).toHaveLength(3);
    for (const id of ["memNew", "memEdit", "memDelete", "memEditor", "memEdSave"]) expect(PAGE_HTML).toContain(`id="${id}"`);
  });

  test("the map: GET /api/memories/graph, and the page draws it (D-082)", async () => {
    const { deps } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    const g = (await (await h(req("/api/memories/graph"))).json()) as { edges: unknown[]; dangling: number };
    expect(g).toMatchObject({ edges: [[0, 1, 2]], dangling: 1 });
    expect((await h(req("/api/memories/graph", { token: null }))).status).toBe(401);
    for (const id of ["mapCanvas", "mapSpin", "mapReset", "mapToggle", "mapLegend", "mapStats"]) expect(PAGE_HTML).toContain(`id="${id}"`);
    expect(PAGE_HTML).toContain("prefers-reduced-motion: reduce");
  });

  test("fonts come from inside the binary, need no token, and nothing else under /fonts/ does (D-083)", async () => {
    const { deps } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    const res = await h(req("/fonts/electrolize-latin-400.woff2", { token: null }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("font/woff2");
    expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 4))).toBe("wOF2");
    for (const bad of ["/fonts/nope.woff2", "/fonts/../x.woff2", "/fonts/constructor.woff2"]) expect((await h(req(bad, { token: null }))).status).toBe(404);
    expect(PAGE_HTML).toContain('font-family:"Electrolize"');
    expect(PAGE_HTML).toContain('"Electrolize","IBM Plex Sans Thai"');
    expect(PAGE_HTML).not.toContain("${");
  });

  test("import: a file as base64 or a link, checked then written; anything else runs nothing (D-084)", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler(deps, "tok", HOSTS);
    const post = (body: unknown) => req("/api/memory/import", { method: "POST", body: JSON.stringify(body) });
    const ok = (await (await h(post({ name: "notes.md", data: btoa("# hi") }))).json()) as { ok: boolean; message: string };
    expect(ok).toEqual({ ok: true, message: "new memory/imported/x.md" });
    await h(post({ url: "https://example.org/a", write: true }));
    expect(runs).toEqual([
      ["memory", "import", "notes.md:# hi", "(dry)"],
      ["memory", "import", "https://example.org/a", "--yes"],
    ]);
    for (const bad of [{ url: "file:///etc/passwd" }, { name: "x.exe", data: "AA==" }, { name: "a/b.md", data: "AA==" }, { name: "x.md", data: "%%%" }, { name: "x.md", data: "A".repeat(30_000_000) }, {}]) {
      expect((await h(post(bad))).status).toBe(400);
    }
    expect(runs).toHaveLength(2);
    for (const id of ["memImp", "memImport", "memFiles", "memUrl", "memImpGo", "memQueue"]) expect(PAGE_HTML).toContain(`id="${id}"`);
  });

  test("the page's script parses — one bad quote in the template stops every button", () => {
    const scripts = [...PAGE_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });

  test("a bulk selection holds only the cards on screen — never one a filter or \"Show fewer\" hid", () => {
    expect(PAGE_HTML).toContain("for (const id of [...picked]) if (!waitOnScreen.includes(id)) picked.delete(id);");
    expect(PAGE_HTML).toContain("for (const id of waitOnScreen) picked.add(id);");
    expect(PAGE_HTML).not.toContain("for (const p of waitShown()) picked.add(p.id)");
  });

  test("the chat switches backend and model: /api/models, and each one named replaces only its own flag (D-085)", async () => {
    const { deps, runs } = fakeDeps();
    const h = handler({ ...deps, turnFlags: ["--backend", "ollama", "--model", "qwen3.8:27b"] }, "tok", HOSTS);
    const m = (await (await h(req("/api/models"))).json()) as { models: Record<string, string[]>; chain: string[] };
    expect(m.models["claude"]).toEqual(["opus", "sonnet", "haiku"]);
    expect(m.chain).toEqual(["claude", "codex", "ollama"]);
    expect((await h(req("/api/models", { token: null }))).status).toBe(401);
    const turn = (body: unknown) => h(req("/api/turn", { method: "POST", body: JSON.stringify(body) }));
    await turn({ prompt: "a" });
    await turn({ prompt: "b", backend: "claude", model: "opus" });
    await turn({ prompt: "c", model: "typhoon-4b" });
    await turn({ prompt: "d", backend: "claude" });
    await turn({ prompt: "e", backend: "claude; rm -rf /", model: "--yes" });
    const flags = runs.filter((r) => r[0] === "turn").map((r) => r.slice(r.indexOf("--json") + 1).join(" "));
    expect(flags).toEqual([
      "--backend ollama --model qwen3.8:27b",
      "--backend claude --model opus",
      "--backend ollama --model typhoon-4b",
      "--backend claude",
      "--backend ollama --model qwen3.8:27b",
    ]);
    for (const id of ["chatPick", "pickRow", "chatBackend", "chatModel", "chatModelList"]) expect(PAGE_HTML).toContain(`id="${id}"`);
  });

  test("the chat's / commands (D-086): all listed, and every endpoint the page calls is one the server answers", async () => {
    for (const name of ["help", "clear", "retry", "copy", "export", "backend", "model", "status", "waiting", "approve", "decline", "do", "search", "remember", "import", "memories", "autonomy", "stop", "update", "go"]) {
      expect(PAGE_HTML).toContain(`{ name: "${name}", args: `);
    }
    expect(PAGE_HTML).toContain('id="cmdMenu"');
    const server = await Bun.file(new URL("../../src/web/server.ts", import.meta.url)).text();
    const called = [...new Set([...PAGE_HTML.matchAll(/api\("(\/api\/[a-z/-]+)/g)].map((m) => m[1]!))];
    expect(called.length).toBeGreaterThan(15);
    // A plain route is a string; one with an id in it is a pattern with its slashes escaped.
    for (const path of called) expect(server.includes(`"${path}"`) || server.includes(path.split("/").join("\\/")), path).toBe(true);
  });

  test("the tab's icon is Om, from inside the page (CSP allows data: images)", () => {
    expect(PAGE_HTML).toContain('<link rel="icon" type="image/svg+xml" href="data:image/svg+xml');
  });

  test("a refused delete shows the plan and the reason, not the plan alone", async () => {
    const { deps } = fakeDeps();
    const h = handler({ ...deps, run: async () => ({ code: 1, stdout: "1 file(s) would go\n", stderr: "ohmyagi: cannot reach the vectors. Nothing was removed\n" }) }, "tok", HOSTS);
    const out = (await (await h(req("/api/memory/delete", { method: "POST", body: JSON.stringify({ path: "memory/a.md", write: true }) }))).json()) as { ok: boolean; message: string };
    expect(out.ok).toBe(false);
    expect(out.message).toBe("1 file(s) would go\ncannot reach the vectors. Nothing was removed");
  });
});
