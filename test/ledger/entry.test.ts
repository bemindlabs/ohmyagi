/**
 * One line of the ledger, and the two properties the whole format rests on.
 *
 * The first is that a line is a line: a prompt with twenty newlines in it must
 * still occupy exactly one, or a crash mid-write would leave something that
 * parses as a complete record of a turn that did not finish.
 *
 * The second is that `content: "withheld"` is a fact rather than a label. If a
 * `--private` line could carry the text it claims not to have, the flag would
 * be documentation instead of a guarantee, and the owner would have no way to
 * tell the two apart by looking.
 */

import { describe, expect, test } from "bun:test";
import {
  byteLength,
  formatLine,
  LEDGER_VERSION,
  parseLine,
  type LedgerEntry,
} from "../../src/ledger/entry.ts";
import { subjectId } from "../../src/types.ts";

const SUBJECT = subjectId("example");

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    v: LEDGER_VERSION,
    kind: "turn",
    id: "11111111-1111-4111-8111-111111111111",
    turn: "22222222-2222-4222-8222-222222222222",
    at: "2026-09-21T10:00:00.000Z",
    subject: SUBJECT,
    backend: "ollama",
    model: "stub",
    content: "full",
    prompt: "hello",
    prompt_bytes: 5,
    text: "hi",
    text_bytes: 2,
    confidence: "confirmed",
    exit: null,
    duration_ms: 42,
    cost: null,
    identity: "system",
    soul_sha: "a".repeat(64),
    ...overrides,
  } as LedgerEntry;
}

describe("a ledger line", () => {
  test("round-trips through format and parse", () => {
    const original = entry();
    const parsed = parseLine(formatLine(original));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entry).toEqual(original);
  });

  test("a multi-line prompt still occupies exactly one line", () => {
    const line = formatLine(entry({ prompt: "one\ntwo\nthree", prompt_bytes: 13 }));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1).includes("\n")).toBe(false);

    const parsed = parseLine(line);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entry.prompt).toBe("one\ntwo\nthree");
  });

  test("byteLength counts UTF-8 bytes, not characters", () => {
    // The size of a `--private` prompt is recorded when its text is not, so
    // the number has to mean something a human could check with `wc -c`.
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("สวัสดี")).toBe(18);
  });

  test("a withheld line carrying text is refused, not accepted and trusted", () => {
    const bad = formatLine(entry({ content: "withheld" }));
    const parsed = parseLine(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("withheld");
  });

  test("a genuine withheld line keeps the sizes and drops the text", () => {
    const parsed = parseLine(
      formatLine(entry({ content: "withheld", prompt: null, text: null })),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.entry.prompt).toBeNull();
      expect(parsed.entry.text).toBeNull();
      expect(parsed.entry.prompt_bytes).toBe(5);
      // Nothing that could be reversed into the prompt. A sha256 of a short
      // prompt is guessable, so the format carries no digest of one — the
      // only hash in a line is of the soul, which is in git anyway.
      expect(Object.keys(parsed.entry).filter((key) => key.includes("sha"))).toEqual(["soul_sha"]);
    }
  });

  test("cost is null rather than zero — and null by decision, not by debt", () => {
    // The survey that used to be missing has happened. Its answer was that no
    // figure in a currency belongs here: a vendor's own is an API list price
    // its subscription holders do not pay, and a local model's would be a `0`
    // claiming electricity is free. Tokens carry the part that was measured.
    const parsed = parseLine(formatLine(entry()));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entry.cost).toBeNull();
  });

  test.each([
    ["not JSON at all", "{nope", "not JSON"],
    ["an array", "[1,2]", "not a JSON object"],
    ["a future schema version", JSON.stringify({ ...entry(), v: 2 }), "schema version"],
    ["an unknown kind", JSON.stringify({ ...entry(), kind: "proposal" }), "unknown kind"],
    ["a subject that is not one", JSON.stringify({ ...entry(), subject: "Not A Subject" }), "subject"],
    ["a missing backend", JSON.stringify({ ...entry(), backend: "" }), "backend"],
    ["a bogus confidence", JSON.stringify({ ...entry(), confidence: "maybe" }), "confidence"],
    ["a bogus identity", JSON.stringify({ ...entry(), identity: "strong" }), "identity"],
    ["a non-numeric duration", JSON.stringify({ ...entry(), duration_ms: "42" }), "duration_ms"],
    ["a fractional byte count", JSON.stringify({ ...entry(), prompt_bytes: 1.5 }), "prompt_bytes"],
    ["a blank line", "   ", "blank"],
  ])("refuses %s, and says why", (_name, line, reason) => {
    const parsed = parseLine(line);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain(reason);
  });
});

describe("a line's account of what the turn used", () => {
  const usage = { status: "reported", input: 15, output: 24, total: null } as const;

  test("round-trips, zeros included", () => {
    const parsed = parseLine(formatLine(entry({ usage })));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entry.usage).toEqual(usage);

    const zeros = parseLine(
      formatLine(entry({ usage: { status: "reported", input: 0, output: 0, total: 0 } })),
    );
    expect(zeros.ok).toBe(true);
    if (zeros.ok) expect(zeros.entry.usage?.input).toBe(0);
  });

  test("a line written before this field existed still parses (I-4)", () => {
    // This is the whole reason the field is optional on read. Every line in a
    // real ledger predates it. If `parseLine` refused them, `ledger show`
    // would count them as unreadable and `ledger forget` — which only deletes
    // lines it could read — would leave them on disk while reporting success.
    // A schema change is a strange way to take away the right to withdraw.
    const { usage: _omitted, ...withoutUsage } = entry({ usage });
    expect("usage" in withoutUsage).toBe(false);

    const parsed = parseLine(`${JSON.stringify(withoutUsage)}\n`);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entry.usage).toBeUndefined();
  });

  test("`unreported` and an absent field are two different facts", () => {
    // "written by a backend nobody has surveyed" is not "written before there
    // was anywhere to say so", and a reader has to be able to tell them apart.
    const unreported = parseLine(
      formatLine(entry({ usage: { status: "unreported", input: null, output: null, total: null } })),
    );
    expect(unreported.ok).toBe(true);
    if (unreported.ok) expect(unreported.entry.usage?.status).toBe("unreported");
  });

  test.each([
    ["a status nobody defined", { status: "free", input: null, output: null, total: null }, "usage status"],
    ["a quoted count", { status: "reported", input: "15", output: 24, total: null }, "usage.input"],
    ["a negative count", { status: "reported", input: 15, output: -1, total: null }, "usage.output"],
    ["a fractional count", { status: "reported", input: 15, output: 24, total: 1.5 }, "usage.total"],
    ["a usage that is not an object", "reported", "not an object"],
    ["a usage that is an array", [15, 24], "not an object"],
  ])("refuses %s, and says why", (_name, usageValue, reason) => {
    const parsed = parseLine(JSON.stringify({ ...entry(), usage: usageValue }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain(reason);
  });
});
