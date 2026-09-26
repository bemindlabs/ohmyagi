# Security policy

Oh My AGI holds things that matter: an agent's memory, the personal data of the person it inherits from, the
tokens it talks to other agents and chat apps with, and a kill switch. A hole in any of those is a security bug.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub:
[**Security → Report a vulnerability**](https://github.com/bemindlabs/ohmyagi/security/advisories/new)
on `bemindlabs/ohmyagi`. Only the maintainers see it.

Useful to include: the version (`ohmyagi --version`), the platform, the command or page involved, what you
expected, what happened, and the smallest steps that show it. Please leave real personal data and real tokens out
of the report — a made-up one shows the same thing.

We aim to answer within 7 days, to agree on a fix and a date with you, and to credit you in the release notes
unless you would rather not be named.

## What counts

Anything that breaks one of the six principles in the [README](README.md#six-things-it-will-never-trade-for-speed)
is in scope. For example:

- personal data leaving the machine without a human's approval for that instance (the egress filter, the local
  judge, the chat and A2A connectors)
- one agent's memory or personal data reaching another agent's context
- the autonomy dial or the kill switch being raised or bypassed by anything other than the person at a terminal
- `ohmyagi erase` or `memory forget` claiming to have removed something it did not
- the web console (`ohmyagi web`) being reachable without its key, answering a host it should refuse, or running
  something its buttons do not
- a credential getting past the staged-file scan into an agent's repository or memory

Not in scope: what a vendor CLI (Claude Code, Codex, …) does on its own once Oh My AGI has started it — report
those to that vendor — and anything that needs someone who already controls your user account.

## Supported versions

Oh My AGI is a 0.x. Only the newest release gets fixes; `ohmyagi update` installs it.
