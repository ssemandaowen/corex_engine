---
name: symbol-and-data-integrity
description: Symbol & Data Integrity
---


## Symbol formatting
Trading symbols/pairs have previously broken through formatting bugs in the pipeline (e.g. a
slash-formatting bug corrupting a pair and causing 404s from a market data provider). Any code that
builds, parses, or forwards a symbol string must:
- Be explicit about the expected format at each boundary (internal `runtimeId` format vs. a
  specific provider's expected format).
- Never assume every provider or broker shares one symbol format — normalize at the adapter/wrapper
  boundary (see `04-market-data-provider-abstraction.md`), not deep in shared logic.

## Data validation
- Analytics and dashboards must reflect real pipeline data. If a broadcast/data gap would otherwise
  show a blank or stale UI, surface that clearly — never substitute synthetic values (see
  `07-websocket-realtime-conventions.md`).
- When debugging a data-looks-wrong report, first check the symbol/format pipeline and the
  broadcast-event coverage before assuming a deeper logic bug.



