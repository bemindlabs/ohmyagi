/**
 * `ohmyagi update` — ask GitHub, and swap the binary only after its checksum
 * matches (D-065).
 *
 * The file is written beside the running binary and renamed over it, so a
 * failure part-way leaves the old one working; a download whose sha256 is not
 * the one the release lists is thrown away before it is ever executable.
 */

import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { latestRelease, RELEASES_URL, sumFor, type Release } from "./version.ts";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const headers = (version: string) => ({ "user-agent": `ohmyagi/${version}`, accept: "application/vnd.github+json" });

/** The newest release, or why it could not be asked. Never throws. */
export async function fetchLatest(version: string, fetchImpl: Fetch = fetch, timeoutMs = 5000): Promise<{ readonly ok: true; readonly release: Release | undefined } | { readonly ok: false; readonly reason: string }> {
  try {
    const res = await fetchImpl(RELEASES_URL, { headers: headers(version), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, reason: `GitHub answered ${res.status}` };
    return { ok: true, release: latestRelease(await res.json()) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Download `asset` from `release`, check it against SHA256SUMS, and put it in
 * place of `target`. Returns what happened in words.
 */
export async function installRelease(
  release: Release,
  asset: string,
  target: string,
  version: string,
  fetchImpl: Fetch = fetch,
): Promise<{ readonly ok: true; readonly sha256: string } | { readonly ok: false; readonly reason: string }> {
  const binUrl = release.assets.get(asset);
  const sumsUrl = release.assets.get("SHA256SUMS");
  if (binUrl === undefined) return { ok: false, reason: `${release.tag} has no ${asset}` };
  if (sumsUrl === undefined) return { ok: false, reason: `${release.tag} has no SHA256SUMS, so nothing could be checked — not installed` };
  let bytes: Uint8Array;
  let sums: string;
  try {
    const [b, s] = await Promise.all([fetchImpl(binUrl, { headers: headers(version) }), fetchImpl(sumsUrl, { headers: headers(version) })]);
    if (!b.ok || !s.ok) return { ok: false, reason: `download failed (${b.status}, ${s.status})` };
    bytes = new Uint8Array(await b.arrayBuffer());
    sums = await s.text();
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const expected = sumFor(sums, asset);
  if (expected === undefined) return { ok: false, reason: `SHA256SUMS does not list ${asset} — not installed` };
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  const actual = hasher.digest("hex");
  if (actual !== expected) return { ok: false, reason: `checksum mismatch (${actual.slice(0, 12)}… ≠ ${expected.slice(0, 12)}…) — not installed` };
  const temp = `${target}.update-${process.pid}`;
  try {
    await writeFile(temp, bytes, { mode: 0o755 });
    await chmod(temp, 0o755);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    return { ok: false, reason: `could not replace ${target}: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true, sha256: actual };
}
