/** `ohmyagi doctor` — is this machine ready, and nothing wider. */

import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  DEFAULT_OLLAMA_HOST,
  DEFAULT_QDRANT_HOST,
  doctorExit,
  fetchJson,
  pathLookup,
  renderDoctor,
  runDoctor,
  runProbe,
  type DoctorEnv,
} from "../../src/doctor.ts";
import { VENDORS } from "../../src/exec/index.ts";
import { isKnownBackend } from "../../src/soul/index.ts";
import { subjectId } from "../../src/types.ts";
import { ENGINE_CHECKOUT, parseArgs, usageError } from "../shared.ts";

const DOCTOR_USAGE =
  "usage: ohmyagi doctor [--model a,b] [--backend a,b] [--home <dir>] " +
  "[--agent <dir> --subject <id>] [--ollama <url>] [--qdrant <url>] [--no-version] [--json]";

/**
 * `ohmyagi doctor` — S0.2, kept to parsing and printing.
 *
 * Every probe lives in `src/doctor.ts` behind an injected {@link DoctorEnv}, so
 * this function does three things and no more: read the flags, put this
 * machine's facts into that env, and hand the exit code back. The report is
 * printed as plain lines rather than coloured: it is long, it is the kind of
 * output people paste into an issue, and a table of escape codes is worth less
 * than text that survives being copied.
 */
export async function cmdDoctor(argv: readonly string[]): Promise<number> {
  const { positional, options } = parseArgs(argv, ["json", "no-version"]);
  if (positional.length > 0) return usageError(DOCTOR_USAGE);

  const commas = (raw: string | undefined) =>
    (raw ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");

  const named = commas(options.get("backend"));
  for (const name of named) {
    if (!isKnownBackend(name)) return usageError(`unknown backend ${JSON.stringify(name)}`);
  }
  // Every backend by default, not the phase-A chain: this is a survey, and a
  // vendor whose instruction file nobody looked at is exactly where a leftover
  // identity block sits unnoticed (I-3).
  const backends = named.length > 0 ? named : ["ollama", ...VENDORS.map((spec) => spec.id)];

  const rawSubject = options.get("subject");
  let subject;
  if (rawSubject !== undefined && rawSubject !== "") {
    try {
      subject = subjectId(rawSubject);
    } catch (error) {
      return usageError(error instanceof Error ? error.message : String(error));
    }
  }

  const rawAgent = options.get("agent");
  const agent = rawAgent === undefined || rawAgent === "" ? undefined : resolve(rawAgent);
  if (agent !== undefined && subject === undefined) {
    return usageError(
      "--agent needs --subject <id> as well: whether `.dagi/` is stale is a question about one " +
        "identity's derived state, and om-agi will not take the subject from a directory name (D-014)",
    );
  }

  const askedHome = options.get("home");
  const home = askedHome === undefined || askedHome === "" ? homedir() : resolve(askedHome);

  const host = (asked: string | undefined, fallback: string) =>
    (asked === undefined || asked === "" ? fallback : asked).replace(/\/$/, "");
  const configured = process.env["OLLAMA_HOST"];

  const env: DoctorEnv = {
    home,
    cwd: process.cwd(),
    env: process.env,
    // `undefined` when this is the compiled binary, and the report says so
    // rather than scanning a virtual filesystem and calling the result clean.
    engineRoot: ENGINE_CHECKOUT,
    which: pathLookup,
    run: runProbe,
    getJson: fetchJson,
    ollamaHost: host(
      options.get("ollama"),
      configured === undefined || configured === "" ? DEFAULT_OLLAMA_HOST : configured,
    ),
    qdrantHost: host(options.get("qdrant"), DEFAULT_QDRANT_HOST),
    models: commas(options.get("model")),
    backends,
    probeVersions: !options.has("no-version"),
    ...(agent === undefined ? {} : { agent }),
    ...(subject === undefined ? {} : { subject }),
  };

  const report = await runDoctor(env);
  if (options.has("json")) console.log(JSON.stringify(report, null, 2));
  else for (const line of renderDoctor(report)) console.log(line);

  return doctorExit(report);
}
