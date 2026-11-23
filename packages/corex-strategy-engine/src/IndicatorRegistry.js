"use strict";

class UnknownIndicatorError extends Error {
    constructor(type) {
        const key = String(type || "").toUpperCase();
        super("[IndicatorRegistry] Unknown indicator type '" + key + "'");
        this.name = "UnknownIndicatorError";
        this.code = "UNKNOWN_INDICATOR";
        this.type = key;
    }
}

class IndicatorRegistry {
    constructor() {
        this._registry = new Map();
        this._aliases = new Map();
    }

    register(type, implementation, meta = {}) {
        if (typeof implementation !== "function") {
            const key = String(type || "").toUpperCase();
            throw new TypeError("[IndicatorRegistry] Indicator implementation for '" + key + "' must be a constructor function or class.");
        }
        const key = String(type || "").toUpperCase();
        this._registry.set(key, {
            loader: null,
            implementation,
            loaded: true,
            meta: this._normaliseMeta(meta, implementation)
        });
        this._registerAliases(key, this._registry.get(key).meta.aliases);
        return this;
    }

    registerLazy(type, loader, meta = {}) {
        const key = String(type || "").toUpperCase();
        if (!key) throw new TypeError("[IndicatorRegistry] Indicator type must be non-empty.");
        if (typeof loader !== "function") throw new TypeError("[IndicatorRegistry] Lazy loader for '" + key + "' must be a function.");
        const normalized = this._normaliseMeta(meta);
        this._registry.set(key, { loader, implementation: null, loaded: false, meta: normalized });
        this._registerAliases(key, normalized.aliases);
        return this;
    }

    _normaliseMeta(meta = {}, implementation = null) {
        const staticMeta = implementation && implementation.meta ? implementation.meta : {};
        return Object.freeze({
            aliases: Object.freeze([...(meta.aliases || staticMeta.aliases || [])]),
            cost: meta.cost || staticMeta.cost || "O(n)",
            version: Number(meta.version || staticMeta.version || 1)
        });
    }

    _registerAliases(type, aliases) {
        for (const alias of aliases) {
            const key = String(alias).toUpperCase();
            if (!key || key === type) continue;
            const existing = this._aliases.get(key);
            if (existing && existing !== type) throw new Error("[IndicatorRegistry] Alias '" + key + "' is already registered.");
            this._aliases.set(key, type);
        }
    }

    _canonical(type) {
        const key = String(type || "").toUpperCase();
        return this._aliases.get(key) || key;
    }

    get(type) {
        const key = this._canonical(type);
        const entry = this._registry.get(key);
        if (!entry) throw new UnknownIndicatorError(type);
        if (!entry.loaded) {
            const implementation = entry.loader();
            if (typeof implementation !== "function") throw new TypeError("[IndicatorRegistry] Lazy loader for '" + key + "' did not return a constructor.");
            entry.implementation = implementation;
            entry.loaded = true;
            entry.loader = null;
            entry.meta = this._normaliseMeta(entry.meta, implementation);
        }
        return entry.implementation;
    }

    getMeta(type) {
        const key = this._canonical(type);
        const entry = this._registry.get(key);
        if (!entry) throw new UnknownIndicatorError(type);
        if (entry.loaded) return this._normaliseMeta(entry.meta, entry.implementation);
        return entry.meta;
    }

    has(type) {
        return this._registry.has(this._canonical(type));
    }

    listTypes() {
        return Array.from(this._registry.keys());
    }

    listMetadata() {
        return this.listTypes().map(type => ({ type, ...this.getMeta(type) }));
    }
}

const indicatorLoaders = {
    SMA: () => require("./indicators/sma"),
    EMA: () => require("./indicators/ema"),
    WMA: () => require("./indicators/wma"),
    HMA: () => require("./indicators/hma"),
    McGinley: () => require("./indicators/mcginley"),
    ALMA: () => require("./indicators/alma"),
    KAMA: () => require("./indicators/kama"),
    VIDYA: () => require("./indicators/vidya"),
    ParabolicSAR: () => require("./indicators/parabolic_sar"),
    SuperTrend: () => require("./indicators/supertrend"),
    LinearRegression: () => require("./indicators/linear_regression"),
    StandardDeviation: () => require("./indicators/stddev"),
    MACD: () => require("./indicators/macd"),
    ROC: () => require("./indicators/roc"),
    Momentum: () => require("./indicators/momentum"),
    WilliamsR: () => require("./indicators/williams_r"),
    UltimateOscillator: () => require("./indicators/ultimate_oscillator"),
    CCI: () => require("./indicators/cci"),
    TSI: () => require("./indicators/tsi"),
    CMO: () => require("./indicators/cmo"),
    STC: () => require("./indicators/stc"),
    Fisher: () => require("./indicators/fisher"),
    LaguerreRSI: () => require("./indicators/laguerre_rsi"),
    RVI: () => require("./indicators/rvi"),
    ConnorsRSI: () => require("./indicators/connors_rsi"),
    BollingerBands: () => require("./indicators/bollinger_bands"),
    KeltnerChannels: () => require("./indicators/keltner_channels"),
    DonchianChannels: () => require("./indicators/donchian_channels"),
    Stochastic: () => require("./indicators/stoch"),
    VWAP: () => require("./indicators/vwap"),
    AnchoredVWAP: () => require("./indicators/anchored_vwap"),
    OBV: () => require("./indicators/obv"),
    MFI: () => require("./indicators/mfi"),
    CMF: () => require("./indicators/cmf"),
    AD: () => require("./indicators/ad"),
    EoM: () => require("./indicators/eom"),
    ADX: () => require("./indicators/adx"),
    Vortex: () => require("./indicators/vortex"),
    Choppiness: () => require("./indicators/choppiness"),
    Hurst: () => require("./indicators/hurst"),
    FDI: () => require("./indicators/fdi"),
    ZScore: () => require("./indicators/zscore"),
    DPO: () => require("./indicators/dpo"),
    Coppock: () => require("./indicators/coppock"),
    Fibonacci: () => require("./indicators/fibonacci"),
    InstantTrend: () => require("./indicators/instantaneous_trend"),
    SuperSmoother: () => require("./indicators/supersmoother"),
    Ichimoku: () => require("./indicators/ichimoku"),
    ATR: () => require("./indicators/atr"),
    RSI: () => require("./indicators/rsi")
};

const aliases = {
    SMA: ["SimpleMovingAverage"],
    EMA: ["ExponentialMovingAverage"],
    WMA: ["WeightedMovingAverage"],
    MACD: ["MovingAverageConvergenceDivergence"],
    ATR: ["AverageTrueRange"],
    RSI: ["RelativeStrengthIndex"],
    OBV: ["OnBalanceVolume"],
    BollingerBands: ["BBANDS"]
};
const constantTime = new Set(["SMA", "EMA", "WMA", "McGinley", "VIDYA", "OBV", "VWAP", "ATR", "RSI", "ROC", "Momentum"]);
const indicatorMeta = {};
for (const type of Object.keys(indicatorLoaders)) {
    indicatorMeta[type] = {
        aliases: aliases[type] || [],
        cost: constantTime.has(type) ? "O(1)" : "O(n)",
        version: 1
    };
}
indicatorMeta.EMA.version = 2;
indicatorMeta.ATR.version = 2;
indicatorMeta.DPO.version = 2;
indicatorMeta.DPO.cost = "O(1)";
indicatorMeta.BollingerBands.version = 2;
indicatorMeta.ZScore.version = 2;

const indicators = Object.create(null);
for (const [key, loader] of Object.entries(indicatorLoaders)) {
    Object.defineProperty(indicators, key, {
        enumerable: true,
        configurable: false,
        get: loader
    });
}

const globalIndicatorRegistry = new IndicatorRegistry();
for (const [key, loader] of Object.entries(indicatorLoaders)) {
    globalIndicatorRegistry.registerLazy(key, loader, indicatorMeta[key]);
}

module.exports = {
    IndicatorRegistry,
    UnknownIndicatorError,
    globalIndicatorRegistry,
    indicators,
    indicatorLoaders,
    indicatorMeta
};