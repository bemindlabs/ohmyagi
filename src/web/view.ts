/**
 * `ohmyagi web` — what the page shows, in words a person uses (D-060).
 *
 * Every function here is pure: it takes what the commands already know (the
 * dial, the proposals and their triage, the triggers, the ledger) and turns it
 * into short plain sentences. The page does no reasoning of its own; if a
 * sentence here is wrong, the page is wrong, and a test says so.
 */

import type { Level } from "../decide/autonomy.ts";
import type { Triage } from "../decide/triage.ts";

/** One line for "what may it do on its own", from the level a turn acts at. */
export function levelSentence(act: Level, stopped: boolean): { readonly title: string; readonly detail: string; readonly tone: "stop" | "ask" | "act" } {
  if (stopped) {
    return {
      title: "Stopped",
      detail: "The brake is on, so nothing runs. To release it, type `ohmyagi autonomy resume` in a terminal.",
      tone: "stop",
    };
  }
  switch (act) {
    case 0:
      return { title: "Paused", detail: "It does not run at all until you raise a level.", tone: "stop" };
    case 1:
      return { title: "Asks you first", detail: "It can read and suggest. Anything it wants to do comes to you as a proposal.", tone: "ask" };
    case 2:
      return { title: "Acts, then tells you", detail: "It can change files and run commands, and reports every change afterwards.", tone: "act" };
    case 3:
      return { title: "Acts on its own", detail: "It can change files and run commands without stopping to report.", tone: "act" };
  }
}

/** Plain words for Jev's risk kinds. */
export const RISK_WORDS: Readonly<Record<string, string>> = Object.freeze({
  "read-only": "Only looks",
  "local-change": "Changes this computer",
  external: "Reaches outside",
  destructive: "Deletes or can't be undone",
});

export interface Chip {
  readonly text: string;
  readonly tone: "calm" | "care" | "warn";
}

/** A triage as two or three chips a person reads at a glance. */
export function triageChips(triage: Triage): readonly Chip[] {
  const chips: Chip[] = [];
  const kind = triage.risk.choice;
  chips.push({
    text: `${RISK_WORDS[kind] ?? kind}${triage.risk.confidence < 0.7 ? " (unsure)" : ""}`,
    tone: kind === "destructive" ? "warn" : kind === "read-only" ? "calm" : "care",
  });
  chips.push(triage.reversible >= 0.5 ? { text: "Can be undone", tone: "calm" } : { text: "Hard to undo", tone: "warn" });
  if (triage.personal >= 0.5) chips.push({ text: "Touches private info", tone: "warn" });
  return chips;
}

/** "3 minutes ago", "yesterday", or the date — never a raw ISO string on the page. */
export function ago(at: string, now: Date): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return at;
  const s = Math.round((now.getTime() - then) / 1000);
  if (s < 0) {
    const m = Math.round(-s / 60);
    if (m < 60) return `in ${m} min`;
    const h = Math.round(m / 60);
    return h < 48 ? `in ${h} h` : `in ${Math.round(h / 24)} days`;
  }
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : at.slice(0, 10);
}

/** The first line of a text, cut to a length a list row can hold. */
export function excerpt(text: string | null, max = 90): string {
  if (text === null) return "(not kept)";
  const first = text.trim().split("\n")[0] ?? "";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** What the page receives from `/api/state`. Built by the command, shaped here. */
export interface ViewState {
  readonly agent: { readonly name: string; readonly role: string; readonly subject: string; readonly dir: string };
  readonly autonomy: { readonly title: string; readonly detail: string; readonly tone: string; readonly levels: Readonly<Record<string, number>> };
  readonly stopped: boolean;
  readonly waiting: readonly {
    readonly id: string;
    readonly what: string;
    readonly why: string;
    readonly impact: string;
    readonly filed: string;
    readonly byAgent: boolean;
    readonly chips: readonly Chip[];
  }[];
  readonly approved: readonly { readonly id: string; readonly what: string; readonly decided: string }[];
  readonly triggers: readonly { readonly id: string; readonly every: string; readonly next: string }[];
  readonly recent: readonly { readonly when: string; readonly backend: string; readonly asked: string; readonly ok: boolean }[];
  readonly canTriage: boolean;
}
