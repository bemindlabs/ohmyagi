/**
 * `ohmyagi memory index` and `memory search`, spawned the way a person runs
 * them — S4.1 (D-037, D-038).
 *
 * Two stand-in servers on loopback play Ollama and Qdrant, so the whole path
 * runs without this machine's own: the embed model answers with a vector that
 * is a function of the text, and the store keeps collections in a map and
 * records every request. That record is what S1.6 AC4 is checked against — a
 * recall for B makes no request that names A's collection.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BUN } from "../support/bare-path.ts";

const ROOT = join(import.meta.dir, "..", "..");
const BIN = join(ROOT, "bin", "om-agi.ts");
const DEAD = "http://127.0.0.1:9";

const scratch: string[] = [];
const servers: { stop: (force: boolean) => void }[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function sandbox(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "om-agi-memory-"));
  scratch.push(dir);
  return dir;
}

async function run(home: string, args: readonly string[], env: Record<string, string>) {
  const child = Bun.spawn([BUN, "run", BIN, ...args], {
    cwd: home,
    env: {
      HOME: home,
      PATH: `${dirname(BUN)}:${process.env["PATH"] ?? ""}`,
      XDG_STATE_HOME: join(home, "state"),
      XDG_DATA_HOME: join(home, "data"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  await child.exited;
  return { code: child.exitCode ?? -1, stdout, stderr };
}

/** An agent repository with only what `memory` reads. */
async function agentWith(home: string, files: Record<string, string>): Promise<string> {
  const agent = join(home, "agent");
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(agent, rel)), { recursive: true });
    await Bun.write(join(agent, rel), text);
  }
  return agent;
}

/** A 1024-vector that depends on which of a few words the text contains. */
function vectorFor(text: string): number[] {
  const v = new Array<number>(1024).fill(0.001);
  ["port", "deploy", "ทอง", "สวัสดี"].forEach((word, i) => {
    if (text.includes(word)) v[i] = 1;
  });
  return v;
}

function standIns() {
  const collections = new Map<string, Map<string, { vector: number[]; payload: unknown }>>();
  const asked: string[] = [];
  const embed = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { model: string; input: string[] };
      asked.push(`embed ${body.model} ${body.input.length}`);
      return Response.json({ model: body.model, embeddings: body.input.map(vectorFor) });
    },
  });
  const qdrant = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      asked.push(`${req.method} ${url.pathname}`);
      const [, , name, rest] = url.pathname.split("/");
      const col = collections.get(name ?? "");
      if (rest === undefined) {
        if (req.method === "GET") {
          return col === undefined
            ? new Response("{}", { status: 404 })
            : Response.json({ result: { points_count: col.size } });
        }
        if (req.method === "DELETE") {
          collections.delete(name ?? "");
          return Response.json({ result: true });
        }
        if (req.method === "PUT") {
          collections.set(name ?? "", new Map());
          return Response.json({ result: true });
        }
      }
      if (col === undefined) return new Response("{}", { status: 404 });
      if (req.method === "PUT") {
        const body = (await req.json()) as { points: { id: string; vector: number[]; payload: unknown }[] };
        for (const p of body.points) col.set(p.id, { vector: p.vector, payload: p.payload });
        return Response.json({ result: { status: "completed" } });
      }
      if (req.method === "POST") {
        const body = (await req.json()) as { vector: number[]; limit: number };
        const scored = [...col.entries()]
          .map(([id, p]) => ({ id, payload: p.payload, score: p.vector.reduce((t, x, i) => t + x * (body.vector[i] ?? 0), 0) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, body.limit);
        return Response.json({ result: scored });
      }
      return new Response("", { status: 405 });
    },
  });
  servers.push(embed, qdrant);
  return {
    env: { OM_AGI_EMBED_URL: `http://127.0.0.1:${embed.port}`, OM_AGI_QDRANT_URL: `http://127.0.0.1:${qdrant.port}` },
    collections,
    asked,
  };
}

const MEMORY = {
  "memory/ops.md": "# Ports\n\nThe dashboard listens on port 30600.\n\n## Deploy\n\nRun deploy.sh from the Mac.\n",
  "memory/th.md": "# ราคา\n\nราคาทองวันนี้ขึ้น AIT-52\n",
};

describe("memory index", () => {
  test("with no servers: the full-text half is built, the vector half says why not, exit 0", async () => {
    const home = await sandbox();
    const agent = await agentWith(home, MEMORY);

    const result = await run(home, ["memory", "index", agent, "--subject", "alpha"], {
      OM_AGI_EMBED_URL: DEAD,
      OM_AGI_QDRANT_URL: DEAD,
    });

    expect(result.code, result.stderr).toBe(0);
    // The list comes before anything is embedded.
    expect(result.stdout.indexOf("cannot reach")).toBeLessThan(result.stdout.indexOf("full-text"));
    expect(result.stdout).toContain("2 file(s) · 3 piece(s)");
    expect(result.stdout).toContain("full-text  3 piece(s)");
    expect(result.stdout).toContain("vectors    not built");
    expect(await Bun.file(join(agent, ".dagi", "index", "fts.sqlite")).exists()).toBe(true);
  }, 60_000);

  test("a name is not a loopback literal, so the vector half is refused before any request", async () => {
    const home = await sandbox();
    const agent = await agentWith(home, MEMORY);
    const result = await run(home, ["memory", "index", agent, "--subject", "alpha"], {
      OM_AGI_EMBED_URL: "http://localhost:11435",
    });
    expect(result.stdout).toContain("OM_AGI_EMBED_URL");
    expect(result.stdout).toContain("not a loopback literal");
  }, 60_000);

  test("with both servers: one collection per subject, and the marker is written", async () => {
    const home = await sandbox();
    const agent = await agentWith(home, MEMORY);
    const s = standIns();

    const result = await run(home, ["memory", "index", agent, "--subject", "alpha"], s.env);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("vectors    3 point(s) → omagi__alpha");
    expect([...s.collections.keys()]).toEqual(["omagi__alpha"]);
    expect(await Bun.file(join(home, "state", "om-agi", "rag", "alpha", "collection.json")).exists()).toBe(true);
    expect(s.asked).toContain("embed bge-m3 3");
  }, 60_000);
});

describe("memory search", () => {
  test("Thai, a ticket number and a meaning all come back, each saying which index found it", async () => {
    const home = await sandbox();
    const agent = await agentWith(home, MEMORY);
    const s = standIns();
    await run(home, ["memory", "index", agent, "--subject", "alpha"], s.env);

    const thai = await run(home, ["memory", "search", agent, "--subject", "alpha", "ราคาทอง"], s.env);
    expect(thai.code, thai.stderr).toBe(0);
    expect(thai.stdout).toContain("memory/th.md");
    expect(thai.stdout).toContain("fts");

    const ticket = await run(home, ["memory", "search", agent, "--subject", "alpha", "AIT-52"], s.env);
    expect(ticket.stdout.split("\n")[0]).toContain("memory/th.md");

    const meaning = await run(home, ["memory", "search", agent, "--subject", "alpha", "deploy"], s.env);
    expect(meaning.stdout).toContain("Deploy");
    expect(meaning.stdout).toContain("vector");
  }, 60_000);

  test("S1.6 AC4 — B's recall makes no request that names A's collection", async () => {
    const home = await sandbox();
    const a = await agentWith(home, MEMORY);
    const s = standIns();
    await run(home, ["memory", "index", a, "--subject", "alpha"], s.env);

    const bHome = await sandbox();
    const b = await agentWith(bHome, { "memory/b.md": "# B\n\nnothing about ports here\n" });
    await run(bHome, ["memory", "index", b, "--subject", "beta"], s.env);

    s.asked.length = 0;
    const result = await run(bHome, ["memory", "search", b, "--subject", "beta", "port"], s.env);
    expect(result.stdout).not.toContain("30600");
    expect(s.asked.some((line) => line.includes("omagi__alpha"))).toBe(false);
    expect(s.asked.some((line) => line.includes("omagi__beta"))).toBe(true);
  }, 60_000);

  test("before any index: no hit, exit 1, and it says what to run", async () => {
    const home = await sandbox();
    const agent = await agentWith(home, MEMORY);
    const result = await run(home, ["memory", "search", agent, "--subject", "alpha", "port"], {
      OM_AGI_EMBED_URL: DEAD,
      OM_AGI_QDRANT_URL: DEAD,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ohmyagi memory index");
    expect(result.stderr).toContain("vector half skipped");
  }, 60_000);

  test("usage errors are usage errors", async () => {
    const home = await sandbox();
    for (const args of [
      ["memory", "index"],
      ["memory", "index", "x", "y", "--subject", "a"],
      ["memory", "index", "x", "--subject", "Not Valid"],
      ["memory", "search", "x", "--subject", "a"],
      ["memory", "search", "x", "--subject", "a", "--limit", "0", "q"],
      ["memory", "wat"],
    ]) {
      const result = await run(home, args, { OM_AGI_EMBED_URL: DEAD, OM_AGI_QDRANT_URL: DEAD });
      expect(result.code, args.join(" ")).toBe(2);
    }
  }, 60_000);
});

describe("memory ingest", () => {
  async function notes(home: string): Promise<string> {
    const src = join(home, "notes");
    await mkdir(src, { recursive: true });
    await Bun.write(join(src, "infra.md"), "# Ports\n\ndashboard on 30600\n");
    await Bun.write(join(src, "creds.md"), "# DB\n\npostgres://app:hunter22-x@db.invalid/main\n");
    return src;
  }

  test("without --yes: the plan, the blocked file named without its secret, nothing written, exit 1", async () => {
    const home = await sandbox();
    const agent = await agentWith(home, {});
    const src = await notes(home);

    const result = await run(home, ["memory", "ingest", agent, "--from", src], { OM_AGI_QDRANT_URL: DEAD });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("memory/imported/notes");
    expect(result.stdout).toContain("+ memory/imported/notes/infra.md");
    expect(result.stdout).toContain("! memory/imported/notes/creds.md:3  url-credentials");
    expect(result.stdout).not.toContain("hunter22");
    expect(result.stdout).toContain("Nothing was written.");
    expect(await Bun.file(join(agent, "memory", "imported", "notes", "infra.md")).exists()).toBe(false);
  }, 60_000);

  test("--yes writes the clean files only, says what git keeps first, and index reads them", async () => {
    const home = await sandbox();
    const agent = await agentWith(home, {});
    const src = await notes(home);

    const result = await run(home, ["memory", "ingest", agent, "--from", src, "--name", "owner", "--yes"], {
      OM_AGI_QDRANT_URL: DEAD,
    });

    expect(result.stdout.indexOf("what a commit puts beyond")).toBeLessThan(result.stdout.indexOf("wrote 1 file(s)"));
    expect(await Bun.file(join(agent, "memory", "imported", "owner", "infra.md")).exists()).toBe(true);
    expect(await Bun.file(join(agent, "memory", "imported", "owner", "creds.md")).exists()).toBe(false);

    const indexed = await run(home, ["memory", "index", agent, "--subject", "alpha"], {
      OM_AGI_EMBED_URL: DEAD,
      OM_AGI_QDRANT_URL: DEAD,
    });
    expect(indexed.stdout).toContain("1 file(s) · 1 piece(s)");
  }, 60_000);

  test("usage: no --from, a bad --name, and a source that is not there", async () => {
    const home = await sandbox();
    const agent = await agentWith(home, {});
    for (const args of [
      ["memory", "ingest", agent],
      ["memory", "ingest", agent, "--from", home, "--name", "Bad Name"],
    ]) {
      expect((await run(home, args, {})).code, args.join(" ")).toBe(2);
    }
    const missing = await run(home, ["memory", "ingest", agent, "--from", join(home, "nope")], {});
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("ohmyagi:");
  }, 60_000);
});

describe("memory forget", () => {
  test("plan without --yes; with --yes the file goes, both indexes are rebuilt, and the look again is clean", async () => {
    const home = await sandbox();
    const agent = await agentWith(home, MEMORY);
    const s = standIns();
    await run(home, ["memory", "index", agent, "--subject", "alpha"], s.env);
    expect([...(s.collections.get("omagi__alpha")?.keys() ?? [])].length).toBe(3);

    const dry = await run(home, ["memory", "forget", agent, "--subject", "alpha", "--match", "ทอง"], s.env);
    expect(dry.code, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("- memory/th.md  (line 3)");
    expect(dry.stdout).not.toContain("ราคาทองวันนี้");
    expect(dry.stdout).toContain("Nothing was removed.");
    expect(await Bun.file(join(agent, "memory", "th.md")).exists()).toBe(true);

    const done = await run(home, ["memory", "forget", agent, "--subject", "alpha", "--match", "ทอง", "--yes"], s.env);
    expect(done.code, done.stderr).toBe(0);
    expect(done.stdout).toContain("collection dropped whole and rebuilt with 2 point(s)");
    expect(done.stdout).toContain("0 file(s) still matching · 0 full-text hit(s) · 2 point(s) for 2 piece(s)");
    expect(await Bun.file(join(agent, "memory", "th.md")).exists()).toBe(false);
    expect([...(s.collections.get("omagi__alpha")?.values() ?? [])].some((p) => JSON.stringify(p.payload).includes("ทอง"))).toBe(false);
  }, 60_000);

  test("nothing matching, both selectors, and neither, are refusals", async () => {
    const home = await sandbox();
    const agent = await agentWith(home, MEMORY);
    const env = { OM_AGI_EMBED_URL: DEAD, OM_AGI_QDRANT_URL: DEAD };
    const none = await run(home, ["memory", "forget", agent, "--subject", "alpha", "--match", "zzzzzz"], env);
    expect(none.code).toBe(1);
    expect(none.stderr).toContain("nothing under memory/ matched");
    for (const args of [
      ["memory", "forget", agent, "--subject", "alpha"],
      ["memory", "forget", agent, "--subject", "alpha", "--match", "x", "--file", "memory/th.md"],
    ]) {
      expect((await run(home, args, env)).code, args.join(" ")).toBe(2);
    }
    const outside = await run(home, ["memory", "forget", agent, "--subject", "alpha", "--file", "soul/role.md"], env);
    expect(outside.code).toBe(1);
    expect(outside.stderr).toContain("only a file under memory/");
  }, 60_000);
});
