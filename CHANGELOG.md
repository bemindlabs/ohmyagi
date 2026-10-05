# Changelog

## 0.10.0 — 2026-10-05

An approved proposal runs once, even when two turns start together, and a spent approval can be filed again
only when nothing was sent (D-144, refile). Turns that finish together are all recorded, and a killed turn's
ledger lock no longer stops every turn after it (D-145). You can ask your memory a question and get a summary
with its sources, never the file pasted back (D-152). A real-backend e2e suite proves the agent acts — writes,
runs, levels, the fence and `stop` — and the stop-inside-the-turn case holds on a slow, loaded machine. The dial
gains an `operate` category with a fixed sensitive-actions list, and an approval is bound to the action it was
given for (D-153). The E17 browser runtime — a per-task browser container and one Playwright MCP for every CLI —
ships as internal plumbing, not yet reachable from turns; tasks will use it next (D-151, D-155). And the suite is
stable on a slow CI runner: tests wait on conditions, and process tests carry explicit timeouts.

### Fixed — the browser runtime, after its review (PR #19)
- **A page's dialogs are judged before they are accepted.**
  - A password-like `prompt` is held.
  - Accepting a `confirm` is held: it commits whatever the page asked.
  - `alert` and leaving the page are not held.
  - A held dialog is dismissed, and dismissing always works.
- **Only web URLs are opened.**
  - `browser_navigate` and `browser_tabs` take `http:`, `https:` or `about:blank` and nothing else. This happens at
    the guard, and again at `page.goto` in the container.
  - A `javascript:` URL could run page code, and a `data:` page could post to an allowed origin.
  - The action log keeps a URL's origin only.
- **The container's guard enforces the operate level.** `browser up --operate 1|2` (default 1) sets it. At 1 the
  guard serves only the look tools, to any caller.
- **A login form's submit is held whatever its button says.** This adds a `credentials.login-submit` rule to
  D-153's list.
- **`up` waits for the browser behind the guard,** not just for the guard.
- **Only om-agi can drive a task's browser.**
  - Playwright MCP moved behind a guard that needs a per-task bearer token. claude gets the token through its MCP
    config's `headers`, in a file of mode 600.
  - The container takes the guard's port only from the docker gateway. Another container on the bridge reaches
    neither port.
  - The guard serves 21 tools. `browser_run_code_unsafe`, `browser_evaluate`, `browser_file_upload` and
    `browser_drop` are refused and hidden.
- **The operate level decides the tools.** `Restraint` now carries the turn's operate level (D-153). Operate 1
  approves look tools only, 2 adds click and type, and 0 is refused. Tools are approved one by one.
- **Sensitive actions are held in the container.** D-153's list (`src/decide/sensitive.ts`) is bundled into the
  image as `sensitive.cjs`, and a test keeps the two equal. It is asked before every click, keystroke, select or
  upload. Paying, sending, deleting, credentials and accepting terms do not happen, and the model is told why
  (`held.jsonl`).
- **The deadline holds.** It runs as root with KILL only (plus what dropping needs), so the browser's uid cannot stop
  it. Every `up` and `status` also ends a record past its deadline.
- **`erase` reaches browser tasks.** Their records and wiring live under the subject. `erase` docker-kills the
  subject's containers first and counts a refused kill as a failure.
- **No typed password in the recording.**
  - A password field is held before a keystroke, and a context's trace stops before any.
  - Playwright MCP's session log is off. The guard's action log keeps lengths, not values.
  - Files are 600 and directories 700. Each context gets its own trace name.
- **Smaller fixes.**
  - `up` refuses while the brake is on.
  - Records are created exclusively, and a lost port race moves on to the next port.
  - Only `docker-init` and the deadline keep any capability, measured.
  - The proxy has upstream timeouts and documents its limits (CONNECT host and port only; the first address).

### Added — a per-task browser container and one Playwright MCP for every CLI: the runtime only, not yet reachable from turns (E17, D-151, D-155)
- **`docker/browser/`: one task's browser.**
  - Headless Chromium and the pinned Playwright MCP (`@playwright/mcp@0.0.83`).
  - It runs as the owner's uid with every capability dropped, `no-new-privileges`, a read-only root, and memory,
    pid and CPU limits.
  - The MCP port is published on `127.0.0.1` only (30730–30749).
  - The one host mount is the task's output directory.
  - Chromium runs `--no-sandbox`, because the container is the fence; the Dockerfile says why.
  - The image is built on this machine and never pushed. Its tag carries a digest of the directory, so an edit
    means a rebuild.
- **Egress only to the task's origins.**
  - A proxy in the container lets through `scheme://host:port` origins from the allowlist and nothing else.
  - It refuses a public name that resolves to a private, loopback, link-local, CGNAT or multicast address.
  - Every decision is logged.
  - The container's own firewall drops every packet not sent by the proxy's group, so a socket opened around the
    proxy goes nowhere.
  - Allowlist entries are origins only: no paths, no wildcards, default ports written out (`src/browser/allowlist.ts`).
- **Recording** goes to the subject's `personal/browser/<task>/`, so `erase` reaches it:
  - a live Playwright trace, which survives a kill;
  - a screenshot after every page load;
  - Playwright MCP's session log;
  - the egress log.
  - It is kept until the owner erases it.
- **`ohmyagi browser up|down|status|mcp-config`** (internal).
  - A record is written before `docker run`.
  - `ohmyagi stop` gained step 4: `docker kill` on every browser task of this state root.
  - A sweep on every `up` and `status` ends a container whose owner process is gone (pid and start time), a container
    nothing records, and a record whose container is gone.
  - The container's own deadline (`--ttl`, default 30 min) ends it if nothing sweeps.
- **One MCP server per turn, from om-agi's own config** (`src/browser/mcp-config.ts`, D-155).
  - `TurnRequest.browser` makes `CliExec` hand claude and claude-local `--mcp-config <om-agi file>`
    (`--strict-mcp-config` stays on) and approve that server's tools.
  - The local chain's fence gains exactly the container's port.
  - grok and grok-local, kimi and codex are refused, each with the reason measured on this machine.
    grok-local's reason: it offers MCP only through the meta-tools D-119 removes.
  - Nothing in `ohmyagi turn` sets `browser` yet: the `operate` dial (D-153) will decide when.
- **Real-backend e2e:** `OM_AGI_E2E_BROWSER=1 bun run e2e:browser` (`notes/2026-10-05_browser-runtime-e2e.md`).
  - A claude-local turn in the fence read a random heading from a page the test served, and was refused the
    forbidden one (7/7).
  - Cloud claude (haiku) did the same.
  - Proxy and kernel refusals were checked without a model.
  - `stop` killed the container, and a SIGKILLed owner's container was swept.
  - Nothing was left in `docker ps -a`.
### Added — the `operate` dial category, a fixed sensitive-actions list, and approvals bound to the action (E17, D-153)
- **`operate`, the browser.** A fifth dial category, beside read, write, run and reach. It runs at
  `min(operate, reach)`: 0 no browser · 1 looks, then proposes · 2 acts only on the task's allowed sites, recorded
  and reported · 3 any site, confirmed by the typed phrase at a terminal on this machine (D-042; in force when reach
  is at its top, as D-047 reads level 3 for files). It is not part of a turn's acting level, so its default of 0
  silences nothing. Shown by `ohmyagi autonomy`, on the web page (Home and Settings) and in `/api/state` and
  `/api/settings`, in English and Thai. Nothing drives a browser yet (S17.7–S17.8).
- **Dial files migrate by being read.** `autonomy.md` is now `om-agi/autonomy@2` with `operate` required; an `@1`
  file is read as written with operate 0, and the next `autonomy set` writes it back at `@2`.
- **`src/decide/sensitive.ts`.** Paying, sending a message or e-mail, deleting, entering a credential and accepting
  terms wait for a yes at every level. The list is frozen, its classifier takes the action and nothing else, and
  `test/decide/sensitive.test.ts` holds every category and rule that has shipped — removing one fails it. Not wired
  to a browser yet.
- **An approval runs exactly what it approved** (e2e finding 6). A proposal records its action (`{kind: "turn",
  prompt: what}`) and its digest; `proposal decide --approve` writes the digest into the decision; `turn --proposal
  <id>` builds the prompt from the record. A different `--prompt` or `--prompt-file`, a `--history-json`, or a
  record changed after the yes is refused (exit 4) with nothing sent and the approval unspent. `/api/turn` passes
  only the id, and the page sends only the id. D-144's once-only claim is unchanged; the claim now names the
  action digest.
- **An approval that names no action is refused**, with "approve it again" — one given before this, or one whose
  digest was stripped. A "legacy" path would have let an edit (what changed, `action` and the digest deleted) run
  as an old approval (review of PR #18, measured). **What the digest is:** it catches a record that changed after
  the yes; it does not stop somebody determined to edit the record — it is a plain sha256 in the same file, and
  anything that can write the state root (a vendor CLI runs as the owner) can recompute it. The same limit D-042
  states for level-3 confirmations.
- **Steps that commit without saying what pause too:** a generic submit, Enter (or a chord with Enter) or typing
  that submits, and Confirm/OK/Proceed — unless the context is a search (a search box, or a form whose role is
  `search`). OAuth allow/authorize/grant is a credentials rule. Patterns are held as source strings and compiled
  fresh per call: a frozen `RegExp` is not enough in Bun, where `compile()` swaps the pattern before the frozen
  `lastIndex` write throws.
- **Level 3 of `operate`** is said as "operate 3, confirmed at a terminal, with reach at its top", never as a
  minimum of 3 (the owner confirmed this reading, D-153 amended 2026-10-05).

### Fixed — ask your memory: a question covered in part is answered in part, `--` is `memory ask`'s alone, and each ask's recall is kept as numbers (D-152 follow-up)
- **Partial answers.** `NOT_IN_MEMORY` is now for a question the excerpts say nothing about; covered in part, the
  part is answered and the gap named. A reply that opens with the token and then answers (80+ letters, or a handed
  path) is read as an answer; an inline token becomes "not in memory" / "ไม่มีใน memory" — no "Retention: ." is left.
  A closing reminder after the pieces names the question's language. Measured: the Thai two-part question went from
  4/8 to 5/5 on qwen3.8 27B (5/5 on claude-local throughout); 69/70 asks over five full e2e runs, the canary never read.
- **`ohmyagi stop -- --help` does nothing again.** Only `memory ask` reads the words after a bare `--` as a value
  (its question); every other command still answers `--help`/`-h` and reads `--as` wherever they sit.
- **Each ask's recall, in numbers** — `<personal dir>/ask/recall.jsonl`: how many pieces were recalled, kept and
  handed, the best vector cosine, the floor, and whether a model was asked. No text. So the 0.50 cosine floor can be
  re-checked on a real memory.
- **Thai terms are words.** The full-text half's "two terms of the question" rule counts Thai words cut by ICU
  (`Intl.Segmenter`), less question words, instead of overlapping 4-character windows.

### Added — ask your memory: a summary with its sources, never the file pasted back (D-152)
- **`ohmyagi memory ask <agent-dir> --subject <id> [--scope all|memory|knowledge] [--json] [--] <question…>`.** The
  owner, 2026-10-04: RAG in the app should answer with a summary, not by quoting files back. The question gets an
  answer the agent writes from what recall finds — the same recall a turn makes — in the question's language, then
  a list of sources (file and section). The model is told to summarize, quote at most a short phrase, cite its
  sources, and answer with a token when the pieces do not cover the question; the engine then says "There is
  nothing in memory about this." / "ใน memory ไม่มีเรื่องนี้" itself. After `--` the question is words, never a flag.
- **Accounted for as a turn is.** The same route rule and D-095 split (a backend on this machine is handed every
  piece, a cloud backend only the pieces the egress filter passes — a cloud CLI every piece is held from is not
  asked at all), the same egress door and block log, one ledger line per backend handed the question (priced as a
  turn), and a run record so `ohmyagi stop` reaches an ask in progress.
- **No tools at all, at any dial level, and no proposal.** Only backends whose read-only flags leave no tool —
  claude's empty `--tools ""`, so claude and claude-local — and ollama (no tools by construction) answer. grok and
  grok-local keep read_file/grep/list_dir even read-only, and a memory note could point them at `~/.secrets`, so
  they are left out until an empty grok tool list is measured. A vendor whose only identity channel is a file
  (codex, gemini, copilot, kimi) could not be handed the pieces and is left out too; both are said.
- **Only pieces about the question are handed over.** A piece only the vector half found needs a bge-m3 cosine of
  0.50 (calibrated: on-topic 0.562–0.713, off-topic 0.255–0.467 on the e2e set); a full-text piece needs two of the
  question's terms. Nothing left = no model, no ledger line. Recall hits now carry the vector cosine; a turn's
  recall is otherwise unchanged.
- **Sources are what the answering backend was handed**, one per file and section in recall's order — never parsed
  from the model's text; when the answer names handed files by path, only those are listed. Nothing recalled: no model is asked and nothing is recorded. Exit 2 for an empty question or
  one over 2000 characters, exit 3 when neither index could be searched. The model step has 3 minutes
  (`ASK_TIMEOUT_MS`, sized for a model on this machine); an answer is cut at 8000 characters.
- **`POST /api/memory-ask {question, scope?}` → `{ok, answer, sources: [{path, title?, section?}], found, backend,
  model}`**, plus `local`, `held`, `pieces` (excerpts, for a "show the pieces" toggle) and `searched`. The same key
  and Host checks as every route; the question is handed over after `--`; one ask per agent at a time, held until
  the child has exited even when the asker stopped waiting (a second is 409); the child is ended after
  `MEMORY_ASK_TIMEOUT_MS` (4 minutes, 504) — SIGTERM to its group, SIGKILL 10 s later if it is still there; inside, a
  vendor that ignores its stop is ended by `CliExec`'s own SIGKILL round (PR #12). `/api/memory-search` stays for the views that show raw pieces.
- **The web page's "Search by meaning"** now asks: "Searching your memory…", then the summary, where it came from,
  and each source as a link that opens the file in Read. The pieces it read are behind "Show the pieces it read",
  closed by default. `/search` in the chat asks too, and says its sources as text (D-086).
- **A bare `--` ends the options everywhere it is read first:** `--help`/`-h` and `--as=…` after it are words a
  command was handed, not a request for help or an identity.
- **Proved on a real model on this machine** (`OM_AGI_E2E_MEMORY_ASK=1 bun run e2e:memory-ask`, D-149): ollama
  (qwen3.8 27B through LiteLLM) and claude-local (`local-coder`), English and Thai, plus a canary in `~/.secrets`
  that a memory note asks for — 10 of 10, the canary never read. See
  `notes/2026-10-04_memory-ask-e2e.md`.
### Added — a real-backend e2e that proves the agent acts, and two fixes it found (D-149)
- **`bun run e2e:actions`** (with `OM_AGI_E2E_ACTIONS=1`) runs `test/e2e/actions.e2e.ts` against the backends this
  machine really has. The cases are: write and run at level 2, propose then approve-once at level 1, refusal at
  level 0, the kernel fence on local backends (a write outside the work directory, and connects to two listeners
  the test opens), and `ohmyagi stop` on a running action. Each case checks the real outcome: the file, the
  command's output, the listener's count, the process table, D-043's report and the ledger line. Every backend
  gets a throwaway agent in a temporary state root. `bun test` and CI never discover the file. The results of
  2026-10-04 are in `notes/2026-10-04_e2e-actions.md`, and the survey of what each backend and model could do
  next (computer use, tasks) is in `notes/2026-10-04_capability-survey.md`.
- **Fixed: `ohmyagi stop` now stops a vendor tool's shell that runs in a session of its own.** grok runs every
  shell command under `setsid`. `stop` signalled the vendor's group, said "everything this record named is gone",
  and the command finished its action afterwards. Measured: `sleep 37 && printf late > file` wrote the file after
  `stop` exited 0. `stop` now reads the whole process tree of the turn before signalling anything. Each group in
  the tree is signalled when that is safe, and whatever no group signal reached is signalled one process at a time.
  Every process in the tree is watched for D-044's SIGKILL, so a member that ignores SIGTERM after its leader died
  is killed too. A `stop` run from inside the turn (by the agent or a script) is never signalled, and its group is
  never addressed as a group. It finishes and says it was spared. A turn that times out or is cancelled ends the
  same tree the same way. A pid whose parent started after it is not counted as that parent's child.
- `turn --json` has a `notes` list (today: the no-tools note below), and `/api/turn` passes it on in `notes`.
- **Fixed: a backend with no tools no longer looks as if it acted.** At level 2, ollama answered "done" to "create
  a file", and the turn exited 0 with nothing done. The turn now says that ollama has no tools, and that nothing
  it says it did was done.

### Fixed — turns that finish together are all recorded, and a killed turn's ledger lock no longer stops every turn after it (D-145)
- **The ledger's lock refused instead of waiting.** Every turn appends after its answer has come back, and the
  lock threw the moment it was taken, so of two turns that finished together one exited "sent and not recorded".
  Measured on 0.9.0: two real turns at once lost a line in every round; eight lost 21 of 24. And a turn killed
  while holding the lock (`ohmyagi stop` during the fsync) left `.lock` behind, after which every turn was sent
  and not recorded until somebody removed it by hand.
- **It waits now** — up to 5 s, backing off from 5 to 50 ms — and only for a lock that is held; any other error
  is reported as itself. Eight turns at once, six rounds: 48 of 48 recorded.
- **The lock names its owner** (`.lock/owner.<uuid>.json`: pid, host, start time) **and a dead owner's lock is
  broken — only on evidence**: its process is gone from this machine or started before its last boot, or the
  lock is more than 10 minutes old. An ownerless `.lock`, which is how an older om-agi holds it, after 2 s.
  Breaking removes that owner's file by name and then the empty directory, so two waiters cannot both break it
  and both go in, and nothing is ever removed recursively.
- **`turn` finds out before sending.** Its ledger check takes the lock once with the same wait: a lock somebody
  alive holds past it refuses the turn with nothing sent — under `--proposal`, before the approval is claimed —
  and a killed turn's lock is cleared there, so the next turn starts clean.
- **A refused turn no longer tells anyone to delete the ledger.** It used to end every ledger refusal with "…or
  delete the ledger directory if you want a fresh one", which loses the record of every turn and does not help
  with a lock at all. A held lock now says another turn is writing — try again in a moment, and that a lock left
  by a stopped turn clears by itself. A path that cannot be written says to fix what it names (permissions,
  something in the way, a full or read-only disk). Something in the lock's way that om-agi did not make is named
  at once instead of being waited on as if it were a lock.
- **After the send, a turn's line waits a minute for the lock, not five seconds.** `canAppend` still gives up
  after 5 s, before anything is sent; a lock that becomes held between that check and the line written once a
  backend has answered (a `forget`, a slow disk) is waited out for 60 s, because giving up then loses the record of
  something that happened. Only that line: the chat and A2A lines written *before* a reply or a delivery keep
  5 s, since a longer wait there only stalls the reply, or outlasts an A2A sender's 30 s timeout so that it reports
  a failure the receiver then delivers anyway.
- **`erase` knows which machine it is on.** It judged every lock by age alone: a killed turn's lock could stop
  an erase for ten minutes, and a killed erase left a lock naming no machine that refused every turn for as long.
  Both are now cleared at once once their process is gone.
- **A long hold is not mistaken for an abandoned one.** A holder touches its owner file while it holds the lock,
  and the ten-minute rule counts from the last touch, so a `forget` of a big ledger is never broken mid-way; a
  process that is stopped or wedged stops touching it and is broken as before.

### Fixed — an approved proposal runs once, even when two turns start together (D-144)
- **Two taps on "Do it now" ran the approved action twice.** `turn --proposal <id>` checked that the approval
  was unspent at the start and marked it spent much later, with nothing between the two; two turns started
  together (two taps on the web page, or the app's "Run now" beside it) both found it unspent and both ran it.
  Measured on the old code: three turns at once, two prompts reached the backend.
- **Checked and claimed in one step, as the last step before the prompt goes.** The approval is still read
  early (missing, pending, refused or spent stops the turn before anything is written). Then the ledger, the
  model and route, recall and the price file are all asked, and only then is the approval read again and claimed:
  `proposals/spent/<id>.json` is created with `link(2)` from a claim written whole and synced, so exactly one
  process succeeds on any number of them and every other is refused (exit 4, nothing sent) with the turn that has
  it. A turn that stops for anything that is not about the proposal — an unwritable ledger, a model or route it
  cannot use — spends nothing. There is no lock to go stale: the claim is the spend. Every reader of the store
  folds the claims in. A filesystem without hard links is named as the reason nothing was claimed.
- **A turn that fails after its claim keeps the approval spent (the owner's decision), and says what happened,**
  as its last line: it **ran** (a backend answered — do not file it again), it **may have run** (the request
  reached a backend that did not answer — check what it did), or **nothing was sent**. Only in the last case can
  it be asked for again: **`proposal new --refile <id>`**, or **"File it again"** on the web page, files a new
  proposal from the old one's own record — same what, why and impact, a new id, waiting for a new yes. Nothing is
  approved or run by filing it, and it can be filed again once.
- **`ohmyagi web`:** one turn per proposal at a time — a second `/api/turn` for a proposal still running is
  answered **409** "Already running" and starts no CLI. A proposal id that is not one is **400**, not an ordinary
  turn with the same prompt. A turn under an approval that failed with no answer returns why as its `error`, and
  the page shows a failed turn's notes beside its answer. "Do it now" is off from the click until the turn
  returns, also across the page's redraws; "File it again" likewise, and it sends only the id.
- **The proposal store** rewrites a record at the file it was read from, never at a path built from the `id`
  inside it, and refuses a record whose id is not one plain file name (a hand-edited `../../escaped` used to be
  written outside `proposals/`). It reads only `*.json` names, so a write in flight or a `.bak` copy is not a
  second record to spend.

### Fixed — filing a spent approval again is once across processes too; "it ran" is known when the answer arrives (D-144)
- **Six `--refile` at once filed six proposals** — each process read the store before any wrote. The refile is now
  claimed like a spend, `proposals/refiled/<old id>.json` linked into place before the new record is written: six
  at once file one, and five exit 5 ("filed again already, as <id>"; 409 on the page). A crash between the claim
  and the write uses the refile up rather than ever filing two; the same what can still be filed by hand — and
  asking again then says exactly that ("used up by an attempt that did not finish; file the same text with
  `ohmyagi proposal new`") instead of "filed again already, as" an id no record has.
- **A turn that answered and then threw said "it may have run".** The answer is now recorded the moment a
  backend's run returns it, so anything failing afterwards leaves "it ran — <backend> answered".
- **A refile keeps who first filed it:** `filedBy` and `fromTurn` come over from the old record.

## 0.9.0 — 2026-09-28

The agent's own signing key, and the first thing it signs: a usage report (S15.8, D-108, D-106, D-138). Then
what each turn really cost, priced from the tokens apart and a dated table, and signed in the same report
(S15.9, D-110, D-139). Then the engine's half of the protocol with the marketplace: proof that an agent holds
the key it registers, and reports bound to the market, listing and job they are for (S15.4 step one, D-141).
And a model chosen for a vendor CLI now reaches it, and the ledger records the model it says it ran (D-142).
And claude's 1-hour cache writes are priced at their own rate, from a new shipped table `2026-09-29` (D-143).

### Fixed — claude's 1-hour cache writes are priced at their own rate; shipped table 2026-09-29 (D-143)
- **The under-charge D-139 warned of, and D-142 measured.** Anthropic prices a write to the 5-minute prompt cache
  at 1.25× input and one to the 1-hour cache at 2×; table `2026-09-28` priced every claude cache write at the
  5-minute rate. A turn measured on claude 2.1.283 wrote all 11,856 of its cache tokens to the 1-hour cache and
  was 8,892 µ$ short.
- **The split is read apart.** claude's JSON output says which cache it wrote, in
  `usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}` (measured with one real
  `--model haiku` turn on 2.1.283; `modelUsage` carries no split). A usage gains `cache_write_5m` and
  `cache_write_1h`, parts of `cache_write` — kept only when both are printed and add up to it. A backend that
  never splits its writes (grok, ollama, codex) lists both in `not_printed`, and its writes stay one part at
  the `cache_write` rate. Lines written before still parse.
- **Shipped table `2026-09-29`, now the default.** Every entry gains `cache_write_1h`: claude's 1-hour write
  rates read off Anthropic's pricing page on 2026-09-28 (Fable 5.1 and 5 $20, Opus 5.5 $8, Opus 5 and 4.5–4.8
  $10, Sonnet 5 $4, Sonnet 4.5–4.6 $6, Haiku 4.5 $2 per million tokens — 2× input throughout); grok unchanged
  from xAI's page read the same day, `null` (no 1-hour cache). Every other rate is `2026-09-28`'s. `2026-09-28`
  is not edited: it keeps its digest and still checks the reports it priced.
- **`cache_write_1h` is optional in a price file**, so an owner's file from before stays usable. Left out it is
  no price: a turn that wrote to the 1-hour cache is not charged (`price-unknown`), never charged at the
  5-minute rate. A table that does not write it keeps the digest it had.
- **A write whose cache is unknown is not charged.** claude prints the split; a turn whose output lacked it and
  that wrote to the cache is `usage-unsplit` — D-110's rule that a missing count is billed at nothing, not at a
  guess, even a guess that can only fall low.
- **Usage report v2: `cache_write_1h_tokens` on a row, and the rate `cache_write_1h` in its cost — only on a row
  whose turn wrote to the 1-hour cache.** Every other row keeps exactly the shape the deployed marketplace
  (migration 0006) reads, so those reports are still taken; a row with a 1-hour write is new money arithmetic,
  and a marketplace that cannot do it refuses the report rather than recomputing it wrong. `usage verify`
  recomputes with the split, holds a shipped row's 1-hour rate to its table, and refuses a `0`, a part larger
  than the write, or a 1-hour rate on a row without 1-hour tokens.
- **Test vectors:** `test/fixtures/usage-report-v2.json` and `-job.json` are unchanged, byte for byte. New:
  `usage-report-v2-split.json`, six rows priced from `2026-09-29` and an owner's table, covering the split.
- **`usage prices`** shows a `cache_write_1h` column (and `--json` a `cache_write_1h` per price); `usage report`
  and `verify` show a row's 1-hour part and a group's 1-hour rate.

### Fixed — a model chosen for a vendor CLI reaches it, and the ledger records the model it ran (D-142)
- **`--backend claude --model opus` hands claude `--model opus`.** `backend()` gave the model to ollama alone,
  so a vendor CLI always ran its own default — the web page's "claude · opus" (D-085) never sent `opus`
  anywhere. A model now belongs to the backend it was chosen for: it is bound to that backend when it is
  built, and put on the CLI's command line behind the CLI's own flag, as one argument, never through a shell.
- **Each vendor's model flag, read off its `--help` on 2026-09-28**: claude `--model` (2.1.283), codex
  `--model` (`-m`, 0.155.1), grok `--model` (`-m`, 1.0.40), gemini `-m` (0.38.2), copilot `--model` with its
  fixed list (0.0.367), kimi `-m` (2.0.2). `claude-local` and `grok-local` run `local-coder` and take no model.
  A backend with no declared flag, and the local variants, **refuse** a model instead of running their
  default; a name that is empty, over 128 characters, starts with `-`, or holds anything but letters, digits
  and `._:@+/[]-` is refused too (exit 2 from `turn`, before anything is sent).
- **A model never leaks along a fallback chain.** With one `--backend` the model is that backend's. In a chain
  of several a bare `--model` stays the ollama step's, as it always was, and `--model claude=opus,ollama=qwen3:8b`
  gives each named step its own; every other step runs its own default, and `turn` says which step got which.
  A bare name in a chain of several without ollama is refused — which step was meant cannot be known. The
  chain itself refuses a request that carries a model. `soul verify`, `web` and `chat serve` read `--model` the
  same way, and `web` and `chat serve` refuse at start a `--model` no turn would take.
- **The ledger records the model the CLI ran, and what was asked for apart.** claude's and grok's JSON output
  name the model each turn called (`modelUsage`; claude also gives its canonical name, measured with one real
  `--model haiku` turn: key `claude-haiku-4-5-20251001`, `canonicalModel: "claude-haiku-4-5"`). That name is the
  line's `model`. The new `model_requested` holds what om-agi asked for (`opus`), or `null` for the vendor's
  default; lines from before still parse. When the output names no model the line's `model` is `null`, and when
  it names two, neither is picked.
- **Pricing uses only a model the CLI reported, or a requested name that is exactly a price-table entry for that
  backend** — and the second only when the output named no model at all. An alias (`opus`) is in no table and
  is never priced as the model it may resolve to; a line whose output named a different model is priced by that
  one; a line whose output named two is not charged. A usage report row names the model its price was looked up
  by, so a row charged by an exact requested name still checks against the shipped table.
- **`turn --json`** adds `model_requested` beside `model`, and the web page shows a model a CLI was only asked
  for as "asked for opus", never as the model it ran; a resolved alias reads "claude-opus-5-5 (asked for opus)".
- **The web picker suggests each backend's names from the vendor's own list and the price table**, never from
  ledger history, whose old lines carry wrong names; a backend that takes no model is offered none. The page
  accepts exactly the model names `turn` would hand a CLI (`opus[1m]` now among them).

### Added — proof of key possession, and reports bound to where they go (S15.4 step one, D-141)
- **`ohmyagi key prove <agent-dir> --subject <id> --market <origin> --listing <slug> --nonce <nonce> [--json]`**
  signs a market's challenge with the agent's key, so the market can register the public key knowing the agent
  holds its private half — not a key copied off somebody else's card. The proof is the same signed envelope as a
  usage report, over `{kind: "ohmyagi.key-proof", v: 1, market, listing, nonce, at}`. `--json` prints it alone,
  on one line. It never makes a key: without one it says to run `ohmyagi key`, exit 1.
  - `--market` is an origin as a browser writes it: `https://host[:port]` — http only to `127.0.0.1` or
    `localhost`, for a local test — with no path, no trailing `/`, no query, fragment, user name or password, the
    host in lower case and an international name in punycode. Anything else is refused (exit 2), and the refusal
    says the one spelling when there is one. `--listing` is the platform's slug rule; `--nonce` is 32 bytes of
    base64url, 43 characters, in its one spelling (`--nonce=<nonce>` when it begins with `--`).
- **`ohmyagi key verify-proof <file|-> --key <public-key> --market <origin> --listing <slug> --nonce <nonce>`**
  checks a proof as the market does: exit 0 only when it is signed by exactly that key and names exactly that
  market, listing and nonce; 1 when it does not; 2 for a command line it will not run.
- **`usage report --market <origin> --listing <slug> [--job <id>]`** binds the report to one listing on one
  market, and to one job there: the payload gains `binding: {market, listing, job}` (job `null` when not given),
  signed with the rows, so one report counts at one listing and nowhere else. Without both flags `binding` is
  `null` — a report for this machine, which no market takes. One without the other, or `--job` without both, is
  exit 2. The report stays `v: 2` (never released), and the field is required: a v2 report without it is refused.
- **`usage verify --market <origin> --listing <slug>`** holds a report to that market and listing: bound anywhere
  else, or to nothing, it is not valid (exit 1). Without them the binding is printed, escaped, and said to be not
  checked; the exit codes are as before.
- **Test vectors the platform ports:** `test/fixtures/key-proof-v1.json` (+ `.key`), a proof signed with RFC 8032's
  test-1 key for `https://market.example`, listing `ts-reviewer`, nonce bytes 0–31, at a fixed instant; and
  `usage-report-v2.json` regenerated with `binding` (`job: null`), beside a new `usage-report-v2-job.json` (job
  `job_01`). Tests rebuild each byte for byte; each was checked independently with Python's
  `json.dumps(sort_keys=True, separators=(",", ":"))` and `openssl pkeyutl -verify`, and re-signed with OpenSSL to
  the same signature.

### Changed — S15.4 step one
- **A signed number has one spelling** (D-141 §4). The strict reader every verifier uses refuses a number in
  anything but plain integer digits — `1.0`, `151250.0`, `1e3`, `1E3`, `-0`, a leading zero, a `+`, and an integer
  beyond 2^53 − 1. Before, `"usd_micros":151250.0` or `1.5125e5` verified, because the value, and so the canonical
  bytes, were the same. The owner's price file is read by the same reader, so a rate written `3e5` there is
  refused too (every number in it is a whole rate); nothing that legitimately holds a fraction reads through it.
- `usage report` and `usage verify` refuse an option they do not take, by name, instead of ignoring it.

### Added — pricing by real cost (S15.9)
- **Cache tokens are recorded apart.** claude and grok (and `claude-local`, `grok-local`) now record the cache
  reads and cache writes inside a turn's input as `usage.cache_read` and `usage.cache_write`; `usage.input`
  stays the whole prompt side, as before. A count a backend never prints is `null` and named in
  `usage.not_printed` — ollama prints no cache counts, codex prints one total and no parts — never 0.
  gemini, copilot and kimi are still unsurveyed and stay `unreported`.
- **A price table.** `src/pricing/shipped/2026-09-28.json`, version `2026-09-28`: per-million-token prices for
  input, output, cache read and cache write of current Claude models (Anthropic's pricing page) and Grok models
  (xAI's models page), read that day, in whole US micro-dollars. It prices only backends whose usage splits into
  those four parts. A shipped table is never edited: new prices ship as a new version beside it, so reports
  priced by the old one still check.
- **The owner's own prices**, in `$XDG_STATE_HOME/om-agi/prices.json`, the same shape. It is the only place a
  model on this machine gets a price (D-106), and where a subscription holder says what their turns really
  cost. An entry there replaces the shipped one for that backend and model. It must be yours and not writable
  by group or others; a field it does not know, a part left out or a price in dollars instead of micro-dollars
  is refused. A symlink whose target has gone is refused too — never read as "no file", which would price at
  list prices.
- **Cost in the ledger.** Every model turn's line carries `cost`: `{usd_micros, table, table_digest, source,
  usd_micros_per_mtok}` — the price, the table's version, `default` or `owner`, and every rate applied — or
  `null` with `not_charged` saying why: `usage-missing`, `usage-unsplit`, `model-unknown`, `table-unusable` or
  `price-unknown`. A turn with a count or a price missing is not charged; it is never estimated (D-110). Lines
  from before are not priced after the fact.
- **Cost in the signed usage report** (report `v: 2`). Each row adds `cache_read_tokens`, `cache_write_tokens`,
  `cost` and `not_charged`; money is integer micro-dollars (`usd_micros`, 1 = $0.000001), because signed JSON
  holds integers only. `usage report` prints the cost of each row and the total over charged rows, and counts
  the rest by reason.
- **`usage verify` re-checks every cost** from its own row's counts and rates, with the formula written in
  `src/identity/report.ts`. A row whose cost does not follow is not valid, however it is signed. A row that says
  its rates are a shipped table this build carries is held to that table — its rates, its model and its
  digest — and is not valid otherwise. Exit codes are unchanged.
- **Costs are shown by the price each row claims**: source, table, digest, backend and model, with the rates,
  and whether a reader can check them — rates the owner set, or a shipped table this build does not carry, are
  printed as not checked. The total says how much of it was checked against a shipped table and how much was
  not, and is summed exactly (BigInt) however many rows there are.
- **A row carrying a shipped table's digest is held to that table** whatever version or source it names, and
  rows that price one model two ways from one table (one digest) are refused. The report leaves such ledger
  lines out and says why, instead of counting them as bad ids.
- **`usage report --json` prints one compact line** (about 0.5 KiB a row, down from 0.8), and `usage verify`
  refuses any option but `--key` — a stray `--json` used to be ignored.
- **Each cost carries its table's digest** (`table_digest`, 16 hex characters of SHA-256 over the canonical
  table), so a version name cannot hide a changed price.
- **A signed v2 report pinned for the platform's verifier**: `test/fixtures/usage-report-v2.json` and its
  public key, rebuilt byte for byte by a test.
- **`ohmyagi usage prices [--json]`** shows the tables in force: the shipped one with its sources and date, and
  yours. Exit 1 when yours is there and cannot be used — then every turn is recorded as not charged
  (`table-unusable`) rather than priced at a list price you meant to replace. `turn` says so too.
- `ledger show` has a cost column.

### Fixed — S15.9
- **A ledger line names the model its backend really ran.** `--model` goes to ollama only, but every line of the
  chain recorded it, so a claude line could say `qwen3:8b` or `opus` for a turn claude ran on its own default.
  A vendor CLI's line now says `null`; ollama's says `--model` or its `OM_AGI_OLLAMA_MODEL` default. Such claude
  turns are therefore not charged (`model-unknown`) until the model reaches the vendor (D-142, above, does that). `turn --json` says the
  same, and the web page shows a cloud backend's model only as the turn reported it — no longer the model picked
  in the browser, which claude was never given.
- `turn` escapes what it prints from an unusable price file.

### Added
- **`ohmyagi key <agent-dir> --subject <id>` — the agent's own ed25519 keypair.** The first run makes it and
  prints the public key and a short fingerprint; every later run prints the same key and changes nothing. It is
  never replaced: a new key is a different signer to everyone who knew the old one.
  - The private key is PKCS#8 PEM at `$XDG_DATA_HOME/om-agi/<subject>/identity/ed25519.pem`, mode 600 in a 700
    directory, outside every git repository. It is never printed, logged, passed on a command line or written into
    the agent's repository.
  - It is written through a new file (`wx`) and linked into place, so two runs at once end with one key and a crash
    leaves no half key.
  - A key file group or others can read is refused, with the `chmod` that fixes it. So is a directory that is not
    700, a symlink, a key that is not ed25519, and a key directory inside a checkout.
- **The agent card carries the public key.** `soul card` and `a2a serve` add an A2A extension,
  `urn:ohmyagi:agent-key:v1`, in `capabilities.extensions`, with the algorithm, the public key and the fingerprint.
  With no usable key the extension is still there, with nulls, and says nothing the agent reports is signed.
  Printing or serving a card never makes a key.
- **`ohmyagi usage report <agent-dir> --subject <id> [--since] [--until] [--json]` — what the turns used, signed.**
  - One row per model delivery in the ledger: line and turn ids, time, duration, backend, model, and input and
    output tokens.
  - Never the prompt, the answer, their sizes, memory, the soul, the subject id or a path. The row is built by
    naming the fields that go, not by removing the ones that do not.
  - A2A and chat messages are not model turns and are left out.
  - A count the ledger does not have is `null`, marked `not-recorded`, `unreported` or `missing`, and never 0
    (D-110). The totals line says how many rows had none, and from which backends.
  - `--json` prints the signed envelope alone. The report makes no key; without one it says to run `ohmyagi key`.
- **`ohmyagi usage verify <file|-> [--key <public-key>]`** checks a report against the key on the agent card.
  - **Exit 0** only for a usage report that is well formed in every field and signed by exactly `--key`'s key.
  - **1** when it is not valid: a changed payload, another key, an unknown algorithm, a weak key, a duplicate
    field, or a string with control characters.
  - **2** for a command line it will not run.
  - **3** when the report is signed by the key inside it but no `--key` was given, so whose key it is is unknown.
    `usage verify r.json && accept` no longer accepts anyone's report.
- **Hardened after an independent security review of this work (D-138):**
  - **Weak keys are refused**, both in an envelope and as `--key`: the eight points of small order, non-canonical
    encodings (y ≥ p), a small-order `R` and an `S` that is not below the group order, as libsodium does. Under
    plain Ed25519 the identity point verifies every payload; a test shows that forgery working against the library
    underneath and refused here.
  - **Duplicate field names are refused.** Signed text is read with a strict parser; `JSON.parse` keeps the last
    of two, so a second `rows` could be shown to one reader and not another.
  - **No terminal escapes.** Every string in a report has a shape (ids, ISO-8601 times, a plain backend id, a
    model's name). A report with any other string is refused, and everything printed from one is escaped.
  - **A model that is a path is sent as null.** A model value that is not `name` or `org/name` is withheld, and the
    report says how many rows that happened to. A fractional `duration_ms` in the ledger is rounded instead of
    crashing the signer.
  - **The key is read through one open file.** `O_NOFOLLOW` and `fstat` on the handle, at most 4 KiB, and parent
    directories checked StrictModes-style. The git-checkout check now follows symlinks, for the personal directory
    too. A temporary file a crashed `key` left behind is removed at the next run.
- **What is signed** is Ed25519 (RFC 8032) over the UTF-8 of the payload in RFC 8785 canonical JSON, with numbers
  restricted to integers. For ASCII field names that is exactly Python's
  `json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`, checked against OpenSSL. A
  fixed test vector is pinned in `test/identity/sign.test.ts` for the marketplace's verifier (S16.4).

### Fixed
- **A relative `XDG_STATE_HOME` or `XDG_DATA_HOME` is ignored, as the XDG spec says.** It used to be honoured, so
  state landed under whatever directory a command was run from, and `erase` run from anywhere else never found it.
  An empty or relative value now falls back to `~/.local/state` or `~/.local/share` (found by S15.8's security
  review).

### Changed
- **A full `erase` removes the key; `erase --personal` keeps it and says so, as it keeps `role.md`.** The key is the
  agent's identity, not the person's data. The data map has a new entry, `identity`, under the `soul` place.
  - Erase now plans 13 trees (11 with `--personal`, 11 with `--no-agent`).
  - Under `--personal` the search reports the key's path, which names the subject, under a new scope kind, `kept`,
    rather than as a deletion that failed. The certificate is now `om-agi/erase-certificate@5`, with
    `verification.keptHits`.
  - `kept` is narrow and read off the disk. It covers only the key file, and a directory that holds nothing but
    the key. The note that the key is kept is printed only when a key file is really there. Anything else beside
    it, under `<subject>/` or in `identity/`, is still a deletable remainder, with or without a key (found by the
    second security review).
  - Deploy copies the key onto the encrypted volume, because the agent there is the same agent.
  - The `soul` place now also says that what the key signed stays signed wherever it went.

## 0.8.3 — 2026-09-28

A Memory map that stays usable at hundreds of memories, a search that says when it could not run, and what the
app needs to show an answer's sources. The macOS binaries are signed with a Developer ID and notarized (D-136).

### Changed
- **The Memory map shows a part of memory at a time, and can be filtered (D-137).** At 500 memories it drew one
  hairball and kept the laptop busy. It now lays out and draws only its view:
  - the 150 most linked by default, or 60, 300 or all;
  - **Find**, which shows what matches and what that links to;
  - **Around the chosen memory**, one or two steps out, walked by clicking a dot;
  - kinds switched off by clicking them in the legend, unlinked memories shown or hidden, and **Clear filters**.

  The counts still describe the whole memory and say how much of it is showing.
- **Drawing the map costs less.**
  - Lines are stroked in batches.
  - The glow is a sprite stamped per dot, instead of a canvas blur on every dot every frame.
  - At rest it draws at about 30 fps.
  - A stray dot near the eye no longer blows up and throws its lines off the edge.

  Measured in headless Chrome on 512 notes and 1229 links: the old map kept the page 76% busy, the new default
  17–19%, and All 26%.

### Fixed
- **A search that could not run no longer says "no hit".** With no full-text index yet and no vector store
  answering, `memory search` claimed it had looked and found nothing. It now prints `nothing searched` and exits 3.
  `/api/memory-search` says `searched: false`, and the page says "Nothing was searched:" with the reasons. Found
  while verifying the app's RAG work.

### Added
- **The app can show an answer's sources.** `/api/turn` now passes on what recall attached: each piece's path,
  heading, size, and how it was found (words or meaning), never its text, just as `turn --json` already reports
  it. Asked for by the app's RAG work, ohmyagi-app PR #10.

## 0.8.2 — 2026-09-27

Fixes reported on 0.8.1 and found by an independent review of its engine; the first E13 command, `deploy plan`.

### Fixed — reported on 0.8.1 by agent-fern
- **`ohmyagi backends` crashed** with `unknown vendor "claude-local"` since the local backends arrived (0.8.0): the
  table asked the vendor registry about every backend, and a local one is not a vendor — it runs one. Its row now
  names the vendor it runs and says its identity file is in a home of its own under the state root, never yours.
  The command had no end-to-end test; it has one now.
- **`ohmyagi web --help` lists `--qr`.**
- **The test suite no longer writes into this machine's Qdrant.** Two `turn` test files ran the CLI without
  `OM_AGI_QDRANT_URL`, leaving a synthetic `omagi__example` collection on the real store at every run.

### `ohmyagi deploy plan` — what a deploy would do, before anything is done (S13.1, E13, D-100)
- **A target file and a dry run.** `ohmyagi deploy plan <agent-dir> --subject <id> --target <file> [--json]`
  reads a JSON target — `ssh` (a VPS you rent), `gcp` or `aws`, with `arch` and an optional `home` (the machine
  on your tailnet where the local model is) — and prints what would go where: the binary for that CPU, the
  agent's repository as a git bundle, and each place of the subject's data with its size read off this disk and
  its path there, all of it on an encrypted volume. What is made there rather than copied (`.dagi/`, the vector
  collection), what stays here and why (the apply backups, level-3 confirmations, run records by pid, trigger
  times keyed by this machine's path), and what is not in the data map and does not go (vendor logins — S13.7;
  local models — S13.6; the brake). Then the services it would install (the page on 127.0.0.1, reaching the
  tailnet only through `tailscale serve`; the triggers timer), D-100's four conditions with how this provider
  can meet each and which story it waits on, and every `ssh`/`gcloud`/`aws` command line `apply` would run —
  keys on stdin, never in an argv. It ends with what it does not check, like `doctor`.
- **It runs nothing, writes nothing, sends nothing**, and skips the daily update check. Measured, not
  claimed: the plan is made in a test with spawn and fetch taken away and the tree counted before and after;
  the CLI runs under a PATH of traps for `ssh`, `scp`, `gcloud`, `aws`, `git` and `tar`; and the import closure
  of `src/deploy/` holds no process or network API — not even the spawn chokepoint.
- **The target file is strict.** Unknown fields are refused at every level, the provider block must match the
  provider, hosts that `ssh` would read as an option are refused, the arch must agree with the machine type,
  and `home` must be a tailnet name or address. A field named like a secret is refused as one, and the file
  goes through the repo guard's scanner; no value is quoted back once anything secret-shaped is found.
- `apply`, `status`, `update` and `destroy` are named and answer "not built yet" (S13.2–S13.5) with exit 2.
- **The data map is one list now** (`src/erase/map.ts`): erase removes what it names, deploy moves what it
  names, and each entry says how it travels. The remote's paths are erase's own resolvers evaluated with the
  remote's roots, which is what D-100 #2 needs. Erase's output is unchanged.

### Found while reviewing the app's and the relay's pull requests, and by an independent review of this engine (D-131)
- **Push subscriptions belong to the page key they were made under.** A page tells only the phones paired with the
  key it holds: after a key change of any kind — "Unpair every phone", a deleted key file, a page that makes a new
  key each start — the old key's phones are told nothing more, and a second page run for the same subject neither
  tells nor drops the first page's phones (the earlier wipe at a key-less start did drop them). Changing the key from
  the page drops the old key's subscriptions and asks the relays to forget them; if that fails, the key has still
  changed and the tab is told so instead of being locked out. Writes to the subscriptions file take turns.
- **An uncaught error on the page is a bare JSON 500** — no stack, no path.
- **Cloud grok turns switch off xAI's telemetry, trace upload and feedback.** After login, the owner's account got
  `telemetry=true` and `trace_upload=true` from xAI's remote config; `GROK_TELEMETRY_ENABLED=0`,
  `GROK_TELEMETRY_TRACE_UPLOAD=0` and `GROK_FEEDBACK_ENABLED=0` now ride every grok turn and win over it. The D-119
  switches were re-measured at run time rather than from `grok inspect` (which lists what it found either way):
  with them, 0 hooks ran and 0 MCP servers were spawned at session start; without them, 1 and 7.
- **`doctor` no longer passes a route that parsers read differently.** An `api_base` with `@` or `\\` in its
  authority, anything outside printable ASCII, or one that cannot be parsed is now read as leaving (a Python client
  took `http://127.0.0.1\\@api.example.com` to api.example.com); an ollama route with no `api_base` is "unknown",
  since LiteLLM takes that address from its own environment. Text from LiteLLM's answer is printed without control
  characters.
- **`erase` follows a linked instruction file to the file it points to.** kimi's home `AGENTS.md` as a link into
  dotfiles was replaced by an empty file while the block stayed in dotfiles, and the certificate said erased; now the
  link is resolved, a file two vendors reach is stripped once, and a link handed to the stripper is refused. The
  certificate also says a push relay keeps a phone's registration until it is told — unpair first.

## 0.8.1 — 2026-09-27

The engine side of the companion app (E14, D-125): pairing, unpairing and push. Plus two checks that close gaps
S12.6 and D-124 left open.

### Push, engine side (S14.3 — D-130)
- **A phone that asks is told "something is waiting", and nothing else.** The app hands the page a relay handle
  (`POST /api/push/subscribe`, behind the page's key); while `ohmyagi web` runs it looks every 30 s, and when a
  proposal is waiting that was not before it sends each subscribed relay the handle alone — no kind of event, no
  agent name, no text — at most once per five minutes (one that arrives inside the gap goes out when it ends).
  Starting the page tells nobody about what was already waiting. Off until a phone subscribes: until then the
  engine never contacts a relay. Relays are https (http only to a loopback literal); ten phones at most.
- Subscriptions are kept 0600 in the state root, one directory per subject, and `erase` takes it whole.
- **"Unpair every phone" also stops the notices:** every subscription is dropped and each relay is asked to
  forget its handle. Settings says how many phones are told, and what the relay learns (when, never what).

### Local action: `doctor` asks LiteLLM where `local-coder` goes (D-124 follow-up)
- **A route that leaves this machine now fails `ohmyagi doctor`.** Where local action is set up (a LiteLLM key
  file), `doctor` reads `/model/info` with the virtual key and places every `local-coder` route: loopback or an
  address of this machine's own is ok; another machine on the network, or a name only a local resolver can place,
  is a warning; anything else — or a provider with no `api_base`, which means its vendor's servers — is a
  failure, because held pieces of memory would go with a local-action turn. The key goes to LiteLLM alone, in a
  header, and appears in no output. What it cannot see is said: `local-coder`'s fallbacks sit in router settings a
  key limited to it cannot read, and a route changed after the last run is not noticed until the next.
- A LiteLLM key file holding only the master key is refused in one place now, for turns and `doctor` alike.

### kimi's home instruction file is looked in (S12.6 follow-up)
- **`worn` and `erase` now read `${KIMI_CODE_HOME:-~/.kimi-code}/AGENTS.md`.** kimi 2.0.2 reads it before any
  project file — measured in S12.6 (a line written there reached the system prompt and was obeyed), but the registry
  listed only `./AGENTS.md`, so an identity block left there reached every kimi turn unseen. om-agi still writes
  kimi's identity per project and never writes the home file; a block found in it now counts in `worn` (a second
  subject there is a `mixed` switch) and is stripped by `erase`. The file shared with copilot keeps each vendor's
  extra files through the merge, credited to the vendor that reads them. `~/.agents/AGENTS.md`, which kimi's source
  also reads, is unmeasured and not listed.

### Pairing a phone (S14.2, engine side — D-125)
- **A pairing code for the companion app.** `ohmyagi web --qr` prints the page's link as a QR code in the
  terminal (black on white by ANSI colour, so it reads on a dark or a light terminal), and Settings → *Pair a
  phone* shows the same code for the address the page was opened at. The encoder is in the engine (no
  dependency): byte mode, versions 1–10, all four levels; pinned codes were read back by an independent decoder.
  The code holds the key — the page says so, and says how to unpair every phone (change the key).
- **The page's key is compared in constant time.** A phone now holds it too, over a network.
- **Unpair every phone from the page (S14.2 AC3).** Settings → *Unpair every phone* changes the page's key while
  it runs: the new key is written to `--key-file` first (600, beside it and renamed over, never half a key), and
  only then used; every paired phone, every other tab and every saved link stop working, and the tab that asked
  carries on with the new key. If the key cannot be kept, the old one stays. The terminal is told, without the key.

## 0.8.0 — 2026-09-27

### Local action (E12) — the first three stories, built by other AI CLIs under `/agents-coding`
- **A kernel fence for local turns (S12.2, D-118).** A turn given `fence` runs its vendor CLI inside Landlock —
  writes only beneath the granted directories, TCP connect only to the granted ports, bind denied — through a
  hidden `ohmyagi __fence` helper that installs the rules and `execvp`s the vendor in the same process group. No
  Landlock, or an ABI older than 4, and the turn is refused with the reason. The command inside the fence is judged
  by the same spawn guard as any other (it had been a way around it).
- **The routing rule (S12.3, part 1).** `chooseRoute` sends a turn local when a recalled piece is held back from
  cloud and the turn acts, and says why in one sentence; `--route` comes with the local backends.
- **Local backends with tools (S12.1, D-117).** `claude-local` → `grok-local`: the real Claude Code and Grok CLIs
  on the local model through LiteLLM, each in a vendor home of om-agi's own, the key only in the child's
  environment, no web tools, always inside the fence. `turn --route auto|local|cloud` picks them (S12.3). Until the
  fence also closes UDP/DNS and checks addresses (S12.7), they get the cloud's copy of recall — none of the pieces
  a cloud may not see — and say so on stderr (D-123).
- **The fence closes UDP/DNS and checks addresses; local backends may see personal data (S12.7, D-124).** seccomp in
  the fence refuses UDP, IPv6, raw sockets and resolver sockets, and a supervisor lets `connect` reach only
  `127.0.0.1` on LiteLLM's port. Two ways out found outside the fence were closed first: vLLM no longer fetches
  image URLs, and local backends use a LiteLLM key limited to `local-coder` (`~/.secrets/.env.om-agi-litellm`,
  `LITELLM_API_KEY`) — a file with only the master key is refused.
- **Measured (S12.5):** on the owner's 24-task set, `grok-local` answers 87.5% with recall once the door is open
  (75.0% before it) — the cloud chain's 91.7%, within one task, with nothing leaving the machine.
- **`eval` files no proposals** (`turn --no-proposals`) — measuring an agent no longer puts questions in the owner's list.
- **The web says who answered (S12.4).** Under every reply: the backend, on this machine or cloud, the model, how
  many recalled pieces were held back, and — for a turn that acted — what it changed.

## 0.7.2 — 2026-09-26

### Backends — what SP-5 and S12.6 found wrong in how each vendor CLI is run (D-116 → D-121)
- **grok can act at levels 2 and 3.** Headless grok *cancels* any tool call that needs an approval and exits 0,
  so with no grant a level-2 turn ended at its first command having done nothing. It is now granted
  `--always-approve` (the owner's choice, D-119; the `--allow` rules still died silently on `rm`, on `$?` and in 3 of
  11 multi-step runs). `--max-turns` goes from 2 — which could never finish a 4-to-6-step task — to 20.
- **grok stops loading other tools' settings.** On the owner's machine every grok turn, level 1 included, ran Claude
  Code's hooks (a SessionStart hook that injects another persona among them) and seven MCP servers from
  `~/.claude.json`. The Claude and Cursor compatibility switches are now off for every turn om-agi starts, and the
  MCP meta-tools a level-1 turn used to reach a shell are removed.
- **kimi can run at level 1.** It was refused there because 2.0.2 seemed to have no read-only mode; it has one —
  `--agent-file`. om-agi writes a profile with only Read, Glob and Grep before every read-only turn (D-120). The
  built-in `plan` profile is not used: it fetches web pages, and a repository can replace it with one that writes.
- **codex stops phoning plugins and leaking keys to its shell.** Every turn now runs with `--disable plugins`,
  `--disable shell_snapshot`, `--disable apps`, `--disable remote_plugin` and
  `shell_environment_policy.ignore_default_excludes=false` (D-121): no fetch from github.com before the turn, and
  environment variables named `*KEY*`, `*SECRET*` or `*TOKEN*` stay out of the commands the model runs.
- **A turn that did not finish is no longer an answer.** A reply field that is there and blank used to be replaced
  by the whole JSON document — which then counted as confirmed; a notice printed before the JSON hid it; and grok's
  `stopReason` was ignored. All three now come back `silent`, so the chain moves on.
- **grok's token counts are read** (`/usage/*`), so its turns reach the ledger with numbers instead of `unreported`.

### Roadmap
- SP-5 answered (D-116): Claude Code, Grok and Kimi each drove the local 27B model through LiteLLM 15/15 with nothing
  leaving the machine — so E12 builds on them (claude → grok, D-117) inside a Landlock fence (D-118), not on a loop of
  our own. The platform and app repositories exist (D-122).

## 0.7.1 — 2026-09-26

### Turns — the chat keeps its context, and a personal line no longer holds a whole turn back (D-095)
- **Why the web chat could not act:** a recalled note carrying a personal word (a needle) or an email held the whole
  turn back from claude and codex, so it fell to the local model — text only, no tools. On the owner's memory 20 of
  82 notes carry one, so nearly every turn did. Now recall is chosen twice: everything for a backend on this machine,
  and only the pieces that pass the filter for a cloud backend, the room refilled with the next clean piece. What the
  person types is screened as before — a needle there still keeps the turn in.
- **Why the chat forgot:** each message was a turn of its own. The page now sends the last six exchanges;
  `turn --history-json` puts them in the system prompt under "This conversation so far" (the ledger's "asked" stays
  what was typed), each message screened on its own for a cloud backend.

### Web — phone audit (D-094)
- Measured on 360, 390 and 430 wide, every tab and each open state (picker, "/" menu, reader, editor, import, facts):
  no page scrolls sideways; now also no text under 11px (tab bar, tags, footer, code, the line under the box), every
  control at least 36px to touch (Clear, Edit tags, the backend chip, wizard steps; the footer is 32px), long paths
  wrap (Privacy), and the "/" menu wraps long arguments. The tag box no longer shows in Import or the editor.

## 0.7.0 — 2026-09-26

### Memory — facts drawn out of memory, confirmed one by one (D-093)
- `ohmyagi memory distill` has a local model read memory (by default `memory/knowledge/`) and offer short standalone
  facts, each with the words it came from; a fact whose quote is not in the note is cut. `show`, `decide <id>
  --yes|--no`, and `adopt [--yes]`, which writes only the yeses — one note per topic in `memory/knowledge/facts/`,
  each line citing `note:line` — through the same gates as `memory write`.
- Web: "Facts to confirm" in Memories — start a read (it runs in the background and the page asks after it), Yes/No
  on each fact with its quote and a link to the note, "Write the yeses". `/facts` opens it.
- On the owner's knowledge: 3 pieces read by qwen3.8:27b in about a minute, 22 facts, 2 cut.

### Memory — the things memories share (D-092)
- Ports, services, hosts, env names and paths are found in every memory by their shape — no model, nothing leaves the
  machine. `ohmyagi memory who <thing>` (and `/who`, `GET /api/memory/who`) lists every memory that mentions it and
  the line: `who 10410`, `who port 10410` and `who :10410` all ask for the port.
- The memory map's **Things** button adds what two or more memories mention as diamonds, a colour per kind, joined
  by dashed lines; clicking one lists where it is mentioned. On the owner's memory: 83 notes, 95 shared things.

### Memory — collections (D-091)
- A memory's `tags:` in its front matter puts it in collections (`tags: [infra, ports]`; inline, comma or block
  lists are read). The Memories tab shows every collection with its count; pressing one narrows the list and the
  map. "Edit tags" on an open memory writes them through `memory write`. `/tags` lists them, `/tag <name>` opens one.

### Memory — knowledge, kept apart from memory (D-090)
- Everything under `memory/knowledge/` is **knowledge** — documents, manuals, pages brought in to look things up
  in; everything else is the person's **memory**. `memory import` now writes to `memory/knowledge/`.
- `ohmyagi memory move --file … --to knowledge|memory|<path>` moves a memory between them (same gates as write, one
  rebuild). `memory search --scope knowledge|memory` looks in one kind; a turn's recall still looks in both.
- Web: an All · Memory · Knowledge switch with counts, a "Move to Knowledge / Memory" button, search by meaning
  follows the switch, `/search knowledge <words>`, and knowledge drawn as squares on the memory map.

### Web — the version in a footer (D-089)
- A thin bar across the bottom of every screen: "Oh My AGI v0.6.1", a note when the last update check saw a newer
  release, and the agent and subject on the right. Pressing the version checks for a newer one. On a phone it sits
  under the tab bar, which moves up with the message box.

### Web — a restart no longer cuts off what is running (D-088)
- `ohmyagi web` stopping on SIGTERM or Ctrl-C lets requests already running finish and answer, and says how many;
  a second signal stops at once. Before, an import that had written its file was cut off while rebuilding the
  index, and the page said "The server did not answer". A systemd unit for it wants `KillMode=mixed` so the
  command doing the work is not killed under it.

## 0.6.1 — 2026-09-26

### Project
- Om the mascot is the README icon and the web page's tab icon. The description says what 0.6 is. GitHub
  community files: SECURITY (private reports), CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1), SUPPORT,
  issue forms, a pull request template, CODEOWNERS, dependabot for actions, .editorconfig and .gitattributes.

### Memory — import pages built by JavaScript (D-087)
- A web page that arrives as an empty app shell (React, Vue, Next export…) is run in a headless Chrome or Chromium
  with a throwaway profile, then read — it used to fail as "nothing readable". With no such browser installed it
  says so and suggests saving the page as PDF. The "scanned PDF" hint is now given only for a PDF.

### Web — "/" commands in the chat (D-086)
- Type `/` in the message box for a menu of commands (↑ ↓, Tab or Enter, Esc); each does something the page can
  already do: `/help` `/clear` `/retry` `/copy` `/export` · `/backend` `/model` · `/status` `/waiting`
  `/approve` `/decline` `/do` · `/search` `/remember` `/import` `/memories` · `/autonomy` `/stop` `/update` ·
  `/go` and `/agent` `/profile` `/privacy` `/settings`. Suggestions are named by their number in `/waiting` or the
  start of their id. What a command says appears as the page's own note in the chat, not the agent's. `//` sends a
  message that starts with a slash.

### Web — switch backend and model from the chat (D-085)
- A chip under the message box shows who answers ("claude · opus"); pressing it opens a backend picker (the ones
  not on this computer are greyed) and a model box with suggestions for that backend: models that really answered
  (from the ledger), the local model and what the local Ollama lists, and Claude's aliases. A model meant for
  another backend is cleared when the backend changes. The same choice as Settings, which stays in step. Each
  answer names the model that was asked for. `GET /api/models`.
- A backend named by the page no longer inherits the model `ohmyagi web` was started with; a model alone still
  keeps the started backend.

### Web — "Waiting for you" selections
- A selection holds only the cards on screen: "Select shown" no longer picks cards folded under "Show all", and a
  filter that hides a selected card drops it, so a bulk "Allow once" never reaches one you did not see. The count
  reads "2 of 5" while filtering.

## 0.6.0 — 2026-09-26

### Memory — import documents and web links (D-084)
- `ohmyagi memory import` and the Memories tab's Import… bring a file or a web page in as a markdown memory under
  `memory/imported/`, with front matter naming the source. Markdown, text, HTML and data files are read directly;
  PDF with `pdftotext`; `.docx` from its XML (LibreOffice if that fails); pptx, xlsx, odt, rtf, epub and others
  through LibreOffice. Anything over one memory's 256 KB is cut into linked parts. Every part passes the credential
  scan and needs a memory basis. On the page: drop files or paste a link, see each checked, then Import.

### Web — fonts (D-083)
- Electrolize for English and IBM Plex Sans Thai for Thai, bundled in the binary (both OFL 1.1) and served from
  `/fonts/`, so the page stays offline and CDN-free.

### Web — Memory map (D-082)
- The Memories tab opens with a 3D map: each memory is a neuron, sized by its links, and each `[[link]]` (or a
  relative `.md` link) is a synapse with signals running along it. Drag to turn, scroll to zoom, hover to see a
  memory's neighbours, click to read it. Broken links are counted. Drawn by hand on a canvas (no library), paused
  when out of view, and still under reduced motion. `GET /api/memories/graph`.

### Web — Memories CRUD (D-081)
- The Memories tab can create, edit and delete memories. It has New (with a front-matter template), Edit with
  Preview, and Delete (shown first). Saving runs the new `ohmyagi memory write`: the path must be a `.md` under
  `memory/`, a memory basis must be on record, the credential scan applies, and both indexes are rebuilt with the
  vector collection dropped whole. Deleting runs `memory forget`.

### Web — four gaps closed (D-079)
- What waits can be filtered and decided in bulk. A poll no longer throws away a note being typed.
- The chat survives a reload (kept in this browser). A Recently row opens to the full question and answer from the
  ledger, with "Ask again".
- A Privacy tab shows whether capture is on, every message kept on this machine (the rule, never the words), and the
  basis records with a Revoke button.
- Persona drafts can be answered on the page: `persona show --json` and `persona decide`. "Write the yeses" runs
  `persona adopt`.

### Web
- Redesigned as an agent console (D-078). On a desk: a sidebar with the agent, its status, sections with icons and an
  Engine box (the backend chain, the local model, the judge, and who answered last), with the chat as the main panel.
  On a phone: a compact top bar and a bottom tab bar. Dark by default with a working light theme. Before the redesign,
  a phone audit fixed eight problems: an off-screen tab, a header taking half the screen, a chat buried under 16
  cards, low-contrast buttons in the dark, and others.

### Data ownership (E7)
- `ohmyagi basis record|show|revoke` (S7.3, D-077) records on what basis a subject's data may come in: the basis, who
  approved it, when, for which uses (memory, persona, fine-tune) and until when. Recording is typed at a terminal.
  `memory ingest` and `persona extract` read nothing without an active record for their use, and the owner's own data
  needs one too (basis `owner`). `erase` removes the records.

## 0.5.1 — 2026-09-25

### Identity (E6)
- SP-3 closed as not passed for now (D-076): soul + RAG already answers 91.7% of the task set, the data is 270
  pieces rather than 1k–10k, and trained weights cannot have one person removed. S6.3 is not built; om-agi has no Python.
  D-076 lists the conditions for reopening it.

### Recall
- Recall finds the answer more often (D-075). A turn's query drops English stopwords, ranks 12 hits instead of 8, and
  attaches up to 4500 characters instead of 3000. On a real agent's 24 tasks, the attached text held the answer for
  91.7%, up from 79.2%. `ohmyagi eval --recall-only [--recall-chars <n>]` measures this without asking any model.

## 0.5.0 — 2026-09-25

### Web
- A Profile tab: a nine-step wizard over every axis of the agent (D-074). The steps are identity, scope, prohibitions,
  voice, principles, whose knowledge it carries, autonomy 0–2, notes, then review and save. It saves through the new
  `ohmyagi soul edit --profile <file> [--yes]`, which says which fields change and writes only a soul that still
  loads, firewall included.

### Identity (E6)
- `ohmyagi persona extract|review|show|adopt` (S6.1, D-072) drafts a soul from real artifacts with a model on this
  machine. Every claim must quote its source, and a claim whose quote is not there is cut as made up. The owner answers
  yes or no to each claim at a terminal, and only the yeses are written: role knowledge with its source to `role.md`,
  personal traits to `person.md`. The soul must still load afterwards. Drafts stay in `personal/`.
- `ohmyagi eval` (S6.5, D-073) runs the job's task set in `evals.md` (20 real tasks or more) twice: the soul alone
  and soul + recall. Each answer is graded by required and forbidden phrases, not by a model. It reports percentages
  by configuration and by kind of work, and names the kinds it cannot do yet.

## 0.4.2 — 2026-09-25

### Web
- Markdown is rendered: answers, memories (with a "show as written" switch) and the soul's notes (D-070). It is a
  small built-in renderer that builds elements, never HTML; only http(s) links become links.

### Backends
- `OM_AGI_OLLAMA_MODEL` names the local model a chain's fallback uses when a turn names none (D-070). Before this, a
  turn the egress filter or judge kept off the cloud had no model to fall back to, and nothing answered.
- A turn's judge reads the question and what recall attached, not the soul (D-071); the filter still reads all of it.
  Before this, with needles set, the judge kept nearly every turn off the cloud.

## 0.4.1 — 2026-09-25

### Web
- A page opened without its key (or with an old one) says so in its header, clears the stale key, and takes the
  link or the key pasted into a box, so there is no terminal round-trip. Answers in the chat carry the agent's name.
- Om, the mascot, heads the page and speeds up while it thinks. There are two new tabs (D-068). **Agent** shows the
  whole soul, the repository (its remote, HEAD and last commit) and counts. **Memories** lists every `memory/**/*.md`
  with a filter, a reader and "Search by meaning" (`memory search`). Both are read-only, and the reader cannot leave
  `memory/`.
- A Settings tab (D-067). It sets each category to 0–2 (`autonomy set`), picks the backend and model this browser's chat
  uses, stops answering a chat user (`chat remove`), removes a peer (`a2a remove`) and checks for updates. It also
  shows the privacy guards. Level 3, adding a person or peer, consent, the brake and installing an update stay in the
  terminal, and there is no route for any of them.
- On a tailnet address the page answers to the machine's tailnet names; `--name` adds others. `--https` is for a page
  on loopback behind `tailscale serve --https=<port>`: it accepts the tailnet name and prints the https link.
- `--key-file <path>` keeps the page's link across restarts (D-069). The key is made once at 600, and a key file
  others can read is refused.

## 0.4.0 — 2026-09-24

### Chat (E9)
- `ohmyagi chat` (S9.1, S9.2, D-066): the agent answers people on Telegram. `chat allow telegram <user-id>` is typed
  at a terminal, and there is no flag for it. `chat serve --token-file <f>` long-polls the agent's own bot.
  Anyone not on the list gets no answer at all. The first answer to each person, and every answer to "are you a
  bot?", says it is an AI. Each answer is a turn held at level 1 and must pass the filter *and* the local judge
  (serve refuses to start without `OM_AGI_EGRESS_JUDGE`); anything caught becomes "I can't share that here.", and no
  approval lets it out. Every message, in and out, goes to the ledger as `chat:telegram:in|out:<user>`. `erase`
  removes the allowlist. Platforms are adapters in `src/connectors/`.

### Install
- `ohmyagi update` (D-065): `--check` asks the public repository for a newer release; `--yes` downloads this
  machine's build, checks it against the release's SHA256SUMS and swaps it in by rename (a checkout is told to use
  git instead). Commands check once a day by themselves, only at a terminal, after they finish, in one line;
  `OM_AGI_NO_UPDATE_CHECK=1` turns that off.

### Observer (E3)
- `observe interests --root <dir>…` (S3.4, D-064): projects ranked by frequency × recency (half-life tunable,
  default 7 days), counted through `countPersonal` over directories on your own disk — no record's words become
  keys, and nothing is kept. `countPersonal` gains a `day` take.

### Agent-to-agent (E8)
- `ohmyagi a2a` (D-063): `allow` a peer (typed at a terminal, never by a flag; each peer gets its own token),
  `serve` (loopback, the agent card with a bearer scheme; what an allowed peer sends is written to the ledger, then
  the inbox — never run), `send` (only to allowed peers, through both egress layers, announced, ledger first),
  `peers`, `remove`, `inbox`. Interop checked against the real `bwoc-a2a` in both directions.

### Release
- CI (D-062): every push and pull request runs typecheck, the tests and the coverage gate. `bun run release:check`
  adds the identity firewall's real-model test (S6.4) and refuses to pass without `OM_AGI_RELEASE_MODEL`.

### Data (E7)
- The egress guard's second layer (D-061): with `OM_AGI_EGRESS_JUDGE=<ollama model>`, a model on this machine reads
  every prompt the text filter passed before it leaves — paraphrase, translation, other scripts — and anything it is
  unsure about stays in. Loopback only; used by `turn`, `proposal triage` and `egress check`. Red team 10 of 10 with
  qwen3.8:27b (was 8 of 10), ordinary work still leaves.

### Web
- `ohmyagi web <dir> --subject <id>` (D-060): one page for an agent, in plain words — what it may do on its own, a
  Stop everything button, proposals waiting for a yes or no (with Jev's labels as "Changes this computer",
  "Hard to undo" …), "Do it now" for approved ones, a chat, its schedule and recent turns. Every button runs the CLI;
  level 3, capture consent, releasing the brake and erase stay in the terminal. Loopback by default, a one-time key
  in the link, a Host check and a strict content policy; no remote assets, works offline.

### Autonomy (E5)
- `proposal triage` (D-059, opt-in): TypeSafe's Jev reads a proposal's what/why/impact and labels it — kind of action
  (read-only · local-change · external · destructive), whether it can be undone, whether it touches private data —
  with probabilities, shown in `proposal list` and `show`. Advisory only: it approves nothing. The text is screened
  by the egress filter first and the departure is announced; `OM_AGI_TRIAGE=jev` triages every filing. Needs
  `TYPESAFE_API_KEY` (or `TYPESAFE_API_KEY_FILE`).

### Published
- A public repository, [`bemindlabs/ohmyagi`](https://github.com/bemindlabs/ohmyagi), starts from a one-commit
  snapshot of 0.3.0 (`v0.3.0-alpha`, pre-release — D-058). Local paths and addresses are replaced on export; the
  development history stays in the private repository. A snapshot carries `.snapshot`, and the one test that checks
  a sha in the development history skips there and says why.

### Docs
- The product is called **Oh My AGI** everywhere a sentence names it; the command stays `ohmyagi`.
- README: four Mermaid diagrams (how the parts fit, one turn, autonomy, what is remembered and how it goes), an
  Install section (release binaries checked against `SHA256SUMS`, the macOS signing step, from source, the `.pkg`)
  and Set up an agent (`ohmyagi setup`, the same steps by hand, what to do next).
- ADR 0001/0002, the CLI matrix, the demo notes and the backlog brought up to date with what shipped.

## 0.3.0 — 2026-09-24

The observer mines routines and sequences from what you did, and offers the timed ones as triggers.

### Observer (E3)
- `observe patterns` (S3.3, D-057): routines (the same action in the same project on 3+ days, with a 2-hour time
  window when 60% of those days share one) and sequences (B within 10 minutes of A, 5+ times on 2+ days, 60%+ of the
  time), each with its evidence, and a `triggers.md` snippet for timed routines that you copy yourself. Recomputed
  on every run and never stored. Shell plumbing (`cd`, `cat`, …) is not an action, and wrappers like `rtk` are seen
  through. The miner is the third file allowed to open a `Personal` box, and only `observe` imports it.

### Known limits
- S3.3 AC6 is open: the owner judges the top five patterns once capture has run for a few weeks.
- Still not built: the interest tracker (S3.4), agent-to-agent messaging (S8.2, S8.4) and chat connectors (E9), LoRA
  (S6.3, behind SP-3). Partly met: S6.4 AC4, and S8.3 AC3 — the egress filter catches 8 of 10 red-team forms
  (paraphrase and translation get through).

## 0.2.0 — 2026-09-24

The command is now `ohmyagi`, a first agent can be set up by answering questions, the agent can work on a
schedule (always as proposals), and there is a macOS installer.

### Install
- `ohmyagi setup` (D-056): the first run, one question at a time — checks the machine, creates an agent, writes its
  soul from the answers, runs `soul check` and a first turn. It raises no autonomy, enables no capture and writes
  into no AI CLI's files; it prints those commands instead.
- macOS installer: `bun run build:macos` cross-compiles arm64 and x64; `packaging/macos/build-pkg.sh` (on a Mac)
  builds a universal, optionally signed and notarized `.pkg` that installs `/usr/local/bin/ohmyagi` and opens
  Terminal with `ohmyagi setup`. No LaunchAgent, no data.

### Name
- The command is `ohmyagi` (D-055); `om-agi` stays as an alias. `bun run build` produces `dist/ohmyagi`.
  Data directories, `OM_AGI_*` variables, schema ids and markers keep their names, so nothing on disk moves.

### Autonomy (E5)
- `triggers show / tick / schedule` (S5.3, D-054): schedules written in `triggers.md` beside `autonomy.md`.
  Each due trigger runs as an ordinary `turn` held at level 1 — it proposes and never acts, whatever the dial
  says — once per window, never under the brake, one tick at a time. om-agi runs no daemon: `schedule` prints
  a systemd timer and a cron line that call `tick`, and installs neither. `erase` removes the fire times.

## 0.1.0 — 2026-09-24

First release: the full MVP (`.scrum/backlog.md` §7) — *the first agent that is a real identity,
moves between machines, and can prove itself.* Every item below is ticked against acceptance
criteria in the backlog; the reasoning behind each is a numbered decision in `.scrum/decisions.md`.

### Identity (E1)
- `soul` — one definition (role + person, two files) rendered into every AI CLI:
  claude, codex, copilot, kimi, gemini, grok (by flag), and the local ollama path. `soul apply` shows a diff before writing,
  `soul revoke` puts every touched file back byte for byte, `soul verify` measures whether the identity
  actually landed, per backend.
- Isolation: switching identity leaves nothing of the previous one behind (S1.6).
- `soul check` (every problem with its file and line) and `soul card` — the A2A 1.0.0 agent card, built from
  `role.md` only, saying it is an AI (S8.1; not served yet).
- `soul import` converts an existing bwoc agent without losing a line.

### Engine (E0, E2)
- One agent, one git repository; `.dagi/` is derived and rebuildable (`rm -rf .dagi && ohmyagi rebuild`).
- A repo guard scans what is staged for secrets and personal data; it never pushes and has no code that can.
- `turn` runs one turn wearing a soul, trying backends in order until one really answers; every turn is in the ledger.
- `doctor`, `backends`, `worn`.
- `guard install / scan / status` — the pre-commit and pre-push hooks, and what none of it reaches.
- `ledger show / forget` — what was asked, when, of which backend; and withdrawing it.

### Observer (E3)
- Actions (files edited, commands run, tools called) captured by hook at the moment they happen, with consent,
  local-only. Fleet launchers declare themselves (`OM_AGI_FLEET`) so their work never lands in the owner's data.
- `observe enable / disable / hook / capture / seed / status / actions / audit / leaks / purge` — consent typed by
  the person it is about, the hook snippet, a one-time seed from history, counts-only summaries into git, the
  accuracy audit, fleet-leak counts, and purge.

### Recall (E4)
- `memory index / search / ingest / forget`: full-text (FTS5 trigram) plus a per-subject Qdrant collection,
  both derived from `memory/` in git; every turn carries related memory, named on stderr before it goes.

### Autonomy (E5)
- A dial per category (read, write, run, reach); a turn acts at the lowest of write, run and reach.
  Level 1 proposes instead of acting, 2 acts and reports, 3 needs a confirmation typed at a terminal.
- `autonomy show / set / resume` — per category, with who set it and when; level 3 typed at a terminal.
- `proposal new / list / show / decide` — a store of its own; a refusal is remembered, an approval is good for
  one turn (`turn --proposal <id>`).
- `stop`: one command, every category to 0, running work killed (SIGTERM, then SIGKILL).

### Data (E7)
- `erase` removes a subject from every place om-agi writes, checks again from disk, and says what it cannot reach.
- The egress filter keeps personal data and credentials off cloud backends, falling through to local;
  `egress needles / check / log` — your own list of what must not leave, a dry screen, and what was kept in.

### Also in this release
- A turn whose dial settings disagree names the category in force (D-052).
- The repo guard's scanner knows a placeholder (`<pw>`, `***`, `{{…}}`, a path) from a secret (D-051).

### Known limits
- Categories are set apart but act together — one shell both writes and reaches out (D-052).
- grok ignores a project instruction file (use the flag); gemini was not measurable on the test account.
- Not built yet: triggers mined from behaviour (S5.3 with S3.3), pattern miner (S3.3), interest tracker (S3.4), LoRA (S6.3, behind SP-3),
  agent-to-agent messaging (E8) beyond the agent card.
