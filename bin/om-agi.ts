#!/usr/bin/env bun
/**
 * `om-agi` — entry point.
 *
 * Thin for real now, rather than on purpose: this file is `main`, and `main`
 * is a `switch`. Every command's parsing and printing lives in
 * `bin/commands/<command>.ts`, what more than one of them needs lives in
 * `bin/shared.ts`, the help text in `bin/usage.ts`, and `--as` in
 * `bin/as.ts`. Anything a human would want to unit-test is still under
 * `src/`.
 *
 * It was one file until it was 3364 lines and almost every task had to open it,
 * so two tasks in parallel edited the same file and merged by hand. Changing a
 * command now touches that command's file; adding one touches this `switch`
 * and `bin/usage.ts` as well, which is a few lines rather than a whole file.
 *
 * `main` stays here, last, and keeps its `switch`: `test/guard/no-push.test.ts`
 * reads the `case` labels out of this file to check that no command reaches
 * release without a test exercising it.
 */

import { VERSION } from "../src/version.ts";
import { expandAs } from "./as.ts";
import { cmdA2A } from "./commands/a2a.ts";
import { cmdChat } from "./commands/chat.ts";
import { cmdPersona } from "./commands/persona.ts";
import { cmdEval } from "./commands/eval.ts";
import { cmdAutonomy } from "./commands/autonomy.ts";
import { cmdBackends } from "./commands/backends.ts";
import { cmdDoctor } from "./commands/doctor.ts";
import { cmdErase } from "./commands/erase.ts";
import { cmdGuard } from "./commands/guard.ts";
import { cmdLedger } from "./commands/ledger.ts";
import { cmdNew } from "./commands/new.ts";
import { cmdEgress } from "./commands/egress.ts";
import { cmdMemory } from "./commands/memory.ts";
import { cmdObserve } from "./commands/observe.ts";
import { cmdProposal } from "./commands/proposal.ts";
import { cmdRebuild } from "./commands/rebuild.ts";
import { cmdSetup } from "./commands/setup.ts";
import { cmdSoul } from "./commands/soul.ts";
import { cmdStop } from "./commands/stop.ts";
import { cmdTriggers } from "./commands/triggers.ts";
import { cmdTurn } from "./commands/turn.ts";
import { autoCheck, cmdUpdate } from "./commands/update.ts";
import { cmdWeb } from "./commands/web.ts";
import { cmdWorn } from "./commands/worn.ts";
import { asksForHelp, helpFor } from "./shared.ts";
import { USAGE } from "./usage.ts";

async function main(rawArgv: readonly string[]): Promise<number> {
  // `--as` is resolved before dispatch and nowhere else: it expands into the
  // `<dir> --subject <id>` every command already takes, so no command below
  // learns a second way to be told whose identity it is working on (D-003).
  const expanded = await expandAs(rawArgv);
  if (!expanded.ok) return expanded.code;
  const argv = expanded.argv;

  const [command = "help", ...rest] = argv;

  // **A command that is asked how does not do.** Answered here, before the
  // `switch`, and that position is the whole of the guarantee: every command
  // reaches its own code through one of the `case`s below, so a rule in front
  // of them covers the ones written after this line as well as the ones
  // written before it. Put inside each command instead, it would have been
  // fifteen places to remember and one of them would be the dangerous one.
  //
  // It is here because of what `ohmyagi stop --help` did on 2026-09-22: it set
  // the brake. `--help` is not in `stop`'s boolean list, so `parseArgs` filed
  // it as an option nothing reads, the positional list came back empty, and
  // the command ran exactly as if it had been typed bare — writing
  // `$XDG_STATE_HOME/om-agi/STOP` and printing a report of having stopped the
  // machine. Nothing was malformed enough to refuse, which is why nothing did.
  //
  // `help` itself is excluded so that `ohmyagi help --help` is still the whole
  // help text rather than the one line describing `help`.
  if (command !== "help" && asksForHelp(rest)) {
    const block = helpFor(USAGE, command);
    if (block !== undefined) {
      console.log(block);
      console.log("");
      console.log(
        "Nothing was done. `--help` asks how, and a command that is asked how does not act — " +
          "which is a rule om-agi needs because `ohmyagi stop --help` used to set the brake.",
      );
      console.log("`ohmyagi help` prints all of it.");
      return 0;
    }
    // No block means the help text does not describe this verb. Falling
    // through is right: either it is not a command at all, and the `default`
    // arm says so, or it is one nobody documented — which
    // `test/cli/usage-dispatch.test.ts` fails for separately, and which must
    // not be quietly answered with an empty page here.
  }

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;

    case "backends":
      return cmdBackends();

    case "doctor":
      return cmdDoctor(rest);

    case "setup":
      return cmdSetup(rest);

    case "new":
      return cmdNew(rest);

    case "rebuild":
      return cmdRebuild(rest);

    case "soul":
      return cmdSoul(rest);

    case "worn":
      return cmdWorn(rest);

    case "turn":
      return cmdTurn(rest);

    case "ledger":
      return cmdLedger(rest);

    case "observe":
      return cmdObserve(rest);

    case "memory":
      return cmdMemory(rest);

    case "egress":
      return cmdEgress(rest);

    case "triggers":
      return cmdTriggers(rest);

    case "web":
      return cmdWeb(rest);

    case "a2a":
      return cmdA2A(rest);
    case "chat":
      return cmdChat(rest);
    case "persona":
      return cmdPersona(rest);
    case "eval":
      return cmdEval(rest);

    case "update":
      return cmdUpdate(rest);

    case "erase":
      return cmdErase(rest);

    case "guard":
      return cmdGuard(rest);

    case "autonomy":
      return cmdAutonomy(rest);

    case "proposal":
      return cmdProposal(rest);

    case "stop":
      return cmdStop(rest);

    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;

    default:
      console.error(`ohmyagi: unknown command ${JSON.stringify(command)}`);
      console.error(USAGE);
      return 2;
  }
}

const code = await main(process.argv.slice(2));
// D-065: at most once a day, at a terminal, one line if a newer release exists.
// After the command, so it can never delay or change what the command did.
await autoCheck(process.argv.slice(2));
process.exitCode = code;
