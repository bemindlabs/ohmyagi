/**
 * What more than one command needs, and nothing else.
 *
 * The bar for living here is *two callers in different files*, checked rather
 * than assumed: `indent` is used by `soul verify` and `ledger show`,
 * `printPlaceNotices` by `new` and `erase`, `ledgerEnv` by `turn` and
 * `ledger`. A helper with one caller stays in that caller's file, because a
 * shared module that collects them is the file every task has to open again —
 * which is the problem splitting the CLI was for.
 *
 * It sits at `bin/`, not under `bin/commands/`, so that {@link ENGINE_ROOT}
 * is still `resolve(import.meta.dir, "..")` — the same expression, resolving
 * to the same directory, as when the whole CLI was one file.
 */

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isatty } from "node:tty";
import { PLACE_IDS, placeOf } from "../src/erase/index.ts";
import type { LedgerEnv } from "../src/ledger/index.ts";
import { formatIssue, type SoulIssue } from "../src/soul/index.ts";

/**
 * Where this engine's own repository lives, resolved, never hard-coded (D-021).
 *
 * Not exported, and that is the whole of the fix for a check that passed
 * because it looked at nothing. Under `bun build --compile` every module is
 * flattened into the executable and `import.meta.dir` is `/$bunfs/root`, so
 * this constant names a directory that is not on any filesystem. Callers get
 * {@link ENGINE_CHECKOUT} instead, whose type makes them say what they do when
 * there is no checkout to point at.
 */
const ENGINE_ROOT = resolve(import.meta.dir, "..");

/**
 * The engine's own source tree, when it is really on disk.
 *
 * Evidence, not a string test: asking whether the path starts with `/$bunfs`
 * would be asking about one version of one runtime on one OS, and the same
 * question — *is the engine's source where this thinks it is?* — is worth
 * answering when a checkout has been moved, packaged or half-installed too.
 *
 * `src/` and `bin/` are the two that must be there. `scripts/` is not in
 * `package.json`'s `files`, so an installed copy has none and its absence says
 * nothing.
 *
 * Pure, with the lookup injected, because the compiled case is otherwise only
 * reachable by building a binary — the same shape, and for the same reason, as
 * {@link import("../src/guard/hooks.ts").hookCommand}.
 */
export function checkoutRoot(
  root: string,
  isDirectory: (path: string) => boolean,
): string | undefined {
  return isDirectory(join(root, "src")) && isDirectory(join(root, "bin")) ? root : undefined;
}

/** A directory on disk, or false for anything else — including what is not there. */
function dirOnDisk(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * This engine's checkout, or `undefined` when it is running as a binary.
 *
 * Every caller has to handle the second case, which is the point: `doctor`
 * reports that it could not check rather than reporting a clean scan of an
 * empty virtual filesystem, and `new` and `soul --out` fall back to the guard
 * that does still work — see the note on {@link import("../src/agent/new.ts").newAgent}.
 */
export const ENGINE_CHECKOUT: string | undefined = checkoutRoot(ENGINE_ROOT, dirOnDisk);

/**
 * Colour only when that stream is a terminal, so pipes stay parseable.
 *
 * Two answers, because `ohmyagi doctor > report.txt` leaves stderr a terminal and
 * stdout not: a single flag would either colour the file or strip the colour
 * from the console. Both are read once, at import — a file descriptor's kind is
 * settled when the process is handed it and nothing in om-agi reopens one, so a
 * per-call read would ask a question whose answer cannot change and read as if
 * it could.
 *
 * ## Why `isatty(1)` and not `process.stdout.isTTY`
 *
 * Measured under bun 1.4.2 on Linux, and the reason is not style. **Reading the
 * `process.stdout` getter can change what that stream then does**: after the
 * read, a single `console.log` longer than 8192 bytes into a real pipe(2) can
 * arrive cut to exactly 8192 bytes, with no error, no exception and no short
 * write reported anywhere. With `isatty(1)` from `node:tty`, and with no read
 * at all, the same program wrote all 20001 bytes in every condition measured;
 * through `Bun.spawn`'s pipe all 20001 arrive either way, which is why every
 * test in this repository and every one of `scripts/cli-parity.ts`'s
 * invocations were blind to it.
 *
 * **It is a race, not a ceiling.** On one machine on 2026-09-22 the same probe
 * came back whole 40 times out of 40 while that machine was quiet — including
 * under a CPU busy loop, and at every size from 8000 to 65536 bytes — and cut
 * 15 out of 15 while `npm test` ran, and 15 out of 15 beside half a dozen other
 * bun processes. 8192 is what was observed to get out before the process ended,
 * not a limit the runtime declares. So a quick check on an idle machine will
 * say there is no problem and be wrong, and the loss lands where it is least
 * welcome: in CI, and while somebody is running something else.
 *
 * This line ran at *import*, so every command was exposed: `ohmyagi help`
 * through a pipe showed 8192 of its 17363 bytes, ending just after `erase`'s
 * usage line and before the warnings that follow it, and `erase --json | jq`
 * could not read a 14 KB certificate.
 *
 * What is known here is behaviour, not mechanism: nobody read bun's source, and
 * whether other operating systems or other bun releases do the same is
 * unmeasured. `test/cli/streams.test.ts` asserts the two halves that held in
 * every condition and *prints* the rest on every run, because a check whose
 * colour follows the load average is one nobody keeps believing.
 */
const tty = isatty(1);
const ttyErr = isatty(2);
export const dim = (s: string) => (tty ? `\u001b[2m${s}\u001b[0m` : s);
export const bold = (s: string) => (tty ? `\u001b[1m${s}\u001b[0m` : s);
/** For lines that go to stderr, which has its own answer to "am I a terminal?". */
export const dimErr = (s: string) => (ttyErr ? `\u001b[2m${s}\u001b[0m` : s);
/** …and its own bold, for the same reason {@link dimErr} exists. */
export const boldErr = (s: string) => (ttyErr ? `\u001b[1m${s}\u001b[0m` : s);

/**
 * One stream, with the two questions a caller has to ask about it answered
 * together: *where does this line go* and *is colour wanted there*.
 *
 * `erase --json` is why this is one value rather than three arguments. Under
 * that flag every human line moves to stderr, and moving the line without
 * moving the styling would put escape codes into `2> erase.log` whenever stdout
 * happened to be a terminal — the bug this module's header says it exists to
 * avoid, arriving by the other door.
 *
 * `line()` with no argument writes a blank line **with an explicit empty
 * string**: under bun 1.4.2 `console.error()` puts its newline on stdout, which
 * `test/cli/streams.test.ts` measures and bans.
 */
export interface Sink {
  readonly line: (text?: string) => void;
  readonly dim: (s: string) => string;
  readonly bold: (s: string) => string;
}

/** stdout: the answer, the document, the thing being piped. */
export const OUT: Sink = { line: (text = "") => console.log(text), dim, bold };

/** stderr: the reason, the plan, everything a person reads and a script does not. */
export const ERR: Sink = { line: (text = "") => console.error(text), dim: dimErr, bold: boldErr };

/**
 * `--key value` and `--key=value`, plus whatever is left over.
 *
 * @param booleans Flags that take no value. Without this list, `--apply ./soul`
 *   would read as `apply="./soul"` and the directory would vanish from the
 *   positionals — silently, which for a command that writes files is the worst
 *   available failure.
 */
export function parseArgs(
  argv: readonly string[],
  booleans: readonly string[] = [],
): {
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, string>;
} {
  const positional: string[] = [];
  const options = new Map<string, string>();

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    if (equals !== -1) {
      options.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }
    const key = token.slice(2);
    if (booleans.includes(key)) {
      options.set(key, "");
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      options.set(key, "");
      continue;
    }
    options.set(key, value);
    index++;
  }

  return { positional, options };
}

/** Print every issue, then a count. Returns the exit code to use. */
export function report(issues: readonly SoulIssue[]): number {
  for (const issue of issues) console.error(formatIssue(issue));
  console.error(`\n${issues.length} problem${issues.length === 1 ? "" : "s"}.`);
  return 1;
}

/**
 * One line from the terminal, without its newline.
 *
 * Here, rather than in `src/observer/consent.ts`, so that the consent logic
 * takes a `ConsentIo` and can be tested without a process — the same split
 * `ApplyEnv` makes, for the same reason. It moved out of
 * `bin/commands/observe.ts` when `autonomy` needed the same phrase prompt for
 * the same reason (a level 3 nobody typed), because `test/cli/layout.test.ts`
 * holds a rule worth keeping: one command never imports another. A helper two
 * commands need is a helper that belongs here.
 *
 * It is the one thing in this file no test can call in-process — `Bun.stdin`
 * inside the test runner is the runner's — so it is deliberately as small as it
 * can be, and everything a case could want to check about *what the phrase is*
 * lives in pure functions elsewhere.
 */
/**
 * A line reader over one stream, keeping what it read past a newline for the
 * next call. One per process for stdin: a second question (`persona review`
 * asks many) must get the second line — opening the stream anew each time lost
 * everything already buffered, and every answer after the first came back
 * empty (D-072). The reader's lock is released after each line, so a command
 * that asks once still exits with the terminal open.
 */
export function lineReader(open: () => ReadableStream<Uint8Array>): () => Promise<string> {
  let stream: ReadableStream<Uint8Array> | undefined;
  let pending = "";
  const decoder = new TextDecoder();
  return async () => {
    const reader = (stream ??= open()).getReader();
    try {
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          return line;
        }
        const { done, value } = await reader.read();
        if (done || value === undefined) {
          const rest = pending;
          pending = "";
          return rest;
        }
        pending += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  };
}

export const readTerminalLine: () => Promise<string> = lineReader(() => Bun.stdin.stream() as ReadableStream<Uint8Array>);

export function usageError(message: string): number {
  console.error(`ohmyagi: ${message}`);
  return 2;
}

/**
 * The tokens that mean *tell me how*, rather than *do it*.
 *
 * `-h` is here as well as `--help` because a person reaching for one reaches
 * for the other, and the cost of being wrong is not symmetrical: printing help
 * at somebody who wanted the command costs them one keystroke, and acting at
 * somebody who wanted help costs them whatever the command does.
 */
export const HELP_FLAGS: readonly string[] = ["--help", "-h"];

/**
 * Was this command asked how to be used?
 *
 * Measured on 2026-09-22, and this exists because of what the measurement
 * found: of the fifteen verbs `bin/om-agi.ts` dispatches, fourteen answered
 * `<verb> --help` with a usage error and **`ohmyagi stop --help` armed the
 * brake** — it wrote `$XDG_STATE_HOME/om-agi/STOP` and reported having done so,
 * because `--help` fell through `parseArgs` into an option nothing reads and
 * the command ran as if it had been typed bare. Asking a kill switch how to
 * work threw the kill switch.
 *
 * ## Any position, not just the first
 *
 * `ohmyagi stop ./agent --subject x --help` is the same question as
 * `ohmyagi stop --help`, and a rule that only looked at the first token would
 * have answered the first of those by stopping the machine. The cost of the
 * wider rule is one case: a turn whose prompt is the exact string `--help`
 * (`--prompt --help`) prints help instead of running. That is a prompt of two
 * words nobody has, the failure is in the direction that does nothing, and
 * `--prompt-file` — which the help text already recommends for anything you
 * would rather not put on a command line — does not go through argv at all.
 */
export function asksForHelp(argv: readonly string[]): boolean {
  return argv.some((token) => HELP_FLAGS.includes(token));
}

/**
 * The lines of a usage list that describe one verb, or `undefined` for a verb
 * it does not describe.
 *
 * It slices the real help text rather than holding a second copy per command,
 * for the reason `test/cli/usage-dispatch.test.ts` already exists to enforce:
 * two places that list the commands drift, and the one that drifts is always
 * the one a person is reading. `undefined` is therefore a meaningful answer —
 * it means the entry point dispatches something the help text never mentions —
 * and the guard in `test/cli/help-does-nothing.test.ts` treats it as a failure
 * rather than as "no help available".
 *
 * The usage text arrives as an argument instead of being imported so that this
 * stays a pure function of a string: the parsing is the part that can be wrong
 * about the shape of the prose, and it is the part a test has to be able to
 * hand synthetic prose to.
 *
 * @param usage The whole `USAGE` string.
 * @param command The verb, exactly as the entry point's `switch` spells it.
 * @param notBuilt The heading below which a line is a plan and not a command,
 *   so that `ohmyagi soul --help` does not offer `soul revoke`.
 */
export function helpFor(
  usage: string,
  command: string,
  notBuilt = "Not built yet",
): string | undefined {
  const end = usage.indexOf(notBuilt);
  const list = end === -1 ? usage : usage.slice(0, end);
  const opening = `  ohmyagi ${command}`;

  const block: string[] = [];
  let inside = false;
  for (const line of list.split("\n")) {
    if (line.startsWith("  ohmyagi ")) {
      // A new entry begins here, so this one either is ours or ends ours.
      inside = line === opening || line.startsWith(`${opening} `);
      if (inside) block.push(line);
      continue;
    }
    if (!inside) continue;
    // A continuation: either the rest of the signature or the description
    // column, both of which are indented past the entry's own two spaces.
    if (line.startsWith("   ")) {
      block.push(line);
      continue;
    }
    inside = false;
  }
  return block.length === 0 ? undefined : block.join("\n");
}

export function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/** The machine facts the ledger is allowed to see, in one place. */
export function ledgerEnv(): LedgerEnv {
  return { home: homedir(), env: process.env, now: () => new Date() };
}

/**
 * AC4 — the five places, and what deleting each of them will not reach.
 *
 * Printed by `ohmyagi new`, which is before there is any data anywhere, and by
 * every run of `erase`. The two `not-built` places are named as loudly as the
 * three that exist: a reader who is told about three and later discovers two
 * more has been told something false by omission.
 */
export function printPlaceNotices(out: Sink): void {
  out.line(out.bold("The five places a subject's data can end up, and what deleting it cannot reach:"));
  for (const id of PLACE_IDS) {
    const place = placeOf(id);
    out.line(`  ${id.padEnd(9)} ${place.status.padEnd(12)} ${place.what}`);
    if (place.status === "not-built") {
      out.line(
        out.dim(
          `             nothing in om-agi writes here yet, so nothing deletes here yet — ` +
            `${place.owedBy} owes it, reserved at ${place.reserved}/`,
        ),
      );
    }
    for (const list of place.undeletable) {
      for (const note of list) out.line(out.dim(`             - ${note}`));
    }
    out.line(out.dim(`             said at: ${place.noticeAt}`));
  }
}
