/** `ohmyagi memory` — build an agent's recall from its `memory/`, and ask it something. */

import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { GIT_UNDELETABLE, SCAN_BLIND_SPOTS } from "../../src/guard/index.ts";
import {
  collectionFor,
  commitForget,
  commitIngest,
  formatForgetPlan,
  planForget,
  formatIngestPlan,
  importName,
  planIngest,
  FTS_FILE,
  indexAgent,
  RAG_UNDELETABLE,
  ragDirFor,
  recall,
  vectorEndpoints,
} from "../../src/memory/index.ts";
import { subjectId, type SubjectId } from "../../src/types.ts";
import { basisDirFor, basisFor, readBasis, refusalLine, soulSubject } from "../../src/consent/basis.ts";
import { commitWrite, planWrite, type WritePlan } from "../../src/memory/write.ts";
import { convertFile, convertUrl, planImport, type Converted } from "../../src/memory/import.ts";
import { dialEnv } from "../dial.ts";
import { bold, dim, parseArgs, usageError } from "../shared.ts";

const INDEX_USAGE = "usage: ohmyagi memory index <agent-dir> --subject <id>";
const INGEST_USAGE = "usage: ohmyagi memory ingest <agent-dir> --from <dir> [--name <name>] [--yes]";
const FORGET_USAGE =
  "usage: ohmyagi memory forget <agent-dir> --subject <id> (--file <memory/…> [--file …] | --match <text>) [--yes]";
const SEARCH_USAGE = "usage: ohmyagi memory search <agent-dir> --subject <id> [--limit <n>] <query...>";
const WRITE_USAGE = "usage: ohmyagi memory write <agent-dir> --subject <id> --file <memory/…md> --from <file> [--yes]";
const WRITE_BOOLEANS: readonly string[] = ["yes"];
const IMPORT_USAGE =
  "usage: ohmyagi memory import <agent-dir> --subject <id> (--from <file> | --url <link>) [--name <file name>] [--as <memory/…md>] [--yes]";

function subjectFrom(raw: string | undefined, usage: string): { ok: true; id: SubjectId } | { ok: false; code: number } {
  if (raw === undefined || raw === "") return { ok: false, code: usageError(usage) };
  try {
    return { ok: true, id: subjectId(raw) };
  } catch (error) {
    return { ok: false, code: usageError(error instanceof Error ? error.message : String(error)) };
  }
}

/** The endpoints, or the reason the vector half will be skipped. Never a failure of the command. */
function endpointsOrReason() {
  const checked = vectorEndpoints(process.env);
  return checked.ok ? checked.endpoints : { reason: checked.reason };
}

/**
 * `ohmyagi memory index` — S4.1.
 *
 * Prints what dropping the collection will not reach *before* anything is
 * embedded, because after is too late to decide not to. The full-text half is
 * always built; the vector half is reported and skipped when a server is
 * missing (AC4). Exit 0 either way — a recall with one half is still a recall.
 */
async function cmdMemoryIndex(argv: readonly string[]): Promise<number> {
  const { positional, options } = parseArgs(argv);
  const dir = positional[0];
  if (dir === undefined || dir === "" || positional.length > 1) return usageError(INDEX_USAGE);
  const subject = subjectFrom(options.get("subject"), INDEX_USAGE);
  if (!subject.ok) return subject.code;
  const agentDir = resolve(dir);

  console.log(bold("Before anything is embedded — what dropping the collection cannot reach:"));
  for (const note of RAG_UNDELETABLE) console.log(dim(`  - ${note}`));
  console.log();

  const report = await indexAgent(agentDir, subject.id, endpointsOrReason(), {
    markerDir: ragDirFor(homedir(), process.env, subject.id),
    now: () => new Date(),
  });

  console.log(bold(`memory — ${agentDir}`));
  console.log(`  ${report.files} file(s) · ${report.chunks} piece(s)`);
  for (const bad of report.unreadable) console.log(dim(`  unreadable: ${bad.path} — ${bad.reason}`));
  console.log(`  full-text  ${report.fts} piece(s) → ${FTS_FILE}`);
  console.log(
    report.vectors.ok
      ? `  vectors    ${report.vectors.points} point(s) → ${collectionFor(subject.id)}`
      : `  vectors    not built — ${report.vectors.reason}`,
  );
  if (!report.vectors.ok) {
    console.log(dim("  recall still works on the full-text half; run this again when the store is up."));
  }
  return 0;
}

/** `ohmyagi memory search` — hybrid recall, with where each hit came from (S4.3 AC3's "not a black box"). */
async function cmdMemorySearch(argv: readonly string[]): Promise<number> {
  const { positional, options } = parseArgs(argv);
  const [dir, ...words] = positional;
  if (dir === undefined || dir === "" || words.length === 0) return usageError(SEARCH_USAGE);
  const subject = subjectFrom(options.get("subject"), SEARCH_USAGE);
  if (!subject.ok) return subject.code;
  const limit = Number(options.get("limit") ?? "5");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return usageError(`${SEARCH_USAGE} — --limit is a whole number from 1 to 50`);
  }

  const result = await recall(resolve(dir), subject.id, words.join(" "), limit, endpointsOrReason());
  if (result.fts === "absent") {
    console.error(dim(`no ${FTS_FILE} — run \`ohmyagi memory index\` first`));
  }
  if (result.vector !== "ok") console.error(dim(`vector half skipped: ${result.vector.failed}`));
  if (result.hits.length === 0) {
    console.log("no hit");
    return 1;
  }
  for (const hit of result.hits) {
    console.log(bold(`${hit.path}${hit.heading === "" ? "" : ` — ${hit.heading}`}`));
    console.log(dim(`  ${hit.via.join("+")} · ${hit.score.toFixed(4)}`));
    const excerpt = hit.text.replace(/\s+/g, " ").slice(0, 240);
    console.log(`  ${excerpt}${hit.text.length > 240 ? "…" : ""}`);
  }
  return 0;
}

/**
 * `ohmyagi memory ingest` — S4.2 (D-040).
 *
 * Shows the plan — every file, every removal, every file the guard stopped —
 * and writes only with `--yes`. Before writing it prints what git keeps and
 * what the scan cannot see, because the step after this one is `git add`, and
 * that step is the owner's.
 */
async function cmdMemoryIngest(argv: readonly string[]): Promise<number> {
  const { positional, options } = parseArgs(argv, ["yes"]);
  const dir = positional[0];
  const from = options.get("from");
  if (dir === undefined || dir === "" || positional.length > 1 || from === undefined || from === "") {
    return usageError(INGEST_USAGE);
  }
  const source = resolve(from);
  const name = options.get("name") ?? importName(basename(source));
  if (name === undefined || importName(name) !== name) {
    return usageError(`${INGEST_USAGE} — --name takes a-z, 0-9 and -, and the source's name gave nothing usable`);
  }

  // S7.3 (D-077): no basis on record for memory, and nothing is read.
  const subject = await soulSubject(dir);
  if (subject === undefined) {
    console.error(`ohmyagi: ${dir} has no soul that names its subject, so there is no basis to check — nothing was read.`);
    return 1;
  }
  const allowed = basisFor(await readBasis(basisDirFor(dialEnv(), subjectId(subject))), "memory", new Date());
  if (!allowed.ok) {
    console.error(`ohmyagi: ${refusalLine(subject, "memory", allowed.reason)}`);
    return 1;
  }
  console.error(dim(`ohmyagi: basis ${allowed.record.id} (${allowed.record.basis}, by ${allowed.record.approvedBy}) allows memory for ${subject}.`));

  let plan;
  try {
    plan = await planIngest(source, resolve(dir), name);
  } catch (error) {
    console.error(`ohmyagi: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  console.log(bold(`ingest — ${source} → ${plan.target}`));
  for (const line of formatIngestPlan(plan)) console.log(line);
  console.log();
  console.log(bold("What the scan cannot see — the files above passed it, and that is all it says:"));
  for (const note of SCAN_BLIND_SPOTS) console.log(dim(`  - ${note}`));

  if (!options.has("yes")) {
    console.log();
    console.log(dim("Nothing was written. --yes copies the files above into the working tree; it does not stage or commit."));
    return plan.blocked.length > 0 ? 1 : 0;
  }

  console.log();
  console.log(bold("Before these files exist: what a commit puts beyond om-agi's reach"));
  for (const note of GIT_UNDELETABLE) console.log(dim(`  - ${note}`));
  const done = await commitIngest(plan);
  console.log();
  console.log(`wrote ${done.written} file(s), removed ${done.removed} under ${plan.target}`);
  console.log(
    dim(
      "Not staged and not committed. Run `ohmyagi memory index` to put them in recall, and " +
        "`git add` them when you have read them — recall sends what it finds to the backend that " +
        "answers a turn (D-039).",
    ),
  );
  return plan.blocked.length > 0 ? 1 : 0;
}

/**
 * `ohmyagi memory forget` — S4.4 (D-041).
 *
 * Whole files under memory/, then the collection dropped whole and both
 * indexes rebuilt, then the needle looked for again. Exit 1 if that last look
 * finds anything, if anything was refused, or if nothing matched.
 */
async function cmdMemoryForget(argv: readonly string[]): Promise<number> {
  const files = argv.flatMap((arg, i) => (arg === "--file" && argv[i + 1] !== undefined ? [argv[i + 1] as string] : []));
  const rest = argv.filter((arg, i) => arg !== "--file" && argv[i - 1] !== "--file");
  const { positional, options } = parseArgs(rest, ["yes"]);
  const dir = positional[0];
  const match = options.get("match");
  if (dir === undefined || dir === "" || positional.length > 1) return usageError(FORGET_USAGE);
  if ((files.length > 0) === (match !== undefined && match !== "")) {
    return usageError(`${FORGET_USAGE} — name files, or a text to match, and not both`);
  }
  const subject = subjectFrom(options.get("subject"), FORGET_USAGE);
  if (!subject.ok) return subject.code;
  const agentDir = resolve(dir);
  const endpoints = endpointsOrReason();

  const plan = await planForget({
    agentDir,
    subject: subject.id,
    target: files.length > 0 ? { kind: "files", files } : { kind: "match", text: match! },
    markerDir: ragDirFor(homedir(), process.env, subject.id),
    endpoints,
  });

  console.log(bold(`forget — ${agentDir}`));
  for (const line of formatForgetPlan(plan)) console.log(line);
  for (const refusal of plan.refusals) console.error(`ohmyagi: ${refusal}`);
  if (plan.refusals.length > 0) return 1;
  if (plan.files.length === 0) {
    console.error("ohmyagi: nothing under memory/ matched, so nothing was forgotten.");
    return 1;
  }

  console.log();
  console.log(bold("What forgetting here cannot reach:"));
  for (const note of GIT_UNDELETABLE) console.log(dim(`  - ${note}`));
  for (const note of RAG_UNDELETABLE) console.log(dim(`  - ${note}`));
  if (!options.has("yes")) {
    console.log();
    console.log(dim("Nothing was removed. --yes removes the files above and rebuilds both indexes."));
    return 0;
  }

  const result = await commitForget(plan, endpoints);
  console.log();
  console.log(`removed ${result.removed.length} file(s) · full-text rebuilt with ${result.fts} piece(s)`);
  console.log(
    result.dropped === null
      ? "vectors: nothing to drop"
      : result.dropped
        ? result.vectors !== null && result.vectors.ok
          ? `vectors: collection dropped whole and rebuilt with ${result.vectors.points} point(s)`
          : `vectors: collection dropped whole, not rebuilt (${result.vectors?.ok === false ? result.vectors.reason : "no endpoints"}) — \`memory index\` brings recall back`
        : "vectors: the collection was NOT dropped",
  );
  const c = result.check;
  console.log(
    `checked again: ${c.filesStillMatching.length} file(s) still matching · ${c.ftsStillMatching} full-text hit(s) · ` +
      `${c.pointsAfter === null ? "no store read" : `${c.pointsAfter} point(s) for ${c.piecesAfter} piece(s)`}`,
  );
  if (!c.passed) {
    for (const path of c.filesStillMatching) console.error(`ohmyagi: still there: ${path}`);
    console.error("ohmyagi: the second look found what was meant to be gone — see the line above.");
    return 1;
  }
  console.log(dim("Not staged and not committed: the removal is in the working tree, and every earlier commit still holds the file."));
  return 0;
}

/**
 * `ohmyagi memory write` — create or replace one memory file (D-081): what the
 * web page's editor saves through. Shows the plan; with --yes writes it and
 * rebuilds both indexes, the vector collection dropped whole (D-035). Needs
 * the S7.3 basis for memory, like ingest. Nothing is staged or committed.
 */
async function cmdMemoryWrite(argv: readonly string[]): Promise<number> {
  const { positional, options } = parseArgs(argv, WRITE_BOOLEANS);
  const dir = positional[0];
  const file = options.get("file");
  const from = options.get("from");
  if (dir === undefined || dir === "" || positional.length > 1 || file === undefined || from === undefined || from === "") return usageError(WRITE_USAGE);
  const subject = subjectFrom(options.get("subject"), WRITE_USAGE);
  if (!subject.ok) return subject.code;
  const allowed = basisFor(await readBasis(basisDirFor(dialEnv(), subject.id)), "memory", new Date());
  if (!allowed.ok) {
    console.error(`ohmyagi: ${refusalLine(subject.id, "memory", allowed.reason)}`);
    return 1;
  }
  let text: string;
  try {
    text = await Bun.file(from).text();
  } catch (error) {
    console.error(`ohmyagi: ${from}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const agentDir = resolve(dir);
  const plan = await planWrite(agentDir, file, text);
  if (plan.refusal !== undefined) {
    console.error(`ohmyagi: not written — ${plan.refusal}`);
    return 1;
  }
  if (plan.kind === "same") {
    console.log(`${plan.path} already says exactly that — nothing to write.`);
    return 0;
  }
  console.log(`${plan.kind === "new" ? "new" : "replace"} ${plan.path} · ${plan.bytesBefore} → ${plan.bytesAfter} bytes · +${plan.linesAdded} / -${plan.linesRemoved} line(s)`);
  if (!options.has("yes")) {
    console.log(dim("Nothing was written. --yes writes it and rebuilds both indexes."));
    return 0;
  }
  await commitWrite(agentDir, plan, text);
  const report = await indexAgent(agentDir, subject.id, endpointsOrReason(), {
    markerDir: ragDirFor(homedir(), process.env, subject.id),
    now: () => new Date(),
  });
  console.log(`written · full-text ${report.fts} piece(s) · ${report.vectors.ok ? `vectors rebuilt whole, ${report.vectors.points} point(s)` : `vectors not rebuilt — ${report.vectors.reason}`}`);
  console.log(dim("Not staged and not committed: git keeps whatever it is given — see what git remembers with `ohmyagi memory forget`'s notes."));
  return 0;
}

/**
 * `ohmyagi memory import` — a document or a web page into memory as markdown
 * (D-084). Shows where it would go and how it was read; with --yes writes
 * every part through the same gates as `memory write`, then rebuilds both
 * indexes once. `--name` is the file's own name when `--from` is a temporary
 * copy (the web page's upload), so the kind and the title come from it.
 */
async function cmdMemoryImport(argv: readonly string[]): Promise<number> {
  const { positional, options } = parseArgs(argv, WRITE_BOOLEANS);
  const dir = positional[0];
  const from = options.get("from");
  const url = options.get("url");
  if (dir === undefined || dir === "" || positional.length > 1 || (from === undefined) === (url === undefined) || from === "" || url === "") return usageError(IMPORT_USAGE);
  const subject = subjectFrom(options.get("subject"), IMPORT_USAGE);
  if (!subject.ok) return subject.code;
  const allowed = basisFor(await readBasis(basisDirFor(dialEnv(), subject.id)), "memory", new Date());
  if (!allowed.ok) {
    console.error(`ohmyagi: ${refusalLine(subject.id, "memory", allowed.reason)}`);
    return 1;
  }
  const agentDir = resolve(dir);
  const now = new Date();
  let converted: Converted;
  let source: string;
  try {
    if (url !== undefined) {
      const got = await convertUrl(url, fetch, tmpdir());
      converted = got;
      source = got.url;
    } else {
      const name = options.get("name") ?? from!;
      converted = await convertFile(from!, name.split(/[\\/]/).pop()!, tmpdir());
      source = name.split(/[\\/]/).pop()!;
    }
  } catch (error) {
    console.error(`ohmyagi: not imported — ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  let parts;
  try {
    parts = await planImport(converted, source, now, (path) => Bun.file(join(agentDir, ...path.split("/"))).exists(), options.get("as"));
  } catch (error) {
    console.error(`ohmyagi: not imported — ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const plans: { plan: WritePlan; text: string }[] = [];
  for (const part of parts) plans.push({ plan: await planWrite(agentDir, part.path, part.text), text: part.text });
  console.log(bold(`${converted.title} — ${source}`));
  console.log(`read ${converted.via} · ${parts.length} memory file(s)`);
  for (const { plan } of plans) console.log(`  ${plan.refusal === undefined ? "new" : "REFUSED"} ${plan.path} · ${plan.bytesAfter} bytes${plan.refusal === undefined ? "" : ` — ${plan.refusal}`}`);
  const refused = plans.filter((p) => p.plan.refusal !== undefined);
  if (refused.length > 0) {
    console.error(`ohmyagi: not imported — ${refused.length} part(s) refused above; nothing was written.`);
    return 1;
  }
  if (!options.has("yes")) {
    console.log(dim("Nothing was written. --yes writes it and rebuilds both indexes."));
    return 0;
  }
  for (const { plan, text } of plans) await commitWrite(agentDir, plan, text);
  const report = await indexAgent(agentDir, subject.id, endpointsOrReason(), {
    markerDir: ragDirFor(homedir(), process.env, subject.id),
    now: () => new Date(),
  });
  console.log(`imported · full-text ${report.fts} piece(s) · ${report.vectors.ok ? `vectors rebuilt whole, ${report.vectors.points} point(s)` : `vectors not rebuilt — ${report.vectors.reason}`}`);
  console.log(dim("Not staged and not committed. The original stays where it was; only the text came in."));
  return 0;
}

export async function cmdMemory(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "index":
      return cmdMemoryIndex(rest);
    case "search":
      return cmdMemorySearch(rest);
    case "ingest":
      return cmdMemoryIngest(rest);
    case "forget":
      return cmdMemoryForget(rest);
    case "write":
      return cmdMemoryWrite(rest);
    case "import":
      return cmdMemoryImport(rest);
    default:
      return usageError(`unknown memory subcommand ${JSON.stringify(sub ?? "")} — try "ingest", "index", "search", "write" or "forget"`);
  }
}
