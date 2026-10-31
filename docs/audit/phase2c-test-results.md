# Phase 2c Test Results

- Test 1 (gross): FAIL. entry fill received 107 (expected 105), exit fill 108 (expected 110). gross P&L (108-107)*10=10 (expected 50). Source: engine/backtestManager.js:581 + :609, SharedFillSim.js:47 (fills at bar.close).
- Test 2 (no lookahead): FAIL. entryPrice received 107 == bar4 close (expected not 107). Source same as above.
- Test 3 (commission 0.2%): FAIL. netProfit received 10 (expected 45.70); commission total 0 (expected 4.30) because realism config dropped. Source: engine/backtestManager.js:308-328 (_resolveConfig omits commissionPct/slippageBps/spread) + :775-776 (analytics passes 0).
- Test 4 (slippage 10 bps): FAIL. entryPrice received 107 (expected 105.105). Source same.
- Test 5a high<low: ran silently (no throw). 5b duplicates: ran silently. 5c NaN close: threw "No bars in selected range." (indirect). 5d out-of-order: ran silently (sorted).
- Test 6 abort: shouldAbort first true ~? total wall ~12085ms; error code JOB_CANCELLED; abort not within 1s. Heartbeat count during 200k run ~0 (event loop starved by sync-ish batch). 

Verdicts:
- realism dropped: CONFIRMED
- lookahead: CONFIRMED
- validation: CONFIRMED (absent)
- abort: CONFIRMED (ineffective within 1s)
- event-loop starvation: CONFIRMED
