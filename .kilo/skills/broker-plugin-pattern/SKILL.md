---
name: broker-plugin-pattern
description: Broker Plugin Architecture
---


## The pattern
- `BrokerContract` — the interface/abstract shape every broker must satisfy.
- `BaseBroker` — shared base implementation (retries, logging, lifecycle hooks).
- `RuntimeBrokerFactory` — the only place that instantiates a concrete broker for a given
  `runtimeId` + mode.

## Rules
- New broker integrations implement `BrokerContract` and extend `BaseBroker` — never call a
  provider SDK directly from strategy/engine code.
- `RuntimeBrokerFactory` is the single source of truth for "which broker instance backs this
  runtime." Don't add a second construction path.
- Broker injection must never leave `executionContext` empty — this has been a real bug in CoreX;
  when touching broker injection, explicitly verify `executionContext` is populated before signals
  can execute.
- Keep broker-mode logic (Backtest/Paper/Live) inside the broker implementations themselves, not
  scattered through the signal engine.



