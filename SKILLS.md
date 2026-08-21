# AGENTS.md — CoreX

Portable project baseline for any AGENTS.md-compatible agent (Kilo Code, GitHub Copilot Coding Agent, etc).
Kilo Code loads this automatically from the project root in addition to `.kilo/rules/*.md`.

## What this project is

CoreX is a full-stack algorithmic trading platform. Sole developer: Owen (Ssemanda Owen), building
toward two goals: personal income and funding an engineering degree. Public repo:
`github.com/ssemandaowen/corex_engine` (package name `corex-engine`, company "Apex Trait Ltd").

Stack: Node.js/Express backend, React/TypeScript frontend, PostgreSQL, WebSocket-based real-time
architecture (no polling, anywhere).

## Non-negotiable invariants

These hold across the entire codebase. Do not propose changes that violate them without flagging
the conflict explicitly and stopping for confirmation first.

1. **Server decides everything.** The frontend never makes trading/risk decisions locally — it
   renders server state.
2. **WebSocket-only real-time.** No polling loops, ever, for live data or state sync.
3. **Full state recoverability.** Any process restart must be able to reconstruct exact runtime
   state from the DB. Nothing important lives only in memory.
4. **Complete audit logging.** Every state-changing action (signal, order, risk decision, config
   change) must be traceable after the fact.
5. **Lazy, on-demand strategy loading.** Nothing compiles or loads at startup — strategies compile
   on first use and are cached (SHA256-keyed).

## Current priorities (check `.kilo/rules/` for detail on each)

- Market data provider abstraction: moving off a hard-wired TwelveData dependency to a universal
  multi-provider architecture, mirroring the existing broker Contract/Factory pattern. Work is
  broken into sequential packages delegated one at a time.
- Modularization: extracting the monolith into independently-verified npm workspace packages
  before refactoring the main engine to plug into them.
- Owen is a student sitting final exams through the rest of 2026 — CoreX work happens in short
  sessions (20–60 min), package-by-package. Do not assume a large continuous block of time or
  context carried silently from a prior session: restate what you're doing and why.

## Ground rules for any agent working here

- **Propose before you build.** Owen wants a plan/diff description reviewed before code is written,
  especially for anything touching risk, brokers, or state persistence. Default to a short plan,
  wait for confirmation, then implement.
- **Never invent data.** No placeholder/synthetic values presented as real (this project has been
  bitten by fake data in analytics before). If data isn't available, say so — don't fill the gap.
- **Package discipline.** When asked to do "Package N" of a larger plan, do only that package. Do
  not silently expand scope into adjacent packages.
- **Delivery format:** fixes and new packages are typically delivered as zip archives Owen extracts
  locally (`Expand-Archive` on PowerShell) — keep changesets self-contained and clearly listed.
- **Token/usage awareness:** Owen is on a free plan across multiple agents (Kilo Code, Claude Code,
  Google AI Studio). Be economical — don't re-read or re-explain files unnecessarily.

See `.kilo/skills/` for the detailed, topic-by-topic rule set (architecture, brokers, risk, DSL,
WebSocket, persistence, jobs, security, modularization, git workflow, coding standards, testing,
delegation protocol, data integrity).
