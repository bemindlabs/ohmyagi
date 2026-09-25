/** `ohmyagi turn` — one turn wearing this soul, and one ledger line per send. */

import {
  AnnouncedExec,
  PHASE_A_BACKENDS,
  backend as buildBackend,
  fallbackTrail,
  loosenedNote,
  restrain,
  turnChain,
  type TurnResult,
} from "../../src/exec/index.ts";
import {
  describeRun,
  removeRunRecord,
  writeRunRecord,
} from "../../src/decide/runs.ts";
import { judgeConfig, judgeEgress, judgeInput, loadLexicon, recordBlocked, screen, verdictFindings } from "../../src/egress/index.ts";
import { RecordingExec, canAppend, type RecordingOptions } from "../../src/ledger/index.ts";
import {
  AUTONOMY_FILE,
  PROPOSE_INSTRUCTION,
  blockingProposal,
  describeProposal,
  diffSnapshots,
  ensureProposalsDir,
  extractAsks,
  findProposal,
  formatTreeChange,
  proposalLine,
  proposalKey,
  proposalsDir,
  readProposals,
  snapshotTree,
  spendProposal,
  spendability,
  writeProposal,
  type StoredProposal,
} from "../../src/decide/index.ts";
import {
  attachWithin,
  DEFAULT_RECALL_CHARS,
  describeAttachment,
  ftsPath,
  recall,
  vectorEndpoints,
  withRecall,
  type Attachment,
} from "../../src/memory/index.ts";
import { isKnownBackend, loadSoul, renderSoul, resolveSoulDir, sha256 } from "../../src/soul/index.ts";
import { subjectId, type SubjectId } from "../../src/types.ts";
import { DIAL_REFUSED, decideDial, dialEnv, dialLine, heldNote } from "../dial.ts";
import { triageIfEnabled } from "../triage.ts";
import { dimErr, ledgerEnv, parseArgs, report, usageError } from "../shared.ts";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { isatty } from "node:tty";
import {
  appendRecord,
  consentAllows,
  loadConsent,
  observerDir,
  turnRecord,
} from "../../src/observer/index.ts";

/**
 * One line naming who answered, who did not, and how long it took.
 *
 * Goes to stderr so that stdout is the answer and nothing else, and is never
 * optional: the chain's default starts with a cloud CLI, so "which backend
 * received this soul and this prompt" is a fact the person who typed the
 * command is entitled to without asking for it (I-4, I-6).
 */
function routeLine(result: TurnResult): string {
  const ms = result.evidence.durationMs;
  const took = ms === undefined ? "?" : `${(ms / 1000).toFixed(1)}s`;
  const trail = fallbackTrail(result.evidence.raw);
  const answered = result.confidence === "confirmed" || result.confidence === "partial";

  if (!answered) {
    return `no backend answered · ${took}${trail === undefined ? "" : ` · ${trail}`}`;
  }
  return (
    `answered by ${result.backend} · identity arrived as ${result.identityStrength} · ${took}` +
    (trail === undefined ? "" : ` · missed: ${trail}`)
  );
}

/**
 * Read a prompt from a file, or from standard input when the path is `-`.
 *
 * One trailing newline is removed, and only one. `echo hi | ohmyagi turn
 * --prompt-file -` should ask the same question as `--prompt hi`, and a shell
 * adds that newline without being asked. Everything else — interior newlines,
 * trailing spaces, a second blank line somebody meant — is sent verbatim,
 * because `TurnRequest.prompt` says verbatim.
 */
async function readPromptFrom(path: string): Promise<string> {
  const raw = path === "-" ? await Bun.stdin.text() : await Bun.file(path).text();
  return raw.replace(/\r?\n$/, "");
}

const TURN_USAGE =
  "usage: ohmyagi turn <dir> --subject <id> (--prompt <text> | --prompt-file <path>) " +
  "[--backend a,b,c] [--model <m>] [--private] [--proposal <id>] [--no-recall] " +
  "[--recall-chars <n>] [--json]";

/**
 * The approval `--proposal` names, or the exit code that stops the turn.
 *
 * Read from the proposal store (`src/decide/proposals.ts`) and **never from the
 * ledger**: D-029 put proposals in a store of their own so that reading one back
 * into a decision — which is exactly what this is — stays outside D-022's reach.
 * Nothing here touches `src/ledger/`.
 *
 * `spent` is refused as firmly as `refused`, and that is the owner's decision of
 * 2026-09-22 rather than caution: an approval that keeps working is how *I
 * allowed it once* becomes *it has been doing that ever since*, with nothing
 * anywhere to say when the old permission was used again.
 */
async function approvalFor(
  subject: SubjectId,
  id: string,
): Promise<
  | { readonly ok: true; readonly dir: string; readonly stored: StoredProposal }
  | { readonly ok: false; readonly code: number }
> {
  const dir = await proposalsDir(dialEnv(), subject);
  if (!dir.ok) {
    console.error(`ohmyagi: ${dir.reason}`);
    return { ok: false, code: 1 };
  }
  const inventory = await readProposals(dir.path);
  for (const bad of inventory.unreadable) {
    console.error(`ohmyagi: ${bad.path} is in the proposal store and is not a proposal: ${bad.reason}`);
  }

  const stored = findProposal(inventory, id);
  if (stored === undefined) {
    // A usage error rather than a refusal: the command line names something
    // that is not there, which is a different thing from being told no — and a
    // loop that retried this one would retry a typo forever.
    return {
      ok: false,
      code: usageError(
        `no proposal ${JSON.stringify(id)} for subject ${subject} in ${dir.path}. ` +
          `\`ohmyagi proposal list\` prints what is there; nothing was sent.`,
      ),
    };
  }

  const state = spendability(stored.proposal);
  if (state.kind === "ready") return { ok: true, dir: dir.path, stored };

  console.error(`ohmyagi: nothing was sent — ${proposalLine(stored.proposal)}`);
  console.error(
    state.kind === "undecided"
      ? `  It has not been answered. \`ohmyagi proposal decide ${id} <dir> --subject ${subject} ` +
          `--approve\` is the answer this turn is waiting for.`
      : state.kind === "refused"
        ? `  It was refused${
            stored.proposal.decision?.note == null ? "" : `: ${stored.proposal.decision.note}`
          }. A refusal is remembered (S5.2 AC2); file a new proposal saying what is different.`
        : `  Its approval was already spent by turn ${state.turn}. An approval is good for one ` +
          `turn, on purpose: ask again and it will be a decision somebody made today.`,
  );
  return { ok: false, code: DIAL_REFUSED };
}

/**
 * The flags `turn` takes no value for.
 *
 * Exported because `--as` parses this command line too, and it needs the same
 * list to tell `--private` from a flag that swallows the next word. See
 * {@link import("./soul.ts").SOUL_CHECK_BOOLEANS} for why there is one copy.
 */
export const TURN_BOOLEANS: readonly string[] = ["json", "private", "no-recall"];

/**
 * `ohmyagi turn` — spend one turn wearing a soul, on whichever backend answers.
 *
 * This is the command S2.1 AC6 is about. The soul is rendered once, by the
 * same renderer `soul apply` uses, and handed over as the system prompt; the
 * backends that have no such channel say so in the result rather than being
 * reported as if they carried it.
 *
 * S2.2 added the record. Each backend is wrapped so that a line lands in the
 * ledger for every backend that was really handed the prompt — one line, not
 * one per turn, because a chain that fell through to the local model gave the
 * text to two vendors and the owner is entitled to know both names.
 *
 * The ledger is checked for writability *before* the prompt goes out. A turn
 * that has already been sent cannot be un-sent by a later error, so "I cannot
 * record this" has to be an answer to a question asked first.
 */
export async function cmdTurn(argv: readonly string[]): Promise<number> {
  const { positional, options } = parseArgs(argv, TURN_BOOLEANS);
  const dir = positional[0];
  const subject = options.get("subject");
  const promptText = options.get("prompt");
  const promptFile = options.get("prompt-file");

  if (promptText !== undefined && promptText !== "" && promptFile !== undefined && promptFile !== "") {
    return usageError("--prompt and --prompt-file name two different prompts; pass one of them");
  }
  if (
    dir === undefined ||
    subject === undefined ||
    subject === "" ||
    ((promptText === undefined || promptText === "") && (promptFile === undefined || promptFile === ""))
  ) {
    return usageError(TURN_USAGE);
  }

  let prompt: string;
  if (promptFile !== undefined && promptFile !== "") {
    try {
      prompt = await readPromptFrom(promptFile);
    } catch (error) {
      return usageError(`cannot read the prompt from ${promptFile}: ${String(error)}`);
    }
    if (prompt === "") return usageError(`the prompt read from ${promptFile} is empty`);
  } else {
    prompt = promptText!;
  }

  let id;
  try {
    id = subjectId(subject);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error));
  }

  const recallChars = Number(options.get("recall-chars") ?? String(DEFAULT_RECALL_CHARS));
  if (!Number.isInteger(recallChars) || recallChars < 0) {
    return usageError(`${TURN_USAGE} — --recall-chars is a whole number of characters, 0 or more`);
  }

  const named = (options.get("backend") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  for (const name of named) {
    if (!isKnownBackend(name)) return usageError(`unknown backend ${JSON.stringify(name)}`);
  }
  const backendIds = named.length > 0 ? named : [...PHASE_A_BACKENDS];

  // I-3: the soul has to belong to the subject named on the command line, and
  // `loadSoul` is where that is checked — not here, and not by convention.
  const loaded = await loadSoul(dir, id);
  if (!loaded.ok) return report(loaded.issues);

  // S5.1/S5.4, asked before anything is sent and before the ledger is even
  // checked. Level 0 — which is what an unreadable `autonomy.md`, a ceiling of
  // 0, or the stop flag all produce — means *do not run this turn*, and the
  // cheapest place to honour that is here, where no process has started.
  const verdict = await decideDial(dir, dialEnv(), id);
  for (const issue of verdict.issues) console.error(`ohmyagi: ${AUTONOMY_FILE}: ${issue.message}`);
  if (verdict.effective.act === 0) {
    console.error(`ohmyagi: nothing was sent — the autonomy dial is at 0 for this turn.`);
    for (const note of verdict.effective.notes) console.error(`  ${note}`);
    console.error(
      `  ${dialLine(verdict.effective)}\n` +
        `  the brake: ${verdict.stopPath} — ${verdict.effective.stopped ? "IS SET" : "not set"}\n` +
        `  \`ohmyagi autonomy show ${dir} --subject ${id}\` prints the whole picture.`,
    );
    return DIAL_REFUSED;
  }
  // S5.2 — asked here, after the brake and before anything is written, because
  // this is the cheapest refusal left: a proposal that was refused, is still
  // waiting, or has already been spent stops the turn with nothing done. The
  // record is *marked* spent later, immediately before the prompt goes out.
  const proposalId = options.get("proposal");
  let approval: { dir: string; stored: StoredProposal } | undefined;
  if (proposalId !== undefined) {
    // An empty value is a refusal rather than an absence. `--proposal` with
    // nothing after it is somebody asking for a turn *under an approval*, and
    // running it as an ordinary turn would be the free pass this flag exists
    // to make impossible — quietly, which is worse than loudly.
    if (proposalId === "") {
      return usageError("--proposal takes the id of a proposal; it was given nothing");
    }
    const asked = await approvalFor(id, proposalId);
    if (!asked.ok) return asked.code;
    approval = { dir: asked.dir, stored: asked.stored };
  }

  const restraint = restrain(verdict.effective);
  // S5.1 AC2 (D-052): the categories are set apart but act together, so a turn
  // whose settings disagree says which one is in force.
  const held = heldNote(verdict.effective.dial);
  if (held !== "") console.error(dimErr(`ohmyagi: acts at ${verdict.effective.act}${held}`));
  const loosened = loosenedNote(verdict.effective);
  // Printed before the prompt goes, not after: this is the one line that says a
  // turn may write to the disk, and it is worth nothing once it already has.
  if (loosened !== undefined) console.error(dimErr(`ohmyagi: ${loosened}`));

  // Asked before anything is sent. A prompt that has left this machine cannot
  // be recalled by an error message, so a ledger om-agi cannot write is a
  // reason not to send — and the exit code says so rather than the turn
  // happening unrecorded.
  const ledger = ledgerEnv();
  const writable = await canAppend(ledger, id);
  if (!writable.ok) {
    console.error(`ohmyagi: ${writable.reason}`);
    console.error(
      "Nothing was sent. A turn nobody can look back at is the thing S2.2 exists to prevent; " +
        "fix the path above, or delete the ledger directory if you want a fresh one.",
    );
    return 1;
  }

  // `--model` names an ollama model. `backend()` hands it only to the local
  // backend; a vendor CLI keeps its own default, because a local model id
  // passed to `claude --model` is a turn that fails for the wrong reason.
  const model = options.get("model");
  const soulText = renderSoul(loaded.soul);

  // S4.3 (D-039) — recall is asked after every refusal above and before
  // anything is sent, and printed before it goes, because "what was attached"
  // is worth nothing once the backend already has it (AC3).
  const attachment = options.has("no-recall") || recallChars === 0
    ? undefined
    : await recallFor(dir, id, prompt, recallChars);
  const recalled = attachment === undefined ? soulText : withRecall(soulText, attachment);
  // D-045 — level 1 is "propose": the vendor is read-only already, and this
  // tells the model where to put what it would have done.
  const system = verdict.effective.act === 1 ? `${recalled}\n\n${PROPOSE_INSTRUCTION}` : recalled;
  const writeFailures: Error[] = [];
  const turnId = crypto.randomUUID();
  const recording: RecordingOptions = {
    ledger,
    turnId,
    newId: () => crypto.randomUUID(),
    content: options.has("private") ? "withheld" : "full",
    model: model === undefined || model === "" ? null : model,
    // The soul text itself is in git; the hash is enough to say which version
    // was worn without keeping a second copy out here to delete later. Taken
    // from the soul alone: recall changes per turn, and a hash that moved with
    // it would stop naming which soul was worn (D-039).
    soulSha: sha256(soulText),
    onWriteFailure: (error) => writeFailures.push(error),
  };

  // Each member is wrapped, not the chain: `FallbackExec.run` is called once
  // per turn, but `RecordingExec.run` is called once per backend that was
  // really handed the text — which is the fact worth recording, and the same
  // fact `AnnouncedExec` says out loud one moment earlier (S7.2 AC4). The
  // notice goes to stderr, so a `--json` stdout stays parseable, and it is
  // asked of `raw` rather than of the recorder around it: a wrapper copies the
  // id it wraps, and a copied id is no evidence of where a turn goes.
  const { lexicon } = await loadLexicon(dialEnv(), id, loaded.soul.person.inherits_from);
  const judge = judgeConfig(process.env);
  const blocked: Promise<void>[] = [];
  const chain = turnChain(
    backendIds.map((backendId) => {
      const raw = buildBackend(backendId, model === undefined || model === "" ? {} : { model });
      return new AnnouncedExec(new RecordingExec(raw, recording), {
        origin: raw,
        write: (line) => console.error(dimErr(line)),
        // S8.3 (D-048): prompt and system — the soul and whatever recall
        // attached — are screened before anything leaves this machine.
        screen: (request) => screen(`${request.prompt}\n${request.system ?? ""}`, lexicon),
        // D-061: a model on this machine reads meaning the filter cannot, when
        // the owner named one. Unsure keeps the prompt in. D-071: it reads the
        // question and the recall, not the soul — the filter above reads all.
        ...(judge === undefined
          ? {}
          : {
              judge: async (request) =>
                verdictFindings(await judgeEgress(judgeInput(request.prompt, attachment?.block), lexicon.needles, judge)),
            }),
        onBlocked: (backendId, findings) => {
          blocked.push(
            recordBlocked(dialEnv(), id, { at: new Date().toISOString(), backend: backendId, findings }).then(
              () => undefined,
              (error: unknown) => console.error(`ohmyagi: the block was not recorded: ${String(error)}`),
            ),
          );
        },
      });
    }),
  );

  // S5.2 — the approval is spent **before** the prompt goes, for the reason the
  // ledger is checked first: a turn that has been sent cannot be un-sent, so an
  // approval marked afterwards is one that a crash mid-turn hands back unused.
  // A write that fails stops the turn: an approval om-agi cannot record as
  // spent is one that could be spent twice, and twice is the thing the owner
  // decided against.
  if (approval !== undefined) {
    try {
      await writeProposal(approval.dir, spendProposal(approval.stored.proposal, turnId, new Date()));
    } catch (error) {
      console.error(`ohmyagi: the approval could not be marked as spent: ${String(error)}`);
      console.error(
        `Nothing was sent. An approval that cannot be recorded as used is one that could be used ` +
          `again, and "good for one turn" would then be a sentence rather than a rule.`,
      );
      return 1;
    }
    console.error(
      dimErr(
        `ohmyagi: proposal ${approval.stored.proposal.id} is spent on this turn (${turnId}). ` +
          `Another turn needs another approval.`,
      ),
    );
  }

  // S5.4 — written **before** the prompt goes anywhere, and removed in a
  // `finally`. The ledger line is written after a backend answers, so a turn
  // killed mid-flight leaves nothing there; this is the only thing on disk that
  // says a turn is in progress, and it is what makes `ohmyagi stop` able to find
  // one. A failure to write it does not stop the turn — a kill switch that can
  // veto work is a worse failure than one that misses a turn — but it is said.
  let runRecordPath: string | undefined;
  try {
    runRecordPath = await writeRunRecord(
      dialEnv(),
      describeRun({ turnId, subject: id, backends: backendIds, at: new Date() }),
    );
  } catch (error) {
    console.error(
      `ohmyagi: could not write the run record (${String(error)}). The turn is going ahead; ` +
        `\`ohmyagi stop\` will not be able to find it, and the process group is printed above ` +
        `by nothing, so Ctrl-C is all you have for this one.`,
    );
  }

  // S5.2 AC4 (D-043) — a turn allowed to act reports what it changed before
  // it ends. The snapshot is only taken when the vendor may write at all.
  const workdir = process.cwd();
  const before = verdict.effective.act >= 2 ? await snapshotTree(workdir) : undefined;

  const sentAt = new Date();
  let result: TurnResult;
  try {
    result = await chain.run({ subject: id, prompt, system, restraint });
  } finally {
    if (runRecordPath !== undefined) await removeRunRecord(runRecordPath);
  }

  // D-032 — the turn records itself, under the consent `observe enable` took
  // and through the store the hook writes to. After the answer and outside
  // the exit code: capture is the observer's business, not the turn's contract,
  // and a turn that failed because a counter could not be written would have
  // taught somebody to switch the counter off (the same reasoning that makes
  // the hook exit 0). The ledger above is different — it is the contract.
  await captureTurn({
    subject: id,
    turnId,
    at: sentAt,
    result,
    proposal: approval !== undefined,
  });

  await Promise.all(blocked);
  const change = before === undefined ? undefined : diffSnapshots(before, await snapshotTree(workdir));
  // Level 2 is "act, then report"; level 3 is "act" (S5.1 AC1, D-047). At 3
  // the report is still made — it is in --json — but it does not interrupt.
  if (change !== undefined && !restraint.unfenced) {
    for (const line of formatTreeChange(workdir, change)) console.error(`ohmyagi: ${line}`);
  }

  const answered = result.confidence === "confirmed" || result.confidence === "partial";
  const filed = verdict.effective.act === 1 && answered ? await fileAgentAsks(id, turnId, result.text, loaded.soul.person.inherits_from) : [];

  if (options.has("json")) {
    console.log(
      JSON.stringify(
        {
          ...result,
          route: routeLine(result),
          changed: change === undefined ? null : change === null ? "not-measured" : change,
          proposals: filed,
          recall:
            attachment === undefined
              ? null
              : { chars: attachment.chars, ceiling: attachment.ceiling, skipped: attachment.skipped, attached: attachment.attached },
        },
        null,
        2,
      ),
    );
  } else {
    if (result.text !== "") console.log(result.text);
    console.error(dimErr(routeLine(result)));
  }

  // An answer that arrived is still printed — hiding it would lose something
  // real to punish a bookkeeping failure — but the exit code is not 0, because
  // this turn happened and the ledger does not know about it.
  if (writeFailures.length > 0) {
    for (const failure of writeFailures) console.error(`ohmyagi: ledger write failed: ${failure.message}`);
    console.error(
      `${writeFailures.length} turn(s) were sent and not recorded. The answer above is real; ` +
        `the record of it is missing.`,
    );
    return 1;
  }

  // Exit 1 when nothing answered, and say so rather than exiting 0 with an
  // empty stdout — the silent success is the failure this project exists to
  // catch.
  return answered ? 0 : 1;
}

/** One proposal block from the answer, and what became of it. */
interface FiledAsk {
  readonly what: string;
  readonly id: string | null;
  readonly outcome: "filed" | "already-asked" | "unreadable" | "not-written";
}

/**
 * S5.2 AC1 (D-045) — what the agent said it would do, into the proposal store.
 *
 * The same rules `proposal new` keeps: a thing already refused, or still
 * waiting, is not filed again. Every block is accounted for on stderr, filed
 * or not, because a proposal that silently went nowhere is the failure mode
 * this whole level exists to prevent.
 */
async function fileAgentAsks(
  subject: SubjectId,
  turnId: string,
  text: string,
  inheritsFrom: readonly string[],
): Promise<readonly FiledAsk[]> {
  const found = extractAsks(text);
  const out: FiledAsk[] = [];
  for (let i = 0; i < found.unreadable; i += 1) out.push({ what: "", id: null, outcome: "unreadable" });
  if (found.asks.length > 0) {
    const dir = await ensureProposalsDir(dialEnv(), subject);
    const inventory = dir.ok ? await readProposals(dir.path) : undefined;
    for (const ask of found.asks) {
      if (!dir.ok || inventory === undefined) {
        out.push({ what: ask.what, id: null, outcome: "not-written" });
        continue;
      }
      const blocking = blockingProposal(inventory, proposalKey(ask.what));
      if (blocking !== undefined) {
        out.push({ what: ask.what, id: blocking.id, outcome: "already-asked" });
        continue;
      }
      const proposal = describeProposal({
        id: crypto.randomUUID(),
        subject,
        at: new Date(),
        ...ask,
        filedBy: "agent",
        fromTurn: turnId,
      });
      try {
        await writeProposal(dir.path, proposal);
        out.push({ what: ask.what, id: proposal.id, outcome: "filed" });
        // D-059 — only when the owner set OM_AGI_TRIAGE=jev. Advisory: it approves nothing.
        await triageIfEnabled(dir.path, proposal, subject, inheritsFrom);
      } catch {
        out.push({ what: ask.what, id: null, outcome: "not-written" });
      }
    }
  }
  for (const ask of out) {
    const line =
      ask.outcome === "filed"
        ? `proposal ${ask.id} filed by the agent: ${ask.what}`
        : ask.outcome === "already-asked"
          ? `not filed — already asked (${ask.id}), and a refusal or a pending question is not asked twice: ${ask.what}`
          : ask.outcome === "unreadable"
            ? "a proposal block was in the answer and could not be read (it needs what, why and impact) — nothing was filed for it"
            : `not filed — the proposal store could not be written: ${ask.what}`;
    console.error(`ohmyagi: ${line}`);
  }
  if (out.some((ask) => ask.outcome === "filed")) {
    console.error(
      dimErr(
        `ohmyagi: nothing was done. Approve with \`ohmyagi proposal decide <id> <dir> --subject ${subject} ` +
          `--approve\`, then run the turn again with --proposal <id> at level 2.`,
      ),
    );
  }
  return out;
}

/**
 * What this turn will carry from the agent's memory, printed before it goes.
 *
 * The agent repository is the soul directory's parent when `<dir>` named the
 * soul itself (D-033's rule, read back the other way). An agent with no index
 * has not been given recall — `ohmyagi memory index` is the step that gives it —
 * so nothing is asked, nothing is embedded and nothing is printed. A store that
 * is down leaves the full-text half (I-1).
 */
async function recallFor(
  dir: string,
  subject: SubjectId,
  prompt: string,
  ceiling: number,
): Promise<Attachment | undefined> {
  const soulDir = await resolveSoulDir(dir);
  const agentDir = soulDir === dir ? dirname(dir) : dir;
  if (!(await Bun.file(ftsPath(agentDir)).exists())) return undefined;

  const checked = vectorEndpoints(process.env);
  const found = await recall(
    agentDir,
    subject,
    prompt,
    8,
    checked.ok ? checked.endpoints : { reason: checked.reason },
    undefined,
    "any",
  );
  const attachment = attachWithin(found.hits, ceiling);
  if (found.vector !== "ok") console.error(dimErr(`ohmyagi: recall: vector half skipped — ${found.vector.failed}`));
  for (const line of describeAttachment(attachment)) console.error(dimErr(`ohmyagi: ${line}`));
  return attachment;
}

/**
 * Record that this turn happened, if — and only if — the owner has agreed to
 * capture. Silent when they have not: "capture is off" is this program's
 * default state, and a line printed on every turn about it is how people learn
 * to ignore the line that matters.
 *
 * The terminal test is the whole of the evidence for `origin` (D-032): both
 * stdin (fd 0) and stderr (fd 2), because a pipe on either side means a program
 * is at one end of this turn, and a program is not the owner.
 */
async function captureTurn(parts: {
  readonly subject: SubjectId;
  readonly turnId: string;
  readonly at: Date;
  readonly result: TurnResult;
  readonly proposal: boolean;
}): Promise<void> {
  // The same escape hatch the hook honours, so a fleet launcher that set it
  // once stays out of the data on both doors.
  if (process.env["OM_AGI_CAPTURE"] === "off") return;

  const dir = await observerDir({ home: homedir(), env: process.env }, parts.subject);
  if (!dir.ok) {
    console.error(dimErr(`ohmyagi: this turn was not captured: ${dir.reason}`));
    return;
  }
  if (!consentAllows(await loadConsent(dir.path), "capture")) return;

  const record = turnRecord({
    turnId: parts.turnId,
    at: parts.at.toISOString(),
    project: process.cwd(),
    backend: parts.result.backend,
    confidence: parts.result.confidence,
    // `isatty` from node:tty, not `process.stderr.isTTY`: reading that getter
    // can cut a later long write short through a pipe (test/cli/streams.test.ts).
    terminal: isatty(0) && isatty(2),
    proposal: parts.proposal,
  });
  // `appendRecord` will not create the tree: a purge between the consent
  // check and here leaves this refused, which is the right answer (I-4).
  const outcome = await appendRecord(dir.path, record, parts.at);
  if (!outcome.ok) {
    console.error(dimErr(`ohmyagi: the turn happened and was not captured: ${outcome.reason}`));
  }
}
