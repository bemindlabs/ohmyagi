/**
 * The wrapper that turns a delivered prompt into a line.
 *
 * The property worth testing is not "a turn is recorded" — it is **which**
 * turns are. A backend the chain decided was unavailable never saw the text
 * and must leave no line; a backend that was asked and went silent did see it
 * and must leave one. Getting that backwards would make the ledger answer the
 * question "which backend answered?" when the question I-6 asks is "which
 * backend received this?".
 *
 * The fallback case is exercised with the real `FallbackExec` rather than a
 * mock of one, because the whole claim is about how the two compose.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Availability, ExecBackend, TurnRequest, TurnResult } from "../../src/exec/backend.ts";
import { FallbackExec } from "../../src/exec/fallback.ts";
import { query, RecordingExec, type LedgerEnv, type RecordingOptions } from "../../src/ledger/index.ts";
import { subjectId } from "../../src/types.ts";
import { RESTRAINED } from "../support/restraint.ts";

const SUBJECT = subjectId("example");

const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function makeEnv(): Promise<LedgerEnv> {
  const root = await mkdtemp(join(tmpdir(), "om-agi-recording-"));
  scratch.push(root);
  return {
    home: root,
    env: { XDG_STATE_HOME: join(root, "state") },
    now: () => new Date("2026-09-21T10:00:00.000Z"),
  };
}

/** A backend with no subprocess and no socket, scripted per test. */
class Fake implements ExecBackend {
  readonly kind = "cli" as const;
  readonly display: string;
  calls = 0;

  constructor(
    readonly id: string,
    private readonly outcome: Partial<TurnResult> & { readonly available?: boolean },
    readonly identityStrength: "system" | "user" | "none" = "system",
  ) {
    this.display = `${id} (fake)`;
  }

  async available(): Promise<Availability> {
    const ok = this.outcome.available ?? true;
    return { ok, detail: ok ? `${this.id}: ready` : `${this.id}: not on PATH` };
  }

  async run(request: TurnRequest): Promise<TurnResult> {
    this.calls++;
    return {
      backend: this.id,
      text: this.outcome.text ?? `answer from ${this.id}`,
      confidence: this.outcome.confidence ?? "confirmed",
      identityStrength: this.identityStrength,
      evidence: {
        source: this.id,
        prompt: request.prompt,
        raw: `raw from ${this.id}`,
        durationMs: 11,
        exitCode: 0,
        ...this.outcome.evidence,
      },
    };
  }
}

let nextId = 0;
function options(ledger: LedgerEnv, overrides: Partial<RecordingOptions> = {}): RecordingOptions {
  return {
    ledger,
    turnId: "turn-1",
    newId: () => `line-${++nextId}`,
    content: "full",
    model: "stub",
    soulSha: "b".repeat(64),
    onWriteFailure: (error) => {
      throw error;
    },
    ...overrides,
  };
}

describe("RecordingExec", () => {
  test("reports the wrapped backend's own identity, so a route line reads the same", async () => {
    const env = await makeEnv();
    const inner = new Fake("claude", {}, "user");
    const wrapped = new RecordingExec(inner, options(env));

    expect(wrapped.id).toBe("claude");
    expect(wrapped.display).toBe("claude (fake)");
    expect(wrapped.kind).toBe("cli");
    expect(wrapped.identityStrength).toBe("user");
    expect((await wrapped.available()).detail).toBe("claude: ready");
  });

  test("a readiness probe is not a turn and writes nothing", async () => {
    const env = await makeEnv();
    await new RecordingExec(new Fake("claude", {}), options(env)).available();
    expect((await query(env, SUBJECT)).entries).toEqual([]);
  });

  test("one run, one line, carrying what was asked and what came back", async () => {
    const env = await makeEnv();
    const wrapped = new RecordingExec(new Fake("ollama", {}), options(env));
    await wrapped.run({ restraint: RESTRAINED, subject: SUBJECT, prompt: "canary-7f3a", system: "soul text" });

    const { entries } = await query(env, SUBJECT);
    expect(entries.length).toBe(1);
    const line = entries[0]!;
    expect(line.backend).toBe("ollama");
    expect(line.prompt).toBe("canary-7f3a");
    expect(line.text).toBe("answer from ollama");
    expect(line.confidence).toBe("confirmed");
    expect(line.duration_ms).toBe(11);
    expect(line.exit).toBe(0);
    expect(line.model).toBe("stub");
    expect(line.soul_sha).toBe("b".repeat(64));
    expect(line.cost).toBeNull();
    // The backend reported nothing, so the line says so in the state that
    // means "nobody has surveyed this one" — never a zero.
    expect(line.usage).toEqual({ status: "unreported", input: null, output: null, total: null });
    // The soul text itself is in git; only its hash is out here.
    expect(JSON.stringify(line)).not.toContain("soul text");
    // The vendor's raw output is not copied: it duplicates `text` and can
    // carry account ids, paths and tokens from an error message.
    expect(JSON.stringify(line)).not.toContain("raw from ollama");
  });

  test("--private records the turn without the words, and without a digest of them", async () => {
    const env = await makeEnv();
    const wrapped = new RecordingExec(new Fake("ollama", {}), options(env, { content: "withheld" }));
    await wrapped.run({ restraint: RESTRAINED, subject: SUBJECT, prompt: "canary-7f3a", system: "soul" });

    const line = (await query(env, SUBJECT)).entries[0]!;
    expect(line.content).toBe("withheld");
    expect(line.prompt).toBeNull();
    expect(line.text).toBeNull();
    expect(line.prompt_bytes).toBe(11);
    expect(line.text_bytes).toBeGreaterThan(0);
    // Still auditable: when, who, how long, how it went.
    expect(line.backend).toBe("ollama");
    expect(line.duration_ms).toBe(11);
    expect(JSON.stringify(line)).not.toContain("canary-7f3a");
  });

  test("a backend that went silent still received the prompt, and still gets a line", async () => {
    const env = await makeEnv();
    const claude = new RecordingExec(
      new Fake("claude", { confidence: "silent", text: "" }),
      options(env),
    );
    const ollama = new RecordingExec(new Fake("ollama", {}), options(env));
    const missing = new RecordingExec(new Fake("codex", { available: false }), options(env));

    const chain = new FallbackExec([claude, missing, ollama]);
    const result = await chain.run({ restraint: RESTRAINED, subject: SUBJECT, prompt: "canary-7f3a", system: "soul" });
    expect(result.text).toBe("answer from ollama");

    const { entries } = await query(env, SUBJECT);
    // Two lines, not one and not three. `claude` was handed the text and said
    // nothing; `codex` was never asked; `ollama` answered.
    expect(entries.map((e) => e.backend).sort()).toEqual(["claude", "ollama"]);
    expect(entries.every((e) => e.turn === "turn-1")).toBe(true);
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
    expect(entries.find((e) => e.backend === "claude")!.confidence).toBe("silent");
  });

  test("a chain that never reaches a backend writes no line at all", async () => {
    const env = await makeEnv();
    const chain = new FallbackExec([
      new RecordingExec(new Fake("claude", { available: false }), options(env)),
      new RecordingExec(new Fake("ollama", { available: false }), options(env)),
    ]);
    const result = await chain.run({ restraint: RESTRAINED, subject: SUBJECT, prompt: "canary-7f3a", system: "soul" });

    expect(result.confidence).toBe("silent");
    expect((await query(env, SUBJECT)).entries).toEqual([]);
  });

  test("the counts a backend reported land on the line", async () => {
    const env = await makeEnv();
    const usage = { status: "reported", input: 15, output: 24, total: null } as const;
    const wrapped = new RecordingExec(
      new Fake("ollama", { evidence: { source: "ollama", raw: "raw", usage } }),
      options(env),
    );
    await wrapped.run({ restraint: RESTRAINED, subject: SUBJECT, prompt: "canary-7f3a", system: "soul" });

    const line = (await query(env, SUBJECT)).entries[0]!;
    expect(line.usage).toEqual(usage);
    // Tokens, and still no money — the field exists and stays null by
    // decision, because every figure in a currency available here is true for
    // some owners and false for others.
    expect(line.cost).toBeNull();
  });

  test("--private keeps the counts, because a token total is not the words", async () => {
    // A `--private` line already records `prompt_bytes`, which bounds the size
    // of what was sent more tightly than a token count does. Withholding the
    // counts would cost the owner their own accounting without hiding
    // anything the line does not already imply.
    const env = await makeEnv();
    const usage = { status: "reported", input: 15, output: 24, total: null } as const;
    const wrapped = new RecordingExec(
      new Fake("ollama", { evidence: { source: "ollama", raw: "raw", usage } }),
      options(env, { content: "withheld" }),
    );
    await wrapped.run({ restraint: RESTRAINED, subject: SUBJECT, prompt: "canary-7f3a", system: "soul" });

    const line = (await query(env, SUBJECT)).entries[0]!;
    expect(line.content).toBe("withheld");
    expect(line.prompt).toBeNull();
    expect(line.usage).toEqual(usage);
  });

  test("a fallback line carries the counts of the backend that held the text, and only those", async () => {
    // One line per backend that was handed the prompt, and each line's counts
    // are its own. Summing them onto the answering backend would credit it
    // with tokens another vendor's tokenizer counted.
    const env = await makeEnv();
    const silent = new RecordingExec(
      new Fake("claude", {
        confidence: "silent",
        text: "",
        evidence: {
          source: "claude",
          raw: "",
          usage: { status: "reported", input: 7, output: 0, total: null },
        },
      }),
      options(env),
    );
    const answered = new RecordingExec(
      new Fake("ollama", {
        evidence: {
          source: "ollama",
          raw: "raw",
          usage: { status: "reported", input: 15, output: 24, total: null },
        },
      }),
      options(env),
    );

    const result = await new FallbackExec([silent, answered]).run({ restraint: RESTRAINED,
      subject: SUBJECT,
      prompt: "canary-7f3a",
      system: "soul",
    });

    // The chain hands the answering backend's evidence up, unmixed.
    expect(result.evidence.usage).toEqual({
      status: "reported",
      input: 15,
      output: 24,
      total: null,
    });

    const { entries } = await query(env, SUBJECT);
    const byBackend = new Map(entries.map((e) => [e.backend, e.usage]));
    expect(byBackend.get("claude")).toEqual({ status: "reported", input: 7, output: 0, total: null });
    expect(byBackend.get("ollama")).toEqual({ status: "reported", input: 15, output: 24, total: null });
  });

  test("a failed write is handed to the caller, never thrown at the chain", async () => {
    const env = await makeEnv();
    const failures: Error[] = [];
    // A directory that cannot be created: a file sits where it needs to be.
    const broken: LedgerEnv = { ...env, env: { XDG_STATE_HOME: "/dev/null/nope" } };
    const wrapped = new RecordingExec(
      new Fake("ollama", {}),
      options(broken, { onWriteFailure: (error) => failures.push(error) }),
    );

    // The turn's result still comes back: the answer is real even when the
    // bookkeeping failed, and hiding it would lose something true.
    const result = await wrapped.run({ restraint: RESTRAINED, subject: SUBJECT, prompt: "hello", system: "soul" });
    expect(result.text).toBe("answer from ollama");
    expect(failures.length).toBe(1);
  });
});
