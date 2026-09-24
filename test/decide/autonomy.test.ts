/**
 * S5.1 — the dial, and the two ways a dial can lie.
 *
 * A dial lies by having no effect. There are exactly two shapes of that here
 * and both have cases below:
 *
 * 1. **A setting nothing reads.** `read` is the honest example — no vendor
 *    offers a flag that permits reading and forbids writing — and the answer is
 *    not to hide the number but to print `not separable` beside it. What is
 *    asserted is that `actLevel` does not include it, so a category with no
 *    mechanism cannot veto turns either.
 * 2. **A setting arithmetic quietly reduces.** `min(write, run, reach)` means
 *    `write = 3` with `reach = 1` does nothing at all, and
 *    `test/decide/effective.test.ts` asserts that every such reduction comes
 *    back as a {@link Clamp} with both numbers in it.
 *
 * And the direction, which every test here is written to keep visible: the dial
 * does not add restraint. Level 1 — the default — is what om-agi did before it
 * existed, because `readOnlyArgs` was spliced into every vendor's argv
 * unconditionally. 2 and 3 are the new thing.
 */

import { describe, expect, test } from "bun:test";
import {
  AUTONOMY_SCHEMA,
  CATEGORIES,
  CATEGORY_ENFORCEMENT,
  DEFAULT_DIAL,
  LEVEL_MEANING,
  SILENT_DIAL,
  actLevel,
  heldBy,
  isLevel,
  isReachLevel,
  levelOf,
  parseDial,
  serializeDial,
  type Dial,
  type Level,
  type ReachLevel,
} from "../../src/decide/autonomy.ts";

/** A dial with every category at one level, for the cases that vary one thing. */
function flat(level: Level, reach: ReachLevel = Math.min(level, 2) as ReachLevel): Dial {
  return { read: level, write: level, run: level, reach, setBy: null, setAt: null };
}

describe("S5.1 AC2 (D-052) — set apart, acting together, and saying which one decides", () => {
  test("agreeing categories hold nothing; read never holds a turn", () => {
    expect(heldBy(flat(1))).toEqual([]);
    expect(heldBy({ ...flat(2), read: 0 })).toEqual([]);
  });

  test("the lowest of write, run and reach is named, and ties are all named", () => {
    expect(heldBy({ ...flat(2), run: 1 })).toEqual(["run"]);
    expect(heldBy({ ...flat(3), reach: 2 })).toEqual(["reach"]);
    expect(heldBy({ ...flat(3, 2), write: 1, reach: 1 })).toEqual(["write", "reach"]);
  });
});

describe("the defaults, which are AC3 and also today's behaviour", () => {
  test("every category starts at 1, and nothing starts at 3", () => {
    for (const category of CATEGORIES) expect(levelOf(DEFAULT_DIAL, category)).toBe(1);
    expect(actLevel(DEFAULT_DIAL)).toBe(1);
    // AC3's second half, as a property rather than four assertions: no category
    // of the default is 3, whatever categories there turn out to be.
    expect(CATEGORIES.map((c) => levelOf(DEFAULT_DIAL, c)).includes(3)).toBe(false);
  });

  test("the silent dial is every category at 0, and is not the default", () => {
    for (const category of CATEGORIES) expect(levelOf(SILENT_DIAL, category)).toBe(0);
    expect(actLevel(SILENT_DIAL)).toBe(0);
    // The distinction the whole failure path rests on: a file om-agi cannot
    // read produces this, never `DEFAULT_DIAL`.
    expect(SILENT_DIAL).not.toEqual(DEFAULT_DIAL);
  });

  test("both are frozen, so a caller cannot edit the default for everybody", () => {
    expect(Object.isFrozen(DEFAULT_DIAL)).toBe(true);
    expect(Object.isFrozen(SILENT_DIAL)).toBe(true);
  });
});

describe("actLevel is a minimum, and the reason is I-6", () => {
  test("it is the smallest of write, run and reach", () => {
    expect(actLevel(flat(2))).toBe(2);
    expect(actLevel({ ...flat(3), write: 3, run: 3, reach: 1 })).toBe(1);
    expect(actLevel({ ...flat(3), write: 3, run: 0, reach: 2 })).toBe(0);
  });

  test("a maximum would let write raise reach past the cap its own type declares", () => {
    // The whole argument, as arithmetic. `reach` is `0 | 1 | 2`; under a
    // maximum, `write = 3` would put the acting level at 3 and the egress
    // category would be at 3 with nothing having said so. Under a minimum it
    // cannot exceed reach, which is the property S8.3 AC2 needs.
    const guarded: Dial = { read: 3, write: 3, run: 3, reach: 1, setBy: null, setAt: null };
    const maximum = Math.max(guarded.write, guarded.run, guarded.reach);
    expect(maximum).toBe(3);
    expect(actLevel(guarded)).toBe(1);
    expect(actLevel(guarded)).toBeLessThanOrEqual(guarded.reach);

    // As a property over every combination, not the three above.
    for (const write of [0, 1, 2, 3] as const) {
      for (const run of [0, 1, 2, 3] as const) {
        for (const reach of [0, 1, 2] as const) {
          const act = actLevel({ read: 3, write, run, reach, setBy: null, setAt: null });
          expect(act).toBeLessThanOrEqual(reach);
          expect(act).toBe(Math.min(write, run, reach) as Level);
        }
      }
    }
  });

  test("`read` is not in the minimum, because nothing enforces it", () => {
    // Including it would let a number that controls nothing veto turns — a
    // control surface that works in one direction only, which is worse than one
    // labelled as absent. The label is asserted here so it cannot quietly go.
    const readSilent: Dial = { read: 0, write: 2, run: 2, reach: 2, setBy: null, setAt: null };
    expect(actLevel(readSilent)).toBe(2);
    expect(CATEGORY_ENFORCEMENT.read).toContain("not separable");
    expect(CATEGORY_ENFORCEMENT.read).toContain("nothing in om-agi acts on it");
  });

  test("every level has a meaning written down, and 0 means the turn does not run", () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(LEVEL_MEANING[level].length).toBeGreaterThan(20);
    }
    expect(LEVEL_MEANING[0]).toContain("does not run");
    // The direction, in the text a person reads: at 1 the flag is sent, at 2 it
    // is taken off. A reader who has these two backwards has the dial backwards.
    expect(LEVEL_MEANING[1]).toContain("read-only flag");
    expect(LEVEL_MEANING[2]).toContain("taken off");
  });
});

describe("reach is capped at 2 by the type, not by a check", () => {
  test("`tsc` refuses a reach of 3", () => {
    // The mechanism, demonstrated rather than described. I-6 says the
    // outward-contact category is held low *in code*; this is the code.
    // @ts-expect-error — ReachLevel is 0 | 1 | 2, and 3 is deliberately absent
    const impossible: ReachLevel = 3;
    void impossible;

    // …and the same at the whole-dial level, which is where it would be written.
    // @ts-expect-error — reach: 3 does not type-check on a Dial either
    const dial: Dial = { read: 1, write: 1, run: 1, reach: 3, setBy: null, setAt: null };
    void dial;
  });

  test("the narrowing predicates agree with the types", () => {
    for (const value of [0, 1, 2, 3]) expect(isLevel(value)).toBe(true);
    for (const value of [0, 1, 2]) expect(isReachLevel(value)).toBe(true);
    expect(isReachLevel(3)).toBe(false);
    for (const value of [-1, 4, 1.5, "1", null, undefined, {}, [], NaN]) {
      expect(isLevel(value)).toBe(false);
      expect(isReachLevel(value)).toBe(false);
    }
  });
});

describe("parseDial refuses rather than repairs", () => {
  const good = serializeDial(flat(1));

  test("a file it wrote reads back as the dial that wrote it", () => {
    for (const dial of [flat(0), flat(1), flat(2), { ...flat(3), reach: 2 as ReachLevel }]) {
      const parsed = parseDial("autonomy.md", serializeDial(dial));
      expect(parsed.ok, JSON.stringify(dial)).toBe(true);
      if (parsed.ok) expect(parsed.value).toEqual(dial);
    }
  });

  test("provenance survives the round trip, which is AC4's half of it", () => {
    const dial: Dial = {
      ...flat(2),
      setBy: "Somebody Synthetic",
      setAt: "2026-09-22T00:00:00.000Z",
    };
    const parsed = parseDial("autonomy.md", serializeDial(dial));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.setBy).toBe("Somebody Synthetic");
      expect(parsed.value.setAt).toBe("2026-09-22T00:00:00.000Z");
    }
  });

  test("the body is kept, because why a level was raised is the part nothing else holds", () => {
    const text = serializeDial(flat(2), "Raised for the migration on the 22nd. — a note\n");
    expect(text).toContain("Raised for the migration on the 22nd.");
    const parsed = parseDial("autonomy.md", text);
    expect(parsed.ok).toBe(true);
  });

  test("a level this program does not have is refused, not rounded down", () => {
    // `write = 4` is not a file that meant 3. The two readings — "they meant
    // the maximum" and "they meant something this version does not support" —
    // differ by exactly the amount of autonomy being handed over.
    const parsed = parseDial("autonomy.md", good.replace("write = 1", "write = 4"));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.length).toBe(1);
      expect(parsed.issues[0]!.path).toBe("write");
      expect(parsed.issues[0]!.message).toContain("0, 1, 2 or 3");
      // A line to go to, which is the whole reason this reuses the soul parser.
      expect(parsed.issues[0]!.line).toBeGreaterThan(0);
    }
  });

  test("reach = 3 in a file is refused with I-6 named", () => {
    const parsed = parseDial("autonomy.md", good.replace("reach = 1", "reach = 3"));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues[0]!.path).toBe("reach");
      expect(parsed.issues[0]!.message).toContain("I-6");
      expect(parsed.issues[0]!.message).toContain("never 3");
    }
  });

  test("a missing category is an issue, not a default", () => {
    // A file that names `write` and forgets `reach` would otherwise inherit a
    // default for the one category I-6 protects — from a file whose whole
    // purpose is to say what the defaults should be.
    const parsed = parseDial("autonomy.md", good.replace("reach = 1\n", ""));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.some((issue) => issue.path === "reach")).toBe(true);
      expect(parsed.issues[0]!.message).toContain("decides the categories it does not mention");
    }
  });

  test("an unknown key is an issue — a setting somebody believes is in force", () => {
    const parsed = parseDial("autonomy.md", good.replace("read = 1", "read = 1\nspend = 3"));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.some((issue) => issue.path === "spend")).toBe(true);
  });

  test("a wrong or missing schema tag is refused", () => {
    expect(parseDial("autonomy.md", good.replace(AUTONOMY_SCHEMA, "om-agi/autonomy@99")).ok).toBe(
      false,
    );
    expect(parseDial("autonomy.md", good.replace(/^schema = .*$/m, "")).ok).toBe(false);
  });

  test("broken TOML and a missing fence are both refused, with a line", () => {
    for (const text of ["+++\nthis is not toml = = =\n+++\n", "read = 1\n", ""]) {
      const parsed = parseDial("autonomy.md", text);
      expect(parsed.ok, JSON.stringify(text)).toBe(false);
      if (!parsed.ok) expect(parsed.issues.length).toBeGreaterThan(0);
    }
  });

  test("every issue is collected, not the first one", () => {
    // Somebody hand-writing this file wants the whole list; a validator that
    // stops early teaches them to fix one line per run.
    const parsed = parseDial(
      "autonomy.md",
      "+++\nschema = \"nope\"\nread = 9\nwrite = 1\nrun = 1\nreach = 1\n+++\n",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.length).toBeGreaterThan(1);
  });
});
