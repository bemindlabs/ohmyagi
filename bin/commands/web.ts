/**
 * `ohmyagi web <dir> --subject <id>` — a page for one agent (D-060).
 *
 * Reads what the commands read and serves it in plain words; every button
 * runs the CLI as a child. Loopback only unless `--host` says otherwise.
 */

import { firedPath, nextDue, parseTriggers, readFired, triggersDirFor, TRIGGERS_FILE } from "../../src/decide/triggers.ts";
import { proposalsDir, readProposals } from "../../src/decide/proposals.ts";
import { readTriage, typesafeKey } from "../../src/decide/triage.ts";
import { engineCommand } from "../../src/guard/hooks.ts";
import { query } from "../../src/ledger/store.ts";
import { loadSoul } from "../../src/soul/load.ts";
import { runGuarded } from "../../src/spawn.ts";
import { subjectId, type SubjectId } from "../../src/types.ts";
import { startWeb } from "../../src/web/server.ts";
import { ago, excerpt, levelSentence, triageChips, type ViewState } from "../../src/web/view.ts";
import { decideDial, dialEnv } from "../dial.ts";
import { bold, dim, ledgerEnv, parseArgs, report, usageError } from "../shared.ts";
import { join, resolve } from "node:path";

const USAGE = "usage: ohmyagi web <dir> --subject <id> [--port <n>] [--host <addr>] [--backend a,b] [--model <m>]";

/** The default port: om-agi's block in the dev band, beside the A2A default (30700). */
export const WEB_PORT = 30701;

async function gather(dir: string, id: SubjectId): Promise<ViewState> {
  const now = new Date();
  const loaded = await loadSoul(dir, id);
  const verdict = await decideDial(dir, dialEnv(), id);
  const level = levelSentence(verdict.effective.act, verdict.effective.stopped);

  const pdir = await proposalsDir(dialEnv(), id);
  const inventory = pdir.ok ? await readProposals(pdir.path) : { proposals: [], unreadable: [] };
  const waiting = [];
  const approved = [];
  for (const { proposal } of [...inventory.proposals].sort((a, b) => b.proposal.at.localeCompare(a.proposal.at))) {
    if (proposal.decision === null) {
      const triage = pdir.ok ? await readTriage(pdir.path, proposal.id) : undefined;
      waiting.push({
        id: proposal.id,
        what: proposal.what,
        why: proposal.why,
        impact: proposal.impact,
        filed: ago(proposal.at, now),
        byAgent: (proposal as { filedBy?: string }).filedBy === "agent",
        chips: triage === undefined ? [] : triageChips(triage),
      });
    } else if (proposal.decision.outcome === "approved" && proposal.usedByTurn === null) {
      approved.push({ id: proposal.id, what: proposal.what, decided: ago(proposal.decision.at, now) });
    }
  }

  const triggers: { id: string; every: string; next: string }[] = [];
  const file = Bun.file(join(dir, TRIGGERS_FILE));
  if (await file.exists()) {
    const parsed = parseTriggers(TRIGGERS_FILE, await file.text());
    if (parsed.ok) {
      const fired = await readFired(firedPath(dir, triggersDirFor(dialEnv(), id)));
      for (const t of parsed.value) {
        const due = nextDue(t, fired, now);
        triggers.push({ id: t.id, every: t.every, next: due <= now ? "now" : ago(due.toISOString(), now) });
      }
    }
  }

  const ledger = await query(ledgerEnv(), id);
  const recent = [...ledger.entries]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10)
    .map((e) => ({ when: ago(e.at, now), backend: e.backend, asked: excerpt(e.prompt), ok: e.confidence === "confirmed" || e.confidence === "partial" }));

  return {
    agent: {
      name: loaded.ok ? loaded.soul.role.name : "this agent",
      role: loaded.ok ? loaded.soul.role.role : "its soul does not load — run `ohmyagi soul check` in a terminal",
      subject: id,
      dir,
    },
    autonomy: { ...level, levels: { read: verdict.effective.dial.read, write: verdict.effective.dial.write, run: verdict.effective.dial.run, reach: verdict.effective.dial.reach } },
    stopped: verdict.effective.stopped,
    waiting,
    approved,
    triggers,
    recent,
    canTriage: (await typesafeKey(process.env)) !== undefined,
  };
}

export async function cmdWeb(argv: readonly string[]): Promise<number> {
  const { positional, options } = parseArgs(argv);
  const dir = positional[0];
  const raw = options.get("subject");
  if (dir === undefined || positional.length > 1 || raw === undefined || raw === "") return usageError(USAGE);
  let id: SubjectId;
  try {
    id = subjectId(raw);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error));
  }
  const loaded = await loadSoul(dir, id);
  if (!loaded.ok) return report(loaded.issues);
  const port = Number(options.get("port") ?? String(WEB_PORT));
  if (!Number.isInteger(port) || port < 0 || port > 65535) return usageError(`${USAGE} — --port is a number`);
  const hostname = options.get("host") ?? "127.0.0.1";
  const turnFlags = ["backend", "model"].flatMap((name) => {
    const value = options.get(name);
    return value === undefined || value === "" ? [] : [`--${name}`, value];
  });

  const absolute = resolve(dir);
  const server = startWeb(
    {
      dir: absolute,
      subject: id,
      turnFlags,
      state: () => gather(absolute, id),
      run: async (args) => {
        const out = await runGuarded([...engineCommand().argv, ...args]);
        return { code: out.code, stdout: new TextDecoder().decode(out.stdout), stderr: out.stderr };
      },
    },
    { port, hostname },
  );
  console.log(bold(`${loaded.soul.role.name} — open this in your browser:`));
  console.log(`  ${server.url}`);
  console.log(
    dim(
      (hostname === "127.0.0.1" || hostname === "localhost"
        ? "Only this computer can reach it. "
        : `Listening on ${hostname}: anything that can reach that address and has the link can use it. `) +
        "The link carries a one-time key; keep it to yourself. Ctrl-C stops the page (D-060).",
    ),
  );
  await new Promise<void>((done) => {
    const stop = () => {
      server.stop();
      done();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
