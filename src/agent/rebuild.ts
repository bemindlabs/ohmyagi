/**
 * Deleting `.dagi/` and getting it back — the command I-2 is measured by.
 *
 * `rm -rf .dagi` has to be a safe thing to type, at any moment, for any reason.
 * That is the whole of what "data outlives the program" means in practice: git
 * holds the truth, and everything else is a cache somebody can throw away
 * without asking permission. Three choices below exist to keep that true.
 *
 * - **The build is staged, then swapped.** Artefacts are written into a
 *   temporary sibling directory and only then moved into place, so an
 *   interrupted rebuild leaves the previous `.dagi/` intact rather than a half
 *   one. A directory that is *absent* is a state this code handles; a directory
 *   that is *partly right* is the state it refuses to create.
 * - **Anything no derivation owns is swept out, and named.** A file under
 *   `.dagi/` that nothing knows how to rebuild is a file in the wrong layer
 *   (D-014) — and if it were quietly preserved across rebuilds, I-2 would be
 *   false in exactly the way nobody would notice. {@link rebuildDagi} reports
 *   every such path rather than deleting it in silence.
 * - **The subject is an argument, and the files have to agree with it.** The
 *   soul is loaded for the subject the caller named, so a rebuild of somebody
 *   else's agent directory fails on the subject check rather than producing a
 *   rendered identity under the wrong name (I-3).
 *
 * {@link dagiStatus} is the read-only half — the question `doctor` (S0.2) asks
 * and answers, kept here so both commands agree on what "stale" means. It never
 * re-derives anything: it compares hashes the manifest recorded against the
 * files on disk now, which is cheap enough to run on every invocation.
 *
 * Nothing in this file calls a model or a vendor CLI, and nothing it imports
 * can reach one. A test asserts that by walking the import graph, because "it
 * does not today" is not a property, and taking CLIs off `PATH` would not prove
 * it on a machine that has one installed in a system directory.
 */

import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildFtsFile, FTS_IN_DAGI } from "../memory/fts.ts";
import { readMemory } from "../memory/sources.ts";
import { sha256 } from "../soul/block.ts";
import { loadSoul } from "../soul/load.ts";
import type { SoulIssue } from "../soul/schema.ts";
import type { SubjectId } from "../types.ts";
import { GENERATOR } from "../version.ts";
import { DERIVATIONS } from "./derive.ts";
import {
  dagiPath,
  MANIFEST_FILE,
  MANIFEST_SCHEMA,
  parseManifest,
  serializeManifest,
  type DagiManifest,
  type ManifestArtefact,
  type ManifestSource,
} from "./manifest.ts";
import { DAGI_DIR, SOUL_DIR } from "./template.ts";

/** Derived identity text is not world-readable, same as everything om-agi writes. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** Everything a rebuild is allowed to know that is not in the repository. */
export interface RebuildEnv {
  readonly subject: SubjectId;
  /** Injected so a test can hand out two distinct build times on purpose. */
  readonly now: () => Date;
  /** Overridden only by a test that wants a generator mismatch. */
  readonly generator?: string;
}

/** What a rebuild did, or every reason it did nothing. */
export type RebuildOutcome =
  | {
      readonly ok: true;
      readonly manifest: DagiManifest;
      /** Repo-relative paths written, artefacts first and the manifest last. */
      readonly built: readonly string[];
      /** Repo-relative paths that were under `.dagi/` and no derivation owns. */
      readonly removed: readonly string[];
    }
  | { readonly ok: false; readonly issues: readonly SoulIssue[] };

/**
 * Rebuild `<repo>/.dagi/` from what git holds.
 *
 * @param repo Root of the agent repository.
 */
export async function rebuildDagi(repo: string, env: RebuildEnv): Promise<RebuildOutcome> {
  const loaded = await loadSoul(join(repo, SOUL_DIR), env.subject);
  if (!loaded.ok) {
    // `loadSoul` names files as `role.md`; from the repository root they are
    // `soul/role.md`, and the person reading this is standing at the root.
    return {
      ok: false,
      issues: loaded.issues.map((issue) => ({ ...issue, file: `${SOUL_DIR}/${issue.file}` })),
    };
  }

  const dagi = join(repo, DAGI_DIR);
  const before = await listFiles(dagi);
  const staging = `${dagi}.rebuilding-${process.pid}`;
  await rm(staging, { recursive: true, force: true });

  try {
    await mkdir(staging, { recursive: true, mode: DIR_MODE });

    const artefacts: ManifestArtefact[] = [];
    for (const derivation of DERIVATIONS) {
      const sources: ManifestSource[] = [];
      for (const path of derivation.sources) {
        const text = await readOrUndefined(join(repo, path));
        if (text === undefined) {
          return {
            ok: false,
            issues: [
              {
                file: path,
                line: 0,
                path: "",
                message: `not found — ${derivation.id} is derived from it, so ${DAGI_DIR}/ cannot be rebuilt`,
              },
            ],
          };
        }
        sources.push({ path, sha256: sha256(text) });
      }

      const content = derivation.render(loaded.soul);
      await writeInto(staging, derivation.output, content);
      artefacts.push({
        derivation: derivation.id,
        path: dagiPath(derivation.output),
        sha256: sha256(content),
        sources,
      });
    }

    // The full-text index (D-037, D-038) is derived from memory/ in git, so it
    // is rebuilt here like any other artefact rather than carried across the
    // swap. It is not in the manifest: SQLite does not promise the same bytes
    // for the same rows, so a hash of it would call a fresh index stale.
    await buildFtsFile(join(staging, FTS_IN_DAGI), (await readMemory(repo)).chunks);

    const manifest: DagiManifest = {
      schema: MANIFEST_SCHEMA,
      subject: env.subject,
      generator: env.generator ?? GENERATOR,
      built_at: env.now().toISOString(),
      artefacts,
    };
    await writeInto(staging, MANIFEST_FILE, serializeManifest(manifest));

    const owned = ownedPaths();
    const removed = before.filter((path) => !owned.has(path)).map(dagiPath);

    // Swap rather than delete-then-write: at no point is there a `.dagi/` that
    // exists and is incomplete.
    const displaced = `${dagi}.replaced-${process.pid}`;
    await rm(displaced, { recursive: true, force: true });
    const existed = await isDirectory(dagi);
    if (existed) await rename(dagi, displaced);
    await rename(staging, dagi);
    if (existed) await rm(displaced, { recursive: true, force: true });

    return {
      ok: true,
      manifest,
      built: [
        ...DERIVATIONS.map((d) => dagiPath(d.output)),
        dagiPath(FTS_IN_DAGI),
        dagiPath(MANIFEST_FILE),
      ],
      removed,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Whether `.dagi/` reflects what git currently holds. */
export type DagiState =
  /** Never built, or the manifest is gone. Not an error — a fresh clone. */
  | "missing"
  /** Built, but from something other than what is in the repository now. */
  | "stale"
  /** Every source and every artefact hashes to what the manifest recorded. */
  | "fresh";

/** The answer, the reason for it, and anything found that nothing owns. */
export interface DagiStatus {
  readonly state: DagiState;
  /** One sentence, addressed to whoever ran `doctor`. */
  readonly reason: string;
  /** Repo-relative paths under `.dagi/` that no derivation would produce. */
  readonly unowned: readonly string[];
}

/**
 * Ask whether `<repo>/.dagi/` is current, without building anything (AC6).
 *
 * @param generator The engine a fresh build would record. A manifest written by
 *   a different engine is stale by definition: two versions of a renderer are
 *   not promised to produce the same bytes, so "identical after a rebuild" only
 *   holds within one of them.
 */
export async function dagiStatus(
  repo: string,
  subject: SubjectId,
  generator: string = GENERATOR,
): Promise<DagiStatus> {
  const dagi = join(repo, DAGI_DIR);
  const present = await listFiles(dagi);
  const owned = ownedPaths();
  const unowned = present.filter((path) => !owned.has(path)).map(dagiPath);

  const text = await readOrUndefined(join(dagi, MANIFEST_FILE));
  if (text === undefined) {
    return {
      state: "missing",
      reason: `there is no ${dagiPath(MANIFEST_FILE)} — nothing has been built here yet`,
      unowned,
    };
  }

  const manifest = parseManifest(text);
  if (manifest === undefined) {
    return {
      state: "stale",
      reason: `${dagiPath(MANIFEST_FILE)} cannot be read as an om-agi manifest`,
      unowned,
    };
  }
  if (manifest.schema !== MANIFEST_SCHEMA) {
    return {
      state: "stale",
      reason: `built against schema ${JSON.stringify(manifest.schema)}, this engine writes ${JSON.stringify(MANIFEST_SCHEMA)}`,
      unowned,
    };
  }
  if (manifest.subject !== subject) {
    return {
      state: "stale",
      reason: `built for subject ${JSON.stringify(manifest.subject)}, asked about ${JSON.stringify(subject)}`,
      unowned,
    };
  }
  if (manifest.generator !== generator) {
    return {
      state: "stale",
      reason: `built by ${manifest.generator}, this is ${generator} — a rebuild is only identical within one engine version`,
      unowned,
    };
  }

  const recorded = manifest.artefacts.map((artefact) => artefact.derivation).sort();
  const expected = DERIVATIONS.map((derivation) => derivation.id).sort();
  if (recorded.join(",") !== expected.join(",")) {
    return {
      state: "stale",
      reason: `built ${recorded.length === 0 ? "nothing" : recorded.join(", ")}; this engine builds ${expected.join(", ")}`,
      unowned,
    };
  }

  for (const artefact of manifest.artefacts) {
    for (const source of artefact.sources) {
      const current = await readOrUndefined(join(repo, source.path));
      if (current === undefined) {
        return { state: "stale", reason: `${source.path} is gone, and ${artefact.path} was built from it`, unowned };
      }
      if (sha256(current) !== source.sha256) {
        return { state: "stale", reason: `${source.path} changed since ${artefact.path} was built`, unowned };
      }
    }
    const built = await readOrUndefined(join(repo, artefact.path));
    if (built === undefined) {
      return { state: "stale", reason: `${artefact.path} is missing`, unowned };
    }
    if (sha256(built) !== artefact.sha256) {
      return { state: "stale", reason: `${artefact.path} was edited after it was built`, unowned };
    }
  }

  if (unowned.length > 0) {
    return {
      state: "stale",
      reason: `${unowned.length} file(s) under ${DAGI_DIR}/ that no derivation produces — nothing can rebuild them`,
      unowned,
    };
  }

  return {
    state: "fresh",
    reason: `${manifest.artefacts.length} artefact(s) match what the repository holds · built ${manifest.built_at}`,
    unowned,
  };
}

/** Paths, relative to `.dagi/`, that a rebuild produces. Everything else is debris. */
function ownedPaths(): ReadonlySet<string> {
  return new Set([
    MANIFEST_FILE,
    FTS_IN_DAGI,
    ...DERIVATIONS.map((derivation) => derivation.output),
  ]);
}

/** Every file under `dir`, relative and POSIX, sorted. Empty when there is no `dir`. */
async function listFiles(dir: string): Promise<readonly string[]> {
  const found: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(current, entry.name), relative);
      else found.push(relative);
    }
  };
  await walk(dir, "");
  return found.sort();
}

async function writeInto(root: string, relative: string, content: string): Promise<void> {
  const path = join(root, relative);
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
  await writeFile(path, content, { mode: FILE_MODE });
}

async function readOrUndefined(path: string): Promise<string | undefined> {
  const handle = Bun.file(path);
  if (!(await handle.exists())) return undefined;
  return handle.text();
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
