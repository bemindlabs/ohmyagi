#!/usr/bin/env bun
/**
 * The coverage gate: every source file, and 85% of its lines.
 *
 * ## What this gate used to ask, and why that was not enough
 *
 * `bun test --coverage` only reports files some test actually imports. A source
 * file nothing imports does not show up as 0% — it does not show up at all, and
 * the summary line happily reports 90% while half the code is invisible. So the
 * gate's first question is still **"is there a source file no test has ever
 * loaded?"**, and that question stays: it is the one that catches a promised
 * test file never being written.
 *
 * But for a while that was the *only* question, and a file could answer it
 * without a single assertion ever touching it. `import { thing } from "../src"`
 * in any test loads the whole barrel, and every module behind it counts as
 * seen. The gate went green over code nobody had tested.
 *
 * `src/types.ts` is the proof, not a hypothetical. It scored 70% under the old
 * gate and passed, because a test somewhere imported a type from it. The three
 * uncovered lines were the `throw` inside `subjectId()` — the file's only
 * runtime behaviour. And that file is where `SubjectId` is defined: the brand
 * that makes I-3 (identities never bleed) checkable across the whole system.
 * Its validation had no test on it at all, and the gate said "loaded, fine".
 * A gate that reports health while the one thing it guards is untested is the
 * same silent success this project exists to catch.
 *
 * ## What it asks now
 *
 * Not "was the file loaded?" but **"does the test suite execute at least 85% of
 * this file's lines?"** — per file, so a well-covered module cannot carry an
 * untested one on a repo-wide average. Absence from the report is still an
 * automatic failure, checked first.
 *
 * ## Where 85 comes from — and what to do before you change it
 *
 * Measured, not chosen. `bun test --coverage` over the 29 non-exempt source
 * files gave three clusters and one outlier:
 *
 *   - 16 files at 100%
 *   - 9 files at 93.15–98.68% (frontmatter, block, bwoc, import-map, verify,
 *     store, entry, render, targets)
 *   - 3 files at 86.11–89.30% (serialize, rebuild, apply) — the uncovered parts
 *     are TOML escape branches and error tails
 *   - 1 file at 70% (types.ts, described above)
 *
 * 95 would fail nine files that have real, thorough tests on their first run,
 * which makes the number wrong rather than the files. 60 or 70 would bless
 * exactly the case the gate exists to catch. 85 is the highest multiple of five
 * below 86.11, the worst score among files that are genuinely tested: every
 * such file passes, and only code with no assertions on it goes red.
 *
 * So the number is a reading of this repo at one moment, not a law. If you want
 * to move it, **measure again first**: `bun run scripts/check-coverage.ts
 * --report` prints every file's line coverage, and the new number should be
 * defensible against that table the way 85 is defensible against this one. If a
 * change makes a file with good tests go red, the criterion is wrong, not the
 * file.
 *
 * ## Why `bin/` is asked a different question
 *
 * The floor watched `src/` and nothing else, and `bin/` grew to 15 files and
 * ~2,700 lines of code — about a fifth of the engine — entirely outside it. The
 * obvious repair is to point the same floor at `bin/` too. Measured
 * (2026-09-21, bun 1.4.2, 1118 pass / 7 skip), that repair fails:
 *
 *   - 10 of the 15 files did not appear in the coverage report **at all**;
 *   - the 5 that did are the ones a test imports for a constant, and they
 *     scored 3.74–29.21% (`bin/commands/soul.ts` 3.74%, `bin/shared.ts`
 *     29.21%) — being loaded is not being tested, again;
 *   - `bun test --coverage` counts lines this process runs. The CLI's tests run
 *     it the way a person does — `Bun.spawn(["bun", "run", "bin/om-agi.ts", …])`
 *     — and bun measures nothing in a child process. `bun run` has no coverage
 *     flag of its own.
 *
 * So all 15 would have gone red on their first run while a dozen files under
 * `test/cli/` ran the real CLI at them. A criterion that fails well-tested
 * files is the wrong criterion, not a verdict on the files — the same rule that
 * set 85 rather than 95 above. `bin/` is therefore split in two:
 *
 * **On the floor** — every file under `bin/` that is *not* listed in
 * {@link SPAWN_ONLY}. That is the default, so a new file arrives watched: it
 * has to earn its tests or earn a line in the list with a reason. Two are
 * there today, `bin/shared.ts` and `bin/as.ts`, and they went from 29.21% and
 * 11.51% to 98.82% and 96.90% by being *called* rather than spawned — which is
 * the difference the split is about, and the reason the list is a list and not
 * `bin/commands/**`.
 *
 * **Held at a recorded size** — {@link SPAWN_ONLY}, the files whose lines only
 * run in a spawned process. Each carries the number of code lines it had when
 * it was last measured, and the gate fails if a file is bigger **or smaller**
 * than its number. Smaller matters as much: a file that shrinks without the
 * number moving leaves slack for the next change to grow into, unseen, and a
 * second list that drifts from the first is a thing this repository has already
 * been bitten by.
 *
 * Say plainly what that buys, because it is less than a floor: it says the part
 * bun cannot see **is not growing while nobody watches**. It does not say that
 * part is tested. The question "does a test reach this command at all?" is
 * asked elsewhere and is not repeated here — `test/cli/layout.test.ts` proves
 * no file under `bin/` is orphaned, and `test/guard/no-push.test.ts` spawns the
 * CLI for real. And every run prints how many files and lines are in this half,
 * green runs included, because the one outcome worth refusing is that a fifth
 * of the engine sits unwatched without anyone knowing it.
 *
 * If bun learns to measure a child process — or the tests stop needing one —
 * then measure again and move these files onto the floor, where the number
 * means more.
 *
 * ## Why `scripts/` is asked a third question
 *
 * `scripts/` was outside the gate entirely, and it is where the tools that
 * prove the rest of this repository live. Measured on 2026-09-21 (bun 1.4.2,
 * 1170 pass / 7 skip):
 *
 *   | file                        | line coverage | what was never run            |
 *   |-----------------------------|---------------|-------------------------------|
 *   | `check-coverage.ts`         | 48.74%        | `main` — verdict → exit code  |
 *   | `sp1-transcript-survey.ts`  | 39.57%        | everything touching `homedir` |
 *   | `cli-parity.ts`             | **absent**    | all of it                     |
 *   | `demo-bare-container.sh`    | unmeasurable  | bash                          |
 *
 * `cli-parity.ts` was absent rather than low, and could not have been anything
 * else: it had no `import.meta.main`, so importing it from a test read `--base`
 * off the test runner's command line, failed to find it, and called
 * `process.exit(2)`. The harness that proved `split1` changed nothing was
 * itself unprovable, and the gate that finds unwatched code could not see the
 * folder it lives in.
 *
 * The obvious repair is the one `bin/` got: a floor, and a recorded size for
 * whatever the floor cannot reach. Half of that is right and half is wrong.
 *
 * **The floor is right where the file is judged like `src/`.** `check-coverage.ts`
 * is now judged that way — `judge()` is pure, `measure()` takes the command it
 * runs, and the percentage means what it means everywhere else.
 *
 * **The size ratchet is the wrong question for a proof tool.** `bin/` is held
 * at a size because the risk there is *growth into the dark*: lines arriving
 * where nothing can see them. A proof tool fails differently. `cli-parity.ts`
 * can sit at exactly 1,046 lines, byte for byte the same, and stop proving
 * anything the day a `case` is added to `bin/om-agi.ts` that its matrix never
 * runs. Nothing about its size moves. A ratchet would stay green over a harness
 * that had quietly become a harness for a CLI that no longer exists.
 *
 * So the third question is asked per file, by name, in {@link PROVED_OTHERWISE}:
 * *what would have to be true for this file to still be doing its job, and
 * which test asks that on every run?* Membership costs a line and an answer,
 * the way {@link EXEMPT} and {@link SPAWN_ONLY} do. Anything under `scripts/`
 * that is not listed is gated by the floor if bun can measure it — and **fails**
 * if it cannot, which is what makes a new `.sh` arrive red rather than arrive
 * unwatched.
 *
 * {@link PROOFS} is the weaker half, and is written down as weaker. A recorded
 * sha256 says the bytes have not moved since a run that a person did and dated.
 * It does not say the file passes today, and it cannot see `scripts/demo-bare-container.sh`
 * broken by a change in `src/` — nothing inside `bun test` can, because the demo
 * needs docker, a GPU and a pulled model. That limitation is printed on every
 * run rather than left in this comment, for the same reason the `bin/` summary
 * is: a hash printed beside a percentage reads as a percentage unless it says
 * it is not one.
 *
 * What is *not* here: `sp1-transcript-survey.ts`, deleted in the same task. It
 * was a spike whose note (`notes/sp1-transcript-yield.md`) is cited by D-024,
 * which has already chosen capture over a backfill, so no decision was waiting
 * on it — and it was the only code in this repository that read the owner's
 * real transcripts. The lowest-coverage file in `scripts/` was also the widest
 * surface on I-3 and I-6, and the honest answer to "what question should this
 * be asked?" was that nobody needed the answer any more.
 *
 * ## The unit of "size", measured rather than picked
 *
 * Non-blank, non-comment lines ({@link codeLines}). The first candidate was
 * lines on which a statement *starts*, read with the `typescript` parser that
 * `test/support/ast.ts` already uses, on the grounds that it is closer to what
 * lcov calls `LF`. Measured against the five `bin/` files lcov does report, it
 * is not:
 *
 *   | file                   | lcov `LF` | statement starts | code lines |
 *   |------------------------|-----------|------------------|------------|
 *   | `bin/as.ts`            |       139 |               66 |        145 |
 *   | `bin/shared.ts`        |        89 |               63 |         98 |
 *   | `bin/commands/soul.ts` |       401 |              220 |        393 |
 *   | `bin/commands/turn.ts` |       150 |               69 |        126 |
 *   | `bin/commands/worn.ts` |        67 |               39 |         66 |
 *
 * Statement starts come to 0.46–0.71 of `LF`, and the ratio swings by half
 * again across five files, so the number would not be comparable to the ones
 * the floor prints beside it. It also collapses `bin/usage.ts` — 240 lines of
 * help text — to 6, which is the one file where quiet growth is most likely.
 * Counting lines is dumber and lands within 0.84–1.10 of `LF`. Comments are
 * excluded on purpose: a gate that goes red for a new paragraph of prose is a
 * gate that teaches people to delete prose.
 *
 * Exit 0 when every non-exempt source file is present and at or above the
 * floor, and every spawn-only file is exactly its recorded size; 1 otherwise.
 * `--report` prints both tables and gates nothing.
 *
 * ## Why the parts below are exported, and the run is behind `import.meta.main`
 *
 * This file was a gate with no test on it, and it could not have had one: every
 * line of it was top-level, so `import` from a test meant spawning `bun test`
 * from inside `bun test`. The gate that asks whether anything is unwatched was
 * the one thing nothing watched.
 *
 * So the measuring is behind {@link import.meta.main} and the judging is pure:
 * {@link parseLcov}, {@link verdict}, {@link codeLines}, {@link sizeVerdict},
 * {@link scriptsVerdict} and {@link judge} take values and return values, and
 * `test/scripts/check-coverage.test.ts` feeds them synthetic lcov — including
 * the shape that matters most, a report this cannot parse, which must fail on
 * "no test ever loads this" rather than pass on an empty parse.
 *
 * {@link judge} is the piece that arrived with `scripts/`. It was `main`: 115
 * lines turning verdicts into an exit code, reachable only by running the gate,
 * and therefore the largest untested thing in the file that judges what is
 * untested. Every branch of it now takes readings and returns
 * `{ code, out, err }`; `main` reads the disk, calls it, and prints.
 *
 * {@link measure} takes **the command it runs**, with no default, because it is
 * the one function here that starts `bun test`. A default would be a default
 * nobody passes over, and a test that called it would fork the suite inside
 * itself. Required-and-unexported makes that impossible at the type level
 * instead of catching it afterwards.
 */

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const BIN = join(ROOT, "bin");
const SCRIPTS = join(ROOT, "scripts");

/** Minimum share of a file's executable lines the test suite must run. */
export const FLOOR = 85;

/**
 * Files exempt from needing a test, with the reason.
 *
 * Kept as an explicit list rather than a pattern: an exemption should cost
 * someone a line in a file and a justification, not be something a filename
 * quietly earns.
 */
export const EXEMPT = new Map<string, string>([
  // Checked, not assumed: every line of this file is `export *`, so there is
  // nothing in it a test could load that a test of the re-exported modules
  // does not already load. `src/exec/index.ts` used to sit here on the same
  // words while holding two factories — an exemption whose reason is false is
  // worse than none — and it is gone, tested by `test/exec/index.test.ts`.
  ["src/soul/index.ts", "re-export barrel"],
  // Same check, same reason, and the day it grows a function is the day this
  // line goes and a test arrives.
  ["src/agent/index.ts", "re-export barrel"],
  // Same check, same reason.
  ["src/ledger/index.ts", "re-export barrel"],
  // Same check, same reason.
  ["src/guard/index.ts", "re-export barrel"],
  // Same check, same reason. S7.2 (w3) added it with five modules behind it
  // and nothing of its own.
  ["src/erase/index.ts", "re-export barrel"],
  // Was a placeholder until S3.5 (w2) gave it `store.ts` to re-export. The
  // reason changed with the file rather than being left to read as if it had
  // not: an exemption whose stated reason is false is worse than none.
  ["src/observer/index.ts", "re-export barrel"],
  // Was a placeholder until S1.6 (w7) gave it `collection.ts` to re-export, so
  // the reason moved with the file rather than being left to read as if it had
  // not. Same check as the barrels above: every line is `export *`.
  ["src/memory/index.ts", "re-export barrel"],
  // Was `export {};` under a header comment until E5 filled the layer. The
  // reason moved with the file rather than being left to read as if it had not:
  // every line is now `export *`, and the four modules behind it are tested
  // directly under `test/decide/`.
  ["src/decide/index.ts", "re-export barrel"],
]);

/** A file bun cannot measure, the size it had when it was measured, and why. */
export interface HeldAtSize {
  /** {@link codeLines} of the file, read on 2026-09-21. */
  readonly lines: number;
  /** Why the floor cannot judge it — checked, not assumed, one file at a time. */
  readonly why: string;
}

/**
 * The files under `bin/` whose lines only ever run in a process bun spawned.
 *
 * Not a pattern over `bin/commands/`: `bin/shared.ts` and `bin/as.ts` sit in
 * the same tree and are called in-process by tests, so they are on the floor.
 * Membership here costs a line and a reason, the same way {@link EXEMPT} does,
 * and anything under `bin/` that is not listed is gated by the floor — which is
 * what stops a new file from arriving unwatched.
 *
 * The three that lcov does report — `soul.ts` at 3.74%, `turn.ts` at 6.67%,
 * `worn.ts` at 11.94% — are in the report only because `bin/as.ts` imports one
 * constant from each. Loading a module is not running it, which is the whole
 * lesson of this gate, and those percentages are the proof rather than a
 * counter-example.
 */
export const SPAWN_ONLY = new Map<string, HeldAtSize>([
  // The entry point. `main()` reads `Bun.argv` and ends in `process.exit`, so
  // importing it from a test would end the test run — `test/cli/layout.test.ts`
  // asserts nothing imports it, on purpose.
  // 66 since E5: two `case` labels and two imports, for `autonomy` and `stop`.
  // 80 since the `--help` guard: the arm in front of the `switch` that answers
  // a command asked how without letting it act. It is here rather than in each
  // command because one place covers the commands written after it too — and
  // because the one command that got this wrong, `ohmyagi stop`, was the one
  // where getting it wrong set the brake. See `test/cli/help-does-nothing.test.ts`.
  // 83 since S5.2: one `case` label and one import, for `proposal`.
  ["bin/om-agi.ts", { lines: 118, why: "entry point — dispatch and process.exit" }],
  // One `export const USAGE = \`…\`` around 240 lines of help text. A test could
  // import it and the floor would read 100% off a single declaration while the
  // text said anything at all; the size is the only honest number here.
  // 251 since odd3: six lines under `erase` saying that `--json` puts the
  // certificate on stdout alone and everything a person reads on stderr.
  // 305 since E5: the four `autonomy`/`stop` entries, and the three paragraphs
  // that say which way the dial points, why the brake is not in git, and that
  // Ctrl-C was measured not to be a substitute for it.
  // 359 since S5.2: the four `proposal` entries, `turn`'s `--proposal`, and the
  // three paragraphs that say where proposals are kept and why it is not the
  // ledger (D-029), that the comparison is exact and where that misses, and
  // that om-agi does not turn an agent's own actions into proposals.
  ["bin/usage.ts", { lines: 565, why: "help text — one declaration, 565 lines of prose" }],
  // The commands. Each is `cmdX(rest)` returning an exit code, and each reads
  // `process.env`, `homedir()` or `cwd` on its way. Calling them in-process
  // would mean swapping `HOME` inside the test runner; the tests spawn instead.
  // E5. `sayDial` is here rather than in `bin/dial.ts` on purpose: everything
  // in `dial.ts` can be called from a test and it is held to the floor, so the
  // report-writing that can only run in a spawned process lives on this side of
  // the line.
  ["bin/commands/autonomy.ts", { lines: 295, why: "command — run by spawning the CLI" }],
  ["bin/commands/backends.ts", { lines: 54, why: "command — run by spawning the CLI" }],
  ["bin/commands/doctor.ts", { lines: 79, why: "command — run by spawning the CLI" }],
  // 266 since odd3: `printErasePlan` takes the stream it writes to, and
  // `cmdErase` picks stderr under `--json` so stdout is the document alone.
  ["bin/commands/erase.ts", { lines: 266, why: "command — run by spawning the CLI" }],
  ["bin/commands/guard.ts", { lines: 171, why: "command — run by spawning the CLI" }],
  ["bin/commands/ledger.ts", { lines: 244, why: "command — run by spawning the CLI" }],
  ["bin/commands/new.ts", { lines: 58, why: "command — run by spawning the CLI" }],
  // 677 since odd3: one `import { isatty } from "node:tty"`, which is what
  // replaced the two `process.stdout.isTTY` reads that truncated piped output.
  // 667 since E5: `readTerminalLine` moved to `bin/shared.ts`, because
  // `autonomy` needs the same typed-phrase prompt and one command may not
  // import another (`test/cli/layout.test.ts`).
  ["bin/commands/egress.ts", { lines: 94, why: "command — run by spawning the CLI" }],
  ["bin/commands/triggers.ts", { lines: 155, why: "command — run by spawning the CLI" }],
  ["bin/commands/setup.ts", { lines: 166, why: "command — run by spawning the CLI" }],
  ["bin/commands/a2a.ts", { lines: 216, why: "command — serve listens until Ctrl-C; its parts are tested in src/a2a" }],
  ["bin/commands/basis.ts", { lines: 106, why: "command — asks a person at a terminal; its parts are tested in src/consent/basis, and test/cli/basis.test.ts runs it" }],
  ["bin/commands/eval.ts", { lines: 105, why: "command — runs turns as children; its parts are tested in src/soul/evals, and test/cli/eval.test.ts runs it against a stub model" }],
  ["bin/commands/persona.ts", { lines: 266, why: "command — asks a local model and a person at a terminal; its parts are tested in src/soul/extract, and test/cli/persona.test.ts runs it against a stub model" }],
  ["bin/commands/chat.ts", { lines: 227, why: "command — serve polls until Ctrl-C; its parts are tested in src/connectors, and test/cli/chat.test.ts runs it against a stub Telegram" }],
  ["bin/commands/update.ts", { lines: 77, why: "command — asks GitHub; its parts are tested in src/update" }],
  ["bin/commands/web.ts", { lines: 359, why: "command — serves until Ctrl-C; its parts are tested in src/web" }],
  ["bin/commands/memory.ts", { lines: 625, why: "command — run by spawning the CLI" }],
  ["bin/commands/observe.ts", { lines: 750, why: "command — run by spawning the CLI" }],
  // S5.2. The store itself is `src/decide/proposals.ts`, on the floor and
  // tested there; what is here is the parsing, the four subcommands, and the
  // refusals printed on every run — all of which only happen in a spawned
  // process, and are exercised by `test/cli/proposal.test.ts`.
  ["bin/commands/proposal.ts", { lines: 388, why: "command — run by spawning the CLI" }],
  ["bin/commands/rebuild.ts", { lines: 38, why: "command — run by spawning the CLI" }],
  ["bin/commands/soul.ts", { lines: 566, why: "command — run by spawning the CLI" }],
  // E5. The signalling itself is in `src/decide/runs.ts`, where a test can
  // drive it against processes the test spawned; what is here is the order of
  // the three steps and the report.
  // 191: the line that prints why a group signal was narrowed to one process.
  // A signal that reached less than it looks like it reached is the one thing
  // this command must not leave a person to infer.
  ["bin/commands/stop.ts", { lines: 192, why: "command — run by spawning the CLI" }],
  // 169 since E5: the dial is consulted before anything is sent, and the run
  // record is written before the chain runs and removed in a `finally`.
  // 249 since S5.2: `--proposal` is checked after the brake and before
  // anything is written, and the approval it names is marked spent immediately
  // before the prompt goes — an approval recorded afterwards is one a crash
  // hands back unused.
  ["bin/commands/turn.ts", { lines: 459, why: "command — run by spawning the CLI" }],
  ["bin/commands/worn.ts", { lines: 66, why: "command — run by spawning the CLI" }],
]);

/** The one question a file under `scripts/` is asked, and who asks it. */
export interface ProvedOtherwise {
  /** What would have to be true for this file to still be doing its job. */
  readonly question: string;
  /** The test that asks it, on every `bun test` rather than when remembered. */
  readonly by: string;
  /** Why the floor is the wrong question here — checked one file at a time. */
  readonly why: string;
}

/**
 * The files under `scripts/` that a line percentage cannot honestly judge.
 *
 * Not a pattern and not a folder: `scripts/check-coverage.ts` sits in the same
 * directory and is on the floor, because a test can call every one of its
 * functions and does. Membership here costs a line, a question and an answer,
 * and **anything under `scripts/` that is not listed is gated** — by the floor
 * if it is TypeScript, and by failing outright if it is not, which is how a new
 * `.sh` arrives red instead of arriving unwatched.
 *
 * The questions differ from `bin/`'s on purpose. There, the risk is growth into
 * the dark and a recorded size answers it. Here, the risk is a tool that still
 * runs, still passes, and has stopped testing the thing it names — for which
 * size is no evidence at all.
 */
export const PROVED_OTHERWISE = new Map<string, ProvedOtherwise>([
  [
    "scripts/cli-parity.ts",
    {
      question: "do both controls still hold, and does the matrix still describe this CLI?",
      by: "test/scripts/cli-parity.test.ts",
      why:
        "Its work is two runs of a whole engine in a sandbox, so in-process coverage would " +
        "read a few per cent no matter how thoroughly it was tested. The number that matters " +
        "is not how many of its lines ran but whether its controls still bite and its matrix " +
        "still reaches every command — so one scenario of `--selftest` runs on every " +
        "`bun test` (both controls, ~1.3 s), and the coupling to `bin/` is checked statically.",
    },
  ],
  [
    "scripts/demo-bare-container.sh",
    {
      question: "has it been edited since the run that proved it?",
      by: "test/scripts/demo.test.ts",
      why:
        "bash: `bun test --coverage` cannot see a line of it, and the run it exists for needs " +
        "docker, a GPU and a pulled model, so it can never be a unit test. What is testable " +
        "is its refusals — `--model` has no default, cleanup cannot widen — plus `bash -n` and " +
        "the proof record below. Say the limit plainly: that is weaker than a floor.",
    },
  ],
]);

/** A run that happened once, by a person, and what the file looked like then. */
export interface Proof {
  /** sha256 of the file's bytes on {@link provedOn}. */
  readonly sha256: string;
  /** The date the run was done. */
  readonly provedOn: string;
  /** The command that was run, verbatim, so it can be run again. */
  readonly by: string;
  /** What it printed. */
  readonly result: string;
}

/**
 * Runs that cannot happen inside `bun test`, recorded with the bytes they ran on.
 *
 * This is an honour system and is worth saying so out loud, here and in what
 * the gate prints. A hash can be updated by hand without the run being redone,
 * exactly as a number in {@link SPAWN_ONLY} can. What it buys is the one thing
 * a comment cannot: the file **cannot be edited quietly** after it was proven.
 *
 * What it does not buy, in both directions:
 *
 *   - it does not say the file passes *today*, only that it is the file that
 *     passed *then*;
 *   - it cannot see a demo broken by a change somewhere else. `demo-bare-container.sh`
 *     clones this repository and runs the CLI inside a container; every line of
 *     it can be untouched while `src/` makes the demo fail. Nothing available
 *     inside `bun test` closes that, and pretending otherwise would be worse
 *     than the gap.
 */
export const PROOFS = new Map<string, Proof>([
  [
    "scripts/demo-bare-container.sh",
    {
      sha256: "f7d304e6ba81e229553b0c3e8121f434040cafc80836cf6db063cab48d7b4745",
      provedOn: "2026-09-24",
      by: "npm run demo -- --model <a local model>",
      result:
        "15/15 criteria passed on 2026-09-26 on the tree released as 0.7.0 (run 1c88d842, table kept in notes/2026-09-26_demo-v0.7.0.txt), on 0.6.1 the same day (run 3eaea63f, table kept in notes/2026-09-26_demo-v0.6.1.txt), on 0.6.0 the same day (run 1972948d, table kept in notes/2026-09-26_demo-v0.6.0.txt), on 0.5.1 on 2026-09-25 (run caa68c60, table kept in notes/2026-09-25_demo-v0.5.1.txt), on 0.5.0 the same day (run 5e5f6903, table kept in notes/2026-09-25_demo-v0.5.0.txt), on 0.4.2 the same day (run fbad84d0, table kept in notes/2026-09-25_demo-v0.4.2.txt), on 0.4.1 the same day (run 8a52848c, table kept in notes/2026-09-25_demo-v0.4.1.txt), on 0.4.0 the day before (run 065c6900, table kept in notes/2026-09-24_demo-v0.4.0.txt), on 0.3.0 the same day (run cbeda900, " +
        "table kept in notes/2026-09-24_demo-v0.3.0.txt), on 0.2.0 the same day (run fd433912, " +
        "table kept in notes/2026-09-24_demo-v0.2.0.txt), and earlier that day on the tree released as 0.1.0 (run 2ddacb38, " +
        "table kept in notes/2026-09-24_demo-v0.1.0.txt). Before that, " +
        "15/15 on 2026-09-23 with --model qwen3.8:27b, on the tree after " +
        "E4 (S4.1–S4.4): the container erase printed a note that Qdrant did not answer and " +
        "still came back erased-and-verified, which is the case D-038 designed for. First " +
        "proved 2026-09-22 at 15/15 on the tree that commit left behind — the three added in " +
        "dod1 are the guard's typechange case (on the host, said so in the output) and " +
        "erase asked in both directions inside the container",
    },
  ],
  [
    "scripts/cli-parity.ts",
    {
      sha256: "5eeab6f7a1e7acb9a7bc8f0c2ad32dac3b06370e881a4fdf8e50e7fb546a1f3d",
      provedOn: "2026-09-25",
      by: "npm run parity -- --base . --selftest",
      result:
        "exit 0 — control 1 steady, control 2 not blind to a changed character, control 3 not " +
        "blind to an added line, and control 4 refusing a side with no engine in it, over all " +
        "17 case(s), 188 invocation(s) per side. Re-proved for `basis` (D-077), which added bare `basis` " +
        "to `02-unknown` — control 1 first caught a test that had left a collection in the machine's real " +
        "Qdrant, which that test no longer can; before that for `eval` (D-073), which added bare `eval` " +
        "to `02-unknown`; before that for `persona` (D-072), which added bare `persona` " +
        "to `02-unknown`, and made a recorded file the duration rule fires in show its size as `<varies>` — " +
        "control 1 had caught two runs of one revision disagreeing on a ledger file by one byte, a 9 ms " +
        "against a 10 ms; before that for `chat` (D-066), which added bare `chat` " +
        "to `02-unknown`; before that for `update` (D-065), which added `update wat` " +
        "to `02-unknown`; before that for `a2a` (D-063), which added bare `a2a` " +
        "to `02-unknown`; before that for `web` (D-060), which added bare `web` " +
        "to `02-unknown`; before that for `setup` (D-056), which added `setup wat` " +
        "to `02-unknown`; before that after the CLI took the name `ohmyagi` " +
        "(D-055), which rewrote the expected `om-agi …` strings in this file's declarations; " +
        "before that for S5.3 (D-054), which added `triggers wat` " +
        "and bare `triggers` to `02-unknown`; before that for S8.3 (D-048), which added `egress wat` " +
        "and bare `egress` to `02-unknown`, and before that for S4.1 (D-038), whose only edit " +
        "here is two steps in `02-unknown` — `memory wat` and bare `memory` — so the matrix " +
        "reaches the new verb; the four controls above re-ran on these bytes. Re-proved after the `--help` guard, which " +
        "added one step to each of the two `added` cases — `autonomy --help` and `stop --help`, " +
        "153 invocations to 155. They are recorded there and nowhere else because those two " +
        "cases cost nothing to declare (the base answers every step of them with `unknown " +
        "command`), and because a recording cannot hold the half of that rule that matters: " +
        "that the state root was still empty afterwards. `test/cli/help-does-nothing.test.ts` " +
        "asks that of every verb the entry point dispatches, with a control that runs `om-agi " +
        "stop` without the flag and requires the same detector to go the other way. Before " +
        "that guard, `ohmyagi stop --help` armed the brake. Re-proved for E5, which added a sixth " +
        "declaration kind (`added`, for a whole case whose command the base revision does not " +
        "have) and was proved before being used to judge E5's own work: the four controls above " +
        "re-ran on these bytes, and `test/scripts/cli-parity.test.ts` holds eight controls of " +
        "its own for the new kind — one step the base could run takes the exemption away, a " +
        "base that grew the command stops the rule dead, a recording with no steps in it is " +
        "not an addition, and a case no rule names can never become one. 97fb8d2 → the E5 tree " +
        "is `PARITY-OK` with 2 declared addition(s) (`15-autonomy`, `16-stop` — 27 invocations " +
        "the base answers only with `unknown command`), 20 declared difference(s) and 29 " +
        "declared insertion(s), over 16 case(s) and 155 invocation(s). Re-proved for odd3, " +
        "which added a fifth " +
        "declaration kind (`crossed`, for output that changed stream and nothing else) and was " +
        "proved before being used to judge odd3's own work: the four controls above re-ran on " +
        "these bytes, and `test/scripts/cli-parity.test.ts` holds five controls of its own for " +
        "the new kind — a byte edited on the way across, a line that was never on stdout, the " +
        "reverse direction, and the same move in a case the rule does not name all go red. " +
        "d6c03b5 → the odd3 tree is `PARITY-OK` with 1 declared crossing (74 lines off `erase " +
        "--json`'s stdout and onto its stderr, unchanged), 6 declared difference(s) and 6 " +
        "declared insertion(s) — the help text's new sentence, at the seven steps that print " +
        "it — and the same run with `--binary` is `PARITY-OK` too, so the fix holds in the " +
        "compiled engine and not only in the checkout. `--structure` is red for this change and " +
        "is meant to be: it proves a *refactor* moved lines without editing them, and odd3 " +
        "edits them (45 only on base, 62 only on head, import-union unchanged). Re-proved for " +
        "fix3, which added the fourth kind (`removed`, the one-directional mirror of " +
        "`inserted`): cc192e8 → the fix3 tree is `PARITY-OK` with 2 declared removal(s) and " +
        "nothing else, and fix1's own regression pair 7373a5b → c235f6f re-ran to exactly 15 " +
        "declared difference(s), 56 declared insertion(s) and **0** declared removal(s). " +
        "Control 4 and the `PARITY-UNDECIDED` exit 3 it guards landed with fix2, and were " +
        "proved before being used to judge fix2's own work: two empty directories printed " +
        "`PARITY-OK` and exited 0 before (odd2 `D-P6`) and exit 3 now, while fa46ad6 → " +
        "7373a5b re-ran clean. Re-proved for S5.2, which added a seventeenth case " +
        "(`17-proposal`) and a second `added` command; the four controls above re-ran on these " +
        "bytes — 17 case(s), 174 invocation(s) per side — and were proved before being used to " +
        "judge S5.2's own work. Control 1 earned its keep on the way: the first version of that " +
        "case filed two proposals for one subject, `record()` lists a directory sorted by raw " +
        "name, a record's filename *is* a uuid, and two runs of one revision came back in " +
        "different orders. The case now files one record per subject and says why. " +
        "4e93c3a → the S5.2 tree is `PARITY-OK` with 1 declared addition (`17-proposal`, 19 " +
        "steps the base answers only with `unknown command`), 44 declared difference(s) and 30 " +
        "declared insertion(s) — the help text's four new entries and three new paragraphs, " +
        "`turn`'s `--proposal`, and the one sentence `erase` prints about what the personal " +
        "directory holds.",
    },
  ],
]);

/** One file's line coverage, as lcov reports it. */
export interface FileCoverage {
  /** Executable lines (lcov `LF`). */
  readonly found: number;
  /** Executable lines the suite ran at least once (lcov `LH`). */
  readonly hit: number;
  /** Line numbers with zero hits, in file order. */
  readonly missed: number[];
}

export async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) found.push(path);
  }
  return found;
}

/**
 * Every file under a directory, whatever it is called.
 *
 * {@link sourceFiles} keeps `.ts`, which is right for `src/` and `bin/` and
 * wrong for `scripts/`: the file the gate most wants to notice arriving there
 * is the one it cannot measure, and a walker that only sees TypeScript would
 * report a folder full of shell as empty and pass.
 */
export async function allFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await allFiles(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

/** The digest {@link PROOFS} records, over the file's bytes as text. */
export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/**
 * Parse the records this gate needs out of an lcov report.
 *
 * Only `SF` / `DA` / `LF` / `LH` are read; function and branch records are
 * ignored on purpose, because the task is one number per file and a second
 * threshold would be a second thing to argue about. A report shaped differently
 * than expected produces no entries, and the caller fails loudly on the missing
 * file rather than passing on an empty parse.
 */
export function parseLcov(lcov: string): Map<string, FileCoverage> {
  const files = new Map<string, FileCoverage>();
  let path: string | undefined;
  let found = 0;
  let hit = 0;
  let missed: number[] = [];

  for (const line of lcov.split("\n")) {
    if (line.startsWith("SF:")) {
      path = line.slice(3).trim();
      found = 0;
      hit = 0;
      missed = [];
    } else if (line.startsWith("DA:")) {
      const [at, hits] = line.slice(3).split(",");
      if (Number(hits) === 0) missed.push(Number(at));
    } else if (line.startsWith("LF:")) {
      found = Number(line.slice(3));
    } else if (line.startsWith("LH:")) {
      hit = Number(line.slice(3));
    } else if (line.startsWith("end_of_record") && path !== undefined) {
      files.set(path, { found, hit, missed });
      path = undefined;
    }
  }
  return files;
}

/** Percentage as lcov's own integers give it, for printing only. */
export function percent({ found, hit }: FileCoverage): string {
  return found === 0 ? "  n/a" : ((hit * 100) / found).toFixed(2).padStart(5);
}

/**
 * Collapse `[3,4,5,9]` to `3-5, 9` so a long tail of dead lines stays legible.
 *
 * The two `!` are the loop's own invariant: `i` and `end` are both below
 * `lines.length` every time they are read. They are written out because nothing
 * type-checked this file until a test imported it — `tsconfig.json` includes
 * `bin`, `src` and `test`, and `scripts/` only enters the program through an
 * import — and `noUncheckedIndexedAccess` had a real complaint waiting here.
 */
export function ranges(lines: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let end = i;
    while (end + 1 < lines.length && lines[end + 1] === lines[end]! + 1) end += 1;
    out.push(i === end ? `${lines[i]}` : `${lines[i]}-${lines[end]}`);
    i = end + 1;
  }
  return out.join(", ");
}

/**
 * The two ways a gated file fails, decided from values and nothing else.
 *
 * Absence comes first and shuts the other out, which is why this returns one
 * object rather than two lists a caller could report in either order: a file no
 * test loads has no percentage, and `measured.get(path)!` on it would be an
 * assertion about a value that is not there. So when `unseen` is non-empty,
 * `below` is empty by construction and the caller reports the absence.
 *
 * Integer comparison rather than a float percentage, so a file sitting exactly
 * on the floor is never decided by a rounding artefact. A file with no
 * executable lines at all (`LF:0`) passes: there is nothing there to run, and
 * calling that 0% would fail a file for being empty.
 */
export function verdict(
  gated: readonly string[],
  measured: ReadonlyMap<string, FileCoverage>,
  floor: number,
): {
  readonly unseen: readonly string[];
  readonly below: ReadonlyArray<{ readonly path: string; readonly cov: FileCoverage }>;
} {
  const unseen = gated.filter((path) => !measured.has(path));
  if (unseen.length > 0) return { unseen, below: [] };

  const below = gated
    .map((path) => ({ path, cov: measured.get(path)! }))
    .filter(({ cov }) => cov.found > 0 && cov.hit * 100 < floor * cov.found);
  return { unseen, below };
}

/**
 * Lines of a file that are neither blank nor comment — the size of the part
 * bun cannot measure.
 *
 * Deliberately a text count and not a parse; see the header for the two
 * candidates and the measurement that chose between them. It reads line and
 * block comments the way a person skimming the file would, which means a line
 * *inside a template literal* that begins with `//` is counted as a comment. No
 * file under `bin/` has one, and the cost if one appears is that a number in
 * {@link SPAWN_ONLY} is one lower than a reader would guess — not that a change
 * goes unnoticed, because the count still moves when the file does.
 */
export function codeLines(source: string): number {
  let count = 0;
  let inBlock = false;

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (inBlock) {
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlock = true;
      continue;
    }
    count += 1;
  }
  return count;
}

/** A file whose size no longer matches the one written down. */
export interface SizeDrift {
  readonly path: string;
  /** The number in {@link SPAWN_ONLY}. */
  readonly was: number;
  /** What the file measures today. */
  readonly now: number;
}

/**
 * The three ways the held-at-size half fails, decided from values alone.
 *
 * Both directions are failures. Growth is the one the gate was written for —
 * code moving into the half bun cannot see. Shrinkage fails too because a
 * recorded number that is larger than the file is headroom: the next change can
 * grow into it and the gate will stay green. A list kept beside the tree it
 * describes only stays true if both directions cost something.
 *
 * `missing` is the third: a path written down that is not on disk any more
 * exempts nothing, and would otherwise sit in the list looking like a decision.
 */
export function sizeVerdict(
  measured: ReadonlyMap<string, number>,
  recorded: ReadonlyMap<string, HeldAtSize>,
): {
  readonly grown: readonly SizeDrift[];
  readonly shrunk: readonly SizeDrift[];
  readonly missing: readonly string[];
} {
  const grown: SizeDrift[] = [];
  const shrunk: SizeDrift[] = [];
  const missing: string[] = [];

  for (const [path, held] of recorded) {
    const now = measured.get(path);
    if (now === undefined) {
      missing.push(path);
      continue;
    }
    if (now > held.lines) grown.push({ path, was: held.lines, now });
    else if (now < held.lines) shrunk.push({ path, was: held.lines, now });
  }

  return { grown, shrunk, missing };
}

/**
 * What the spawn-only half costs, in one line, printed whether or not it failed.
 *
 * The single outcome that is not acceptable is a fifth of the engine sitting
 * outside the floor without anyone knowing, so this is printed on green runs
 * too — and it says what the recorded sizes do *not* prove, because a number
 * printed beside a percentage will otherwise be read as one.
 */
export function heldSummary(
  sizes: ReadonlyMap<string, number>,
  recorded: ReadonlyMap<string, HeldAtSize>,
): string {
  const held = [...recorded.keys()].filter((path) => sizes.has(path));
  const lines = held.reduce((total, path) => total + sizes.get(path)!, 0);
  return (
    `bin/: ${held.length} file(s), ${lines} code line(s) run only in a spawned process, ` +
    `where bun measures nothing.\n` +
    `  They are held at a recorded size — that says this half is not growing unwatched, ` +
    `not that it is tested.`
  );
}

/** The three ways the `scripts/` half fails, decided from values alone. */
export interface ScriptsVerdict {
  /** A file the floor cannot judge and no question names — a new `.sh`, say. */
  readonly unasked: readonly string[];
  /** A question, or a proof, about a file that is not on disk any more. */
  readonly stray: readonly string[];
  /** A file whose bytes have moved since the run recorded beside them. */
  readonly stale: ReadonlyArray<{ readonly path: string; readonly was: string; readonly now: string }>;
}

/**
 * Judge `scripts/` — the folder whose files judge everything else.
 *
 * `unasked` is the one that makes {@link PROVED_OTHERWISE} a gate rather than a
 * note. A `.ts` file nobody lists falls through to the 85% floor and fails
 * there if it is untested; a file bun cannot measure at all has no such
 * backstop, so *arriving unlisted is itself the failure*. Without this, adding
 * a second shell script to this repository would be invisible to every gate in
 * it, which is precisely the hole gate4 exists to close.
 *
 * `stray` covers both maps at once: a path written down that is not there
 * excuses nothing and proves nothing, and either way it sits in a list looking
 * like a decision somebody made.
 *
 * `stale` is the honour system doing the only work it can. It says the bytes
 * moved after the date beside them — not that the file is wrong, and not that
 * an unmoved file is right.
 */
export function scriptsVerdict(
  files: readonly string[],
  digests: ReadonlyMap<string, string>,
  proved: ReadonlyMap<string, ProvedOtherwise>,
  proofs: ReadonlyMap<string, Proof>,
): ScriptsVerdict {
  const present = new Set(files);
  const unasked = files.filter((path) => !path.endsWith(".ts") && !proved.has(path));
  const stray = [...new Set([...proved.keys(), ...proofs.keys()])]
    .filter((path) => !present.has(path))
    .sort();

  const stale: Array<{ path: string; was: string; now: string }> = [];
  for (const [path, proof] of proofs) {
    if (!present.has(path)) continue;
    const now = digests.get(path);
    if (now !== proof.sha256) stale.push({ path, was: proof.sha256, now: now ?? "<not read>" });
  }

  return { unasked, stray, stale };
}

/**
 * What `scripts/` is proved by, file by file, printed whether or not it failed.
 *
 * The counterpart of {@link heldSummary} and written for the same reason: the
 * outcome worth refusing is not a red run but a green one that leaves a reader
 * believing more than was checked. So every group is named and counted — the
 * ones on the floor, the ones answering a question instead, and the ones
 * answering nothing — and the limits of a proof record are said in the same
 * breath as the record.
 */
export function scriptsSummary(
  files: readonly string[],
  code: ReadonlyMap<string, number>,
  proved: ReadonlyMap<string, ProvedOtherwise>,
  proofs: ReadonlyMap<string, Proof>,
): string {
  const onFloor = files.filter((path) => path.endsWith(".ts") && !proved.has(path));
  const named = files.filter((path) => proved.has(path));
  const unasked = files.filter((path) => !path.endsWith(".ts") && !proved.has(path));
  const total = files.reduce((sum, path) => sum + (code.get(path) ?? 0), 0);

  const lines = [
    `scripts/: ${files.length} file(s), ${total} code line(s) — the tools that prove the rest of this repository.`,
    `  ${onFloor.length} on the ${FLOOR}% line floor, judged exactly as src/ is: ` +
      `${onFloor.length === 0 ? "none" : onFloor.join(", ")}`,
    `  ${named.length} proved otherwise — by a question with a name on it, not by a percentage:`,
  ];

  for (const path of named) {
    const asked = proved.get(path)!;
    lines.push(`    ${path}`);
    lines.push(`      asks:    ${asked.question}`);
    lines.push(`      asked by ${asked.by}, on every run`);
    const proof = proofs.get(path);
    if (proof !== undefined) {
      lines.push(`      proved   ${proof.provedOn} by \`${proof.by}\` — ${proof.result}`);
    }
  }

  if (unasked.length > 0) {
    lines.push(`  ${unasked.length} asked nothing at all: ${unasked.join(", ")}`);
  }

  lines.push(
    `  A proof record says only that a file's bytes have not moved since that date. It does not`,
    `  say the file passes today, and it cannot see one of these broken by a change in src/ —`,
    `  no run that fits inside bun test can, which is why the record is printed and not trusted.`,
  );

  return lines.join("\n");
}

/** Everything the gate reads off the disk before it decides anything. */
export interface Readings {
  /** The lcov report, or `undefined` when the suite itself did not pass. */
  readonly lcov: string | undefined;
  /** `src/`, as {@link sourceFiles} reports it, relative to the root. */
  readonly src: readonly string[];
  /** `bin/`, the same shape. */
  readonly bin: readonly string[];
  /** Everything under `scripts/`, whatever the extension. */
  readonly scripts: readonly string[];
  /** {@link codeLines} per file. */
  readonly code: ReadonlyMap<string, number>;
  /** Total lines per file — for the message an absent file gets, nothing else. */
  readonly lines: ReadonlyMap<string, number>;
  /** sha256 per file that has a {@link PROOFS} record. */
  readonly digests: ReadonlyMap<string, string>;
  /** The gate's own command line. */
  readonly argv: readonly string[];
}

/** An exit code, and the two streams that explain it. */
export interface Judgement {
  readonly code: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
}

/**
 * Turn readings into an exit code — the whole of the gate's decision, purely.
 *
 * This was `main`, 115 lines of it, and it was the largest untested thing in
 * the file whose job is to find untested things: reaching it meant running the
 * gate, and running the gate meant starting `bun test` from inside `bun test`.
 * Nothing here touches the disk or the clock, so every branch below — including
 * the *order* of the branches, which is load-bearing — is reachable from a test
 * holding invented lcov.
 *
 * The order is: absence, then the floor, then `scripts/`, then the recorded
 * sizes. Absence first for the reason {@link verdict} gives. `scripts/` before
 * the sizes because a file nobody asked a question about is a hole in the gate
 * itself, and a hole in the gate matters more than a number that drifted.
 */
export function judge(readings: Readings): Judgement {
  const { lcov, src, bin, scripts, code, lines, digests, argv } = readings;
  const out: string[] = [];
  const err: string[] = [];

  if (lcov === undefined) {
    err.push("coverage gate: nothing was measured, so nothing is judged.");
    return { code: 1, out, err };
  }

  const measured = parseLcov(lcov);
  const gated = [
    ...src.filter((path) => !EXEMPT.has(path)),
    ...bin.filter((path) => !SPAWN_ONLY.has(path)),
    ...scripts.filter((path) => path.endsWith(".ts") && !PROVED_OTHERWISE.has(path)),
  ].sort();

  const held = heldSummary(code, SPAWN_ONLY);
  const asked = scriptsSummary(scripts, code, PROVED_OTHERWISE, PROOFS);

  if (argv.includes("--report")) {
    out.push(`line coverage per file (floor is ${FLOOR}%, ${gated.length} file(s) gated)\n`);
    const rows = gated.map((path) => ({ path, cov: measured.get(path) }));
    rows.sort((a, b) => {
      const share = (c?: FileCoverage) =>
        c === undefined ? -1 : c.found === 0 ? 100 : (c.hit * 100) / c.found;
      return share(a.cov) - share(b.cov);
    });
    for (const { path, cov } of rows) {
      if (cov === undefined) out.push(`  absent  ${path}`);
      else out.push(`  ${percent(cov)}%  ${path}  (${cov.hit}/${cov.found})`);
    }

    out.push(`\n${held}\n`);
    for (const [path, holding] of SPAWN_ONLY) {
      const now = code.get(path);
      out.push(
        `  ${String(holding.lines).padStart(4)} line(s)  ${path}` +
          `${now === undefined ? "  (not on disk)" : now === holding.lines ? "" : `  (now ${now})`}` +
          `  — ${holding.why}`,
      );
    }

    out.push(`\n${asked}\n`);
    for (const [path, reason] of PROVED_OTHERWISE) out.push(`  ${path} — ${reason.why}`);
    return { code: 0, out, err };
  }

  // Printed before any verdict and on every run, red or green. The half bun
  // cannot see, and the half judged by a question rather than a number, are the
  // two things most easily forgotten — and silence about either is the failure
  // this gate keeps being extended to prevent.
  out.push(`coverage gate: ${held}`);
  out.push(asked);

  const { unseen, below } = verdict(gated, measured, FLOOR);
  const { unasked, stray, stale } = scriptsVerdict(scripts, digests, PROVED_OTHERWISE, PROOFS);
  const { grown, shrunk, missing } = sizeVerdict(code, SPAWN_ONLY);

  if (unseen.length > 0) {
    err.push(`\ncoverage gate: ${unseen.length} source file(s) that no test ever loads\n`);
    for (const path of unseen) err.push(`  ${path}  (${lines.get(path) ?? 0} lines)`);
    err.push(
      `\nThese do not appear in the coverage report at all — not as 0%, but as nothing.` +
        `\nWrite a test that loads them, or add an exemption with a reason in scripts/check-coverage.ts` +
        `\n— EXEMPT for a file with nothing to run, SPAWN_ONLY for a bin/ file only a spawned` +
        `\nprocess can reach, PROVED_OTHERWISE for a scripts/ file a percentage cannot judge.`,
    );
    return { code: 1, out, err };
  }

  if (below.length > 0) {
    err.push(`\ncoverage gate: ${below.length} source file(s) below the ${FLOOR}% line floor\n`);
    for (const { path, cov } of below) {
      err.push(`  ${percent(cov)}%  ${path}  (${cov.hit}/${cov.found} lines)`);
      err.push(`           never run: ${ranges(cov.missed)}`);
    }
    err.push(
      `\nBeing imported is not being tested — a barrel import loads a file without` +
        `\nasserting anything about it. Write tests that run those lines.` +
        `\nIf you believe ${FLOOR} is the wrong number, re-measure first:` +
        `\n  bun run scripts/check-coverage.ts --report`,
    );
    return { code: 1, out, err };
  }

  if (unasked.length > 0) {
    err.push(
      `\ncoverage gate: ${unasked.length} file(s) under scripts/ that nothing asks anything about\n`,
    );
    for (const path of unasked) err.push(`  ${path}`);
    err.push(
      `\nbun measures TypeScript, so a .ts file here falls through to the ${FLOOR}% floor and is` +
        `\njudged there. These cannot be, so arriving unlisted is the failure itself — otherwise a` +
        `\nsecond shell script would be invisible to every gate in this repository.` +
        `\nAdd it to PROVED_OTHERWISE with the one question it has to keep answering, and the` +
        `\ntest that asks that question on every run.`,
    );
    return { code: 1, out, err };
  }

  if (stray.length > 0) {
    err.push(
      `\ncoverage gate: ${stray.length} path(s) under scripts/ are written down but not on disk\n`,
    );
    for (const path of stray) err.push(`  ${path}`);
    err.push(
      `\nA question about a file that is gone asks nothing, and a proof of it proves nothing —` +
        `\nbut both keep reading like a decision somebody made. Delete the line, or fix the spelling.`,
    );
    return { code: 1, out, err };
  }

  if (stale.length > 0) {
    err.push(`\ncoverage gate: ${stale.length} file(s) changed after the run that proved them\n`);
    for (const { path, was, now } of stale) {
      err.push(`  ${path}`);
      err.push(`    proved ${PROOFS.get(path)?.provedOn ?? "?"}:  ${was}`);
      err.push(`    today:              ${now}`);
    }
    err.push(
      `\nNothing here says the change was wrong. It says the proof beside it is now about a file` +
        `\nthat no longer exists in that form. Re-run the proof, then write down what it printed` +
        `\nand the new digest, in PROOFS (scripts/check-coverage.ts). Updating the digest without` +
        `\nre-running is possible, and is the known limit of this record — what it buys is that` +
        `\nthe edit cannot happen silently.`,
    );
    return { code: 1, out, err };
  }

  if (missing.length > 0) {
    err.push(`\ncoverage gate: ${missing.length} file(s) held at a size are not on disk\n`);
    for (const path of missing) err.push(`  ${path}`);
    err.push(
      `\nA path in SPAWN_ONLY that no longer exists holds nothing. Delete the line, or` +
        `\nfix the spelling — it is written the way sourceFiles() reports it, e.g. bin/commands/new.ts.`,
    );
    return { code: 1, out, err };
  }

  // Measured, so that nobody reads this branch as the first line of defence:
  // `test/scripts/check-coverage.test.ts` asserts the same numbers against the
  // same files, and `bun test` runs before any of this — so in practice the
  // suite goes red there and there is no lcov to judge. This is the backstop for
  // the day that test is changed or deleted, and it is the half that says what
  // to do about the drift.
  if (grown.length > 0 || shrunk.length > 0) {
    err.push(
      `\ncoverage gate: ${grown.length + shrunk.length} file(s) bun cannot measure ` +
        `changed size without the recorded number changing\n`,
    );
    for (const { path, was, now } of grown) err.push(`  grew    ${path}  ${was} → ${now} line(s)`);
    for (const { path, was, now } of shrunk) err.push(`  shrank  ${path}  ${was} → ${now} line(s)`);
    err.push(
      `\nNothing here says the change was wrong — it says it landed where no test can see it.` +
        `\nEither move the logic into src/, where the ${FLOOR}% floor reads it, or update the number` +
        `\nin SPAWN_ONLY (scripts/check-coverage.ts). Shrinking counts too: a number left above the` +
        `\nfile is room for the next change to grow into unnoticed.`,
    );
    return { code: 1, out, err };
  }

  out.push(
    `coverage gate: all ${gated.length} source file(s) are loaded by a test ` +
      `and run at least ${FLOOR}% of their lines, all ${SPAWN_ONLY.size} spawn-only ` +
      `file(s) are the size they were measured at, and all ${PROVED_OTHERWISE.size} ` +
      `file(s) under scripts/ that a percentage cannot judge still answer their question`,
  );
  return { code: 0, out, err };
}

/** What running the suite under `--coverage` produced, or why it produced nothing. */
export type Measured =
  | { readonly ok: true; readonly lcov: string }
  | { readonly ok: false; readonly why: string };

/**
 * Run `command` and hand back the lcov it wrote.
 *
 * **`command` is a parameter, with no default, on purpose.** This is the only
 * function in the file that starts another process, and the process it starts
 * in real life is `bun test`. A default is a default nobody ever passes over,
 * so the first test to call this would have forked the suite inside itself —
 * and a fork bomb started by a test that was trying to be careful is something
 * this repository has already met. Requiring the command makes that impossible
 * to write rather than something to catch afterwards: the real one lives in
 * `main`, unexported, where no test can reach it even by typo.
 *
 * It takes a function of the coverage directory rather than a plain array
 * because the directory has to appear *inside* the command, and this owns the
 * directory: `coverage/` is not in `.gitignore`, and a gate that dirties the
 * working tree every time it runs teaches people to ignore `git status`.
 *
 * Three outcomes, kept apart because they mean different things — the suite
 * failed, the suite passed and wrote no report, and here is the report. Only
 * the last one is a measurement.
 */
export async function measure(
  command: (coverageDir: string) => readonly string[],
): Promise<Measured> {
  const coverageDir = await mkdtemp(join(tmpdir(), "om-agi-coverage-"));
  try {
    const child = Bun.spawn([...command(coverageDir)], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const output =
      (await new Response(child.stdout).text()) + (await new Response(child.stderr).text());
    await child.exited;

    if (child.exitCode !== 0) {
      const tail = output.trim().split("\n").slice(-15).join("\n");
      return { ok: false, why: `the suite failed under --coverage; fix the tests first\n${tail}` };
    }

    const report = Bun.file(join(coverageDir, "lcov.info"));
    if (!(await report.exists())) {
      return {
        ok: false,
        why:
          "the suite passed but wrote no lcov.info. An empty parse would read as " +
          "'no file is below the floor', so this is a failure and not a measurement.",
      };
    }
    return { ok: true, lcov: await report.text() };
  } finally {
    await rm(coverageDir, { recursive: true, force: true });
  }
}

/**
 * The three numbers {@link judge} needs about each file, read in one pass.
 *
 * Kept out of `judge` so that judging stays pure, and kept in one pass so that
 * a gate over sixty files is sixty reads rather than three times that. A digest
 * is computed only for the files {@link PROOFS} names — hashing `src/` would
 * cost little and mean nothing.
 */
export async function readFiles(paths: readonly string[]): Promise<{
  readonly code: Map<string, number>;
  readonly lines: Map<string, number>;
  readonly digests: Map<string, string>;
}> {
  const code = new Map<string, number>();
  const lines = new Map<string, number>();
  const digests = new Map<string, string>();

  for (const rel of paths) {
    const text = await Bun.file(join(ROOT, rel)).text();
    code.set(rel, codeLines(text));
    lines.set(rel, text.split("\n").length);
    if (PROOFS.has(rel)) digests.set(rel, sha256(text));
  }

  return { code, lines, digests };
}

/**
 * The command the gate really measures with.
 *
 * Not exported, and that is the guard rather than a convention: {@link measure}
 * has no default, so the only way to start `bun test` from here is to name this,
 * and the only file that can name it is this one.
 */
const SUITE = (coverageDir: string): readonly string[] => [
  "bun",
  "test",
  "--coverage",
  "--coverage-reporter=lcov",
  `--coverage-dir=${coverageDir}`,
];

/** The gate: read, measure, judge, print. Returns the exit code. */
async function main(argv: readonly string[]): Promise<number> {
  const src = (await sourceFiles(SRC)).map((path) => relative(ROOT, path));
  const bin = (await sourceFiles(BIN)).map((path) => relative(ROOT, path));
  const scripts = (await allFiles(SCRIPTS)).map((path) => relative(ROOT, path));
  const { code, lines, digests } = await readFiles([...src, ...bin, ...scripts]);

  const measured = await measure(SUITE);
  if (!measured.ok) {
    console.error(`coverage gate: ${measured.why}`);
    return 1;
  }

  const judged = judge({ lcov: measured.lcov, src, bin, scripts, code, lines, digests, argv });
  for (const line of judged.out) console.log(line);
  for (const line of judged.err) console.error(line);
  return judged.code;
}

// Behind `import.meta.main` so that a test can import the judging above without
// this file starting a second `bun test` inside the one that is running it.
if (import.meta.main) process.exit(await main(Bun.argv));

