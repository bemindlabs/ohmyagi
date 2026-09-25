/**
 * The one page `ohmyagi web` serves (D-060). Self-contained — no build step,
 * no CDN — so it ships inside the single binary and works offline.
 *
 * Written for a person, not an operator: plain sentences, the thing that needs
 * them first, one obvious button per decision, and every value from the
 * server put on the page with `textContent`, never as HTML.
 */

import { MARKDOWN_CSS, MARKDOWN_JS } from "./markdown.ts";
import { MASCOT_DATA_URI } from "./mascot.ts";

export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Oh My AGI</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1d2330;--muted:#5d6678;--line:#e3e6ec;--brand:#c77d0a;--ok:#1f7a4d;--okbg:#e7f5ee;--warn:#b42318;--warnbg:#fdecea;--care:#8a5a00;--carebg:#fff4de;--calmbg:#eef2f7;--focus:#2f6feb}
@media (prefers-color-scheme:dark){:root{--bg:#0f131a;--card:#171c25;--ink:#e8ebf1;--muted:#9aa3b5;--line:#262d3a;--brand:#f0a830;--ok:#56c28f;--okbg:#12291f;--warn:#ff7a6e;--warnbg:#2e1614;--care:#f0b95a;--carebg:#2a2112;--calmbg:#1d2431}}
*{box-sizing:border-box}
[hidden]{display:none!important}
${MARKDOWN_CSS}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 48px}
header{display:flex;gap:14px;align-items:center;margin-bottom:18px}
.logo{width:64px;height:70px;flex:none}
.thinking .logo,.think img{animation:bob .9s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-4px) scale(1.06)}}
.think{display:inline-flex;align-items:center;gap:6px}.think img{width:28px;height:30px}
@media (prefers-reduced-motion:reduce){.thinking .logo,.think img{animation:none}}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0}.kv dt{color:var(--muted)}.kv dd{margin:0;word-break:break-word}
.notes{white-space:pre-wrap;font-size:.92rem;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px;max-height:320px;overflow:auto;margin:6px 0 0}
.memgrid{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width:860px){.memgrid{grid-template-columns:.9fr 1.1fr}}
.memlist{max-height:70vh;overflow:auto}
.mem{display:block;width:100%;text-align:left;border:0;border-top:1px solid var(--line);border-radius:0;padding:9px 4px;background:none}
.mem:first-child{border-top:0}.mem:hover,.mem[aria-current=true]{background:var(--calmbg)}
.tag{font-size:.72rem;padding:1px 7px;border-radius:99px;background:var(--calmbg);color:var(--muted);margin-left:6px}
.stat{display:inline-block;margin:0 16px 8px 0}.stat b{font-size:1.3rem;display:block}
h1{font-size:1.4rem;margin:0}
.sub{color:var(--muted);margin:0}
.badge{display:inline-block;font-size:.75rem;padding:1px 8px;border-radius:99px;background:var(--calmbg);color:var(--muted);margin-left:6px;vertical-align:middle}
.grid{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width:860px){.grid{grid-template-columns:1.15fr .85fr}}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
h2{font-size:1.05rem;margin:0 0 10px}
.hint{color:var(--muted);font-size:.9rem;margin:4px 0 0}
.status{display:flex;gap:14px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.pill{font-weight:600;padding:4px 12px;border-radius:99px}
.pill.ask{background:var(--carebg);color:var(--care)}.pill.act{background:var(--okbg);color:var(--ok)}.pill.stop{background:var(--warnbg);color:var(--warn)}
button{font:inherit;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px 14px;cursor:pointer}
button:focus-visible,textarea:focus-visible,input:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
button.primary{background:var(--ok);border-color:var(--ok);color:#fff}
button.danger{background:var(--warn);border-color:var(--warn);color:#fff;font-weight:600}
button:disabled{opacity:.55;cursor:default}
.card{border:1px solid var(--line);border-radius:12px;padding:12px;margin-top:10px}
.what{font-weight:600;margin:0 0 4px}
.meta{color:var(--muted);font-size:.88rem;margin:2px 0}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.chip{font-size:.8rem;padding:2px 9px;border-radius:99px}
.chip.calm{background:var(--calmbg);color:var(--muted)}.chip.care{background:var(--carebg);color:var(--care)}.chip.warn{background:var(--warnbg);color:var(--warn)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
input[type=text],textarea{font:inherit;width:100%;border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--bg);color:var(--ink)}
textarea{min-height:70px;resize:vertical}
.chat{display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto;padding:4px 2px;margin-bottom:10px}
.msg{padding:9px 12px;border-radius:12px;max-width:92%;white-space:pre-wrap;word-wrap:break-word}
.me{align-self:flex-end;background:var(--calmbg)}.it{align-self:flex-start;border:1px solid var(--line)}
.small{font-size:.8rem;color:var(--muted)}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{padding:7px 0;border-top:1px solid var(--line)}ul.plain li:first-child{border-top:0}
.empty{color:var(--muted);font-style:italic}
.toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:10px;max-width:90vw;white-space:pre-wrap;display:none}
footer{color:var(--muted);font-size:.85rem;margin-top:22px}
code{background:var(--calmbg);padding:1px 5px;border-radius:6px;font-size:.88em}
nav.tabs{display:flex;gap:6px;margin:0 0 16px}
nav.tabs button{border-radius:99px;padding:6px 16px}
nav.tabs button[aria-selected=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.set{display:grid;grid-template-columns:1fr;gap:16px;max-width:760px}
.cat{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--line)}
.cat:first-of-type{border-top:0}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.seg button{border:0;border-radius:0;border-left:1px solid var(--line);padding:6px 10px;font-size:.88rem}
.seg button:first-child{border-left:0}
.seg button[aria-pressed=true]{background:var(--brand);color:#fff;font-weight:600}
.lock{font-size:.8rem;color:var(--muted);margin-left:8px}
select{font:inherit;border:1px solid var(--line);border-radius:10px;padding:7px 10px;background:var(--bg);color:var(--ink)}
.field{display:grid;gap:4px;margin-top:10px}
.on{color:var(--ok);font-weight:600}.off{color:var(--muted);font-weight:600}
</style>
</head>
<body>
<main>
  <header>
    <img class="logo" src="${MASCOT_DATA_URI}" alt="" aria-hidden="true">
    <div>
      <h1><span id="name">Your agent</span><span class="badge">AI agent</span></h1>
      <p class="sub" id="role">Loading…</p>
    </div>
  </header>

  <nav class="tabs" role="tablist">
    <button role="tab" id="tabHome" aria-selected="true" aria-controls="home">Home</button>
    <button role="tab" id="tabAgent" aria-selected="false" aria-controls="agent">Agent</button>
    <button role="tab" id="tabMemories" aria-selected="false" aria-controls="memories">Memories</button>
    <button role="tab" id="tabSettings" aria-selected="false" aria-controls="settings">Settings</button>
  </nav>

  <div id="expired" class="card" style="display:none;border-color:var(--warn)">
    <p style="margin:0 0 8px">This page needs the full link that <code>ohmyagi web</code> printed — the part after <code>#t=</code> is its key. Paste the link (or just the key) here:</p>
    <div class="row" style="margin:0"><input type="text" id="keyIn" placeholder="https://…#t=…" autocomplete="off" aria-label="Link or key" style="flex:1;min-width:220px"><button class="primary" id="keyGo">Open</button></div>
  </div>

  <div class="grid" id="home" role="tabpanel" aria-labelledby="tabHome">
    <div>
      <section aria-labelledby="h-status">
        <div class="status">
          <div>
            <h2 id="h-status">On its own, it…</h2>
            <span class="pill" id="level">…</span>
            <p class="hint" id="levelDetail"></p>
          </div>
          <div style="text-align:right">
            <button class="danger" id="stopBtn" title="Stops every running turn and sets every category to 0">Stop everything</button>
            <p class="hint">Safe to press any time.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="h-wait" style="margin-top:16px">
        <h2 id="h-wait">Waiting for you <span class="small" id="waitCount"></span></h2>
        <p class="hint">Things it would like to do. Nothing happens until you say yes — and a yes is good for one run.</p>
        <div id="waiting"></div>
        <div id="approved"></div>
      </section>

      <section aria-labelledby="h-chat" style="margin-top:16px">
        <h2 id="h-chat">Talk to it</h2>
        <div class="chat" id="chat" aria-live="polite"></div>
        <label class="small" for="prompt">Your message</label>
        <textarea id="prompt" placeholder="Ask a question, or tell it what you'd like done…"></textarea>
        <div class="row"><button class="primary" id="send">Send</button><span class="small think" id="sending"></span></div>
      </section>
    </div>

    <div>
      <section aria-labelledby="h-sched">
        <h2 id="h-sched">On a schedule</h2>
        <ul class="plain" id="triggers"></ul>
        <p class="hint">Scheduled work only ever makes suggestions — they land in “Waiting for you”.</p>
      </section>
      <section aria-labelledby="h-recent" style="margin-top:16px">
        <h2 id="h-recent">Recently</h2>
        <ul class="plain" id="recent"></ul>
      </section>
      <section aria-labelledby="h-term" style="margin-top:16px">
        <h2 id="h-term">Only in the terminal</h2>
        <p class="hint">These need you to type a phrase yourself, on purpose:</p>
        <ul class="plain small">
          <li>Let it act without asking — <code>ohmyagi autonomy set … 3</code></li>
          <li>Let it learn what you do — <code>ohmyagi observe enable</code></li>
          <li>Release the brake — <code>ohmyagi autonomy resume</code></li>
          <li>Delete your data — <code>ohmyagi erase</code></li>
        </ul>
      </section>
    </div>
  </div>
  <div class="set" id="agent" role="tabpanel" aria-labelledby="tabAgent" hidden>
    <p id="agentProblems" class="card" style="display:none;border-color:var(--warn)"></p>
    <section aria-labelledby="h-who">
      <h2 id="h-who">Who it is</h2>
      <dl class="kv" id="whoKv"></dl>
      <p class="hint">It always says it is an AI when asked — that is built in and cannot be turned off.</p>
    </section>
    <section aria-labelledby="h-repo">
      <h2 id="h-repo">Its repository</h2>
      <dl class="kv" id="repoKv"></dl>
    </section>
    <section aria-labelledby="h-scope">
      <h2 id="h-scope">What it does, and never does</h2>
      <dl class="kv" id="scopeKv"></dl>
      <p class="small" style="margin:12px 0 4px">It never:</p>
      <ul class="plain" id="prohibitions"></ul>
    </section>
    <section aria-labelledby="h-person">
      <h2 id="h-person">How it speaks</h2>
      <dl class="kv" id="personKv"></dl>
      <p class="small" style="margin:12px 0 4px">Its principles:</p>
      <ul class="plain" id="principles"></ul>
    </section>
    <section aria-labelledby="h-stats">
      <h2 id="h-stats">So far</h2>
      <div id="stats"></div>
      <ul class="plain small" id="byBackend"></ul>
    </section>
    <section aria-labelledby="h-notes">
      <h2 id="h-notes">Its own notes</h2>
      <p class="small">role.md — the job</p><div class="notes" id="roleNotes"></div>
      <p class="small" style="margin-top:12px">person.md — the person</p><div class="notes" id="personNotes"></div>
      <p class="hint">To change who it is, edit <code>soul/role.md</code> or <code>soul/person.md</code> and run <code>ohmyagi soul check</code>.</p>
    </section>
  </div>

  <div class="memgrid" id="memories" role="tabpanel" aria-labelledby="tabMemories" hidden>
    <section aria-labelledby="h-mem">
      <h2 id="h-mem">Memories <span class="small" id="memCount"></span></h2>
      <label class="small" for="memFilter">Filter by words</label>
      <input type="text" id="memFilter" placeholder="Type to narrow the list…" autocomplete="off">
      <div class="row"><select id="memType" aria-label="Kind"><option value="">All kinds</option></select><button id="memSearch" title="Ask recall — the same search a turn uses">Search by meaning</button></div>
      <div class="memlist" id="memList" style="margin-top:10px"></div>
    </section>
    <section aria-labelledby="h-memview">
      <h2 id="h-memview">Read</h2>
      <div class="row" style="justify-content:space-between;margin-top:0"><p class="small" id="memPath" style="margin:0">Pick a memory on the left.</p><label class="small"><input type="checkbox" id="memRaw"> show as written</label></div>
      <div class="notes" id="memText" style="max-height:70vh" hidden></div>
      <p class="hint">Read-only here. To remove one: <code>ohmyagi memory forget</code> in a terminal — it shows what it will touch first.</p>
    </section>
  </div>

  <div class="set" id="settings" role="tabpanel" aria-labelledby="tabSettings" hidden>
    <section aria-labelledby="h-levels">
      <h2 id="h-levels">What it may do on its own</h2>
      <p class="hint" id="brakeNote" style="display:none;color:var(--warn)">The brake is on: nothing runs whatever these say, until you release it in a terminal.</p>
      <div id="cats"></div>
      <p class="hint">“On its own” (3) is only set in a terminal, where you type a phrase: <code>ohmyagi autonomy set &lt;category&gt; 3</code></p>
    </section>

    <section aria-labelledby="h-model">
      <h2 id="h-model">Who answers your messages</h2>
      <p class="hint">Used by “Talk to it” on this page, in this browser.</p>
      <div class="field"><label class="small" for="backendSel">Backend</label><select id="backendSel"></select></div>
      <div class="field"><label class="small" for="modelIn">Model (optional)</label><input type="text" id="modelIn" placeholder="e.g. qwen3.8:27b" autocomplete="off"></div>
      <div class="row"><button class="primary" id="saveModel">Save</button><span class="small" id="modelNow"></span></div>
    </section>

    <section aria-labelledby="h-chatusers">
      <h2 id="h-chatusers">People it answers in chat apps</h2>
      <ul class="plain" id="chatUsers"></ul>
      <p class="hint">To add someone, type in a terminal: <code>ohmyagi chat allow telegram &lt;user-id&gt; --subject <span class="subj"></span></code></p>
    </section>

    <section aria-labelledby="h-peers">
      <h2 id="h-peers">Agents it talks to</h2>
      <ul class="plain" id="peers"></ul>
      <p class="hint">To add one, type in a terminal: <code>ohmyagi a2a allow &lt;name&gt; --endpoint &lt;url&gt; --subject <span class="subj"></span></code></p>
    </section>

    <section aria-labelledby="h-guards">
      <h2 id="h-guards">Privacy guards</h2>
      <ul class="plain" id="guards"></ul>
      <p class="hint">These are set where <code>ohmyagi</code> starts, so they cannot be switched from a page.</p>
    </section>

    <section aria-labelledby="h-version">
      <h2 id="h-version">Version</h2>
      <p id="versionLine"></p>
      <div class="row"><button id="checkUpdate">Check for updates</button><span class="small">Installing is done in a terminal: <code>ohmyagi update --yes</code></span></div>
    </section>
  </div>

  <footer>Everything on this page stays on this computer. A message you send goes only to the backend named under its answer.</footer>
</main>
<div class="toast" id="toast" role="status"></div>
<script>
${MARKDOWN_JS}
(() => {
  const hashParams = new URLSearchParams(location.hash.slice(1));
  const token = hashParams.get("t") || sessionStorage.getItem("ohmyagi-t") || "";
  const startTab = hashParams.get("tab") || sessionStorage.getItem("ohmyagi-tab") || "home";
  if (token) { sessionStorage.setItem("ohmyagi-t", token); history.replaceState(null, "", location.pathname); }
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const toast = (text) => { const t = $("toast"); t.textContent = text; t.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = "none", 5200); };
  async function api(path, body) {
    const res = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "x-ohmyagi-token": token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401) { try { sessionStorage.removeItem("ohmyagi-t"); } catch {} $("expired").style.display = "block"; if (!agentName) { $("name").textContent = "Link expired"; $("role").textContent = "Open the full link ohmyagi web printed to see your agent."; } throw new Error("expired"); }
    return res.json();
  }
  let canTriage = false;
  $("keyGo").onclick = () => {
    const raw = $("keyIn").value.trim(); const m = /(?:#t=|^)([0-9a-f]{32,64})/.exec(raw);
    if (!m) { toast("That is not the link or the key — it ends in #t= and a long code."); return; }
    try { sessionStorage.setItem("ohmyagi-t", m[1]); } catch {}
    location.replace(location.pathname + "#t=" + m[1]); location.reload();
  };
  $("keyIn").addEventListener("keydown", (e) => { if (e.key === "Enter") $("keyGo").click(); });

  function renderWaiting(items) {
    const box = $("waiting"); box.replaceChildren();
    $("waitCount").textContent = items.length ? "(" + items.length + ")" : "";
    if (!items.length) { box.append(el("p", "empty", "Nothing is waiting. You're all caught up.")); return; }
    for (const p of items) {
      const c = el("div", "card");
      c.append(el("p", "what", p.what));
      c.append(el("p", "meta", "Why: " + p.why));
      c.append(el("p", "meta", "What it affects: " + p.impact));
      c.append(el("p", "meta", (p.byAgent ? "Suggested by the agent" : "Written by you") + " · " + p.filed));
      if (p.chips.length) { const chips = el("div", "chips"); for (const ch of p.chips) chips.append(el("span", "chip " + ch.tone, ch.text)); c.append(chips); }
      const note = el("input"); note.type = "text"; note.placeholder = "Add a note (optional)"; note.setAttribute("aria-label", "Note for this decision");
      const yes = el("button", "primary", "Yes, allow once");
      const no = el("button", "", "No, thanks");
      const busy = (b) => { yes.disabled = no.disabled = b; };
      yes.onclick = async () => { busy(true); const r = await api("/api/proposals/" + p.id + "/approve", { note: note.value }); toast(r.ok ? "Allowed once. Use “Do it now” when you're ready." : (r.message || "That did not work.")); await refresh(); };
      no.onclick = async () => { busy(true); const r = await api("/api/proposals/" + p.id + "/refuse", { note: note.value }); toast(r.ok ? "Declined — it won't ask this again unless something changes." : (r.message || "That did not work.")); await refresh(); };
      const row = el("div", "row"); row.append(yes, no);
      if (canTriage && !p.chips.length) { const t = el("button", "", "Check risk"); t.title = "Ask TypeSafe's Jev what kind of action this is (sends the text above)"; t.onclick = async () => { t.disabled = true; const r = await api("/api/proposals/" + p.id + "/triage", {}); toast(r.ok ? "Checked." : (r.message || "Could not check.")); await refresh(); }; row.append(t); }
      c.append(note, row); box.append(c);
    }
  }
  function renderApproved(items) {
    const box = $("approved"); box.replaceChildren();
    if (!items.length) return;
    box.append(el("p", "small", "Allowed and not done yet:"));
    for (const p of items) {
      const c = el("div", "card");
      c.append(el("p", "what", p.what), el("p", "meta", "Allowed " + p.decided));
      const go = el("button", "primary", "Do it now");
      go.onclick = () => send(p.what, p.id);
      const row = el("div", "row"); row.append(go, el("span", "small", "Runs once. If it only suggests again, raise “write” to 2 in the terminal."));
      c.append(row); box.append(c);
    }
  }
  function renderList(id, items, line, empty) {
    const ul = $(id); ul.replaceChildren();
    if (!items.length) { ul.append(el("li", "empty", empty)); return; }
    for (const it of items) ul.append(line(it));
  }
  async function refresh() {
    let s; try { s = await api("/api/state"); } catch { return; }
    canTriage = s.canTriage;
    $("name").textContent = s.agent.name; $("role").textContent = s.agent.role; subject = s.agent.subject; agentName = s.agent.name;
    $("prompt").placeholder = "Ask " + s.agent.name + " a question, or say what you'd like done…";
    document.title = s.agent.name + " · Oh My AGI";
    const lv = $("level"); lv.textContent = s.autonomy.title; lv.className = "pill " + s.autonomy.tone;
    $("levelDetail").textContent = s.autonomy.detail;
    renderWaiting(s.waiting); renderApproved(s.approved);
    renderList("triggers", s.triggers, (t) => { const li = el("li"); li.append(el("div", "", t.id), el("div", "small", "every " + t.every + " · next " + t.next)); return li; }, "No schedule. Add one in soul/triggers.md.");
    renderList("recent", s.recent, (r) => { const li = el("li"); li.append(el("div", "", r.asked), el("div", "small", r.when + " · " + r.backend + (r.ok ? "" : " · no answer"))); return li; }, "Nothing yet — say hello.");
  }
  let agentName = "";
  function bubble(cls, text, small) {
    const b = el("div", "msg " + cls);
    if (cls === "it" && agentName) b.append(el("div", "small", agentName + " · AI"));
    if (cls === "it") { b.style.whiteSpace = "normal"; b.append(md(text)); } else b.append(document.createTextNode(text));
    if (small) b.append(el("div", "small", small));
    $("chat").append(b); $("chat").scrollTop = 1e9;
  }
  async function send(text, proposal) {
    text = (text || "").trim(); if (!text) return;
    bubble("me", text); $("prompt").value = ""; $("send").disabled = true;
    const mini = el("img"); mini.src = document.querySelector(".logo").src; mini.alt = "";
    $("sending").replaceChildren(mini, document.createTextNode("Thinking…")); document.body.classList.add("thinking");
    try {
      const body = proposal ? { prompt: text, proposal } : { prompt: text };
      const pick = choice(); if (pick.backend) body.backend = pick.backend; if (pick.model) body.model = pick.model;
      const r = await api("/api/turn", body);
      if (r.error) bubble("it", r.error);
      else {
        const filed = (r.proposals || []).filter((p) => p.outcome === "filed").length;
        bubble("it", r.text || "(no answer)", (r.route ? "answered by " + r.route : "") + (filed ? " · " + filed + " suggestion(s) waiting for you" : ""));
      }
    } catch (e) { bubble("it", e && e.message === "expired" ? "This page's link has changed — open the link ohmyagi web printed (or the service's key), then send again." : "Could not reach the agent — is ohmyagi web still running?"); }
    $("send").disabled = false; $("sending").replaceChildren(); document.body.classList.remove("thinking"); refresh();
  }
  $("send").onclick = () => send($("prompt").value);
  $("prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send($("prompt").value); });
  $("stopBtn").onclick = async () => {
    if (!confirm("Stop everything?\\n\\nRunning work is ended and it may do nothing on its own until you release the brake in a terminal.")) return;
    const r = await api("/api/stop", {}); toast(r.ok ? "Stopped. Nothing will run until you release the brake." : (r.message || "Some things could not be stopped — see the terminal.")); refresh();
  };

  // ── Settings ──
  const store = { get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };
  function choice() { return { backend: store.get("ohmyagi-backend"), model: store.get("ohmyagi-model") }; }
  const CATS = [["read", "Read", "look at files and folders"], ["write", "Write", "change or create files"], ["run", "Run", "run commands on this computer"], ["reach", "Reach", "contact other services and agents"]];
  const LEVELS = ["Never", "Ask me first", "Do it, then tell me"];
  const TABS = ["home", "agent", "memories", "settings"];
  function showTab(which) {
    if (!TABS.includes(which)) which = "home";
    for (const t of TABS) {
      $(t).hidden = t !== which;
      $("tab" + t[0].toUpperCase() + t.slice(1)).setAttribute("aria-selected", String(t === which));
    }
    try { sessionStorage.setItem("ohmyagi-tab", which); } catch {}
    if (which === "settings") loadSettings();
    if (which === "agent") loadAgent();
    if (which === "memories") loadMemories();
  }
  for (const t of TABS) $("tab" + t[0].toUpperCase() + t.slice(1)).onclick = () => showTab(t);
  const kv = (id, rows) => { const dl = $(id); dl.replaceChildren(); for (const [k, v] of rows) { if (v === null || v === undefined || v === "") continue; const dd = el("dd"); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(el("dt", "", k), dd); } };
  async function loadAgent() {
    let a; try { a = await api("/api/agent"); } catch { return; }
    const probs = $("agentProblems"); probs.style.display = a.ok ? "none" : "block"; probs.textContent = a.ok ? "" : "Its soul does not load: " + a.problems.join(" · ") + " — run ohmyagi soul check in a terminal.";
    kv("whoKv", [["Name", a.name], ["Its job", a.role], ["Subject", a.subject], ["Folder", a.dir]]);
    let remote = "none — this repository is only on this computer";
    if (a.repo.remote) { if (a.repo.web) { const link = el("a", "", a.repo.remote); link.href = a.repo.web; link.target = "_blank"; link.rel = "noopener noreferrer"; remote = link; } else remote = a.repo.remote; }
    kv("repoKv", [["Where", a.dir], ["Remote", remote], ["Latest", a.repo.head ? a.repo.head + (a.repo.lastCommit ? " — " + a.repo.lastCommit : "") + (a.repo.lastCommitAt ? " (" + a.repo.lastCommitAt + ")" : "") : "no commits yet"]]);
    kv("scopeKv", [["Does", a.scope.does], ["Does not", a.scope.doesNot]]);
    renderList("prohibitions", a.prohibitions, (p) => el("li", "", p), "No prohibitions listed.");
    const p = a.person;
    kv("personKv", p ? [["Calls you", p.addressesUserAs], ["Calls itself", p.refersToSelfAs.join(", ")], ["Tone", p.tone.join(", ")], ["Knowledge from", p.inheritsFrom.join(", ")]] : []);
    renderList("principles", p ? p.principles : [], (x) => el("li", "", x), "None listed.");
    const st = $("stats"); st.replaceChildren();
    const stat = (n, label) => { const d = el("span", "stat"); d.append(el("b", "", String(n)), el("span", "small", label)); st.append(d); };
    stat(a.stats.memories, "memories"); stat(a.stats.turns, "records in the ledger"); stat(a.stats.lastTurn || "—", "last one");
    renderList("byBackend", a.stats.byBackend, (b) => el("li", "", b.backend + " — " + b.turns), "Nothing recorded yet.");
    for (const [id, text] of [["roleNotes", a.roleNotes], ["personNotes", a.personNotes]]) { const box = $(id); box.replaceChildren(); box.style.whiteSpace = "normal"; box.append(text ? md(text) : document.createTextNode("(empty)")); }
  }
  let mems = []; let memShown = "";
  function drawMemories() {
    const q = $("memFilter").value.trim().toLowerCase(); const kind = $("memType").value;
    const list = $("memList"); list.replaceChildren();
    const hits = mems.filter((m) => (!kind || m.type === kind) && (!q || (m.title + " " + m.description + " " + m.path).toLowerCase().includes(q)));
    $("memCount").textContent = "(" + (hits.length === mems.length ? mems.length : hits.length + " of " + mems.length) + ")";
    if (!hits.length) { list.append(el("p", "empty", mems.length ? "Nothing matches." : "No memories yet. Notes go in memory/ in its repository.")); return; }
    for (const m of hits) {
      const b = el("button", "mem"); b.setAttribute("aria-current", String(m.path === memShown));
      const t = el("div", "what", m.title); if (m.type) t.append(el("span", "tag", m.type));
      b.append(t, el("div", "small", m.description), el("div", "small", m.path + " · " + Math.max(1, Math.round(m.bytes / 1024)) + " KB"));
      b.onclick = () => openMemory(m.path);
      list.append(b);
    }
  }
  async function openMemory(path) {
    memShown = path; drawMemories(); $("memPath").textContent = path; $("memText").hidden = false; $("memText").textContent = "Loading…";
    let r; try { r = await api("/api/memory?path=" + encodeURIComponent(path)); } catch { return; }
    memLast = r.error ? "" : r.text; showMem(r.error || "");
  }
  let memLast = "";
  function showMem(error) {
    const box = $("memText"); box.replaceChildren();
    if (error) { box.textContent = error; return; }
    if ($("memRaw").checked) { box.style.whiteSpace = "pre-wrap"; box.textContent = memLast; }
    else { box.style.whiteSpace = "normal"; box.append(md(memLast)); }
  }
  $("memRaw").addEventListener("change", () => { if (memLast) showMem(""); });
  async function loadMemories() {
    try { mems = await api("/api/memories"); } catch { return; }
    const sel = $("memType"); const keep = sel.value; sel.replaceChildren(el("option", "", "All kinds")); sel.firstChild.value = "";
    for (const k of [...new Set(mems.map((m) => m.type).filter(Boolean))].sort()) { const o = el("option", "", k); o.value = k; sel.append(o); }
    sel.value = keep; drawMemories();
  }
  $("memFilter").addEventListener("input", drawMemories);
  $("memType").addEventListener("change", drawMemories);
  $("memSearch").onclick = async () => {
    const q = $("memFilter").value.trim(); if (!q) { toast("Type what to look for in the box first."); return; }
    $("memSearch").disabled = true; memShown = ""; drawMemories(); $("memPath").textContent = "Search by meaning: " + q; $("memText").hidden = false; $("memText").textContent = "Searching…";
    const r = await api("/api/memory-search", { query: q });
    $("memText").textContent = r.text || r.message || r.error || "Nothing found."; $("memSearch").disabled = false;
  };
  async function loadSettings() {
    let s; try { s = await api("/api/settings"); } catch { return; }
    $("brakeNote").style.display = s.stopped ? "block" : "none";
    const cats = $("cats"); cats.replaceChildren();
    for (const [key, name, what] of CATS) {
      const now = s.levels[key];
      const row = el("div", "cat");
      const label = el("div"); label.append(el("div", "what", name), el("div", "small", "May it " + what + "?"));
      const seg = el("div", "seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", name);
      LEVELS.forEach((word, level) => {
        const b = el("button", "", word); b.setAttribute("aria-pressed", String(now === level));
        b.onclick = async () => {
          if (now === level) return;
          seg.querySelectorAll("button").forEach((x) => x.disabled = true);
          const r = await api("/api/autonomy", { category: key, level });
          toast(r.ok ? name + ": " + word.toLowerCase() + "." : (r.message || r.error || "That did not work."));
          loadSettings(); refresh();
        };
        seg.append(b);
      });
      const right = el("div"); right.append(seg);
      if (now === 3) right.append(el("span", "lock", "now: on its own (set in a terminal)"));
      row.append(label, right); cats.append(row);
    }
    // backend & model
    const sel = $("backendSel"); sel.replaceChildren();
    const def = el("option", "", "Default" + (s.defaultTurn.backend ? " (" + s.defaultTurn.backend + ")" : " (the usual order)")); def.value = ""; sel.append(def);
    for (const b of s.backends) { const o = el("option", "", b.id + (b.available ? "" : " — not found on this computer")); o.value = b.id; o.disabled = !b.available; sel.append(o); }
    const pick = choice(); sel.value = pick.backend; if (sel.value !== pick.backend) sel.value = "";
    $("modelIn").value = pick.model; $("modelIn").placeholder = s.defaultTurn.model ? "default: " + s.defaultTurn.model : "e.g. qwen3.8:27b";
    showModelNow();
    // people & peers
    document.querySelectorAll(".subj").forEach((e) => e.textContent = subject);
    renderList("chatUsers", s.chatUsers, (u) => {
      const li = el("li"); const row = el("div", "row"); row.style.justifyContent = "space-between"; row.style.marginTop = "0";
      const who = el("div"); who.append(el("div", "", (u.label ? u.label + " · " : "") + u.platform + " " + u.userId), el("div", "small", "added " + u.added + " · " + (u.told ? "told it is an AI" : "not written to yet")));
      const rm = el("button", "", "Stop answering");
      rm.onclick = async () => { if (!confirm("Stop answering " + u.platform + " user " + u.userId + "?\\n\\nTheir next message gets no reply. Adding them back is done in a terminal.")) return; rm.disabled = true; const r = await api("/api/chat-users/remove", { platform: u.platform, userId: u.userId }); toast(r.ok ? "Removed." : (r.message || "That did not work.")); loadSettings(); };
      row.append(who, rm); li.append(row); return li;
    }, "Nobody — it answers no one in chat apps.");
    renderList("peers", s.peers, (p) => {
      const li = el("li"); const row = el("div", "row"); row.style.justifyContent = "space-between"; row.style.marginTop = "0";
      const who = el("div"); who.append(el("div", "", p.name), el("div", "small", p.endpoint + " · added " + p.added));
      const rm = el("button", "", "Remove");
      rm.onclick = async () => { if (!confirm("Remove " + p.name + "?\\n\\nIts token stops working both ways. Adding it back is done in a terminal.")) return; rm.disabled = true; const r = await api("/api/peers/remove", { name: p.name }); toast(r.ok ? "Removed." : (r.message || "That did not work.")); loadSettings(); };
      row.append(who, rm); li.append(row); return li;
    }, "No other agents — it talks to none.");
    const g = $("guards"); g.replaceChildren();
    const guard = (name, on, detail) => { const li = el("li"); const t = el("div"); t.append(el("span", "", name + " — "), el("span", on ? "on" : "off", on ? "on" : "off")); li.append(t, el("div", "small", detail)); g.append(li); };
    guard("Personal-word filter", s.guards.needles > 0, s.guards.needles > 0 ? s.guards.needles + " word(s) kept from leaving; plus shapes like phone numbers, always." : "No personal words listed yet — shapes like phone numbers are still caught. List words with ohmyagi egress needles.");
    guard("Local judge", !!s.guards.judge, s.guards.judge ? "A model on this computer (" + s.guards.judge + ") reads meaning before anything leaves." : "Off. Set OM_AGI_EGRESS_JUDGE to a local model to turn it on — chat apps need it.");
    guard("Risk check for suggestions", s.guards.triage, s.guards.triage ? "“Check risk” asks TypeSafe's Jev about a suggestion when you press it." : "Off. It needs a TypeSafe key (TYPESAFE_API_KEY_FILE).");
    $("versionLine").textContent = "You have " + s.version.current + (s.version.latest ? " · newest published " + s.version.latest : "") + (s.version.checked ? " · checked " + s.version.checked : "");
  }
  let subject = "";
  function showModelNow() { const p = choice(); $("modelNow").textContent = p.backend || p.model ? "Using " + (p.backend || "the default backend") + (p.model ? " · " + p.model : "") : "Using the default."; }
  $("saveModel").onclick = () => { store.set("ohmyagi-backend", $("backendSel").value); store.set("ohmyagi-model", $("modelIn").value.trim()); showModelNow(); toast("Saved for this browser."); };
  $("checkUpdate").onclick = async () => { $("checkUpdate").disabled = true; const r = await api("/api/update-check", {}); toast(r.message || (r.ok ? "Checked." : "Could not check.")); $("checkUpdate").disabled = false; loadSettings(); };
  refresh().then(() => { if (startTab !== "home") showTab(startTab); }); setInterval(refresh, 5000);
})();
</script>
</body>
</html>
`;
