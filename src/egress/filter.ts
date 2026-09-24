/**
 * The egress filter — what may not leave this machine (S8.3, D-048, I-6).
 *
 * Pure: text in, findings out. What counts as personal is handed in as a
 * {@link Lexicon}; the patterns below are the kinds of personal data that have
 * a shape. A finding never carries the matched text — the caller has the
 * text, and a finding that repeated it would be one more copy of the thing
 * being kept in.
 *
 * What this cannot see is said in {@link FILTER_LIMITS}, and it is most of
 * the problem: personal information written as prose, paraphrased, translated
 * or summarised has no pattern and no needle.
 */

import { scanStaged } from "../guard/scan.ts";

/** What the owner has said is personal, plus names the soul says it inherits from. */
export interface Lexicon {
  readonly needles: readonly string[];
}

/** One reason a message may not leave. */
export interface EgressFinding {
  readonly rule: string;
  /** For `needle`: its 1-based position in the lexicon. Never the needle's text. */
  readonly needle?: number;
}

/** Lower-case, NFC, whitespace collapsed — the form needles are matched in. */
function fold(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, " ");
}

/** Thai national ID: 13 digits whose last is the checksum of the first twelve. */
function thaiIdValid(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

/** Luhn, for payment card numbers. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const PATTERNS: readonly { readonly rule: string; readonly find: (text: string) => boolean }[] = [
  { rule: "email", find: (t) => /[\w.+-]+@[\w-]+\.[\w.-]+/.test(t) },
  {
    rule: "thai-phone",
    find: (t) => /(?<!\d)(?:\+66[\s-]?|0)(?:[689]\d)[\s-]?\d{3}[\s-]?\d{4}(?!\d)/.test(t),
  },
  {
    rule: "thai-national-id",
    find: (t) => [...t.matchAll(/(?<!\d)(\d[\s-]?){12}\d(?!\d)/g)].some((m) => thaiIdValid(m[0].replace(/[\s-]/g, ""))),
  },
  {
    rule: "payment-card",
    find: (t) =>
      [...t.matchAll(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g)].some((m) => {
        const d = m[0].replace(/[ -]/g, "");
        return d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && luhn(d);
      }),
  },
];

/** Everything that stops this text from leaving. Empty means it may go. */
export function screen(text: string, lexicon: Lexicon): readonly EgressFinding[] {
  const findings: EgressFinding[] = [];
  const folded = fold(text);
  lexicon.needles.forEach((needle, index) => {
    const wanted = fold(needle).trim();
    if (wanted.length >= 2 && folded.includes(wanted)) findings.push({ rule: "needle", needle: index + 1 });
  });
  for (const pattern of PATTERNS) if (pattern.find(text)) findings.push({ rule: pattern.rule });
  // Credentials: the repo guard's own content rules, over the text as a file.
  const secrets = new Set(
    scanStaged([{ path: "outbound.txt", bytes: new TextEncoder().encode(text) }]).map((f) => f.rule),
  );
  for (const rule of secrets) findings.push({ rule: `secret:${rule}` });
  return findings;
}

/** A line a person can act on, naming no personal text. */
export function describeFindings(findings: readonly EgressFinding[]): string {
  return findings
    .map((f) =>
      f.rule === "needle"
        ? `personal needle #${f.needle}`
        : f.rule === "judge:reveals"
          ? "the local judge read it as revealing a protected item"
          : f.rule === "judge:unsure"
            ? "the local judge could not decide, so it stays in"
            : f.rule,
    )
    .join(", ");
}

/** What the filter cannot see. Printed by `egress check`. */
export const FILTER_LIMITS: readonly string[] = [
  "personal information written as prose — a name nobody listed, an illness, a relationship — has no shape and is not caught unless it is a needle",
  "a needle paraphrased, abbreviated, translated or misspelled; the filter matches text, not meaning — unless the local judge is on (OM_AGI_EGRESS_JUDGE, D-061), which reads meaning and can still be wrong",
  "a number split across lines or written in words",
  "anything a local backend receives: I-6 lets personal data reach this machine's own model, so local turns are not screened",
];
