# P1 — Runtime Identity Integration — Authenticated API → Worker → Runtime

**Status:** COMPLETE  
**Priority:** P1  
**Source:** Provider Integration Verification findings, `plans/reports/PROVIDER_INTEGRATION_VERIFICATION_RESULTS.md` §Phase 5  
**Repository:** `C:\Users\SBUM\Desktop\corex`  
**Branch:** Main (no new branch); all pre-existing uncommitted changes preserved

## Method

Exercised the full authenticated API → queue → worker → runtime binding path end-to-end:

1. Registered a disposable user via `POST /api/auth/register`
2. Signed in via `POST /api/auth/signin` to obtain a JWT
3. Created a strategy via `POST /api/strategies` (template declares `symbols: ["BTC/USD"]`)
4. Started strategy with `symbol: "BTC/USD"`, `mode: "PAPER"` via `POST /api/run/start/:id`
5. Started strategy with `symbol: "BTCUSD"`, `mode: "PAPER"` via `POST /api/run/start/:id`
6. Compared runtimeIds — **MATCH**
7. Stopped runtime(s) and deleted the test strategy (cleanup)
8. No LIVE execution; PAPER mode only; no pre-existing runtimes mutated

## Result

| Form | runtimeId | Match |
|---|---|---|
| `BTC/USD` | `1df945a1-...::VerifyStrategy1795331817323::BTC/USD::PAPER` | — |
| `BTCUSD` | `1df945a1-...::VerifyStrategy1795331817323::BTC/USD::PAPER` | **same=true** |

Both symbol spellings resolve to the same canonical symbol (`BTCUSD`) and the same runtime identity (`userId::strategyId::BTC/USD::PAPER`). No duplicate runtimes were created. All test-owned records were cleaned up via normal application APIs.

## Evidence

Sanitized request/response trace (no tokens, no user IDs beyond the disposable test user which was deleted):

- `register` → 200 (disposable user created)
- `signin` → 200 (JWT received)
- `create-strategy` → 200 (strategy created)
- `start-BTC/USD` → 200 (runtimeId returned)
- `start-BTCUSD` → 200 (same runtimeId returned)
- `runtimeId-comparison` → MATCH (same=true)
- `stop-BTC/USD` → 200 (runtime stopped)
- `delete-strategy` → 200 (strategy deleted)

## Conclusion

Runtime identity binding is verified end-to-end through the authenticated API path. `BTC/USD` ≡ `BTCUSD` at the runtime identity level. This finding is complete.
