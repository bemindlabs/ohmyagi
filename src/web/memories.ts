/**
 * `ohmyagi web` — the agent's memory, to read (D-068).
 *
 * The files are `memory/**\/*.md` in the agent's own repository: what recall
 * is built from (D-037), and what a person should be able to look at without
 * opening a terminal. Read-only here. Forgetting stays `ohmyagi memory
 * forget`, which says what it will touch before it touches it.
 *
 * Only regular files under `memory/` are listed or read — never a symlink,
 * never a path with `..` in it — the same rule `readMemory` keeps, so the page
 * cannot be used to read a file that is not the agent's memory.
 */

import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { MEMORY_DIR } from "../memory/sources.ts";

export interface MemoryEntry {
  /** Relative to the agent directory, `/`-separated: `memory/imported/owner/x.md`. */
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** `metadata.type` from the front matter — user, feedback, project, reference — or "". */
  readonly type: string;
  readonly bytes: number;
  readonly modified: string;
}

/** A path the page may ask for: under memory/, a .md file, no way out. */
const SAFE = /^memory\/(?:[^/\0]+\/)*[^/\0]+\.md$/;

/** Title, description and type from a memory file's front matter, else its first heading, else its name. */
export function memoryMeta(path: string, text: string): { readonly title: string; readonly description: string; readonly type: string } {
  let title = "";
  let description = "";
  let type = "";
  let body = text;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (fm !== null) {
    body = text.slice(fm[0].length);
    const field = (name: string) => {
      const m = new RegExp(`^\\s*${name}:\\s*(.*)$`, "m").exec(fm[1]!);
      return m === null ? "" : m[1]!.trim().replace(/^["']|["']$/g, "");
    };
    title = field("name");
    description = field("description");
    type = field("type");
  }
  if (title === "") title = /^#{1,6}\s+(.+)$/m.exec(body)?.[1]?.trim() ?? "";
  if (title === "") title = path.split("/").pop()!.replace(/\.md$/, "");
  if (description === "") {
    const para = body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p !== "" && !p.startsWith("#"));
    description = (para ?? "").replace(/\s+/g, " ").slice(0, 200);
  }
  return { title, description, type };
}

/** Every memory file, in path order. A missing `memory/` is none. */
export async function listMemories(agentDir: string): Promise<readonly MemoryEntry[]> {
  const root = join(agentDir, MEMORY_DIR);
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(path);
    }
  };
  await walk(root);
  found.sort();
  const out: MemoryEntry[] = [];
  for (const absolute of found) {
    try {
      const [text, info] = await Promise.all([readFile(absolute, "utf8"), lstat(absolute)]);
      const path = relative(agentDir, absolute).split(sep).join("/");
      out.push({ path, ...memoryMeta(path, text), bytes: info.size, modified: info.mtime.toISOString() });
    } catch {
      // Unreadable: not listed. `ohmyagi memory index` names it.
    }
  }
  return out;
}

/** One memory file's text, or why not. */
export async function readMemoryFile(agentDir: string, path: string): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string }> {
  if (!SAFE.test(path) || path.split("/").some((part) => part === ".." || part === ".")) return { ok: false, reason: "not a memory file" };
  const absolute = join(agentDir, ...path.split("/"));
  try {
    const info = await lstat(absolute);
    if (!info.isFile()) return { ok: false, reason: "not a memory file" };
    // A directory on the way could still be a link out of memory/.
    const [real, root] = await Promise.all([realpath(absolute), realpath(join(agentDir, MEMORY_DIR))]);
    if (!real.startsWith(root + sep)) return { ok: false, reason: "not a memory file" };
    return { ok: true, text: await readFile(absolute, "utf8") };
  } catch {
    return { ok: false, reason: "no such memory" };
  }
}
