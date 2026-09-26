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
  readonly recent: readonly { readonly id: string; readonly when: string; readonly backend: string; readonly asked: string; readonly ok: boolean }[];
  readonly canTriage: boolean;
  /** This build of Oh My AGI, and the newest release the last update check saw (null: never checked). For the footer (D-089). */
  readonly version: { readonly current: string; readonly latest: string | null };
  /** What answers a message sent from this page, and what answered last. */
  readonly engine: {
    /** The chain a turn tries, in order — `--backend` given to `ohmyagi web`, else the default. */
    readonly chain: readonly string[];
    /** The model the local backend uses: `--model`, else OM_AGI_OLLAMA_MODEL, else none. */
    readonly localModel: string | null;
    /** The local judge that reads what may leave (D-061), or null when it is off. */
    readonly judge: string | null;
    readonly last: { readonly backend: string; readonly model: string | null; readonly when: string } | null;
  };
}

/** What the Settings tab receives from `/api/settings`. */
export interface SettingsState {
  /** Per category, 0–3. The page can set 0–2; a 3 is typed in a terminal. */
  readonly levels: Readonly<Record<string, number>>;
  readonly stopped: boolean;
  /** Backends this machine can reach right now, for the chat's choice. */
  readonly backends: readonly { readonly id: string; readonly available: boolean }[];
  /** What `ohmyagi web` was started with: the default the page's choice falls back to. */
  readonly defaultTurn: { readonly backend: string | null; readonly model: string | null };
  readonly chatUsers: readonly { readonly platform: string; readonly userId: string; readonly label: string; readonly told: boolean; readonly added: string }[];
  readonly peers: readonly { readonly name: string; readonly endpoint: string; readonly added: string }[];
  readonly guards: { readonly judge: string | null; readonly triage: boolean; readonly needles: number };
  readonly version: { readonly current: string; readonly latest: string | null; readonly checked: string | null };
}

/** The four categories, in the words the page uses. */
export const CATEGORY_WORDS: Readonly<Record<string, { readonly name: string; readonly what: string }>> = Object.freeze({
  read: { name: "Read", what: "look at files and folders" },
  write: { name: "Write", what: "change or create files" },
  run: { name: "Run", what: "run commands on this computer" },
  reach: { name: "Reach", what: "contact other services and agents" },
});

/** What each level means, per category, in one short phrase. */
export const LEVEL_WORDS: readonly string[] = ["Never", "Ask me first", "Do it, then tell me", "On its own"];

/** What the Agent tab receives from `/api/agent`: who it is, from its soul, and what it has done. */
export interface AgentInfo {
  readonly ok: boolean;
  /** When the soul does not load: why, one line each. */
  readonly problems: readonly string[];
  readonly name: string;
  readonly role: string;
  readonly subject: string;
  readonly dir: string;
  /** The agent's git repository: where it lives, the remote if it has one, and the last commit. */
  readonly repo: { readonly remote: string | null; readonly web: string | null; readonly head: string | null; readonly lastCommit: string | null; readonly lastCommitAt: string | null };
  readonly prohibitions: readonly string[];
  readonly scope: { readonly does: string; readonly doesNot: string };
  readonly person: {
    readonly tone: readonly string[];
    readonly addressesUserAs: string;
    readonly refersToSelfAs: readonly string[];
    readonly principles: readonly string[];
    readonly inheritsFrom: readonly string[];
  } | null;
  readonly roleNotes: string;
  readonly personNotes: string;
  readonly stats: {
    readonly memories: number;
    readonly turns: number;
    readonly lastTurn: string | null;
    readonly byBackend: readonly { readonly backend: string; readonly turns: number }[];
  };
}

/**
 * A remote as something safe to show and, when it is a known forge, to link:
 * credentials in the URL are cut out, and `git@github.com:o/r.git` becomes
 * `https://github.com/o/r`.
 */
export function remoteForPage(raw: string): { readonly remote: string; readonly web: string | null } {
  const remote = raw.trim().replace(/^(https?:\/\/)[^@/]+@/, "$1");
  const scp = /^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?$/.exec(remote);
  if (scp !== null) return { remote, web: `https://${scp[1]}/${scp[2]}` };
  const http = /^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote);
  if (http !== null) return { remote, web: `https://${http[1]}/${http[2]}` };
  return { remote, web: null };
}

/** What the Privacy tab receives from `/api/privacy` (gap 3, D-079). */
export interface PrivacyState {
  /** `observe status` for this subject, up to its first blank line, and whether capture is on. */
  readonly capture: { readonly on: boolean; readonly lines: readonly string[] };
  /** What the filter or the judge kept on this machine, newest first — the rule, never the text. */
  readonly keptIn: readonly { readonly when: string; readonly at: string; readonly backend: string; readonly why: string }[];
  readonly keptInTotal: number;
  readonly needles: number;
  readonly judge: string | null;
  readonly basis: readonly { readonly id: string; readonly basis: string; readonly uses: readonly string[]; readonly approvedBy: string; readonly at: string; readonly expires: string | null; readonly state: string; readonly note: string }[];
}
