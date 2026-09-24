/**
 * `ohmyagi web --key-file` — a link key that survives a restart (D-069).
 *
 * By default the key is new every start, so an old link stops working the
 * moment the page does. A page run as a service restarts on its own, and a
 * key that changes each time is a link nobody can keep. With a key file the
 * key is read from it — created once, 600, if it is not there — and it is
 * refused if anyone but the owner could read it.
 */

import { readFile, stat, writeFile } from "node:fs/promises";

const KEY = /^[0-9a-f]{32,64}$/;

export async function loadOrCreateKey(path: string): Promise<{ readonly ok: true; readonly key: string; readonly created: boolean } | { readonly ok: false; readonly reason: string }> {
  try {
    const info = await stat(path);
    if ((info.mode & 0o077) !== 0) return { ok: false, reason: `${path} can be read by others (mode ${(info.mode & 0o777).toString(8)}) — chmod 600 it first` };
    const key = (await readFile(path, "utf8")).trim();
    if (!KEY.test(key)) return { ok: false, reason: `${path} does not hold a page key (32–64 lower-case hex)` };
    return { ok: true, key, created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const key = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  try {
    // wx: never over a file that appeared in between.
    await writeFile(path, `${key}\n`, { mode: 0o600, flag: "wx" });
    return { ok: true, key, created: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
