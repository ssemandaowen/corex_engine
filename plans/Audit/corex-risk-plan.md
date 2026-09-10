# CoreX — CoreX-Risk Consolidation Plan (Issue #4)

> **Status:** Draft / Review Only (No implementation code written in this task)
> **Author:** Kilo Agent / CoreX Engineering

---

## 1. Full Inventory of Risk-Check Logic Across Codebase

Today, risk enforcement in CoreX is distributed across three primary pillars:

1. **`BaseBroker` Risk Floor & Injected Validator (`packages/corex-broker-contract/src/base/BaseBroker.js`)**:
   - `_passesRiskFloor()`: Checks if current equity meets `initialCash * riskFloor` (opt-in per account `config.riskFloor`).
   - Injected Risk Validator: `BaseBroker.setRiskValidator(fn)` wired at startup to `SignalProcessingEngine.validateForCommand`. Every order (`handle()`) passes through this synchronous validation gate before reaching driver execution.

2. **`SignalProcessingEngine` (`engine/core/pipeline/SignalProcessingEngine.js`)**:
   - `_validateRisk(intent, brokerInstance, runtimeId)`:
     - **Max Drawdown Limit**: Compares current equity against initial cash allocation (`maxDrawdownThresholdPct = 10.0` hardcoded). If `currentDrawdownPct >= 10%`, the signal/command is rejected (`return null`).
     - **Position Conflict / Scaling**: Checks existing position snapshot (`currentPosition.side`) against intent side. Prevents duplicate entry in the same direction unless `allowScaling` is true.

3. **`RiskGateway` (`packages/corex-gateway/src/socketx/RiskGateway.js`)**:
   - Routes inbound WebSocket Socket_X trade commands through `broker.handle()`, ensuring external client commands pass through the identical portfolio risk gates as internal strategy signals.

4. **`MetricsAccumulator` / Position Guardrails (`packages/corex-broker-contract/src/base/BaseBroker.js` & drivers)**:
   - Margin call and stop-out checks based on account leverage, used margin, and equity thresholds (`marginCall`, `stopOut` config).

5. **Legacy `utils/riskManager.js`**:
   - Orphaned legacy risk manager class. Confirmed dead code with zero references across the codebase; removed during Phase 3 housekeeping.

---

## 2. Overlap / Duplication Analysis

- **`utils/riskManager.js` vs `SignalProcessingEngine`**:
  - `riskManager.js` was an earlier, standalone risk management utility that tracked daily loss limits, position size limits, and trading halts.
  - It was fully superseded by `SignalProcessingEngine` (portfolio drawdown + position checks) and `BaseBroker`'s risk floor + injected validator.
  - Because nothing imported `riskManager.js`, its existence was purely historical residue. Its removal in Phase 3 eliminated dead code without behavioral regression.

---

## 3. Proposed Consolidated Structure

Following CoreX's build philosophy (fast, lean, no speculative configurability, no unnecessary abstraction layers):
- Consolidate all core risk validation rules into `SignalProcessingEngine` as the single authoritative policy engine.
- **Configuration Scope**: The hardcoded constants (`maxDrawdownThresholdPct = 10.0`, `maxDailyLossLimit = 2500`) are currently class properties. While future enhancements may make these dynamically configurable per strategy or account via database-backed settings (per AGENTS.md rules), making them fully dynamic is **deferred** to a subsequent dedicated configuration task unless explicitly required by Issue #4. Keeping them as validated defaults for now avoids premature complexity.

---

## 4. Package Boundaries: Dedicated Package vs Engine Integration

Two architectural options exist for consolidating risk logic:

### Option A: Create `packages/corex-risk/`
- **Arguments For**: Modular isolation; clean package boundaries matching the modularization plan (Issue #4 corresponds to `corex-risk`); reusable across different engines.
- **Arguments Against**: High coupling with `BaseBroker` equity queries, runtime registry, and strategy signal pipelines. Creating an independent package for a 70-line validation class (`SignalProcessingEngine` subset) introduces cross-package package dependency overhead prematurely before `corex-strategy-engine` is extracted.

### Option B: Consolidate into `SignalProcessingEngine` within `engine/` (staging for `corex-strategy-engine`)
- **Arguments For**: Matches the established package extraction pattern (extract execution/broker/market-data/auth/portfolio/accounts first; strategy/pipeline orchestration packages come later). `SignalProcessingEngine` is tightly coupled to strategy signal processing and runtime broker sessions.
- **Arguments Against**: Does not immediately create a `packages/corex-risk/` workspace package.

### Recommendation
Keep risk check logic consolidated inside `SignalProcessingEngine` in `engine/` (or package it alongside strategy execution when `corex-strategy-engine` is extracted), rather than creating a standalone `packages/corex-risk/` package right now. This avoids unnecessary cross-package circular dependencies between broker contracts, runtimes, and risk validation.

---

## 5. Migration & Removal Plan for `utils/riskManager.js`
- `utils/riskManager.js` has already been deleted in Phase 3 housekeeping as verified dead code. No further migration needed.

---

## 6. Uncertainties / Decisions Needed from Owen Before Implementation
1. **Scope of Package 4 (`corex-risk`)**: Does Owen prefer creating an independent `packages/corex-risk/` npm workspace package (Option A), or consolidating the logic into `SignalProcessingEngine` within `engine/` as part of strategy orchestration (Option B)?
2. **Configurability**: Should `maxDrawdownThresholdPct` (currently 10%) and `maxDailyLossLimit` be migrated to database-backed account settings in this task, or kept as hardcoded safety defaults?
