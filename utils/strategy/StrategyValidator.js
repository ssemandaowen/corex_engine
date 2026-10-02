"use strict";

/**
 * Migration shim — the owning implementation now lives in
 * `packages/corex-strategy-engine/src/validation/StrategyValidator.js`
 * and is re-exported through the package's public API
 * (`corex-strategy-engine` -> `StrategyValidator`).
 *
 * The legacy copy was a parallel implementation that had diverged: it validated
 * inheritance against `utils/BaseStrategy` and the `next()` entrypoint, while the
 * package validates against the declarative `Strategy` base and the `onBar`/`onTick`
 * lifecycle, and enforces `MAX_ALLOWED_LOOKBACK` as an error rather than a warning.
 * Two divergent validators were validating against two different contracts.
 *
 * Remaining consumer: scripts/validate-strategy.js (via `validateFile`).
 *
 * Purpose:        keep the legacy import path resolvable while that consumer migrates.
 * Target:         package implementation (already in place).
 * Removal:        safe to delete once no module requires
 *                 "@utils/strategy/StrategyValidator".
 *
 * Do not add behaviour here. Any change belongs in the owning package.
 */

module.exports = require("corex-strategy-engine").StrategyValidator;