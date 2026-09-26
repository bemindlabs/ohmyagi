/**
 * `ohmyagi web` — the agent's memory, to read (D-068), and as a map (D-082).
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

/** One memory as a neuron: its place in the list, what it is, how big. */
export interface MemoryNode {
  readonly path: string;
  readonly title: string;
  readonly type: string;
  readonly bytes: number;
}

/**
 * The memories as a graph for the page's map (D-082): a neuron per file, a
 * synapse per link between two of them — `[[name]]` (by file name or
 * front-matter name) or a markdown link to another `.md` under memory/. A link
 * both ways is one synapse, `weight` counting the links in it. `dangling`
 * counts the links that name no memory here, so a broken one is visible.
 */
export interface MemoryGraph {
  readonly nodes: readonly MemoryNode[];
  /** `[from, to, weight]`, indexes into `nodes`, `from < to`. */
  readonly edges: readonly (readonly [number, number, number])[];
  readonly dangling: number;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\.md$/, "");

/** The links a memory's text makes: wiki names and relative `.md` targets, as written. */
export function memoryLinks(text: string): { readonly names: readonly string[]; readonly files: readonly string[] } {
  const names = [...text.matchAll(/\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g)].map((m) => m[1]!.trim()).filter((n) => n !== "");
  const files = [...text.matchAll(/\]\(\s*([^)\s#]+\.md)(?:#[^)\s]*)?\s*\)/g)].map((m) => m[1]!).filter((f) => !/^[a-z]+:/i.test(f));
  return { names, files };
}

/** Resolve a markdown link written in `from` against the agent directory, `/`-separated. */
function resolveFile(from: string, target: string): string {
  const parts = target.startsWith("memory/") ? [] : from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export async function memoryGraph(agentDir: string): Promise<MemoryGraph> {
  const entries = await listMemories(agentDir);
  const byName = new Map<string, number>();
  const byPath = new Map<string, number>();
  entries.forEach((m, i) => {
    byPath.set(m.path, i);
    byName.set(key(m.title), i);
  });
  // A file name wins over another file's front-matter name that happens to match it.
  entries.forEach((m, i) => byName.set(key(m.path.split("/").pop()!), i));
  const weights = new Map<string, number>();
  let dangling = 0;
  for (const [i, m] of entries.entries()) {
    const read = await readMemoryFile(agentDir, m.path);
    if (!read.ok) continue;
    const { names, files } = memoryLinks(read.text);
    const targets = [...names.map((n) => byName.get(key(n))), ...files.map((f) => byPath.get(resolveFile(m.path, f)))];
    for (const j of targets) {
      if (j === undefined) dangling += 1;
      else if (j !== i) {
        const id = i < j ? `${i}:${j}` : `${j}:${i}`;
        weights.set(id, (weights.get(id) ?? 0) + 1);
      }
    }
  }
  const edges = [...weights].map(([id, w]) => {
    const [a, b] = id.split(":").map(Number) as [number, number];
    return [a, b, w] as const;
  });
  return { nodes: entries.map((m) => ({ path: m.path, title: m.title, type: m.type, bytes: m.bytes })), edges, dangling };
}
