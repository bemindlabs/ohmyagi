/** D-085 — what the chat's backend and model picker offers. */

import { describe, expect, test } from "bun:test";
import { CLAUDE_ALIASES, modelChoices, ollamaTags } from "../../src/web/models.ts";

describe("the chat's model choices", () => {
  test("models that really answered, newest first; Claude's aliases; the local model and Ollama's list, no embedders", () => {
    const entries = [
      { at: "2026-09-26T01:00:00Z", backend: "claude", model: "claude-sonnet-5", confidence: "confirmed" },
      { at: "2026-09-26T03:00:00Z", backend: "claude", model: "claude-opus-5-5", confidence: "partial" },
      { at: "2026-09-26T04:00:00Z", backend: "claude", model: "broken-name", confidence: "failed" },
      { at: "2026-09-26T02:00:00Z", backend: "codex", model: null, confidence: "confirmed" },
      { at: "2026-09-26T02:30:00Z", backend: "ollama", model: "typhoon-4b", confidence: "confirmed" },
    ];
    const got = modelChoices({ backends: ["claude", "codex", "ollama", "kimi"], entries, localModel: "qwen3.8:27b", ollama: ["bge-m3:latest", "typhoon-4b", "nomic-embed-text", "gemma3:27b"] });
    expect(got["claude"]).toEqual(["claude-opus-5-5", "claude-sonnet-5", ...CLAUDE_ALIASES]);
    expect(got["codex"]).toEqual([]);
    expect(got["ollama"]).toEqual(["qwen3.8:27b", "typhoon-4b", "gemma3:27b"]);
    expect(got["kimi"]).toEqual([]);
    expect(modelChoices({ backends: ["ollama"], entries: [], localModel: null, ollama: [] })["ollama"]).toEqual([]);
  });

  test("an Ollama tag list, and anything else is none", () => {
    expect(ollamaTags({ models: [{ name: "a:1" }, { name: "" }, { nope: 1 }, { name: "b" }] })).toEqual(["a:1", "b"]);
    for (const bad of [null, {}, { models: "x" }, 3]) expect(ollamaTags(bad)).toEqual([]);
  });
});
