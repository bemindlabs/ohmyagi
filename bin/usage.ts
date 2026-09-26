/**
 * The help text, which is most of what a first-time reader of this CLI reads.
 *
 * Its own file because it is 250 lines of prose interpolating a dozen values
 * out of `src/`, and because it is the one thing every new command has to
 * touch — keeping it beside one command's code would have made that command's
 * file the shared one instead.
 */

import { DAGI_DIR } from "../src/agent/index.ts";
import { AUTONOMY_FILE, AUTONOMY_MAX_ENV, STOP_FILE } from "../src/decide/index.ts";
import { PHASE_A_BACKENDS } from "../src/exec/index.ts";
import { SUMMARY_PATH } from "../src/observer/index.ts";
import { DEFAULT_RUNS, LEVEL_LEGEND, PERSON_FILE, ROLE_FILE } from "../src/soul/index.ts";
import { VERSION } from "../src/version.ts";

export const USAGE = `ohmyagi ${VERSION} — build AGI agents you actually own

Usage:
  ohmyagi version                       Print the version
  ohmyagi backends                      What this machine can reach, and how identity lands
  ohmyagi doctor [--model a,b] [--backend a,b] [--home <dir>] [--no-version]
                [--agent <dir> --subject <id>] [--ollama <url>] [--qdrant <url>] [--json]
                                        What is installed, missing or stale —
                                        the CLIs and whether the registry's
                                        reading of each is still current, the
                                        local model route, free VRAM, the vector
                                        store, and which identity is worn.
                                        om-agi writes nothing; \`--version\`
                                        starts six other programs, which write
                                        their own caches. \`--no-version\` skips
                                        those probes and the drift check with
                                        them. Exit 1 only when the local route
                                        is broken.
  ohmyagi setup [--no-turn]              First run, one question at a time:
                                        checks this machine, creates an agent,
                                        describes its soul, runs a first turn.
                                        Raises no autonomy and enables nothing.
  ohmyagi new <name> --subject <id> [--dir <parent>]
                                        Create an agent repository: soul,
                                        memory, consent, and a .gitignore with
                                        one line in it. Runs \`git init\` and
                                        stops there — no commit, no remote.
  ohmyagi rebuild <dir> --subject <id> [--check]
                                        Rebuild <dir>/${DAGI_DIR} from what git holds.
                                        --check reports fresh, stale or missing
                                        and writes nothing.
  ohmyagi soul check <dir> --subject <id>
                                        Validate the soul in <dir> — a soul directory or an agent repository (D-033) — with line numbers
  ohmyagi soul import <agent-dir> --subject <id> --map <file> --out <dir>
                                        Convert a bwoc agent directory into a soul
  ohmyagi soul edit <dir> --subject <id> (--profile <file.json> [--yes] | --print)
                                        The soul from a flat JSON profile (what
                                        the web Profile wizard sends): says which
                                        fields change, writes only with --yes, and
                                        only a soul that still loads.
  ohmyagi soul apply <dir> --subject <id> [--backend a,b] [--apply]
                                        Render an identity into each backend.
                                        Prints a diff and writes nothing unless
                                        you pass --apply.
  ohmyagi worn [--backend a,b] [--home <dir>] [--subject <id>] [--json]
                                        Which identity this machine is wearing,
                                        read out of each backend's instruction
                                        file. Exit 0 when exactly one is worn,
                                        intact, everywhere om-agi looked — and
                                        when it is the one you named, if you
                                        named one.
  ohmyagi soul verify <dir> --subject <id> [--backend a,b] [--home <dir>]
                     [--model <m>] [--runs N] [--json]
                                        Ask each backend three questions only
                                        this soul can answer, and report what
                                        came back. Writes nothing.
  ohmyagi soul revoke --subject <id> [--backend a,b] [--apply]
                                        Take om-agi's block out of every file
                                        soul apply wrote — back byte for byte
                                        to what it was before the first apply,
                                        or removed if apply created it. Dry run
                                        without --apply; all or nothing.
  ohmyagi soul card <dir> --subject <id> [--url <base-url>]
                                        Print the A2A 1.0.0 Agent Card this soul
                                        would publish — from role.md only, and
                                        saying it is an AI. Nothing is served:
                                        A2A stays off until the egress filter
                                        (S8.3) exists.
  ohmyagi turn <dir> --subject <id> (--prompt <text> | --prompt-file <path>)
             [--backend a,b,c] [--model <m>] [--private] [--proposal <id>]
             [--no-recall] [--recall-chars <n>] [--json]
                                        Run one turn wearing this soul. Tries
                                        each backend in order until one really
                                        answers. Records one ledger line per
                                        backend that was actually handed the
                                        prompt. --proposal spends an approved
                                        proposal on this turn: a pending or
                                        refused one stops it (exit 4), and the
                                        approval is spent before the prompt
                                        goes, so a second turn needs a second
                                        approval.
                                        Recall: pieces of memory/ related to
                                        the prompt ride along beside the soul,
                                        whole or not at all, up to 4500
                                        characters (--recall-chars), each named
                                        on stderr before the prompt goes. The
                                        prompt itself is sent as typed.
                                        At autonomy level 1 the model is told
                                        to propose rather than act, and each
                                        om-agi-proposal block it writes is
                                        filed as a proposal (filed by the
                                        agent); one already refused is not
                                        filed again.
  ohmyagi ledger show --subject <id> [--since <iso>] [--until <iso>]
                     [--content] [--json]
                                        What this subject's turns were, when,
                                        and which backend received them.
                                        Metadata only unless --content.
  ohmyagi ledger forget --subject <id> (--id <id> | --before <iso> | --all)
                       [--yes]
                                        Withdraw ledger lines. Prints what
                                        would go, who already received it, and
                                        what deletion cannot reach; writes
                                        nothing unless you pass --yes.
  ohmyagi observe status --subject <id>  Where this subject's raw capture lives,
                                        whether capture is on, how much of it
                                        there is, and what a purge cannot
                                        reach. Writes nothing and creates
                                        nothing.
  ohmyagi observe enable --subject <id> [--scope capture|seed]
                                        Turn capture on. Prints exactly what is
                                        kept and what is not, then waits for
                                        the phrase \`capture <id>\` at a
                                        terminal. There is deliberately no
                                        --yes. Nothing is written if you say no.
  ohmyagi observe disable --subject <id> Withdraw consent and stop recording.
                                        Deletes nothing.
  ohmyagi observe hook --print --subject <id>
                                        Print the settings snippet that would
                                        connect the capture hook. om-agi never
                                        writes another program's config; the
                                        snippet is yours to use or not.
  ohmyagi observe capture --subject <id> [--from claude-hook]
                                        Read one hook event from stdin and
                                        record it. Prints nothing on stdout and
                                        always exits 0 — it is running inside
                                        your session and will not interfere
                                        with it.
  ohmyagi observe seed --subject <id> --vendor claude|grok --root <dir> [--again]
                                        Import the history that is already on
                                        disk, once. Needs its own consent, and
                                        refuses a second run without --again,
                                        which prints why repeating it is a
                                        backfill.
  ohmyagi observe actions --subject <id> [--write <agent-dir>] [--json]
                                        What was done, as counts per month over
                                        closed lists of words: kind, outcome,
                                        origin, vendor, and tool or program
                                        names only from a built-in list. Reads
                                        and prints; \`--write\` puts
                                        ${SUMMARY_PATH} in that
                                        repository and says first what a commit
                                        cannot undo. Never stages, never commits.
  ohmyagi observe audit --vendor claude|grok --root <dir>
                                        Show what om-agi derived beside the
                                        transcript line it came from, twenty
                                        files at random, and take y/n per field.
                                        This is S3.2 AC4's instrument: it needs a
                                        terminal, has no --yes, and stores
                                        nothing.
  ohmyagi observe patterns --subject <id> [--limit <n>]
                                        Routines and sequences in what you set
                                        going, with the evidence for each, and
                                        triggers.md snippets for timed ones.
                                        Recomputed each run; nothing is kept.
  ohmyagi observe interests --subject <id> --root <dir> [--half-life <days>] [--limit <n>]
                                        Your projects ranked by how much and how
                                        recently you worked in them. Counts only;
                                        nothing is kept.
  ohmyagi observe leaks --subject <id> --fleet-dir <dir> [--fleet-dir <dir>...]
                                        Count records in the subject that ran in
                                        a directory a fleet launcher uses — a
                                        launcher that forgot OM_AGI_FLEET.
                                        Counts under the names you give, prints
                                        no other path, exits 1 if any is above 0.
  ohmyagi observe purge --subject <id> [--dry-run]
                                        Delete every byte of it, then count the
                                        directory again and print what is left.
                                        Exit 1 if that count is not zero.
  ohmyagi memory index <agent-dir> --subject <id>
                                        Build recall from memory/ in the agent
                                        repository: a full-text index in
                                        .dagi/index/ (always) and the subject's
                                        own Qdrant collection (when bge-m3 and
                                        Qdrant answer on loopback). Says first
                                        what dropping the collection cannot
                                        reach.
  ohmyagi memory ingest <agent-dir> --from <dir> [--name <name>] [--yes]
                                        Copy the top-level .md files of <dir>
                                        into memory/imported/<name>/, after the
                                        repo guard's scanner: a file it flags is
                                        not copied, and is named without what
                                        matched. A mirror — files gone from
                                        <dir> go here too. Plan only without
                                        --yes; never stages or commits.
  ohmyagi memory forget <agent-dir> --subject <id> (--file <memory/…> | --match <text>) [--yes]
                                        Forget whole files under memory/: they
                                        go, the subject's collection is dropped
                                        whole and rebuilt from what is left,
                                        and the needle is looked for again.
                                        Refuses before removing anything if the
                                        store it wrote to cannot be reached.
  ohmyagi memory write <agent-dir> --subject <id> --file <memory/…md> --from <file> [--yes]
                                        Create or replace one memory file — what
                                        the web editor saves. Needs a basis for
                                        memory; the credential scan applies;
                                        --yes writes and rebuilds both indexes.
  ohmyagi memory import <agent-dir> --subject <id> (--from <file> | --url <link>) [--name <file name>] [--as <memory/…md>] [--yes]
                                        A document or a web page into memory as
                                        markdown: md, txt, html, pdf, docx, and
                                        what LibreOffice opens. Shows where it
                                        goes; --yes writes it (long ones in
                                        parts) through the same gates as write.
  ohmyagi memory search <agent-dir> --subject <id> [--limit <n>] <query...>
                                        Ask both indexes and merge the answers;
                                        every hit says which index found it.
  ohmyagi egress needles --subject <id>
                                        Where the list of what must not leave
                                        this machine lives (personal, outside
                                        git), and how many it holds.
  ohmyagi egress check --subject <id> <text...>
                                        Screen a text the way a turn does: the
                                        needles, and emails, Thai phones and
                                        IDs, card numbers, credentials. Exit 1
                                        if it would be kept in.
  ohmyagi egress log --subject <id>     What was kept in, when, going where,
                                        by which rule — never the text.
  ohmyagi erase <subject> (--agent <dir> | --no-agent) --by <text>
               [--personal] [--needle <text>]... [--out <file>] [--json] [--yes]
                                        Remove one subject from every place
                                        om-agi has a deleter for, count what is
                                        left from disk, search for the
                                        identifier afterwards, and print a
                                        certificate. Writes nothing without
                                        --yes. Exit 1 when anything is left, or
                                        when a place has data om-agi cannot
                                        delete. Exit 3 for \`nothing-found\`:
                                        nothing of this subject was here, so
                                        nothing was erased and the document is
                                        not a certificate of erasure. om-agi
                                        cannot tell that from "an earlier run
                                        erased it", and says so. With --json,
                                        stdout is the certificate and nothing
                                        else; the plan, the five places and what
                                        is not searched all go to stderr, so
                                        \`erase … --json | jq\` reads a document
                                        and \`2>&1 | jq\` does not. Keep the two
                                        streams apart.
  ohmyagi guard install [<dir>]         Write the pre-commit and pre-push hooks
                                        into <dir>. \`new\` already did this for
                                        the repository it made; a fresh clone
                                        needs it, because git does not clone
                                        .git/hooks.
  ohmyagi guard scan --staged [<dir>]   Scan what is staged in <dir> and exit 1
                                        on a finding. This is what the
                                        pre-commit hook runs.
  ohmyagi guard status [<dir>]          Are the hooks there, how many commits
                                        already exist, which remotes are
                                        configured — and everything this guard
                                        does not cover. Exit 1 if a hook is
                                        missing.
  ohmyagi autonomy show [<dir> --subject <id>]
                                        What a turn of this agent may do, per
                                        category, with every number that was set
                                        beside the number in force. **Read the
                                        direction carefully: level 1 is the
                                        default and is what om-agi has always
                                        done — every vendor's read-only flag on
                                        every turn. 2 and 3 are what take that
                                        flag off.** Without a directory it shows
                                        the machine's half only: the brake and
                                        the ceiling.
  ohmyagi autonomy set <read|write|run|reach> <0-3> <dir> --subject <id>
                                        Write one category into <dir>/${AUTONOMY_FILE}.
                                        Level 3 has to be typed at a terminal
                                        and there is no --yes; who set it and
                                        when are recorded in the file. Says at
                                        the moment of setting what the number
                                        will actually do — including when the
                                        minimum makes it do nothing, and which
                                        backends will be refused rather than run.
  ohmyagi autonomy resume               Take the brake off. Asks for a phrase at
                                        a terminal; \`rm\` works too and om-agi
                                        says so.
  ohmyagi proposal new <dir> --subject <id>
                      (--what <text> --why <text> --impact <text> | --from <path|->)
                      [--changed <text>]
                                        File what would be done, why, and what it
                                        affects. Refused with exit 5 if this
                                        subject has already been refused the same
                                        \`what\`, or has one pending — unless
                                        --changed says what is new, which is
                                        recorded against the old proposal. The
                                        new id is the whole of stdout; everything
                                        for a person is on stderr. --from reads
                                        the three fields as JSON from a file or
                                        from standard input, which keeps them out
                                        of shell history and \`ps\` the way
                                        --prompt-file does.
  ohmyagi proposal decide <proposal-id> <dir> --subject <id> (--approve | --refuse)
                         [--note <text>]
                                        Answer one, recording who and when. A
                                        decision is written once and never edited
                                        in place. An approval is good for exactly
                                        one turn.
  ohmyagi proposal list <dir> --subject <id> [--json]
                                        Every proposal for this subject, newest
                                        first, with where they are kept.
  ohmyagi proposal show <proposal-id> <dir> --subject <id>
                                        One proposal in full, for a person about
                                        to decide it: the key it is compared by,
                                        whether its approval has been spent, and
                                        this subject's refusals. There is no
                                        --json — \`proposal list --json\` already
                                        holds every record, and two JSON shapes
                                        for one record is one too many.
  ohmyagi proposal triage (<proposal-id> | --pending) <dir> --subject <id>
                                        Ask TypeSafe's Jev what kind of action a
                                        proposal is, whether it can be undone
                                        and whether it touches private data.
                                        Opt-in, advisory, approves nothing; the
                                        text is screened first. Needs
                                        TYPESAFE_API_KEY. OM_AGI_TRIAGE=jev does
                                        it on every filing.
  ohmyagi stop [<dir> --subject <id>]   Stop everything, in a fixed order: set
                                        the brake, take every category to 0, end
                                        the turns that are running. Prints what
                                        it could not reach and the exact command
                                        for each. Exit 1 if anything survived.
  ohmyagi triggers show <dir> --subject <id>
                                        The schedules in triggers.md, when each
                                        last fired and when it is next due.
  ohmyagi triggers tick <dir> --subject <id> [--backend a,b] [--model <m>]
                                        Run what is due, each as a turn held at
                                        level 1 — it proposes, never acts — then
                                        exit. Nothing runs under the brake.
  ohmyagi triggers schedule <dir> --subject <id> [--every <5m>]
                                        Print a systemd timer and a cron line
                                        that call tick. Installs nothing.
  ohmyagi web <dir> --subject <id> [--port <n>] [--host <addr>] [--name <host,…>] [--https] [--key-file <path>]
                                        A page for one agent in your browser:
                                        what it may do, what waits for your
                                        yes or no, a chat, and the brake. Every
                                        button runs a command; level 3, consent,
                                        releasing the brake and erase stay in
                                        the terminal. Loopback, with a link key.
                                        On a tailnet address it also answers to
                                        this machine's tailnet names; --name
                                        adds others. --https: behind
                                        tailscale serve, on loopback.
                                        --key-file keeps the link across
                                        restarts (made once, 600).
  ohmyagi a2a peers --subject <id>        Who this agent may talk to, both ways.
  ohmyagi a2a allow <name> --endpoint <url> --subject <id> [--send-token-file <path>]
                                        Allow a peer: typed at a terminal, never
                                        by a flag. Prints the token it sends with.
  ohmyagi a2a remove <name> --subject <id>
                                        Take a peer away.
  ohmyagi a2a serve <dir> --subject <id> [--port <n>] [--host <addr>]
                                        Listen for allowed peers (loopback) and
                                        serve the agent card. What arrives goes
                                        to the ledger and the inbox; none is run.
  ohmyagi a2a send <dir> --subject <id> --to <name> --text <message>
                                        Send one message to a peer, screened
                                        like a turn; kept in means not sent.
  ohmyagi a2a inbox --subject <id>      What peers have sent.
  ohmyagi persona extract <dir> --subject <id> --from <path,…> [--model <m>] [--max-chunks <n>]
                                        Draft a soul from real artifacts with a
                                        model on this machine. Every claim must
                                        quote its source; one whose quote is not
                                        there is cut. Kept in personal/.
  ohmyagi persona review <dir> --subject <id> [--draft <id>]
                                        Answer yes or no to each claim, at a
                                        terminal.
  ohmyagi persona show --subject <id> [--draft <id>] [--json]
                                        The draft and what was decided.
  ohmyagi persona decide <claim-id> --subject <id> (--yes | --no) [--draft <id>]
                                        One answer — what the web page's review
                                        sends.
  ohmyagi persona adopt <dir> --subject <id> [--draft <id>] [--yes]
                                        Write only the yeses into role.md and
                                        person.md; the soul must still load.
  ohmyagi eval <dir> --subject <id> [--set <file>] [--only <id,…>] [--backend <b>] [--model <m>] [--json]
                                        Run the job's task set (evals.md, at
                                        least 20 real tasks) with the soul alone
                                        and with recall, grade each answer by
                                        its phrases, and say which kinds of work
                                        it cannot do yet. Turns held at level 1.
  ohmyagi basis record <owner|consent|contract|legitimate-interest|legal-obligation> --subject <id> --uses <memory,persona,fine-tune> [--expires YYYY-MM-DD|never] [--approved-by <name>] [--note <text>]
                                        Record on what basis a subject's data
                                        may come in, and for which uses — typed
                                        at a terminal. memory ingest and persona
                                        extract read nothing without one (S7.3).
  ohmyagi basis show --subject <id>      The records, active, expired or revoked.
  ohmyagi basis revoke <record-id> --subject <id>
                                        Stop what comes in next on it.
  ohmyagi chat users --subject <id>       Who the agent answers in chat apps.
  ohmyagi chat allow <platform> <user-id> --subject <id> [--label <name>]
                                        Let one person be answered: typed at a
                                        terminal, never by a flag.
  ohmyagi chat remove <platform> <user-id> --subject <id>
                                        Stop answering them.
  ohmyagi chat serve <dir> --subject <id> --token-file <path> [--platform telegram] [--once]
                                        Answer allowed people on Telegram. Each
                                        answer is a level-1 turn, screened by the
                                        filter and the local judge; it says it is
                                        an AI first; anyone else gets nothing.
  ohmyagi update [--check] [--yes]       Is there a newer release? --check only
                                        asks; without --yes it says what it would
                                        replace; --yes installs this machine's
                                        build after checking its SHA256SUMS.
                                        Once a day, at a terminal, commands also
                                        check by themselves and say so in one
                                        line (OM_AGI_NO_UPDATE_CHECK=1 stops it).
  ohmyagi help                          This message

A soul is two files — ${ROLE_FILE} (role knowledge) and ${PERSON_FILE} (personal
traits) — so that one can be deleted without the other.

\`--as <dir>\` goes before the command and fills in \`<dir> --subject <id>\` for
\`soul check\`, \`soul apply\`, \`soul verify\`, \`turn\` and \`worn\`. It takes the
directory of a soul or of an agent, never a name: om-agi keeps no registry of
agents, and the subject is read out of ${ROLE_FILE} and checked against
${PERSON_FILE} rather than taken from the directory. \`--as\` together with
\`--subject\`, or with a directory argument, is refused — two answers to one
question is how the wrong identity gets applied.

om-agi wears an identity; it does not have one (D-011). Nothing stores which one
is on, so \`worn\` derives it from the markers in the files themselves and is
right about a file something else edited a second ago. Two subjects with blocks
on the same machine is reported as a switch that did not finish, not as an
average.

An agent is a git repository. Everything git holds there is Markdown a human can
read with om-agi uninstalled; everything under ${DAGI_DIR}/ is derived, and deleting
it is always safe (I-2). Data flagged personal belongs in neither — it lives
outside the repository entirely (D-014). om-agi never commits and never pushes.

That last sentence is a claim about om-agi's own code, and it is the only shape
of it that can be proven: \`git\` is reachable from here through one allowlist of
local verbs, and no path in this program reaches a remote. It is *not* a claim
that a push cannot happen on this machine. A vendor CLI om-agi spawns for a turn
has its own shell tool and can push from inside its own process; \`--no-verify\`
skips the hooks; and a clone arrives with no hooks at all. \`ohmyagi guard status\`
prints the full list rather than letting the short sentence stand alone.

\`soul apply\` writes into a delimited block and never touches a byte outside it.
Originals are copied under \$XDG_STATE_HOME/om-agi/backups/ before every write,
and the command to restore each one is printed. Backends: ${PHASE_A_BACKENDS.join(", ")}.
Text written into a cloud CLI's instruction file is uploaded on every turn it takes.

\`soul verify\` spends a real turn on every backend it measures, three questions
at a time, ${DEFAULT_RUNS} times over. It reports four levels — ${Object.keys(LEVEL_LEGEND).join(" / ")} —
and never collapses them into pass/fail.

\`turn\` prints the answer on stdout and the route it took on stderr, so a pipe
gets the answer and a human gets to see which backend was reached. The default
chain is ${PHASE_A_BACKENDS.join(" → ")}, which sends the soul and the prompt to a cloud
CLI first when one is installed; \`--backend ollama\` is the local-only route.
A backend that exits 0 having printed nothing counts as a miss, not an answer.

\`--prompt <text>\` puts the prompt on this process's command line, where shell
history, \`ps\` and terminal scrollback can all see it — and \`ledger forget\`
cannot reach any of them. \`--prompt-file <path>\` reads it from a file instead,
and \`--prompt-file -\` from standard input, which is the safer of the two ways
to ask something you would not want kept.

The ledger lives under \$XDG_STATE_HOME/om-agi/ledger/<subject>/, one JSONL file
per month, readable with \`jq\` and deletable with \`rm\`. One line is written for
each backend that was really handed the prompt, so a chain that fell through
writes more than one. Nothing om-agi does reads it back into a prompt, and
deleting the whole tree changes no agent's behaviour. \`--private\` records the
turn without its text — no prompt, no answer, and no hash of either, because a
short prompt is guessable from its hash.

Each line records what the turn used in **tokens the backend itself printed** —
never money. A vendor's own price is an API list price a subscription holder
does not pay, and a local model's would be 0, which claims electricity is free.
\`unreported\` means om-agi has not surveyed that backend; \`missing\` means one
that usually prints a count did not, which is how a vendor changing its output
shape looks from here.

Raw observer capture lives under \$XDG_DATA_HOME/om-agi/<subject>/personal/observer/,
and nowhere else (D-025). It is personal by default: it records what the owner did,
nothing can rebuild it, so \`.dagi/\` — which a rebuild sweeps — would lose it and
git — which remembers what it is asked to forget — must not have it. Nothing
reachable from that code can open a socket or start a process, which is a claim
about om-agi's own code and not about this machine: a vendor CLI running as you
can read those files and has tools of its own. \`observe purge\` counts the
directory again after deleting and exits 1 if anything is left.

What may enter git out of that capture is one thing only: **integers, keyed by
words om-agi holds in its own source** — the month, the kind, the outcome, the
origin, the vendor, and tool or program names from a built-in list. A path, a
project directory, a session id, an instant, or the name of an MCP server never
does, and that is by construction rather than by filtering: the keys are built
from those lists and looked up, so no string out of a record can become one.
Anything not on a list is counted as \`other\`. The reason is that what enters git
cannot be taken back out, so what enters git must not identify anybody in the
first place. Per-action rows stay in the personal store, where \`observe purge\`
and \`erase\` can delete them.

\`erase\` is AC1's five places and two statuses. soul, observer data, the RAG
collection and the ledger have deleters here; a LoRA adapter (S6.3) does not
exist in this program at all, and the output says "4 of 4 places that exist
were visited · 1 of 5 are not built" rather than a 5 nobody checked. If anything
turns up at the address D-014 reserves for the adapter, erase exits 1 and
issues no certificate: it will not certify a deletion over a directory nothing
in this repository claims. The RAG collection is dropped whole on a loopback
Qdrant; if om-agi wrote one and cannot reach the store, erase refuses too.

An identity lives in three places, not one — the repository, om-agi's block
inside every vendor instruction file \`soul apply\` wrote to, and the backups
taken before those writes, which contain the blocks written by earlier runs.
All three go. What is *searched* afterwards is the whole state root, the whole
data root, those instruction files and the agent's working tree minus .git;
what is not searched is printed every run, vendor transcripts and git objects
first. That search is coarse for text without word boundaries and says so.

\`doctor\` answers "is this machine ready?" and nothing wider. It never spends a
turn: the CLIs are checked with \`--version\`, which is also how it reports
**drift** — a vendor whose installed release is not the one \`src/exec/registry.ts\`
was measured against, because those differences move between releases and the
failures they cause are silent. Its "which identity is on" half is \`worn\`, called
rather than re-answered. Exit 1 is the local route only: a missing commercial CLI
is a machine with fewer hands, not a broken one (I-1).

The autonomy dial (\`${AUTONOMY_FILE}\`, beside the soul, in git) points the opposite
way to its name. Every vendor's read-only flag has gone onto every turn om-agi
starts since long before the dial existed, so **level 1 — the default in every
category — is what om-agi has always done**, and levels 2 and 3 are the new
thing: at 2 that flag is not sent, and the turn may write files and run commands.
A turn runs at \`min(write, run, reach)\`, never the maximum, so raising one
category alone changes nothing — which \`autonomy set\` tells you as you set it
rather than letting you find out later. \`reach\` cannot be set to 3 at all (I-6).
\`${AUTONOMY_MAX_ENV}\` is a ceiling and never a floor: nothing anywhere in om-agi
raises a level, because a variable that could would be one an agent running as
you could export for itself.

At level 1 a turn that lands on a vendor with no read-only mechanism is
**refused**, not run and hoped over. There is exactly one such vendor and
\`ohmyagi backends\` names it; running there means raising write, run and reach to
2 together, which is a sentence somebody has to mean.

Proposals live in a store of their own, outside git and outside the ledger:
\$XDG_DATA_HOME/om-agi/<subject>/personal/proposals/, one JSON file each. Outside
git because what/why/impact are free text about what you do (D-014); outside the
ledger because a refusal has to be read back into the next decision and the
ledger is the one record nothing may read back (D-022, D-029). Deleting this
store is allowed to change something — the agent forgets it was told no, which is
the whole of what it is for, and \`rm\` on one file forgets one refusal.

"The same thing" is compared **exactly**: the text of \`what\`, normalised, with
whitespace collapsed and case ignored, and nothing else. Reword one sentence and
it is a new proposal to om-agi. That is why every run of \`proposal new\`,
\`decide\` and \`show\` prints this subject's refusals in full, unfiltered — the
wider comparison is yours to make, and a program that guessed which ones were
similar enough to show you would be the loose comparison again, hidden.

Not built, and said rather than implied: om-agi does not turn an agent's own
actions into proposals, and cannot at present — it borrows vendor CLIs (D-002)
and sees a turn's output and exit code, never the tool calls inside it. The
caller of \`proposal new\` is a person or the script driving \`turn\`.

The brake is a file: \`\$XDG_STATE_HOME/om-agi/${STOP_FILE}\`. Its contents are never read,
so \`touch\` sets it and \`rm\` clears it, and neither needs om-agi to be working —
which is the point, because \`ohmyagi stop\` does. It is deliberately not in git: a
committed brake would travel to every clone and stop machines nobody stopped.
\`ohmyagi stop\` also ends running turns, and it will not signal a process it cannot
identify: a pid is reused, so a record whose process start time no longer matches
is reported and left alone, with the command printed for you to run once you have
looked. **Ctrl-C is not a substitute** — measured 2026-09-22, a child started as a
shell background job ignores SIGINT by POSIX default and survived a group SIGINT
that a group SIGTERM killed.

Not built yet (see .scrum/backlog.md):
  ohmyagi run <name>          Act on its own, on a trigger it chose  [S5.3]
`;
