/**
 * S8.3's second layer: a local model reads what the text filter cannot (D-061).
 *
 * The filter matches text; it cannot see a needle paraphrased ("the bookkeeper
 * whose name means 'young woman'") or written in another script ("คุณวนิดา"
 * for "Wanida"). Those two were the forms the red team got through (8/10). So,
 * after the filter passes a prompt that is about to leave this machine, and
 * only when the owner has needles, a model **on this machine** is asked one
 * question: does this text reveal or point to any of these protected items?
 *
 * Three rules make it a gate rather than a hope:
 * - **Local only.** The judge is reached at a loopback literal and nowhere
 *   else — asking a cloud model whether text is private would send it out to
 *   find out. A host that is not loopback is refused before any request.
 * - **Fails closed.** No answer, a timeout, or an answer that does not parse
 *   is "unsure", and unsure keeps the prompt in. A prompt that could not be
 *   judged does not leave.
 * - **Opt-in by naming a model** (`OM_AGI_EGRESS_JUDGE=<ollama model>`), because
 *   it costs a local call on every cloud turn. Unset, the layer is off and
 *   `egress check` says so.
 */

import { notLoopbackLiteral } from "../loopback.ts";
import type { EgressFinding } from "./filter.ts";

export const JUDGE_ENV = "OM_AGI_EGRESS_JUDGE";
export const JUDGE_HOST_ENV = "OLLAMA_HOST";
export const DEFAULT_JUDGE_HOST = "http://127.0.0.1:11434";
export const JUDGE_TIMEOUT_MS = 20_000;

export type Verdict =
  | { readonly kind: "clear" }
  | { readonly kind: "reveals" }
  | { readonly kind: "unsure"; readonly reason: string };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface JudgeConfig {
  readonly model: string;
  readonly host: string;
}

/** The judge the environment names, or `undefined` when the layer is off. */
export function judgeConfig(env: Readonly<Record<string, string | undefined>>): JudgeConfig | undefined {
  const model = env[JUDGE_ENV]?.trim();
  if (model === undefined || model === "") return undefined;
  const host = (env[JUDGE_HOST_ENV] ?? DEFAULT_JUDGE_HOST).replace(/\/+$/, "");
  return { model, host };
}

/** What the model is told. The needles are named to it — it is on this machine. */
export function judgePrompt(text: string, needles: readonly string[]): { system: string; user: string } {
  return {
    system:
      "You guard an owner's privacy. You are given a list of PROTECTED items and a TEXT that is about to be sent " +
      "to an outside service. Decide whether the TEXT reveals, names, identifies, describes or points to any " +
      "protected item — in any language, script, spelling, nickname, translation, transliteration, abbreviation " +
      "or paraphrase. When in doubt, answer true. Reply with JSON only: {\"reveals\": true} or {\"reveals\": false}.",
    user: `PROTECTED:\n${needles.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\nTEXT:\n${text}`,
  };
}

/** Read the model's answer. Anything but a clear boolean is unsure. */
export function readVerdict(content: string): Verdict {
  const match = /\{[^{}]*"reveals"\s*:\s*(true|false)[^{}]*\}/i.exec(content);
  if (match === null) return { kind: "unsure", reason: "the judge's answer did not say true or false" };
  return match[1]!.toLowerCase() === "true" ? { kind: "reveals" } : { kind: "clear" };
}

/** Ask the local judge. Never throws; every failure is unsure. */
export async function judgeEgress(
  text: string,
  needles: readonly string[],
  config: JudgeConfig,
  fetchImpl: Fetch = fetch,
): Promise<Verdict> {
  if (needles.length === 0) return { kind: "clear" };
  const refused = notLoopbackLiteral(config.host);
  if (refused !== undefined) return { kind: "unsure", reason: `the judge must run on this machine: ${refused}` };
  const { system, user } = judgePrompt(text, needles);
  try {
    const response = await fetchImpl(`${config.host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: "unsure", reason: `the judge answered ${response.status}` };
    const body = (await response.json()) as { message?: { content?: unknown } };
    const content = body.message?.content;
    return typeof content === "string" ? readVerdict(content) : { kind: "unsure", reason: "the judge sent no message" };
  } catch (error) {
    return { kind: "unsure", reason: `the judge did not answer: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** A verdict as findings the egress path already knows how to keep in and record. */
export function verdictFindings(verdict: Verdict): readonly EgressFinding[] {
  if (verdict.kind === "clear") return [];
  return [{ rule: verdict.kind === "reveals" ? "judge:reveals" : "judge:unsure" }];
}
