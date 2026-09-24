/**
 * S7.1 — the data map is `erase`'s own plan, and nothing om-agi keeps for a
 * subject is missing from it (D-050).
 *
 * Every directory the engine resolves from a SubjectId under the state or the
 * data root is listed here with the function that resolves it, and each must
 * appear among the trees `planErase` would remove. A new place that erase
 * does not know is the failure: it is how D-042's confirmations sat outside
 * every erase until this file was written.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirmationsDirFor } from "../../src/decide/confirm.ts";
import { runsDirFor } from "../../src/decide/runs.ts";
import { triggersDirFor } from "../../src/decide/triggers.ts";
import { a2aDirFor } from "../../src/a2a/peers.ts";
import { chatDirFor } from "../../src/connectors/users.ts";
import { planErase } from "../../src/erase/plan.ts";
import { backupTree } from "../../src/erase/soul.ts";
import { personalDir } from "../../src/guard/personal.ts";
import { ledgerDir } from "../../src/ledger/store.ts";
import { ragDirFor } from "../../src/memory/marker.ts";
import { subjectId } from "../../src/types.ts";

const SUBJECT = subjectId("example");

describe("S7.1 — every place om-agi keeps a subject's data is in the erase plan", () => {
  test("the resolvers, and the trees", async () => {
    const home = await mkdtemp(join(tmpdir(), "om-agi-data-map-"));
    try {
      const env = { home, env: { XDG_STATE_HOME: join(home, "state"), XDG_DATA_HOME: join(home, "data"), OM_AGI_QDRANT_URL: "http://127.0.0.1:9" }, now: () => new Date() };
      const personal = await personalDir(env, SUBJECT);
      const places: Record<string, string> = {
        "backups (soul apply)": backupTree(env, SUBJECT),
        "level-3 confirmations (D-042)": confirmationsDirFor(env, SUBJECT),
        "run records (S5.4)": runsDirFor(env, SUBJECT),
        "trigger fire times (S5.3)": triggersDirFor(env, SUBJECT),
        "A2A peers (D-063)": a2aDirFor(env, SUBJECT),
        "chat allowlist (D-066)": chatDirFor(env, SUBJECT),
        "rag marker (D-038)": ragDirFor(env.home, env.env, SUBJECT),
        "personal directory (capture, proposals, egress)": personal.path,
      };
      const plan = await planErase(env, {
        subject: SUBJECT,
        agentDir: null,
        scope: "all",
        by: "the data map test",
        needles: [],
        instructionFiles: [],
        soulName: null,
        personalValues: [],
      });
      const trees = plan.trees.map((tree) => tree.plan.dir);
      for (const [name, dir] of Object.entries(places)) expect(trees, name).toContain(dir);
      // The ledger is planned as lines, not as a tree.
      expect(plan.ledger.dir).toBe(ledgerDir({ ...env }, SUBJECT));
      // And the vector collection by name.
      expect(plan.vector.collection).toBe("omagi__example");
      // Nothing else resolves under the roots that this list does not name.
      expect(trees.length).toBe(Object.keys(places).length);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
