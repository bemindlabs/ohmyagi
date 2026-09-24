/**
 * The autonomy dial — and the sentence a reader of its name will get backwards.
 *
 * ## Read this before anything else in this directory
 *
 * **The dial does not add safety. It is the key that takes safety off.**
 *
 * Every `headlessArgv` in `src/exec/registry.ts` splices {@link
 * import("../exec/registry.ts").readOnlyArgs} into the command line
 * *unconditionally* — six vendors, six call sites, no branch between the
 * declaration and the argv. Measured on 2026-09-22 against the tree at `97fb8d2`:
 * every turn om-agi has ever started already carries whatever read-only flag
 * its vendor offers. So the starting state of this program is the *restrained*
 * one, and `DEFAULT_DIAL` — every category at 1 — is not an intention waiting to
 * be implemented. It is a description of what already happens.
 *
 * What is new is the ability to **turn that off**, at level 2 and above. A
 * reader who arrives at a file called `autonomy.ts` expecting a safety feature
 * will read every default here as timid and every raise as progress, and will be
 * wrong in the one direction that costs something. The backlog calls S5.1
 * *"คุมได้ว่าเรื่องไหนทำเองได้"* — control over what it may do by itself — and
 * control is bidirectional. This file is the loosening half.
 *
 * ## Four categories, one lever
 *
 * AC2 asks for four: read, write, run, reach. D-002 (om-agi borrows vendor CLIs
 * rather than owning a sandbox) means the lever that really exists is **one bit
 * per turn**: the vendor's read-only flag is on, or it is not. Four numbers
 * therefore have to collapse into one decision, and the collapse is
 * {@link actLevel} — a **minimum**, never a maximum.
 *
 * Minimum, because `reach` is capped at 2 by its own type ({@link ReachLevel},
 * S8.3 AC2 / I-6). Under a maximum, setting `write = 3` would drag the acting
 * level to 3 and `reach` would be at 3 by arithmetic while its type still said
 * `0 | 1 | 2` — the guard would lose without anything printing a word. Under a
 * minimum, the flag comes off only when **all three** of write, run and reach
 * are at 2 or more, so raising `reach` is the single door, which is exactly
 * where I-6 wants the door to be.
 *
 * The cost of a minimum is its own kind of lie: a `write = 3` that does nothing
 * because `reach` is 1. That is why {@link import("./effective.ts").effectiveDial}
 * reports every clamp it applies and `ohmyagi autonomy set` prints them **at the
 * moment of setting**. A dial that quietly divides your number by something is
 * still a dial that lies; it just lies with arithmetic instead of with silence.
 *
 * ## `read` cannot be separated, and says so
 *
 * There is no vendor flag that means "may read, may not write". claude's
 * mechanism is `--tools ""`, an empty allow list that removes the read tools
 * too; codex's is `--sandbox read-only`, which reads freely. So `read` is kept
 * as a number because AC2 asks for four categories — the ACs are the owner's —
 * and every place it is printed carries `not separable` beside it rather than a
 * bare integer that implies a control nobody has.
 */

import { parseFrontmatter } from "../soul/frontmatter.ts";
import type { SoulIssue, Validated } from "../soul/schema.ts";

/** Schema tag `autonomy.md` must carry. Bumped when the shape changes. */
export const AUTONOMY_SCHEMA = "om-agi/autonomy@1";

/** Filename holding the dial, at the root of an agent repository. */
export const AUTONOMY_FILE = "autonomy.md";

/**
 * The four levels AC1 names.
 *
 * `0` is not "off with a warning" — it is *do not run the turn*. The other
 * three differ in what om-agi does around a turn it runs; `0` is the only one
 * that is about not running.
 */
export type Level = 0 | 1 | 2 | 3;

/**
 * The reach category, capped at 2 by the type rather than by a check.
 *
 * I-6 and S8.3 AC2: *หมวด "ติดต่อภายนอก" ล็อกที่ระดับ 1 บังคับที่โค้ด* — the
 * outward-contact category is held low, in code. A `3` here would mean "contact
 * whoever, report nothing", which is the one setting I-6 says may not exist. It
 * is absent from the type, so writing it is a `tsc` error rather than a review
 * comment, and {@link parseDial} rejects it in a file for the same reason.
 */
export type ReachLevel = 0 | 1 | 2;

/** The four AC2 asks for, in the order every report prints them. */
export type Category = "read" | "write" | "run" | "reach";

/** Every category, in AC2's order. Closed, so a fifth is a `tsc` error. */
export const CATEGORIES: readonly Category[] = ["read", "write", "run", "reach"];

/** What each level means, in the backlog's own words plus what om-agi does. */
export const LEVEL_MEANING: Readonly<Record<Level, string>> = Object.freeze({
  0: "เงียบ — the turn does not run at all",
  1: "เสนอ — the turn runs carrying the vendor's read-only flag",
  2: "ทำแล้วรายงาน — the turn runs with the read-only flag taken off",
  3: "ทำเลย — the turn runs with the read-only flag taken off",
});

/**
 * How a category is enforced on this machine, or the admission that it is not.
 *
 * Printed beside every number by `ohmyagi autonomy show`. Three of the four are
 * the same one bit, which is a fact about D-002 and not a gap in this file.
 */
export const CATEGORY_ENFORCEMENT: Readonly<Record<Category, string>> = Object.freeze({
  read:
    "not separable — no vendor here offers a flag that permits reading and forbids writing. " +
    "claude's mechanism is an empty tool allow list, which removes the read tools too; codex's " +
    "is a read-only sandbox, which reads freely. This number is recorded and reported and " +
    "nothing in om-agi acts on it.",
  write:
    "the vendor's own read-only flag, per vendor, listed by `ohmyagi backends`. One bit, on or " +
    "off, decided for the whole turn.",
  run:
    "the same one bit — a vendor CLI that may write may also run commands, and no flag here " +
    "separates them.",
  reach:
    "the same one bit for a turn, plus the egress notice, which has no off switch at any level " +
    "(src/exec/egress.ts). Capped at 2 by its type: see ReachLevel.",
});

/** Who set a level, and when. Both null until somebody sets one. */
export interface DialProvenance {
  /**
   * The name as this machine's git configuration already records it, or the
   * login name when git has none.
   *
   * Not new information and deliberately not a new channel: every commit in an
   * agent's repository already carries it. Recorded because AC4 asks who set a
   * level 3 and when, and an answer nobody can attribute is not an answer.
   */
  readonly setBy: string | null;
  /** ISO 8601, UTC. */
  readonly setAt: string | null;
}

/** The dial itself: four numbers and the provenance of the last change. */
export interface Dial extends DialProvenance {
  readonly read: Level;
  readonly write: Level;
  readonly run: Level;
  readonly reach: ReachLevel;
}

/**
 * AC3 — every category at 1, and nothing starts at 3.
 *
 * Also, per the measurement at the top of this file, *exactly what om-agi does
 * today*: every vendor already gets its read-only flag on every turn. A tree
 * with no `autonomy.md` in it behaves the same before and after this story, and
 * that is a property worth having rather than a coincidence — it is what makes
 * "no file" a safe answer instead of a missing one.
 */
export const DEFAULT_DIAL: Dial = Object.freeze({
  read: 1,
  write: 1,
  run: 1,
  reach: 1,
  setBy: null,
  setAt: null,
} as const);

/**
 * Every category at 0 — what a broken file, a ceiling of 0, or a stop flag
 * produces.
 *
 * Not `DEFAULT_DIAL`. A file om-agi cannot parse means om-agi does not know what
 * the owner intended, and falling back to "the usual" answers a question nobody
 * asked. The safest reading of an unreadable instruction is to do nothing.
 */
export const SILENT_DIAL: Dial = Object.freeze({
  read: 0,
  write: 0,
  run: 0,
  reach: 0,
  setBy: null,
  setAt: null,
} as const);

/** True for `0`, `1`, `2`, `3` and nothing else. Narrows, so callers need no cast. */
export function isLevel(value: unknown): value is Level {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** True for `0`, `1`, `2`. `3` is deliberately not a reach level — see {@link ReachLevel}. */
export function isReachLevel(value: unknown): value is ReachLevel {
  return value === 0 || value === 1 || value === 2;
}

/**
 * One level per category, read without widening.
 *
 * A `Record<Category, Level>` would type `reach` as `Level` and lose the cap the
 * moment anything iterated the categories, which is what every printer does.
 */
export function levelOf(dial: Dial, category: Category): Level {
  switch (category) {
    case "read":
      return dial.read;
    case "write":
      return dial.write;
    case "run":
      return dial.run;
    case "reach":
      return dial.reach;
  }
}

/**
 * The one level a turn is actually run at: `min(write, run, reach)`.
 *
 * `read` is **not** in the minimum, and leaving it out is the honest choice
 * rather than an oversight: there is no mechanism behind it (see
 * {@link CATEGORY_ENFORCEMENT}), so including it would let a number that
 * controls nothing veto turns — a control surface that works in one direction
 * only is worse than one that is labelled as absent.
 *
 * Why a minimum rather than a maximum is the long argument at the top of this
 * file. The short version: a maximum lets `write` raise `reach` past the cap its
 * own type declares.
 */
export function actLevel(dial: Dial): Level {
  return Math.min(dial.write, dial.run, dial.reach) as Level;
}

/**
 * The categories holding a turn at {@link actLevel}, or none when write, run
 * and reach agree (S5.1 AC2 as rewritten by D-052).
 *
 * The categories are set apart and take effect together: one shell both
 * writes files and reaches out (measured, D-047), so no vendor flag can grant
 * one without the other. What a person can still be told is which of their
 * settings is the one in force — otherwise a `write = 3` that does nothing
 * reads as a setting om-agi ignored.
 */
export function heldBy(dial: Dial): readonly Category[] {
  const acting = ["write", "run", "reach"] as const;
  const act = actLevel(dial);
  if (acting.every((category) => dial[category] === act)) return [];
  return acting.filter((category) => dial[category] === act);
}

/**
 * Render a dial as the file that produced it.
 *
 * `+++` TOML frontmatter over Markdown, the same shape a soul uses, for three
 * reasons that are all about the reader rather than the parser: `git diff` shows
 * a level change as one line; the body is a place to write down *why* a level
 * was raised, which is the part a reader six months later needs and no schema
 * can hold; and om-agi already has one frontmatter parser, so this is not a
 * second format to keep honest.
 */
export function serializeDial(dial: Dial, body = ""): string {
  const lines = [
    "+++",
    `schema = "${AUTONOMY_SCHEMA}"`,
    "",
    `read = ${dial.read}`,
    `write = ${dial.write}`,
    `run = ${dial.run}`,
    `reach = ${dial.reach}`,
  ];
  if (dial.setBy !== null) lines.push("", `set_by = ${JSON.stringify(dial.setBy)}`);
  if (dial.setAt !== null) {
    if (dial.setBy === null) lines.push("");
    lines.push(`set_at = ${JSON.stringify(dial.setAt)}`);
  }
  lines.push("+++", "");
  const text = lines.join("\n");
  return body === "" ? `${text}\n` : `${text}\n${body.replace(/\n*$/, "\n")}`;
}

/** An optional string field, or an issue explaining why it was refused. */
function readOptionalString(
  table: Record<string, unknown>,
  key: string,
  file: string,
  line: number,
  issues: SoulIssue[],
): string | null {
  const raw = table[key];
  if (raw === undefined) return null;
  if (typeof raw !== "string" || raw === "") {
    issues.push({ file, line, path: key, message: `${key} must be a non-empty string` });
    return null;
  }
  return raw;
}

/**
 * Read a dial out of `autonomy.md`, or every reason it was refused.
 *
 * Refuses rather than repairs, in every case. A file with `write = 4` in it is
 * not a file that meant 3: somebody wrote a number this program does not have,
 * and the two readings — "they meant the maximum" and "they meant something
 * this version does not support" — differ by exactly the amount of autonomy
 * being handed over. The caller turns a refusal into {@link SILENT_DIAL}; this
 * function never guesses.
 *
 * Every missing category is an issue too. A file that names `write` and forgets
 * `reach` would otherwise inherit a default for the one category I-6 protects,
 * from a file whose whole purpose is to say what the defaults should be.
 */
export function parseDial(file: string, text: string): Validated<Dial> {
  const parsed = parseFrontmatter(file, text);
  if (!parsed.ok) return parsed;

  const { table } = parsed.value.doc;
  const lineOf = (key: string): number => parsed.value.doc.lines.get(key) ?? parsed.value.openLine;
  const issues: SoulIssue[] = [];

  const schema = table["schema"];
  if (schema !== AUTONOMY_SCHEMA) {
    issues.push({
      file,
      line: lineOf("schema"),
      path: "schema",
      message: `schema must be ${JSON.stringify(AUTONOMY_SCHEMA)}, not ${JSON.stringify(schema)}`,
    });
  }

  const levels: Partial<Record<Category, number>> = {};
  for (const category of CATEGORIES) {
    const raw = table[category];
    if (raw === undefined) {
      issues.push({
        file,
        line: parsed.value.openLine,
        path: category,
        message:
          `${category} is missing. Every category is written down, because a file that names ` +
          `some of them and lets the rest default is a file that decides the categories it ` +
          `does not mention.`,
      });
      continue;
    }
    if (category === "reach") {
      if (!isReachLevel(raw)) {
        issues.push({
          file,
          line: lineOf(category),
          path: category,
          message:
            `reach must be 0, 1 or 2 — never 3. Outward contact is capped in code (I-6, S8.3 ` +
            `AC2): level 3 would mean "contact whoever, report nothing", which is the one ` +
            `setting this project says may not exist. Got ${JSON.stringify(raw)}.`,
        });
        continue;
      }
    } else if (!isLevel(raw)) {
      issues.push({
        file,
        line: lineOf(category),
        path: category,
        message: `${category} must be 0, 1, 2 or 3. Got ${JSON.stringify(raw)}.`,
      });
      continue;
    }
    levels[category] = raw as number;
  }

  const setBy = readOptionalString(table, "set_by", file, lineOf("set_by"), issues);
  const setAt = readOptionalString(table, "set_at", file, lineOf("set_at"), issues);

  const known = new Set<string>([...CATEGORIES, "schema", "set_by", "set_at"]);
  for (const key of Object.keys(table)) {
    if (known.has(key)) continue;
    issues.push({
      file,
      line: lineOf(key),
      path: key,
      message:
        `${key} is not a key of ${AUTONOMY_SCHEMA}. An unknown key in this file is a setting ` +
        `somebody believes is in force and that nothing reads.`,
    });
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      read: levels.read as Level,
      write: levels.write as Level,
      run: levels.run as Level,
      reach: levels.reach as ReachLevel,
      setBy,
      setAt,
    },
  };
}
