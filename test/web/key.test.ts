/** D-069 — a page key that survives a restart, and only the owner can read. */

import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateKey } from "../../src/web/key.ts";

const scratch: string[] = [];
afterEach(async () => {
  for (const d of scratch.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("web key file", () => {
  test("made once at 600, then the same key every time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "om-agi-web-key-"));
    scratch.push(dir);
    const path = join(dir, "web.key");
    const first = await loadOrCreateKey(path);
    expect(first.ok && first.created).toBe(true);
    expect(((await stat(path)).mode & 0o777).toString(8)).toBe("600");
    const again = await loadOrCreateKey(path);
    expect(again).toEqual({ ok: true, key: first.ok ? first.key : "", created: false });
    expect((await readFile(path, "utf8")).trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("refused when others can read it, when it is not a key, or when it cannot be made", async () => {
    const dir = await mkdtemp(join(tmpdir(), "om-agi-web-key-"));
    scratch.push(dir);
    const open = join(dir, "open.key");
    await writeFile(open, `${"a".repeat(32)}\n`);
    await chmod(open, 0o644);
    expect(await loadOrCreateKey(open)).toMatchObject({ ok: false });
    const junk = join(dir, "junk.key");
    await writeFile(junk, "not a key", { mode: 0o600 });
    expect(await loadOrCreateKey(junk)).toMatchObject({ ok: false });
    expect(await loadOrCreateKey(join(dir, "missing", "web.key"))).toMatchObject({ ok: false });
  });
});
