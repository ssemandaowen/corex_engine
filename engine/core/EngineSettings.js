"use strict";

const { ENGINE_TUNING } = require("@config/constants");

const toPositiveInt = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

class EngineSettings {
    constructor() {
        this.defaults = Object.freeze({
            warmupCache: {
                enabled: true,
                maxPatchBars: ENGINE_TUNING.WARMUP_CACHE_MAX_PATCH_BARS,
                maxWriteBars: ENGINE_TUNING.WARMUP_CACHE_MAX_WRITE_BARS,
                maxGapBarsForPatch: ENGINE_TUNING.WARMUP_LOOKBACK * 2,
                compress: false,
                compressMinBytes: 256 * 1024
            }
        });
    }

    resolveWarmupCache(strategy = {}, storageCache = {}) {
        const lookback = toPositiveInt(strategy.lookback, ENGINE_TUNING.WARMUP_LOOKBACK);
        const strategyCache = strategy?.warmupCache && typeof strategy.warmupCache === "object" ? strategy.warmupCache : {};
        const envEnabled = String(process.env.WARMUP_CACHE_ENABLED || "").toLowerCase();
        const envCompress = String(process.env.WARMUP_CACHE_COMPRESS || "").toLowerCase();

        const enabled = strategyCache.enabled !== undefined
            ? !!strategyCache.enabled
            : (!["0", "false", "no", "off"].includes(envEnabled || "true"));

        const maxPatchBars = toPositiveInt(
            strategyCache.maxPatchBars ?? process.env.WARMUP_CACHE_MAX_PATCH_BARS,
            this.defaults.warmupCache.maxPatchBars
        );
        const maxWriteBars = toPositiveInt(
            strategyCache.maxWriteBars ?? process.env.WARMUP_CACHE_MAX_WRITE_BARS,
            Math.max(lookback * 2, this.defaults.warmupCache.maxWriteBars)
        );
        const maxGapBarsForPatch = toPositiveInt(
            strategyCache.maxGapBarsForPatch ?? process.env.WARMUP_CACHE_MAX_GAP_BARS,
            Math.max(lookback * 2, this.defaults.warmupCache.maxGapBarsForPatch)
        );
        const compress = strategyCache.compress !== undefined
            ? !!strategyCache.compress
            : ["1", "true", "yes", "on"].includes(envCompress);
        const compressMinBytes = toPositiveInt(
            strategyCache.compressMinBytes ?? process.env.WARMUP_CACHE_COMPRESS_MIN_BYTES,
            this.defaults.warmupCache.compressMinBytes
        );

        return {
            enabled,
            maxPatchBars,
            maxWriteBars,
            maxGapBarsForPatch,
            compress,
            compressMinBytes,
            clampMaxSizeMb: toPositiveInt(storageCache.maxSizeMb ?? process.env.CACHE_MAX_SIZE_MB, 500),
            clampMaxAgeDays: toPositiveInt(storageCache.maxAgeDays ?? process.env.CACHE_MAX_AGE_DAYS, 30)
        };
    }
}

module.exports = new EngineSettings();
