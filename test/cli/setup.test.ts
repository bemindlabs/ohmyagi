/**
 * D-056 through the binary: `ohmyagi setup` with its answers piped in creates
 * an agent, writes the soul it was told, checks it, runs one turn against a
 * stub Ollama — and raises no level and enables no capture.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { barePath, BUN } from "../support/bare-path.ts";

const ROOT = join(import.meta.dir, "..", "..");
const BIN = join(ROOT, "bin", "om-agi.ts");

const scratch: string[] = [];
const servers: { stop: (force: boolean) => void }[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) s.stop(true);
  for (const d of scratch.splice(0)) await rm(d, { recursive: true, force: true });
});

function stubOllama() {
  const systems: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === "/api/tags") return Response.json({ models: [{ name: "stub" }] });
      const body = (await req.json()) as { messages: { role: string; content: string }[] };
      systems.push(body.messages.find((m) => m.role === "system")?.content ?? "");
      return Response.json({ message: { content: "I am helper, an AI agent, not a human." } });
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}`, systems };
}

async function setupRun(answers: readonly string[], ollama: string, extra: readonly string[] = []) {
  const home = await mkdtemp(join(tmpdir(), "om-agi-setup-"));
  scratch.push(home);
  await writeFile(join(home, ".gitconfig"), "[user]\n\tname = Test\n\temail = t@example.invalid\n");
  // `new` runs `git init`; no vendor CLI is on this PATH, so the first turn defaults to ollama.
  const path = await barePath(home);
  await symlink(Bun.which("git")!, join(home, "bare-bin", "git"));
  const child = Bun.spawn([BUN, "run", BIN, "setup", ...extra], {
    cwd: ROOT,
    env: {
      HOME: home,
      USER: "tester",
      PATH: path,
      XDG_STATE_HOME: join(home, "state"),
      XDG_DATA_HOME: join(home, "data"),
      OLLAMA_HOST: ollama,
    },
    stdin: new TextEncoder().encode(answers.map((a) => `${a}\n`).join("")),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  await child.exited;
  return { home, code: child.exitCode ?? -1, stdout, stderr };
}

describe("ohmyagi setup", () => {
  test("creates the agent, writes the answers into its soul, and runs a first turn", async () => {
    const ollama = stubOllama();
    // name · subject · parent · role · does · does-not · address · backend · model
    const run = await setupRun(
      ["helper", "", "~/agents", "answers questions about this server", "", "restarts services", "ที่รัก", "", ""],
      ollama.url,
    );

    expect(run.code, run.stderr).toBe(0);
    const dir = join(run.home, "agents", "helper");
    const role = await Bun.file(join(dir, "soul", "role.md")).text();
    const person = await Bun.file(join(dir, "soul", "person.md")).text();
    expect(role).toContain('subject = "tester"');
    expect(role).toContain('role = "answers questions about this server"');
    expect(role).toContain('does = "answers questions about this server"');
    expect(role).toContain('does_not = "restarts services"');
    expect(person).toContain('addresses_user_as = "ที่รัก"');

    expect(ollama.systems).toHaveLength(1);
    expect(ollama.systems[0]).toContain("answers questions about this server");
    expect(run.stdout).toContain("I am helper, an AI agent, not a human.");
    expect(run.stdout).toContain("git add soul && git commit");

    // Nothing raised, nothing enabled.
    expect(await Bun.file(join(dir, "soul", "autonomy.md")).exists()).toBe(false);
    expect(await Bun.file(join(run.home, "data", "om-agi", "tester", "personal", "consent.json")).exists()).toBe(false);
  }, 60_000);

  test("a bad answer is asked again, and --no-turn sends nothing", async () => {
    const ollama = stubOllama();
    const run = await setupRun(
      ["bad name!", "helper", "Bad Subject", "someone", "", "keeps notes", "", "", ""],
      ollama.url,
      ["--no-turn"],
    );
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain("letters, digits, '.', '_' and '-'");
    expect(run.stdout).toContain("lower-case letters, digits, '_' and '-', up to 64");
    expect(await Bun.file(join(run.home, "agents", "helper", "soul", "role.md")).text()).toContain('subject = "someone"');
    expect(ollama.systems).toHaveLength(0);
  }, 60_000);

  test("running out of answers stops before anything is created", async () => {
    const run = await setupRun(["helper", "tester", ""], "http://127.0.0.1:9");
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("ran out of input");
    expect(await Bun.file(join(run.home, "agents", "helper", "soul", "role.md")).exists()).toBe(false);
  }, 60_000);
});
