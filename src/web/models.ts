/**
 * What the chat's backend and model picker offers (D-085).
 *
 * Only names that have a reason to work: models that really answered on that
 * backend (from the ledger, newest first), the local model this page was
 * started with, what the local Ollama lists, and Claude's own aliases. No
 * guessed catalogue — a stale guess is a turn that fails. The box stays free
 * text, so any other name can still be typed.
 */

/** What the composer's picker receives from `/api/models`. */
export interface ModelsState {
  readonly backends: readonly { readonly id: string; readonly available: boolean }[];
  /** The chain a turn tries when the page names no backend. */
  readonly chain: readonly string[];
  /** What `ohmyagi web` was started with. */
  readonly defaultTurn: { readonly backend: string | null; readonly model: string | null };
  /** Per backend id, the model names worth suggesting, best first. */
  readonly models: Readonly<Record<string, readonly string[]>>;
}

/** `claude --model` takes these and resolves them to the current model of each family. */
export const CLAUDE_ALIASES: readonly string[] = ["opus", "sonnet", "haiku"];

const MAX_PER_BACKEND = 12;
/** An embedding model answers no chat turn. */
const EMBEDDING = /embed|bge-|nomic|minilm|e5-/i;

export function modelChoices(input: {
  readonly backends: readonly string[];
  readonly entries: readonly { readonly at: string; readonly backend: string; readonly model: string | null; readonly confidence: string }[];
  readonly localModel: string | null;
  readonly ollama: readonly string[];
}): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const used = [...input.entries]
    .filter((e) => e.model !== null && e.model !== "" && (e.confidence === "confirmed" || e.confidence === "partial"))
    .sort((a, b) => b.at.localeCompare(a.at));
  for (const id of input.backends) {
    const names = used.filter((e) => e.backend === id).map((e) => e.model!);
    if (id === "claude") names.push(...CLAUDE_ALIASES);
    if (id === "ollama") names.unshift(...(input.localModel === null ? [] : [input.localModel])), names.push(...input.ollama.filter((m) => !EMBEDDING.test(m)));
    out[id] = [...new Set(names)].slice(0, MAX_PER_BACKEND);
  }
  return out;
}

/** Model names out of an Ollama `/api/tags` body; none for anything else. */
export function ollamaTags(body: unknown): string[] {
  const models = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];
  return models.map((m) => (m as { name?: unknown })?.name).filter((n): n is string => typeof n === "string" && n !== "");
}
