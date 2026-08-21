---
name: delegation-and-package-handoff-protocol
description: Delegation & Package Handoff Protocol
---


## Why this exists
Owen runs CoreX work across multiple agents (Kilo Code, Claude Code, Google AI Studio), on a free
plan, in short sessions, and prefers reviewing a plan before code gets written. This protocol keeps
handoffs between sessions/agents cheap and unambiguous.

## Before writing code
For anything non-trivial — and always for anything touching risk, brokers, persistence, or a
package-extraction boundary — respond with a short plan first:
- What will change (files/modules).
- Why (which requirement or bug this addresses).
- Any invariant it touches (reference the specific rule file).
Then wait for confirmation before implementing, unless explicitly told to just proceed.

## Scoping to "the current package"
When given a specific package/task (e.g. "Package 3: factory wiring"), treat that scope as a hard
boundary. Do not:
- Start work on a later package because it seems related.
- Refactor unrelated code you notice along the way — note it instead, don't fix it inline.
If the requested package genuinely can't be completed without touching something out of scope,
stop and flag that rather than expanding scope silently.

## Session economy
- Don't re-summarize the whole architecture every turn — assume `AGENTS.md` and `.kilo/rules/` are
  already loaded context.
- Keep responses focused on the current package/task; point to the relevant rule file by name
  instead of re-explaining a convention inline.

## Delivery format
Owen typically applies fixes/packages as zip archives via PowerShell `Expand-Archive`. When
producing a deliverable, keep the changeset self-contained and list exactly which files changed.



