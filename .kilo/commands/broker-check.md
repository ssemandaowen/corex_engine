---
description: Run a structural check on a broker or market-data-provider integration
subtask: true
---

Run a structural check on a broker or market-data-provider integration.

Verify, in order:
1. It implements the relevant Contract (`BrokerContract` or the market-data equivalent) — no direct
   SDK calls bypassing the factory.
2. `RuntimeBrokerFactory` (or its market-data equivalent) is the only construction path.
3. `executionContext` cannot end up empty after injection.
4. Symbol formatting is normalized at this adapter's boundary, not assumed globally.
5. Credentials (if any) are read via the existing AES-encrypted credential path — never logged.
6. All three broker modes (Backtest/Paper/Live) are handled, or explicitly marked not-applicable.

Output a pass/fail checklist with file:line references for anything failing.

Arguments (`$ARGUMENTS`) may name the specific broker/provider to check, e.g. `/broker-check twelvedata`.
