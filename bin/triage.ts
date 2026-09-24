/**
 * The one place a command asks Jev about a proposal and keeps the answer
 * (D-059). Here rather than in a command because `proposal` and `turn` both
 * file proposals, and one command never imports another.
 */

import { describeFindings, judgeConfig, judgeEgress, loadLexicon, recordBlocked, verdictFindings } from "../src/egress/index.ts";
import {
  triageEnabled,
  triageLabel,
  triageProposal,
  typesafeKey,
  typesafeUrl,
  writeTriage,
  TYPESAFE_KEY_ENV,
  TYPESAFE_KEY_FILE_ENV,
  type TriageOutcome,
} from "../src/decide/triage.ts";
import type { Proposal } from "../src/decide/proposals.ts";
import type { SubjectId } from "../src/types.ts";
import { dialEnv } from "./dial.ts";
import { dimErr } from "./shared.ts";

/** Triage one proposal, store what came back, and say so on stderr. Never throws. */
export async function triageAndStore(
  proposalsDir: string,
  proposal: Proposal,
  subject: SubjectId,
  inheritsFrom: readonly string[] = [],
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>,
): Promise<TriageOutcome> {
  const key = await typesafeKey(process.env);
  if (key === undefined) {
    const reason = `no key — set ${TYPESAFE_KEY_ENV}, or ${TYPESAFE_KEY_FILE_ENV} to a file holding it`;
    console.error(`ohmyagi: proposal ${proposal.id} was not triaged: ${reason}.`);
    return { kind: "failed", reason };
  }
  const { lexicon } = await loadLexicon(dialEnv(), subject, inheritsFrom);
  const outcome = await triageProposal(proposal, {
    key,
    lexicon,
    url: typesafeUrl(process.env),
    ...(judgeConfig(process.env) === undefined
      ? {}
      : { judge: async (text: string) => verdictFindings(await judgeEgress(text, lexicon.needles, judgeConfig(process.env)!)) }),
    announce: (line) => console.error(dimErr(`ohmyagi: ${line}`)),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
  if (outcome.kind === "triaged") {
    try {
      await writeTriage(proposalsDir, outcome.triage);
      console.error(`ohmyagi: proposal ${proposal.id} — ${triageLabel(outcome.triage)} (advisory; it approves nothing)`);
    } catch (error) {
      console.error(`ohmyagi: proposal ${proposal.id} was triaged and the result could not be stored: ${String(error)}`);
    }
  } else if (outcome.kind === "kept-in") {
    await recordBlocked(dialEnv(), subject, { at: new Date().toISOString(), backend: "typesafe", findings: outcome.findings }).catch(() => undefined);
    console.error(`ohmyagi: proposal ${proposal.id} was not sent for triage — kept in: ${describeFindings(outcome.findings)}.`);
  } else {
    console.error(`ohmyagi: proposal ${proposal.id} was not triaged: ${outcome.reason}.`);
  }
  return outcome;
}

/** After filing: triage only when the owner turned it on with `OM_AGI_TRIAGE=jev`. */
export async function triageIfEnabled(
  proposalsDir: string,
  proposal: Proposal,
  subject: SubjectId,
  inheritsFrom: readonly string[] = [],
): Promise<TriageOutcome | undefined> {
  if (!triageEnabled(process.env)) return undefined;
  return triageAndStore(proposalsDir, proposal, subject, inheritsFrom);
}
