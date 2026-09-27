/**
 * The data map (S7.1, D-050) as one list: every place a SubjectId resolves to.
 *
 * `planErase` built this list inline, and until S13.1 that was the only
 * reader. `ohmyagi deploy plan` needs the same list — *what of this subject's
 * is on this machine, and where would it be on another* — and a second copy of
 * it in `src/deploy/` would be the drift D-042's confirmations already showed:
 * a place one list knows and the other does not. So the list lives here, erase
 * removes what it names, and deploy moves what it names. `test/erase/data-map.test.ts`
 * holds the two readers to the same entries.
 *
 * ## Every entry says how it travels
 *
 * D-100 widened "on this machine" to "on a machine the owner controls", with
 * the condition that the data map includes the remote (#2). So each entry
 * carries a required {@link Travel}: whether it goes inside the agent's git
 * repository, is copied to the encrypted volume there, is rebuilt there from
 * git, or stays here — with the reason. Required, not defaulted, so a place
 * added to this file cannot be added without somebody deciding whether it
 * leaves the machine.
 *
 * ## Pure
 *
 * Nothing here touches the filesystem: every resolver is a `join` over the
 * roots it is handed. That is what lets deploy evaluate the same list with the
 * remote's roots and get the remote's paths — by construction the ones the
 * engine there will resolve, because they are the same functions. The one
 * question with I/O in it — is the personal directory inside a git repository?
 * — stays with `personalDir`, and erase asks it.
 *
 * Its import closure reaches no subprocess and no socket, and `test/deploy/
 * no-network.test.ts` checks that, because `src/deploy/` reads this file.
 */

import { a2aDirFor } from "../a2a/peers.ts";
import { chatDirFor } from "../connectors/users.ts";
import { basisDirFor } from "../consent/basis.ts";
import { confirmationsDirFor } from "../decide/confirm.ts";
import { runsDirFor } from "../decide/runs.ts";
import { triggersDirFor } from "../decide/triggers.ts";
import { personalPath } from "../guard/personal.ts";
import { ledgerDir } from "../ledger/store.ts";
import { collectionFor } from "../memory/collection.ts";
import { ragDirFor } from "../memory/marker.ts";
import type { SubjectId } from "../types.ts";
import { pushDirFor } from "../web/push-dir.ts";
import type { PlaceId } from "./place-id.ts";
import { backupTree, dagiTree, soulTree } from "./soul.ts";

/** The roots a resolver reads. This machine's, or the remote's. */
export interface MapEnv {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** What happens to one place when the agent moves to a machine the owner controls (D-100). */
export type Travel =
  /** It is inside the agent's repository, and a clone carries it. */
  | { readonly kind: "in-git" }
  /** Copied onto the encrypted volume there, at the same resolver evaluated with the remote's roots. */
  | { readonly kind: "copied" }
  /** Not copied: the engine there makes its own from what git holds. */
  | { readonly kind: "rebuilt"; readonly how: string }
  /** Not copied, and not made there either: it describes this machine. */
  | { readonly kind: "stays"; readonly why: string };

/** One name per entry, stable, so a reader can find an entry without matching its label. */
export type MapKey =
  | "soul"
  | "dagi"
  | "backups"
  | "confirmations"
  | "rag-marker"
  | "runs"
  | "triggers"
  | "a2a"
  | "chat"
  | "push"
  | "basis"
  | "personal"
  | "ledger";

/** One directory of the map. */
export interface MapTree {
  readonly key: MapKey;
  readonly place: PlaceId;
  /** The words erase's plan and certificate print for it. */
  readonly label: string;
  readonly dir: string;
  readonly travel: Travel;
}

/** The whole map for one subject: the trees, and the three places that are not a tree. */
export interface DataMap {
  /** What erase removes whole, in the order it lists them. */
  readonly trees: readonly MapTree[];
  /** The turn ledger. Erase empties it line by line (`planForget`); here it is one directory. */
  readonly ledger: MapTree;
  /** The subject's vector collection — in Qdrant, by name, not on this disk (D-038). */
  readonly collection: { readonly place: PlaceId; readonly name: string; readonly travel: Travel };
  /** om-agi's blocks inside vendor instruction files — somebody else's files (S1.2). */
  readonly blocks: { readonly place: PlaceId; readonly label: string; readonly travel: Travel };
}

const IN_GIT: Travel = { kind: "in-git" };
const COPIED: Travel = { kind: "copied" };

/**
 * The trees erase removes whole, in its order.
 *
 * `withSoul` is false for `erase --personal`, which keeps `soul/` in git and
 * takes `person.md` alone — a file, which erase plans itself.
 */
export function subjectTrees(
  env: MapEnv,
  subject: SubjectId,
  agentDir: string | null,
  withSoul: boolean,
): readonly MapTree[] {
  const trees: MapTree[] = [];

  if (agentDir !== null) {
    if (withSoul) {
      trees.push({ key: "soul", place: "soul", label: "the soul in git", dir: soulTree(agentDir), travel: IN_GIT });
    }
    trees.push({
      key: "dagi",
      place: "soul",
      label: "the derived directory",
      dir: dagiTree(agentDir),
      travel: {
        kind: "rebuilt",
        how:
          "`ohmyagi rebuild` and `memory index` there, from what git holds — derived, never the " +
          "source (I-2)",
      },
    });
  }

  trees.push({
    key: "backups",
    place: "soul",
    label: "the apply backups",
    dir: backupTree(env, subject),
    travel: {
      kind: "stays",
      why:
        "the originals of this machine's vendor instruction files, copied before `soul apply` wrote " +
        "to them. No vendor file goes from here (vendor logins stay, D-109), so there is nothing " +
        "there for them to restore",
    },
  });
  // Who confirmed level 3 for this subject's dial, and when (D-042).
  trees.push({
    key: "confirmations",
    place: "soul",
    label: "the level-3 confirmations",
    dir: confirmationsDirFor(env, subject),
    travel: {
      kind: "stays",
      why:
        "level 3 counts only where a person confirmed it on that machine (D-042), and each record " +
        "is keyed by this machine's path to the soul, so a copy would not count there anyway. " +
        "Confirm again on the remote",
    },
  });
  // The record that a vector collection was written for this subject. It names
  // the subject, so it goes like any other tree; erase reads it first.
  trees.push({
    key: "rag-marker",
    place: "rag",
    label: "the record of where vectors were written",
    dir: ragDirFor(env.home, env.env, subject),
    travel: {
      kind: "rebuilt",
      how:
        "written there by `memory index` when it reaches a vector store there. It records where " +
        "*this* machine wrote vectors; a copy would send erase on the remote to a store it never " +
        "wrote to",
    },
  });
  // The run records (S5.4). Under `ledger`: the same fact the ledger holds, a
  // turn, keyed by the same turn id — only still in flight.
  trees.push({
    key: "runs",
    place: "ledger",
    label: "run records for turns that were in flight",
    dir: runsDirFor(env, subject),
    travel: {
      kind: "stays",
      why:
        "turns in flight on this machine, by process id. A pid means nothing on another machine, " +
        "and `ohmyagi stop` there must not act on one",
    },
  });
  // When each scheduled trigger last fired (S5.3 AC6).
  trees.push({
    key: "triggers",
    place: "ledger",
    label: "when each trigger last fired",
    dir: triggersDirFor(env, subject),
    travel: {
      kind: "stays",
      why:
        "keyed by this machine's path to the agent: a clone elsewhere starts with nothing fired " +
        "(S5.3), so the first tick there runs whatever is due",
    },
  });
  // The A2A peer list (D-063), with the tokens issued to them.
  trees.push({ key: "a2a", place: "ledger", label: "the A2A peers and their tokens", dir: a2aDirFor(env, subject), travel: COPIED });
  // Who the agent answers in chat apps, and who has been told it is an AI (D-066).
  trees.push({ key: "chat", place: "ledger", label: "the chat allowlist and who has been told", dir: chatDirFor(env, subject), travel: COPIED });
  // D-130: the relay handles of the phones told when something waits.
  trees.push({ key: "push", place: "ledger", label: "the phones told when something is waiting (push handles)", dir: pushDirFor(env, subject), travel: COPIED });
  // Who approved this subject's data coming in, and for what (S7.3, D-077).
  // It has to go where the data goes, or ingest there reads nothing.
  trees.push({ key: "basis", place: "ledger", label: "the basis records for taking this subject's data in", dir: basisDirFor(env, subject), travel: COPIED });
  // Raw capture, the proposal store, the egress needles, the A2A inbox.
  trees.push({
    key: "personal",
    place: "observer",
    // Named for what goes, not for the place id it is counted under: a
    // certificate that said "observer record" while removing somebody's
    // proposals would be claiming to have deleted less than it deleted.
    label: "the personal directory (raw capture and the proposal store live under it)",
    dir: personalPath(env, subject),
    travel: COPIED,
  });

  return trees;
}

/** Every place this subject's data lives, under `env`'s roots and in `agentDir`. */
export function dataMap(env: MapEnv, subject: SubjectId, agentDir: string | null): DataMap {
  return {
    trees: subjectTrees(env, subject, agentDir, true),
    ledger: {
      key: "ledger",
      place: "ledger",
      label: "the turn ledger",
      dir: ledgerDir(env, subject),
      travel: COPIED,
    },
    collection: {
      place: "rag",
      name: collectionFor(subject),
      travel: {
        kind: "rebuilt",
        how:
          "`memory index` there embeds memory/ again when bge-m3 and a Qdrant answer there. A VPS " +
          "has no GPU (D-100); until S13.6 reaches the model at home, recall there is full-text only",
      },
    },
    blocks: {
      place: "soul",
      label: "om-agi's block in each vendor instruction file `soul apply` wrote to",
      travel: {
        kind: "stays",
        why:
          "they sit inside this machine's vendor files. Vendor CLIs and their logins do not go " +
          "(D-109, S13.7), so there is no file there to put one in",
      },
    },
  };
}
