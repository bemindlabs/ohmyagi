/**
 * S8.3 through the binary (D-048): a prompt carrying a needle is not handed to
 * a cloud vendor, the chain falls through to the local model, and the record
 * says which rule — never the text.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { barePath, BUN } from "../support/bare-path.ts";
import { serveOllama, type StubOllama } from "../support/stub-ollama.ts";

const ROOT = join(import.meta.dir, "..", "..");
const BIN = join(ROOT, "bin", "om-agi.ts");
const SOUL = join(ROOT, "test", "fixtures", "soul-valid");
const SECRET = "Wanida Srisuk";

const scratch: string[] = [];
const stubs: StubOllama[] = [];
afterEach(async () => {
  for (const s of stubs.splice(0)) s.server.stop(true);
  for (const d of scratch.splice(0)) await rm(d, { recursive: true, force: true });
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), "om-agi-turn-egress-"));
  scratch.push(home);
  const bin = join(home, "bin");
  await mkdir(bin, { recursive: true });
  // A claude that leaves a mark if it is ever run.
  await Bun.write(
    join(bin, "claude"),
    `#!/usr/bin/env bun\nrequire("node:fs").writeFileSync(process.env.HOME + "/claude-was-called", process.argv.join(" "));\nconsole.log(JSON.stringify({ result: "from claude" }));\n`,
  );
  await chmod(join(bin, "claude"), 0o755);
  const ollama = serveOllama();
  stubs.push(ollama);
  const env = {
    HOME: home,
    PATH: `${bin}:${await barePath(home)}`,
    XDG_STATE_HOME: join(home, "state"),
    XDG_DATA_HOME: join(home, "data"),
    OLLAMA_HOST: ollama.url,
  };
  const run = async (args: readonly string[]) => {
    const child = Bun.spawn([BUN, "run", BIN, ...args], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();
    await child.exited;
    return { code: child.exitCode ?? -1, stdout, stderr };
  };
  return { home, run, ollama };
}

const turn = (prompt: string) => [
  "turn", SOUL, "--subject", "example", "--backend", "claude,ollama", "--model", "stub", "--no-recall", "--prompt", prompt,
];

describe("S8.3 — personal data does not leave through a turn", () => {
  test("a needle keeps the prompt from claude; the local model answers; the record has no text", async () => {
    const { home, run, ollama } = await setup();
    const where = await run(["egress", "needles", "--subject", "example"]);
    const needles = where.stdout.split("\n")[0]!;
    await mkdir(join(needles, ".."), { recursive: true });
    await Bun.write(needles, `# mine\n${SECRET}\n`);

    const result = await run(turn(`token t1 — write to ${SECRET} about the invoice`));

    expect(result.code, result.stderr).toBe(0);
    expect(await Bun.file(join(home, "claude-was-called")).exists()).toBe(false);
    expect(result.stderr).toContain("not sent to claude");
    expect(result.stderr).toContain("personal needle #1");
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stdout).toContain("from ollama");
    expect(ollama.prompts[0]).toContain(SECRET);

    const log = await run(["egress", "log", "--subject", "example"]);
    expect(log.stdout).toContain("claude");
    expect(log.stdout).toContain("personal needle #1");
    expect(log.stdout).not.toContain(SECRET);
  }, 60_000);

  test("the control: a clean prompt goes to claude as before", async () => {
    const { home, run } = await setup();
    const result = await run(turn("token t2 — how do I close the month?"));
    expect(result.stdout).toContain("from claude");
    expect(await Bun.file(join(home, "claude-was-called")).exists()).toBe(true);
    expect((await run(["egress", "log", "--subject", "example"])).stdout).toContain("nothing has been kept in");
  }, 60_000);

  test("a shape needs no needle: a phone number keeps the prompt in", async () => {
    const { home, run } = await setup();
    const result = await run(turn("token t3 — call 081-234-5678"));
    expect(result.stderr).toContain("thai-phone");
    expect(await Bun.file(join(home, "claude-was-called")).exists()).toBe(false);
  }, 60_000);

  test("egress check and needles, from the command line", async () => {
    const { run } = await setup();
    expect((await run(["egress", "check", "--subject", "example", "a@b.co"])).code).toBe(1);
    expect((await run(["egress", "check", "--subject", "example", "nothing here"])).code).toBe(0);
    expect((await run(["egress", "needles", "--subject", "example"])).stdout).toContain("no needles file yet");
    for (const args of [["egress"], ["egress", "check"], ["egress", "log"], ["egress", "wat"]]) {
      expect((await run(args)).code, args.join(" ")).toBe(2);
    }
  }, 60_000);
});
