/**
 * S7.2 AC1 — five places, two statuses, and never "5 deleted".
 *
 * The criterion names five places and one of them has no code in this
 * repository (the adapter, S6.3; the vector store arrived with S4.1, D-038).
 * The failure this file exists to prevent is the easy one: a command that
 * prints `5/5` because the acceptance criterion said five, over an adapter
 * nothing has ever written to or deleted from.
 *
 * Three things are checked here and the third is the one that makes the other
 * two survive contact with the future:
 *
 * 1. **The registry is closed.** A missing place or a sixth one is a `tsc`
 *    error, demonstrated with `@ts-expect-error` rather than described.
 * 2. **The lists are shared, not copied.** Each place's "what deletion cannot
 *    reach" array is the *same object* `ledger forget`, `observe purge` and
 *    `guard status` already print — `toBe`, which a copy fails. ADR 0002 asked
 *    for exactly this when it said erase "must print this same list rather than
 *    a second copy of it".
 * 3. **The tripwire.** "Register it later" is a promise, and a promise in a
 *    comment is a promise nobody keeps. So: if a derivation starts writing
 *    under the reserved address, if a socket appears in `src/memory/` outside
 *    the two files named for it, or if anything in `src/` starts naming an
 *    adapter path while `lora` still says `not-built`, this file goes red.
 *    Every one of those checks has a control that proves it bites.
 */

import { describe, expect, test } from "bun:test";
import { join, relative, resolve } from "node:path";
import { DERIVATIONS } from "../../src/agent/derive.ts";
import {
  implementedPlaces,
  notBuiltPlaces,
  PLACE_IDS,
  PLACES,
  placeOf,
  placeTally,
  undeletableFor,
  WEIGHTS_UNDELETABLE,
  type PlaceId,
} from "../../src/erase/places.ts";
import { GIT_UNDELETABLE } from "../../src/guard/history.ts";
import { UNDELETABLE } from "../../src/ledger/store.ts";
import { SUMMARY_PATH } from "../../src/observer/actions.ts";
import { RAG_UNDELETABLE } from "../../src/memory/store-admin.ts";
import { OBSERVER_UNDELETABLE } from "../../src/observer/store.ts";
import { globalsUsed, moduleSpecifiers, sourceFiles } from "../support/ast.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const SRC = join(ROOT, "src");

/**
 * Names a pure naming layer cannot use without reaching a runtime.
 *
 * Every way out of a JavaScript module that does not go through an import goes
 * through one of these: a file handle, a socket, a subprocess, an environment
 * variable, a dynamically-resolved module. A layer that names none of them and
 * imports nothing outside itself can compute strings and nothing else.
 */
const RUNTIME_GLOBALS: readonly string[] = [
  "Bun",
  "process",
  "globalThis",
  "require",
  "fetch",
  "WebSocket",
  "eval",
];

// ---------------------------------------------------------------------------
// The registry is closed
// ---------------------------------------------------------------------------

describe("the five places, and the one that is not built", () => {
  test("every id in AC1 has exactly one entry, in AC1's order", () => {
    expect(PLACE_IDS).toEqual(["soul", "observer", "rag", "ledger", "lora"]);
    expect(Object.keys(PLACES).sort()).toEqual([...PLACE_IDS].sort());
    for (const id of PLACE_IDS) expect(placeOf(id).id).toBe(id);
  });

  test("four exist and one does not, and it names who owes it", () => {
    expect(implementedPlaces().map((place) => place.id)).toEqual(["soul", "observer", "rag", "ledger"]);
    expect(notBuiltPlaces().map((place) => place.id)).toEqual(["lora"]);

    for (const place of notBuiltPlaces()) {
      expect(place.owedBy, place.id).toBeString();
      expect(place.reserved, place.id).toContain(".dagi/");
      // The five things a place has to bring on the day it registers, so that
      // "add it later" is a specification rather than an intention.
      expect(place.mustBring?.length ?? 0, place.id).toBeGreaterThanOrEqual(5);
      expect(place.noticeAt, place.id).toBeString();
    }
    expect(placeOf("lora").owedBy).toBe("S6.3");
    // S4.1 paid its debt (D-038): an implemented place carries none.
    expect(placeOf("rag").owedBy).toBeUndefined();
    expect(placeOf("rag").reserved).toBeUndefined();
  });

  test("a sixth id, and a missing one, are both type errors", () => {
    // @ts-expect-error — "weights" is not a PlaceId, so the registry cannot be
    // widened by accident at a call site either.
    void (() => placeOf("weights"));

    // And the registry itself is exhaustive: this is the shape `satisfies
    // Record<PlaceId, Place>` refuses, demonstrated rather than asserted.
    // @ts-expect-error — missing the other four keys
    const partial: Record<PlaceId, { id: PlaceId }> = { soul: { id: "soul" } };
    void partial;
  });

  test("the tally never puts a 5 next to a deletion", () => {
    const line = placeTally(4);

    expect(line).toContain("4 of 4 places that exist were visited");
    expect(line).toContain("1 of 5 are not built");
    expect(line).toContain("lora, owed by S6.3");
    expect(line).not.toContain("rag, owed by");
    // The sentence that must never be constructible from this function.
    expect(line).not.toContain("5 of 5");
    expect(line).not.toMatch(/deleted[^.]*5/);
  });
});

// ---------------------------------------------------------------------------
// The lists are shared, not copied
// ---------------------------------------------------------------------------

describe("what deletion cannot reach — one copy of the words", () => {
  test("each place holds the module's own array, by identity", () => {
    // `toBe`, not `toEqual`. A second copy of these words would pass an
    // equality check on the day it was written and drift the day after.
    expect(undeletableFor("soul")[0]).toBe(GIT_UNDELETABLE);
    expect(undeletableFor("observer")[0]).toBe(OBSERVER_UNDELETABLE);
    expect(undeletableFor("ledger")[0]).toBe(UNDELETABLE);
    expect(undeletableFor("lora")[0]).toBe(WEIGHTS_UNDELETABLE);
    expect(undeletableFor("rag")[0]).toBe(RAG_UNDELETABLE);
  });

  test("the observer place names what is derived from it and committed (S3.2)", () => {
    // `actions/summary.json` is not a sixth place — `PlaceId` is still AC1's
    // five. It is a *derivative* of this one, so this place names the path and
    // carries git's list beside its own, by reference rather than as a copy.
    const observer = placeOf("observer");

    expect(observer.what).toContain(SUMMARY_PATH);
    expect(observer.what).toContain("observe actions --write");
    // …and the second subtree, which arrived with S5.2 (D-029). The name of
    // this place is `observer` because that is what first wrote under the
    // personal directory; what it deletes is the whole directory, so the
    // sentence a certificate prints has to say `proposals/` too. A place that
    // takes more than its name admits is the kind of name this project spent a
    // day removing.
    expect(observer.what).toContain("proposals/");
    expect(observer.what).toContain("S5.2");
    expect(undeletableFor("observer")[1]).toBe(GIT_UNDELETABLE);
    expect(observer.noticeAt).toContain("observe actions --write");
  });

  test("rag's list was measured before it was written (D-035)", () => {
    // It was deliberately empty while nothing wrote there: a list about a
    // store om-agi had never touched would have been guesswork printed in the
    // voice of a guarantee. It is filled now because SP-4 measured the store.
    expect(RAG_UNDELETABLE.join(" ")).toContain("D-035");
    expect(RAG_UNDELETABLE.join(" ")).toContain("inversion");
  });

  test("WEIGHTS_UNDELETABLE says the thing people are surprised by, first", () => {
    const text = WEIGHTS_UNDELETABLE.join("\n");

    expect(WEIGHTS_UNDELETABLE[0]).toContain("cannot have one person subtracted from it");
    expect(text).toContain("train again");
    expect(text).toContain("merged into a base model");
    // AC4's timing, in the list itself: before, not after.
    expect(text).toContain("before the first capture");
    expect(text).toContain("S6.3");
  });

  test("the observer's list points at the weights list rather than copying it", () => {
    const text = OBSERVER_UNDELETABLE.join("\n");
    expect(text).toContain("WEIGHTS_UNDELETABLE");
    // The sentence it replaced promised a list that did not exist.
    expect(text).not.toContain("will be added when there is one");
  });
});

// ---------------------------------------------------------------------------
// The tripwire — what makes "register it later" real
// ---------------------------------------------------------------------------

/**
 * Text that means an adapter has arrived.
 *
 * `qdrant` and `.dagi/index` were on this list until S4.1 paid for them
 * (D-038). Deliberately short and specific. A wider list ("adapter") would fire
 * on the `ExecBackend` adapters and teach somebody to delete this test, which
 * is the only way a tripwire really fails.
 */
const ARRIVAL_SIGNALS: readonly string[] = [".dagi/adapters", "lora", "qlora"];

/** Every arrival signal in `source`, lower-cased. Pure, so it has controls. */
function arrivalSignals(source: string): string[] {
  const lower = source.toLowerCase();
  return ARRIVAL_SIGNALS.filter((signal) => lower.includes(signal));
}

/** `places.ts` is the registry: it holds the reserved address and the word LoRA because that is its job. */
const ALLOWED_TO_NAME: readonly string[] = [join("src", "erase", "places.ts")];

/**
 * What would mean a store had been written to rather than listed.
 *
 * `method:` carries most of the weight: `fetch(url)` is a GET, and an option
 * bag is the only way it becomes anything else.
 */
const WRITE_VERBS: readonly string[] = ["POST", "PUT", "PATCH", "DELETE", "method:"];

/** The two files in src/memory/ allowed a socket, and why each is allowed. */
const MEMORY_SOCKETS: readonly string[] = [
  // GET and DELETE a collection by name, no body — the erase layer's one door.
  join("src", "memory", "store-admin.ts"),
  // Embeds and writes text. Never reachable from src/erase/ (no-network.test.ts).
  join("src", "memory", "vector.ts"),
];

describe("the tripwire for S6.3, and what S4.1 left behind it", () => {
  test("no derivation writes under a reserved address while the place is not built", async () => {
    const reserved = notBuiltPlaces().map((place) => place.reserved!.replace(".dagi/", ""));
    expect(reserved.sort()).toEqual(["adapters"]);

    const offenders = DERIVATIONS.filter((derivation) =>
      reserved.some((dir) => derivation.output.startsWith(`${dir}/`)),
    );
    expect(offenders.map((derivation) => derivation.id)).toEqual([]);
  });

  test("a socket in src/memory/ lives in one of two named files, and nowhere else", async () => {
    // This used to say "nothing in src/memory/ can reach a store", and it held
    // until `rag` had a deleter. The rule it became is narrower and still
    // pinned: the network is in two files with two different jobs, and the one
    // that sends text is kept out of the erase layer by its own test.
    expect(placeOf("rag").status).toBe("implemented");

    const files = await sourceFiles(join(SRC, "memory"));
    const withSocket: string[] = [];
    for (const path of files) {
      const rel = relative(ROOT, path);
      const source = await Bun.file(path).text();
      if (globalsUsed(path, source, ["fetch", "WebSocket"]).length > 0) withSocket.push(rel);
    }
    expect(withSocket.sort()).toEqual([...MEMORY_SOCKETS].sort());
  });

  test("the control: that check really fires on a memory layer with a client in it", () => {
    const client = `import { QdrantClient } from "qdrant-js";\nexport const c = new QdrantClient();`;
    expect(moduleSpecifiers("x.ts", client).filter((s) => !s.startsWith("."))).toEqual(["qdrant-js"]);

    const reader = `export const read = () => fetch("http://127.0.0.1:10300/collections");`;
    expect(globalsUsed("x.ts", reader, ["fetch", "WebSocket"])).toEqual(["1: fetch"]);

    const naming = `import type { SubjectId } from "../types.ts";\nexport const n = (s: SubjectId) => \`omagi__\${s}\`;`;
    expect(globalsUsed("x.ts", naming, RUNTIME_GLOBALS)).toEqual([]);
  });

  test("nothing in src/ names an adapter path", async () => {
    const files = await sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(20);

    const hits: string[] = [];
    for (const path of files) {
      const rel = relative(ROOT, path);
      if (ALLOWED_TO_NAME.includes(rel)) continue;
      for (const signal of arrivalSignals(await Bun.file(path).text())) {
        hits.push(`${rel}: ${signal}`);
      }
    }

    expect(
      hits,
      "a place that is registered as `not-built` has code now — update src/erase/places.ts " +
        "and bring the five things its `mustBring` lists",
    ).toEqual([]);
  });

  test("the control: the scanner really fires on source that means one arrived", () => {
    expect(arrivalSignals(`const adapter = loadLoRA(path);`)).toEqual(["lora"]);
    expect(arrivalSignals(`join(agent, ".dagi/adapters", name)`)).toEqual([".dagi/adapters"]);

    expect(arrivalSignals(`import { join } from "node:path";`)).toEqual([]);
    expect(arrivalSignals(`export * from "./index.ts";`)).toEqual([]);
    expect(arrivalSignals(`const adapters = backends.map(toBackend);`)).toEqual([]);
  });

  test("doctor may name the store because it only ever lists it", async () => {
    // `rag` is built now, and doctor is still not its writer: the one thing it
    // may do to the store is read a list of names. Deleting is erase's, through
    // one file; writing is `memory index`'s.
    const source = await Bun.file(join(ROOT, "src", "doctor.ts")).text();
    for (const verb of WRITE_VERBS) {
      expect(source, `src/doctor.ts must not be able to write to a store (${verb})`).not.toContain(
        verb,
      );
    }
    expect(source).toContain("/collections");
  });

  test("the control: that check really fires on a doctor that could write", () => {
    const writing = `await fetch(url, { method: "DELETE" });`;
    expect(WRITE_VERBS.filter((verb) => writing.includes(verb))).toEqual(["DELETE", "method:"]);
    const listing = `await fetch(\`\${host}/collections\`, { signal });`;
    expect(WRITE_VERBS.filter((verb) => listing.includes(verb))).toEqual([]);
  });

  test("the control: the allowances are used, and not left on the list forever", async () => {
    for (const rel of ALLOWED_TO_NAME) {
      const signals = arrivalSignals(await Bun.file(join(ROOT, rel)).text());
      expect(signals, `${rel} is exempt but names nothing`).not.toEqual([]);
    }
  });
});
