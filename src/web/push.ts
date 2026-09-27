/**
 * S14.3, engine side — telling a paired phone "something is waiting for you" (D-130).
 *
 * Off until a phone asks: the app registers itself with the platform's relay, gets a handle, and hands the
 * handle to this page (`POST /api/push/subscribe`, behind the page's key). From then on the page — only while
 * it runs — sends the relay that handle and nothing else when a new proposal is waiting. No kind of event, no
 * agent name, no text: the relay learns *when*, never *what*. Changing the page's key ("Unpair every phone")
 * drops every subscription and asks each relay to forget its handle.
 *
 * Holding a handle is the right to make that phone buzz with a content-free message, so it is kept like the
 * page's key: 0600, in the state root (never in the agent's git), one directory per subject so `erase` takes it
 * whole.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export { PUSH_DIR, pushDirFor } from "./push-dir.ts";
/** 256 random bits, base64url without padding (D-130). */
export const HANDLE = /^[A-Za-z0-9_-]{43}$/;
/** More phones than one person carries is a mistake or an attack; either way, no. */
export const MAX_SUBSCRIPTIONS = 10;
/** How long a relay gets to answer before the page gives up on it for this round. */
export const RELAY_TIMEOUT_MS = 5_000;
/** A burst of proposals is one buzz, not ten: the relay limits too, this spares it the asking. */
export const MIN_GAP_MS = 5 * 60_000;

export interface PushSubscription {
  readonly relay: string;
  readonly handle: string;
  readonly added: string;
}

const file = (dir: string): string => join(dir, "subscriptions.json");

/**
 * Why a relay address is not one to send to, or `undefined`. https only — the handle travels in the body — with
 * a loopback literal allowed over http for a relay run on this machine (tests, a self-hosted relay). No
 * credentials, query or fragment; a path is a base the protocol's paths go under.
 */
export function relayProblem(relay: string): string | undefined {
  let url: URL;
  try {
    url = new URL(relay);
  } catch {
    return "the relay is not a URL";
  }
  if (url.username !== "" || url.password !== "") return "the relay address carries a user name or password";
  if (url.search !== "" || url.hash !== "" || relay.includes("?") || relay.includes("#")) return "the relay address has a query or fragment";
  const loopback = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname) || url.hostname === "[::1]";
  if (url.protocol === "https:") return undefined;
  if (url.protocol === "http:" && loopback) return undefined;
  return "the relay must be https (http only to a loopback address)";
}

/** The relay's base with no trailing slash, so `${base}/v1/…` is one slash. */
const base = (relay: string): string => relay.replace(/\/+$/, "");

export async function readSubscriptions(dir: string): Promise<readonly PushSubscription[]> {
  try {
    const raw = JSON.parse(await readFile(file(dir), "utf8")) as { subscriptions?: unknown };
    if (!Array.isArray(raw.subscriptions)) return [];
    return raw.subscriptions.filter(
      (s): s is PushSubscription =>
        typeof s?.relay === "string" && relayProblem(s.relay) === undefined &&
        typeof s?.handle === "string" && HANDLE.test(s.handle) && typeof s?.added === "string",
    );
  } catch {
    return [];
  }
}

async function write(dir: string, subscriptions: readonly PushSubscription[]): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = file(dir);
  const temp = `${path}.${process.pid}.${crypto.randomUUID().slice(0, 8)}`;
  await writeFile(temp, `${JSON.stringify({ subscriptions }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temp, path);
}

export async function addSubscription(
  dir: string,
  relay: string,
  handle: string,
  now: Date,
): Promise<{ readonly ok: true; readonly count: number } | { readonly ok: false; readonly reason: string }> {
  const problem = relayProblem(relay);
  if (problem !== undefined) return { ok: false, reason: problem };
  if (!HANDLE.test(handle)) return { ok: false, reason: "that is not a relay handle (43 base64url characters)" };
  const current = await readSubscriptions(dir);
  const others = current.filter((s) => s.handle !== handle);
  if (others.length >= MAX_SUBSCRIPTIONS) return { ok: false, reason: `${MAX_SUBSCRIPTIONS} phones already get notifications — unpair one first` };
  const next = [...others, { relay: base(relay), handle, added: now.toISOString() }];
  await write(dir, next);
  return { ok: true, count: next.length };
}

/** The subscription with this handle, gone; `undefined` when there was none. */
export async function removeSubscription(dir: string, handle: string): Promise<PushSubscription | undefined> {
  const current = await readSubscriptions(dir);
  const gone = current.find((s) => s.handle === handle);
  if (gone === undefined) return undefined;
  await write(dir, current.filter((s) => s.handle !== handle));
  return gone;
}

/** Every subscription, gone — what changing the page's key does (S14.2 AC3). */
export async function clearSubscriptions(dir: string): Promise<readonly PushSubscription[]> {
  const current = await readSubscriptions(dir);
  if (current.length > 0) await write(dir, []);
  return current;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

async function call(fetcher: Fetcher, url: string, init: RequestInit): Promise<boolean> {
  try {
    const response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(RELAY_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

/** One content-free notice per subscription: the handle and nothing else (D-130). */
export async function notifyAll(subscriptions: readonly PushSubscription[], fetcher: Fetcher): Promise<{ readonly sent: number; readonly failed: number }> {
  const results = await Promise.all(
    subscriptions.map((s) =>
      call(fetcher, `${base(s.relay)}/v1/notify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle: s.handle }) }),
    ),
  );
  const sent = results.filter(Boolean).length;
  return { sent, failed: results.length - sent };
}

/** Ask each relay to forget a handle. Best effort: the handle is dropped here whatever the relay says. */
export async function forgetAll(subscriptions: readonly PushSubscription[], fetcher: Fetcher): Promise<void> {
  await Promise.all(subscriptions.map((s) => call(fetcher, `${base(s.relay)}/v1/devices/${s.handle}`, { method: "DELETE" })));
}

/**
 * Decides when a notice goes out: a proposal is waiting that was not at an earlier look, and the last notice
 * was long enough ago. One that arrives inside the gap is owed, and goes out when the gap is over — unless
 * nothing is waiting by then. The first look only learns what is already there: starting the page does not
 * buzz anybody's phone.
 */
export class WaitingWatch {
  private seen: ReadonlySet<string> | undefined;
  private lastSent = -Infinity;
  private owed = false;

  constructor(private readonly minGapMs: number = MIN_GAP_MS) {}

  /** True when a notice should go out now. Call `sent` once one did. */
  due(waitingIds: readonly string[], nowMs: number): boolean {
    const before = this.seen;
    this.seen = new Set(waitingIds);
    if (before === undefined) return false;
    if (waitingIds.some((id) => !before.has(id))) this.owed = true;
    if (waitingIds.length === 0) this.owed = false;
    return this.owed && nowMs - this.lastSent >= this.minGapMs;
  }

  sent(nowMs: number): void {
    this.lastSent = nowMs;
    this.owed = false;
  }
}
