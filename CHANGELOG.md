# Changelog

## Unreleased

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
