/**
 * The one page `ohmyagi web` serves (D-060). Self-contained — no build step,
 * no CDN — so it ships inside the single binary and works offline.
 *
 * Written for a person, not an operator: plain sentences, the thing that needs
 * them first, one obvious button per decision, and every value from the
 * server put on the page with `textContent`, never as HTML.
 */

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
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 48px}
header{display:flex;gap:14px;align-items:center;margin-bottom:18px}
.logo{width:44px;height:44px;border-radius:12px;background:radial-gradient(circle at 50% 55%,#ffd27a,#c77d0a 60%,#1b2a4a 61%);flex:none}
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
</style>
</head>
<body>
<main>
  <header>
    <div class="logo" aria-hidden="true"></div>
    <div>
      <h1><span id="name">Your agent</span><span class="badge">AI agent</span></h1>
      <p class="sub" id="role">Loading…</p>
    </div>
  </header>

  <p id="expired" class="card" style="display:none;border-color:var(--warn)">This page needs the full link that <code>ohmyagi web</code> printed in your terminal. Open that link again.</p>

  <div class="grid">
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
        <div class="row"><button class="primary" id="send">Send</button><span class="small" id="sending"></span></div>
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
  <footer>Everything on this page stays on this computer. A message you send goes only to the backend named under its answer.</footer>
</main>
<div class="toast" id="toast" role="status"></div>
<script>
(() => {
  const token = (new URLSearchParams(location.hash.slice(1)).get("t")) || sessionStorage.getItem("ohmyagi-t") || "";
  if (token) { sessionStorage.setItem("ohmyagi-t", token); history.replaceState(null, "", location.pathname); }
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const toast = (text) => { const t = $("toast"); t.textContent = text; t.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = "none", 5200); };
  async function api(path, body) {
    const res = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "x-ohmyagi-token": token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401) { $("expired").style.display = "block"; throw new Error("expired"); }
    return res.json();
  }
  let canTriage = false;

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
    $("name").textContent = s.agent.name; $("role").textContent = s.agent.role;
    document.title = s.agent.name + " · Oh My AGI";
    const lv = $("level"); lv.textContent = s.autonomy.title; lv.className = "pill " + s.autonomy.tone;
    $("levelDetail").textContent = s.autonomy.detail;
    renderWaiting(s.waiting); renderApproved(s.approved);
    renderList("triggers", s.triggers, (t) => { const li = el("li"); li.append(el("div", "", t.id), el("div", "small", "every " + t.every + " · next " + t.next)); return li; }, "No schedule. Add one in soul/triggers.md.");
    renderList("recent", s.recent, (r) => { const li = el("li"); li.append(el("div", "", r.asked), el("div", "small", r.when + " · " + r.backend + (r.ok ? "" : " · no answer"))); return li; }, "Nothing yet — say hello.");
  }
  function bubble(cls, text, small) { const b = el("div", "msg " + cls, text); if (small) b.append(el("div", "small", small)); $("chat").append(b); $("chat").scrollTop = 1e9; }
  async function send(text, proposal) {
    text = (text || "").trim(); if (!text) return;
    bubble("me", text); $("prompt").value = ""; $("send").disabled = true; $("sending").textContent = "Thinking…";
    try {
      const r = await api("/api/turn", proposal ? { prompt: text, proposal } : { prompt: text });
      if (r.error) bubble("it", r.error);
      else {
        const filed = (r.proposals || []).filter((p) => p.outcome === "filed").length;
        bubble("it", r.text || "(no answer)", (r.route ? "answered by " + r.route : "") + (filed ? " · " + filed + " suggestion(s) waiting for you" : ""));
      }
    } catch (e) { bubble("it", "Could not reach the agent."); }
    $("send").disabled = false; $("sending").textContent = ""; refresh();
  }
  $("send").onclick = () => send($("prompt").value);
  $("prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send($("prompt").value); });
  $("stopBtn").onclick = async () => {
    if (!confirm("Stop everything?\\n\\nRunning work is ended and it may do nothing on its own until you release the brake in a terminal.")) return;
    const r = await api("/api/stop", {}); toast(r.ok ? "Stopped. Nothing will run until you release the brake." : (r.message || "Some things could not be stopped — see the terminal.")); refresh();
  };
  refresh(); setInterval(refresh, 5000);
})();
</script>
</body>
</html>
`;
