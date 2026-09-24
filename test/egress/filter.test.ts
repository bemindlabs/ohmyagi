/**
 * S8.3 — the egress filter (D-048). AC1 is "block, not warn"; AC3 is ten ways
 * of trying to get personal data out. The red team below is written to say
 * what it catches **and what it does not**: the two forms a text filter cannot
 * see are asserted as passing, so the day one of them is caught — or the day
 * a caught one slips — this file changes colour instead of a sentence in a
 * README going stale.
 */

import { describe, expect, test } from "bun:test";
import { describeFindings, FILTER_LIMITS, screen } from "../../src/egress/filter.ts";
import { parseNeedles } from "../../src/egress/store.ts";

const LEXICON = { needles: ["Wanida Srisuk", "ร้านใบเตยหอม", "stage 2 diabetes"] };

/** A valid Thai national ID (checksum right) and a Luhn-valid card, both fictional. */
function thaiId(): string {
  const first12 = "110170012345";
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (13 - i);
  return first12 + String((11 - (sum % 11)) % 10);
}
const CARD = "4111 1111 1111 1111";

describe("screen", () => {
  test("a needle is found whatever its case or spacing, and named by number only", () => {
    const findings = screen("please ask   WANIDA   srisuk about it", LEXICON);
    expect(findings).toEqual([{ rule: "needle", needle: 1 }]);
    expect(describeFindings(findings)).toBe("personal needle #1");
    expect(describeFindings(findings)).not.toContain("Wanida");
  });

  test("shapes: email, Thai phone, a Thai ID with a valid checksum, a Luhn card, a credential", () => {
    const rules = (text: string) => screen(text, { needles: [] }).map((f) => f.rule);
    expect(rules("write to w.s@example.co.th")).toContain("email");
    expect(rules("โทร 081-234-5678")).toContain("thai-phone");
    expect(rules("+66 81 234 5678")).toContain("thai-phone");
    expect(rules(`ID ${thaiId()}`)).toContain("thai-national-id");
    expect(rules(`card ${CARD}`)).toContain("payment-card");
    expect(rules("postgres://app:hunter22-x@db.invalid/main")).toContain("secret:url-credentials");
  });

  test("near misses pass: a wrong checksum, a non-Luhn number, a repeated digit, a date", () => {
    const rules = (text: string) => screen(text, { needles: [] }).map((f) => f.rule);
    const bad = thaiId().slice(0, 12) + String((Number(thaiId()[12]) + 1) % 10);
    expect(rules(`ref ${bad}`)).not.toContain("thai-national-id");
    expect(rules("order 4111 1111 1111 1112")).not.toContain("payment-card");
    expect(rules("0000000000000")).not.toContain("payment-card");
    expect(rules("2026-09-23 at 14:15, port 30600")).toEqual([]);
  });

  test("a clean message may leave", () => {
    expect(screen("close the books on the 26th and reconcile the bank feed", LEXICON)).toEqual([]);
  });

  test("the needles file: comments and blanks skipped", () => {
    expect(parseNeedles("# mine\nWanida Srisuk\n\n  ร้านใบเตยหอม  \n")).toEqual(["Wanida Srisuk", "ร้านใบเตยหอม"]);
  });
});

describe("AC3 — ten ways out, and which of them the filter stops", () => {
  const CAUGHT: readonly [string, string][] = [
    ["straight", "The owner is Wanida Srisuk."],
    ["in context", "Summary for the partner: invoices go out monthly, contact Wanida Srisuk if late."],
    ["as an attachment body", "--- attached: notes.md ---\n# Client\nร้านใบเตยหอม closes on the 26th\n---"],
    ["in a quoted log line", '2026-09-23T10:00Z INFO user="wanida srisuk" action=login'],
    ["health fact", "She manages her stage 2 diabetes with diet."],
    ["contact detail", "Reach her on 081-234-5678 after six."],
    ["email in a signature", "Thanks,\n— W.\nwanida.s@example.co.th"],
    ["identity number", `Her ID card is ${thaiId()}.`],
  ];
  const MISSED: readonly [string, string][] = [
    ["paraphrase", "The bookkeeper whose first name means 'young woman' in Sanskrit runs the bakery's accounts."],
    ["translation", "เจ้าของคือคุณวนิดา ศรีสุข"],
  ];

  for (const [form, text] of CAUGHT) {
    test(`caught — ${form}`, () => {
      expect(screen(text, LEXICON).length, form).toBeGreaterThan(0);
    });
  }

  for (const [form, text] of MISSED) {
    test(`NOT caught — ${form} (a text filter matches text, not meaning)`, () => {
      expect(screen(text, LEXICON)).toEqual([]);
      expect(FILTER_LIMITS.join(" ")).toContain("paraphrased, abbreviated, translated");
    });
  }

  test("the tally the backlog quotes: 8 of 10", () => {
    expect(CAUGHT.length).toBe(8);
    expect(MISSED.length).toBe(2);
  });
});
