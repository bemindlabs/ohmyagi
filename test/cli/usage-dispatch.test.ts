/**
 * What om-agi *says* it answers to, against what it *does* answer to.
 *
 * Three directions, and all three are the same bug seen from a different side:
 *
 * 1. **Advertised → dispatched.** A command in the help text with no `case`
 *    behind it prints `unknown command` and exits 2 at the one moment somebody
 *    trusted the documentation. `soul revoke` was this for a while, and the
 *    repair was not a stub — it was moving the line under *Not built yet*.
 * 2. **Not-built → not dispatched.** The footer is a promise in the other
 *    direction. The day `soul revoke` is implemented, leaving it under that
 *    heading hides a finished command from everyone who reads `--help`, which
 *    is direction 3 arriving by a different road.
 * 3. **Dispatched → advertised.** The one people forget, and the worst of the
 *    three: a command that works but is written down nowhere does not exist for
 *    the person using this CLI. It cannot be found by reading the help, it
 *    cannot be found by reading the README, and nothing goes red — the tests
 *    that exercise it all pass, because it works.
 *
 * README gets directions 1 and 2 as well, over the command block under
 * *Architecture*. It is a second place the same list is written down, it is the
 * first place a reader meets it, and it had `ohmyagi run <name>` in it with no
 * such command anywhere in `bin/` and no word saying so. `run` is still there —
 * deleting it would tell a reader who wants it that it was never planned —
 * carrying the marker this file reads, so it goes red the day E5 lands and
 * nobody remembers to unmark it.
 *
 * ## Why the discriminant, not the file
 *
 * `bin/commands/soul.ts` holds two `switch` statements. One is over `sub` and
 * its labels are commands; the other is over `result.outcome` and its labels
 * are `already-current`, `nothing-applicable` and `wrote`. {@link caseLabels}
 * is told which discriminant to read for exactly that reason — a text search
 * for `case "…"` in that file reports seven commands, three of which are not
 * commands, and the three extra ones would then have to be advertised to keep
 * direction 3 green.
 *
 * ## What this cannot see
 *
 * A `case` that exists and throws, a command advertised with the wrong flags,
 * and a subcommand dispatched from somewhere other than a `switch (sub)` in its
 * own file. The first two belong to the tests that run those commands; the
 * third would make this file's answer for that verb `absent`, which is reported
 * rather than skipped.
 */

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { USAGE } from "../../bin/usage.ts";
import { caseLabels } from "../support/ast.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const ENTRY = join(ROOT, "bin", "om-agi.ts");
const COMMANDS = join(ROOT, "bin", "commands");
const README = join(ROOT, "README.md");

/** The heading in `bin/usage.ts` under which a command is a plan, not a command. */
const NOT_BUILT = "Not built yet";

/** The words a README command line carries when it is a plan, not a command. */
const NOT_BUILT_README = "not built yet";

/**
 * A command line's `verb` and, when it has one, its `sub`.
 *
 * Two defences, because each one alone has a hole and the real text walks past
 * both holes by luck:
 *
 * 1. **The signature ends at the first run of two or more spaces.** That is the
 *    column the descriptions are aligned in — `ohmyagi guard install [<dir>]
 *    ⎵⎵⎵⎵ Write the pre-commit…`. Alone this is not enough: four lines in the
 *    help text put a one-space description straight after the arguments
 *    (`observe disable --subject <id> Withdraw consent…`), so on those the
 *    signature is the whole line.
 * 2. **Then: the leading run of bare lowercase words, at most two.** `<name>`
 *    and `<dir>` are placeholders, `[--check]` and `--staged` are flags, and
 *    `Withdraw` starts with a capital — each of them ends the command. Alone
 *    this is not enough either: a description beginning with a lowercase word
 *    right after a verb (`ohmyagi frobnicate ⎵⎵ do the thing`) would be read as
 *    a subcommand, which is what defence 1 catches.
 *
 * No list of which verbs take subcommands is written down here. Such a list is
 * the thing this file exists to check, so keeping a copy of it to do the
 * checking with would make the answer come out of the copy.
 */
function commandOf(rest: string): string {
  const signature = rest.trim().split(/\s{2,}/)[0] ?? "";
  const words: string[] = [];
  for (const token of signature.split(/\s+/)) {
    if (!/^[a-z][a-z-]*$/.test(token)) break;
    words.push(token);
    if (words.length === 2) break;
  }
  return words.join(" ");
}

/** Every `ohmyagi …` line in a block of help text, as `verb` or `verb sub`. */
function advertisedIn(text: string, indent: string): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith(`${indent}ohmyagi `)) continue;
    found.push(commandOf(line.slice(`${indent}ohmyagi `.length)));
  }
  return [...new Set(found)];
}

/** The help text, split at the footer that says what is only planned. */
function usageHalves(text: string): { advertised: string[]; planned: string[] } {
  const at = text.indexOf(NOT_BUILT);
  return {
    advertised: advertisedIn(at === -1 ? text : text.slice(0, at), "  "),
    planned: at === -1 ? [] : advertisedIn(text.slice(at), "  "),
  };
}

/** The fenced block under README's `## Architecture`, split the same way. */
function readmeHalves(text: string): { advertised: string[]; planned: string[] } {
  const section = text.slice(text.indexOf("\n## Architecture"));
  const open = section.indexOf("```");
  const block = section.slice(open + 3, section.indexOf("```", open + 3));

  const advertised: string[] = [];
  const planned: string[] = [];
  for (const line of block.split("\n")) {
    if (!line.startsWith("ohmyagi ")) continue;
    const rest = line.slice("ohmyagi ".length);
    (line.includes(NOT_BUILT_README) ? planned : advertised).push(commandOf(rest));
  }
  return { advertised: [...new Set(advertised)], planned: [...new Set(planned)] };
}

/** The subcommands `bin/commands/<verb>.ts` dispatches, or `undefined` if it has none. */
async function subcommandsOf(verb: string): Promise<string[] | undefined> {
  const path = join(COMMANDS, `${verb}.ts`);
  const source = await Bun.file(path).text().catch(() => undefined);
  if (source === undefined) return undefined;
  const labels = caseLabels(path, source, ["sub"]);
  return labels.length === 1 && labels[0] === "absent" ? undefined : labels;
}

/**
 * Every command this CLI really answers to, as `verb` or `verb sub`.
 *
 * A verb whose own file dispatches subcommands contributes those and not
 * itself: `ohmyagi soul` with nothing after it is an error, so advertising the
 * bare verb would be advertising a command that does not work.
 */
async function dispatched(): Promise<string[]> {
  const entry = caseLabels(ENTRY, await readFile(ENTRY, "utf8"), ["command"]);
  const found: string[] = [];
  for (const verb of entry) {
    // `--version`, `-v`, `--help`, `-h`: aliases of a verb that is itself
    // dispatched, and nobody types them as a command.
    if (verb.startsWith("-")) continue;
    const subs = await subcommandsOf(verb);
    if (subs === undefined) found.push(verb);
    else for (const sub of subs) found.push(`${verb} ${sub}`);
  }
  return found;
}

describe("everything advertised is answered, and everything answered is advertised", () => {
  test("every command in the help text has a case behind it", async () => {
    const { advertised } = usageHalves(USAGE);
    const answers = new Set(await dispatched());

    const unanswered = advertised.filter((name) => !answers.has(name));
    expect(
      unanswered.map(
        (name) =>
          `ohmyagi ${name} — advertised in bin/usage.ts, no case dispatches it. Either add ` +
          `the case, or move the line under "${NOT_BUILT}:" the way soul revoke is.`,
      ),
    ).toEqual([]);

    // Control: the two halves of the comparison are both populated. An empty
    // `advertised` would pass the line above over a help text nobody can read,
    // and an over-eager `answers` would pass it over anything at all.
    expect(advertised.length).toBeGreaterThan(20);
    expect(answers.size).toBeGreaterThan(20);
    expect(advertised).toContain("soul verify");
    expect([...answers]).toContain("soul verify");
  });

  test("nothing under `Not built yet` has a case, or the footer is hiding a command", async () => {
    const { planned } = usageHalves(USAGE);
    const answers = new Set(await dispatched());

    const built = planned.filter((name) => answers.has(name));
    expect(
      built.map(
        (name) =>
          `ohmyagi ${name} — dispatched, but bin/usage.ts still lists it under ` +
          `"${NOT_BUILT}". Move it up into Usage: a finished command listed as unbuilt ` +
          `is a command nobody will try.`,
      ),
    ).toEqual([]);

    // Control: the footer exists and this test is reading something. Were the
    // heading reworded, `planned` would be empty and the assertion above
    // vacuous — which is the failure mode that matters here, because the
    // footer's whole job is to be the place a line can sit without a case.
    expect(USAGE).toContain(`${NOT_BUILT} (see .scrum/backlog.md):`);
    expect(planned.length).toBeGreaterThan(0);
  });

  test("every command that has a case is advertised, or it exists for nobody", async () => {
    const { advertised, planned } = usageHalves(USAGE);
    const known = new Set([...advertised, ...planned]);

    const unadvertised = (await dispatched()).filter((name) => !known.has(name));
    expect(
      unadvertised.map(
        (name) =>
          `ohmyagi ${name} — dispatched, and named nowhere in bin/usage.ts. A command ` +
          `nobody can find by reading --help is a command that does not exist for the ` +
          `person using this CLI. Add it to the Usage block.`,
      ),
    ).toEqual([]);

    // Control: `dispatched()` is returning commands rather than nothing, and is
    // reading past the entry point's own switch into each command's file.
    const answers = await dispatched();
    expect(answers.length).toBeGreaterThan(20);
    expect(answers).toContain("observe purge");
    expect(answers).not.toContain("soul");
  });

  test("README's command block advertises nothing that has no case", async () => {
    const { advertised, planned } = readmeHalves(await readFile(README, "utf8"));
    const answers = new Set(await dispatched());

    const unanswered = advertised.filter((name) => !answers.has(name));
    expect(
      unanswered.map(
        (name) =>
          `ohmyagi ${name} — in README's Architecture block, no case dispatches it. ` +
          `Either add the case, or write "${NOT_BUILT_README} [E<n>]" on that line, the ` +
          `way ohmyagi run does.`,
      ),
    ).toEqual([]);

    const built = planned.filter((name) => answers.has(name));
    expect(
      built.map(
        (name) =>
          `ohmyagi ${name} — dispatched, and README still marks it "${NOT_BUILT_README}". ` +
          `Drop the marker and describe what it does.`,
      ),
    ).toEqual([]);

    // Control: the block was found and parsed. README lists a subset of the
    // help text on purpose — no `doctor`, no `worn`, no `version` — so there is
    // no third direction to check here, which makes an empty parse invisible
    // without this.
    expect(advertised.length).toBeGreaterThan(15);
    expect(advertised).toContain("observe capture");
    expect(advertised).toContain("erase");
  });
});

describe("the parsers themselves, on source they must read and source they must not", () => {
  test("a usage line yields its verb, and a subcommand only when the token is a bare word", () => {
    expect(commandOf("version                        Print the version")).toBe("version");
    expect(commandOf("soul check <dir> --subject <id>")).toBe("soul check");
    expect(commandOf("rebuild <dir> --subject <id> [--check]")).toBe("rebuild");
    expect(commandOf("doctor [--model a,b] [--backend a,b]")).toBe("doctor");
    expect(commandOf("erase <subject> (--agent <dir> | --no-agent)")).toBe("erase");
    expect(commandOf("observe hook --print --subject <id>")).toBe("observe hook");
    // A capitalised description word is not a subcommand, and neither is a flag.
    expect(commandOf("backends                       What this machine can reach")).toBe("backends");
    expect(commandOf("worn [--backend a,b] [--home <dir>]")).toBe("worn");

    // The two lines each defence exists for, and each one defeats the other
    // defence on its own:
    //
    //  - a one-space description, so the column split gives back the whole
    //    line and only the bare-word run keeps `Withdraw` out;
    expect(commandOf("observe disable --subject <id> Withdraw consent and stop recording."))
      .toBe("observe disable");
    //  - a lowercase description right after a verb that takes no subcommand,
    //    where the bare-word run would happily take `do` and only the column
    //    split says otherwise.
    expect(commandOf("frobnicate        do the thing")).toBe("frobnicate");
    expect(commandOf("guard install [<dir>]          Write the pre-commit hooks")).toBe("guard install");
  });

  test("the split at the footer really separates the two halves", () => {
    const synthetic = [
      "Usage:",
      "  ohmyagi frobnicate                     Do the thing",
      "  ohmyagi widget polish <dir>            Polish it",
      "",
      `${NOT_BUILT} (see .scrum/backlog.md):`,
      "  ohmyagi widget tarnish       Un-polish it                [S9.9]",
      "",
    ].join("\n");

    const { advertised, planned } = usageHalves(synthetic);
    expect(advertised).toEqual(["frobnicate", "widget polish"]);
    expect(planned).toEqual(["widget tarnish"]);

    // Without the heading, every line is advertised — which is what makes the
    // footer a promise rather than a comment.
    const flattened = usageHalves(synthetic.replace(NOT_BUILT, "Also"));
    expect(flattened.advertised).toContain("widget tarnish");
    expect(flattened.planned).toEqual([]);
  });

  test("a README line marked not built is read as planned, and an unmarked one is not", () => {
    const synthetic = [
      "# x",
      "",
      "## Architecture",
      "",
      "```",
      "some/path/                        a directory, not a command",
      "ohmyagi frobnicate        do the thing",
      "ohmyagi widget tarnish    not built yet [S9.9] — un-polish it",
      "```",
      "",
      "Prose afterwards mentioning `ohmyagi neverparsed` outside the fence.",
      "",
    ].join("\n");

    const { advertised, planned } = readmeHalves(synthetic);
    expect(advertised).toEqual(["frobnicate"]);
    expect(planned).toEqual(["widget tarnish"]);
    // The fence is the boundary: prose below it is not a command list.
    expect([...advertised, ...planned]).not.toContain("neverparsed");
  });

  test("caseLabels reads the switch it is asked for and not the one beside it", async () => {
    const path = join(COMMANDS, "soul.ts");
    const source = await readFile(path, "utf8");

    const subs = caseLabels(path, source, ["sub"]);
    // The subcommands, and not the count of them: this file goes red for the
    // right reason when `soul` grows one, which is direction 3 above, and
    // pinning the list here would make it go red twice and once too early.
    expect(subs).toContain("check");
    expect(subs).toContain("verify");

    // The other switch in the same file. A text search for `case "…"` reports
    // its labels alongside the subcommands and calls all of them commands.
    const outcomes = caseLabels(path, source, ["result.outcome"]);
    expect(outcomes).toContain("already-current");
    expect(subs.filter((label) => outcomes.includes(label))).toEqual([]);
    // Control: the second switch is really being read, so the disjointness
    // above is two populated lists and not one empty one.
    expect(outcomes.length).toBeGreaterThan(1);

    // A discriminant nothing switches on is `absent`, never `[]` — so a rename
    // shows up as a failure instead of as an empty list everything satisfies.
    expect(caseLabels(path, source, ["renamedAwayFromSub"])).toEqual(["absent"]);
  });
});
