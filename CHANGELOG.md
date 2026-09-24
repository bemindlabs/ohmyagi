# Changelog

## Unreleased

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
