"use strict";

/**
 * Migration shim — the owning implementation now lives in
 * `packages/corex-strategy-engine/src/validation/StrategyManifest.js`
 * and is re-exported through the package's public API
 * (`corex-strategy-engine` -> `StrategyManifest`).
 *
 * Former consumers, all migrated:
 *   - engine/routes/strategyController.js   -> require("corex-strategy-engine")
 *   - scripts/sync-strategy-manifest.js     -> require("corex-strategy-engine")
 *
 * Purpose:        keep the legacy import path resolvable while consumers migrate.
 * Target:         package implementation (already in place).
 * Removal:        safe to delete once no module requires "@utils/strategy/StrategyManifest".
 *
 * Do not add behaviour here. Any change belongs in the owning package.
 */

const { StrategyManifest } = require("corex-strategy-engine");

module.exports = {
    ENTRYPOINT_METHODS: StrategyManifest.ENTRYPOINT_METHODS,
    CORE_METHOD_MANIFEST: StrategyManifest.CORE_METHOD_MANIFEST,
    getIndicatorManifest: StrategyManifest.getIndicatorManifest,
    getIndicatorNameSet: StrategyManifest.getIndicatorNameSet,
    getIndicatorNameLowerSet: StrategyManifest.getIndicatorNameLowerSet,
    hasRegisteredIndicator: StrategyManifest.hasRegisteredIndicator,
    getTechnicalIndicatorNameSet: StrategyManifest.getTechnicalIndicatorNameSet,
    getTechnicalIndicatorNameLowerSet: StrategyManifest.getTechnicalIndicatorNameLowerSet,
    getStrategyManifestPayload: StrategyManifest.getStrategyManifestPayload,
};