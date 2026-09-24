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
import { startWeb, tailnetNames } from "../../src/web/server.ts";
import { ago, excerpt, levelSentence, remoteForPage, triageChips, type AgentInfo, type SettingsState, type ViewState } from "../../src/web/view.ts";
import { listMemories, readMemoryFile } from "../../src/web/memories.ts";
import { loadOrCreateKey } from "../../src/web/key.ts";
import { a2aDirFor, readPeers } from "../../src/a2a/peers.ts";
import { chatDirFor, contactKey, readChatState } from "../../src/connectors/users.ts";
import { judgeConfig, loadLexicon } from "../../src/egress/index.ts";
import { allBackends } from "../../src/exec/index.ts";
import { stateRoot } from "../../src/state.ts";
import { readCheck } from "../../src/update/version.ts";
import { VERSION } from "../../src/version.ts";
import { homedir } from "node:os";
import { decideDial, dialEnv } from "../dial.ts";
import { bold, dim, ledgerEnv, parseArgs, report, usageError } from "../shared.ts";
import { join, resolve } from "node:path";

const USAGE = "usage: ohmyagi web <dir> --subject <id> [--port <n>] [--host <addr>] [--name <host,…>] [--https] [--key-file <path>] [--backend a,b] [--model <m>]";

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

/** The agent repository's remote, HEAD and last commit — read with the git verbs om-agi may use. */
async function repoInfo(dir: string, now: Date): Promise<AgentInfo["repo"]> {
  const git = async (args: readonly string[]) => {
    const out = await runGuarded(["git", ...args], { cwd: dir }).catch(() => undefined);
    return out === undefined || out.code !== 0 ? "" : new TextDecoder().decode(out.stdout).trim();
  };
  const remotes = await git(["config", "--get-regexp", "^remote\\..*\\.url$"]);
  // origin first, else whichever is listed first.
  const lines = remotes.split("\n").filter((l) => l !== "");
  const pick = lines.find((l) => l.startsWith("remote.origin.url ")) ?? lines[0];
  const shown = pick === undefined ? null : remoteForPage(pick.slice(pick.indexOf(" ") + 1));
  const head = (await git(["rev-parse", "--short", "HEAD"])) || null;
  let lastCommit: string | null = null;
  let lastCommitAt: string | null = null;
  if (head !== null) {
    const commit = await git(["cat-file", "commit", "HEAD"]);
    const [headers, ...message] = commit.split("\n\n");
    lastCommit = (message.join("\n\n").split("\n")[0] ?? "").trim() || null;
    const stamp = /^committer .* (\d+) [+-]\d{4}$/m.exec(headers ?? "");
    lastCommitAt = stamp === null ? null : ago(new Date(Number(stamp[1]) * 1000).toISOString(), now);
  }
  return { remote: shown?.remote ?? null, web: shown?.web ?? null, head, lastCommit, lastCommitAt };
}

/** What the Agent tab shows: the soul in full, the repository, and what the ledger counts. */
async function gatherAgent(dir: string, id: SubjectId): Promise<AgentInfo> {
  const now = new Date();
  const loaded = await loadSoul(dir, id);
  const memories = await listMemories(dir);
  const ledger = await query(ledgerEnv(), id);
  const counts = new Map<string, number>();
  let last: string | null = null;
  for (const e of ledger.entries) {
    counts.set(e.backend, (counts.get(e.backend) ?? 0) + 1);
    if (last === null || e.at > last) last = e.at;
  }
  const stats = {
    memories: memories.length,
    turns: ledger.entries.length,
    lastTurn: last === null ? null : ago(last, now),
    byBackend: [...counts].map(([backend, turns]) => ({ backend, turns })).sort((a, b) => b.turns - a.turns),
  };
  const repo = await repoInfo(dir, now);
  if (!loaded.ok) {
    return {
      ok: false, problems: loaded.issues.map((i) => `${i.file ?? ""}${i.line === undefined ? "" : `:${i.line}`} ${i.message}`.trim()),
      name: "this agent", role: "", subject: id, dir, repo, prohibitions: [], scope: { does: "", doesNot: "" }, person: null, roleNotes: "", personNotes: "", stats,
    };
  }
  const { role, person } = loaded.soul;
  return {
    ok: true,
    problems: [],
    name: role.name,
    role: role.role,
    subject: id,
    dir,
    repo,
    prohibitions: role.prohibitions,
    scope: { does: role.scope.does, doesNot: role.scope.does_not },
    person: {
      tone: person.tone,
      addressesUserAs: person.addresses_user_as,
      refersToSelfAs: person.refers_to_self_as,
      principles: person.principles,
      inheritsFrom: person.inherits_from,
    },
    roleNotes: role.body.trim(),
    personNotes: person.body.trim(),
    stats,
  };
}

/** What the Settings tab shows. Read fresh each time it is opened. */
async function gatherSettings(dir: string, id: SubjectId, options: ReadonlyMap<string, string>): Promise<SettingsState> {
  const now = new Date();
  const verdict = await decideDial(dir, dialEnv(), id);
  const dial = verdict.effective.dial;
  const loaded = await loadSoul(dir, id);
  const chat = await readChatState(chatDirFor(dialEnv(), id));
  const peers = await readPeers(a2aDirFor(dialEnv(), id));
  const { lexicon } = await loadLexicon(dialEnv(), id, loaded.ok ? loaded.soul.person.inherits_from : []);
  const backends = await Promise.all(allBackends().map(async (b) => ({ id: b.id, available: (await b.available()).ok })));
  const check = await readCheck(stateRoot(homedir(), process.env));
  return {
    levels: { read: dial.read, write: dial.write, run: dial.run, reach: dial.reach },
    stopped: verdict.effective.stopped,
    backends,
    defaultTurn: { backend: options.get("backend") ?? null, model: options.get("model") ?? null },
    chatUsers: chat.users.map((u) => ({ platform: u.platform, userId: u.userId, label: u.label, told: chat.contacted.includes(contactKey(u.platform, u.userId)), added: ago(u.addedAt, now) })),
    peers: peers.map((p) => ({ name: p.name, endpoint: p.endpoint, added: ago(p.addedAt, now) })),
    guards: { judge: judgeConfig(process.env)?.model ?? null, triage: (await typesafeKey(process.env)) !== undefined, needles: lexicon.needles.length },
    version: { current: VERSION, latest: check?.latest ?? null, checked: check === undefined ? null : ago(check.at, now) },
  };
}

export async function cmdWeb(argv: readonly string[]): Promise<number> {
  const { positional, options } = parseArgs(argv, ["https"]);
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

  // The names a browser may use to reach it: any given with --name, and — on
  // a tailnet address — this machine's own tailnet names, so the URL a person
  // types is not refused as a wrong host.
  const names = (options.get("name") ?? "").split(",").map((n) => n.trim()).filter((n) => n !== "");
  // --https: something in front (tailscale serve) ends TLS and forwards here,
  // with the tailnet name in the Host header — so the name must be accepted,
  // and the link printed is the https one.
  const https = options.has("https");
  const keyFile = options.get("key-file");
  let token: string | undefined;
  if (keyFile !== undefined && keyFile !== "") {
    const key = await loadOrCreateKey(keyFile);
    if (!key.ok) {
      console.error(`ohmyagi: ${key.reason}`);
      return 1;
    }
    token = key.key;
    if (key.created) console.error(dim(`ohmyagi: a page key was written to ${keyFile} (600); the link stays the same across restarts.`));
  }
  if (hostname.startsWith("100.") || https) {
    const status = await runGuarded(["tailscale", "status", "--self", "--json"]).catch(() => undefined);
    if (status !== undefined && status.code === 0) names.push(...tailnetNames(new TextDecoder().decode(status.stdout)));
  }

  const absolute = resolve(dir);
  const server = startWeb(
    {
      dir: absolute,
      subject: id,
      turnFlags,
      state: () => gather(absolute, id),
      settings: () => gatherSettings(absolute, id, options),
      agent: () => gatherAgent(absolute, id),
      memories: () => listMemories(absolute),
      memory: (path) => readMemoryFile(absolute, path),
      run: async (args) => {
        const out = await runGuarded([...engineCommand().argv, ...args]);
        return { code: out.code, stdout: new TextDecoder().decode(out.stdout), stderr: out.stderr };
      },
    },
    { port, hostname, names, scheme: https ? "https" : "http", ...(token === undefined ? {} : { token }) },
  );
  console.log(bold(`${loaded.soul.role.name} — open this in your browser:`));
  console.log(`  ${server.url}`);
  if (names.length > 0) console.log(dim(`  also answers as ${[hostname, ...names.slice(1)].join(", ")} — the same key after #t=`));
  console.log(
    dim(
      (hostname === "127.0.0.1" || hostname === "localhost"
        ? https
          ? "On loopback, reached through the https proxy in front of it. "
          : "Only this computer can reach it. "
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
