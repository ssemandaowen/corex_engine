---
name: market-data-provider-abstraction
description: Market Data Provider Abstraction (active work)
---


## Context
CoreX is mid-refactor: moving the market data portal away from a hard-wired TwelveData dependency
toward a universal multi-provider architecture, mirroring the existing broker
Contract/Factory pattern (see `03-broker-plugin-pattern.md`). This work is broken into discrete
packages delegated to agents one at a time.

## Target shape (mirror the broker pattern exactly)
- A `MarketDataContract` (or equivalently named) interface every provider wrapper must satisfy.
- A base wrapper class for shared concerns (rate limiting, retry/backoff, symbol normalization).
- A factory that resolves "which provider backs this request" — never a hard import of a specific
  provider SDK from consuming code.
- TwelveData becomes just one implementation of the contract, not the assumed default.

## Package discipline
- Work through this refactor **one package at a time**, in the order Owen specifies (contract →
  provider wrapper → factory wiring → consumer migration). Do not jump ahead to a later package
  even if it looks like a natural next step.
- Each package should be independently testable/verifiable before the next one starts.
- Reference prior completed packages (contract, TwelveData wrapper) for naming/style consistency —
  don't introduce a divergent pattern for a new provider.

## Symbol handling
Symbol strings have previously broken through slash-formatting bugs (e.g. corrupted pairs, 404s
from a provider). Any code that formats, parses, or forwards a symbol string to a provider must be
explicit about the expected format per provider and must not assume all providers share one format.



