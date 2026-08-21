---
name: project-overview
description: CoreX Project Overview
---


## What CoreX is
A full-stack algorithmic trading platform. Backend: Node.js/Express. Frontend: React/TypeScript.
DB: PostgreSQL. Real-time: WebSocket only. Repo: `corex-engine` (Apex Trait Ltd).

## Three broker modes
Every runtime operates in exactly one of:
- **Backtest** — historical replay, capped at 5000 candles globally (enforced at three separate
  gates — do not remove or relax any gate without flagging it).
- **Paper** — simulated live execution against real-time data.
- **Live** — real broker execution.

## `runtimeId` scoping
Every strategy runtime is identified by the composite key:
`userId::strategyName::symbol::mode`
Any code that stores, looks up, or broadcasts runtime state must scope by the full `runtimeId`, not
just strategy name or symbol alone — partial scoping has caused cross-runtime bugs before.

## When you're unsure which mode/runtime you're in
Ask, or trace the `runtimeId` back to its origin, before writing logic that behaves differently per
mode. Silent mode-specific branching that isn't explicit is a common source of Backtest-only bugs
leaking into Paper/Live.



