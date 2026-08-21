---
name: risk-management-safety
description: Risk Management — Single Enforcement Path
---


## The decision (already made — follow it, don't relitigate it)
`utils/riskManager.js` has been deleted. All risk-check logic is consolidated into
`SignalProcessingEngine` as the **single** enforcement path. Do not:
- Reintroduce a separate risk manager module.
- Add a second place where risk checks run "just to be safe" — duplicated enforcement paths are
  exactly what caused prior bugs (e.g. SL/TP not firing due to a casing bug that only one path
  checked correctly).

## Sequencing
Config limits are layered hard/soft. The agreed sequencing is: formalize the hard/soft config limit
layering first, then apply that layering to risk enforcement. Don't build new risk-enforcement
logic against config limits that haven't been formalized yet — flag it and ask instead.

## Backtest cap
The 5000-candle global backtest cap is enforced at three separate gates. If you find or touch one
of these gates, check whether the other two still agree with it — don't fix one gate in isolation.

## Any change touching risk/signal execution
Treat this as high-stakes: propose the change and get confirmation before writing code (see
`15-delegation-and-package-handoff-protocol.md`). This is exactly the kind of change the
`risk-auditor` custom agent (see `.kilo/agents/risk-auditor.md`) should review.



