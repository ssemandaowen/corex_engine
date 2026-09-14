"use strict";

class IndicatorRegistry {
    constructor() {
        this._registry = new Map();
    }

    register(type, implementation) {
        const key = String(type || "").toUpperCase();
        if (typeof implementation !== "function") {
            throw new Error(`[IndicatorRegistry] Indicator implementation for '${key}' must be a constructor function or class.`);
        }
        this._registry.set(key, implementation);
    }

    get(type) {
        const key = String(type || "").toUpperCase();
        return this._registry.get(key) || null;
    }

    has(type) {
        const key = String(type || "").toUpperCase();
        return this._registry.has(key);
    }
}

const indicators = {
    SMA: require("./indicators/sma"),
    EMA: require("./indicators/ema"),
    WMA: require("./indicators/wma"),
    HMA: require("./indicators/hma"),
    McGinley: require("./indicators/mcginley"),
    ALMA: require("./indicators/alma"),
    KAMA: require("./indicators/kama"),
    VIDYA: require("./indicators/vidya"),
    ParabolicSAR: require("./indicators/parabolic_sar"),
    SuperTrend: require("./indicators/supertrend"),
    LinearRegression: require("./indicators/linear_regression"),
    StandardDeviation: require("./indicators/stddev"),
    MACD: require("./indicators/macd"),
    ROC: require("./indicators/roc"),
    Momentum: require("./indicators/momentum"),
    WilliamsR: require("./indicators/williams_r"),
    UltimateOscillator: require("./indicators/ultimate_oscillator"),
    CCI: require("./indicators/cci"),
    TSI: require("./indicators/tsi"),
    CMO: require("./indicators/cmo"),
    STC: require("./indicators/stc"),
    Fisher: require("./indicators/fisher"),
    LaguerreRSI: require("./indicators/laguerre_rsi"),
    RVI: require("./indicators/rvi"),
    ConnorsRSI: require("./indicators/connors_rsi"),
    BollingerBands: require("./indicators/bollinger_bands"),
    KeltnerChannels: require("./indicators/keltner_channels"),
    DonchianChannels: require("./indicators/donchian_channels"),
    Stochastic: require("./indicators/stoch"),
    VWAP: require("./indicators/vwap"),
    AnchoredVWAP: require("./indicators/anchored_vwap"),
    OBV: require("./indicators/obv"),
    MFI: require("./indicators/mfi"),
    CMF: require("./indicators/cmf"),
    AD: require("./indicators/ad"),
    EoM: require("./indicators/eom"),
    ADX: require("./indicators/adx"),
    Vortex: require("./indicators/vortex"),
    Choppiness: require("./indicators/choppiness"),
    Hurst: require("./indicators/hurst"),
    FDI: require("./indicators/fdi"),
    ZScore: require("./indicators/zscore"),
    DPO: require("./indicators/dpo"),
    Coppock: require("./indicators/coppock"),
    Fibonacci: require("./indicators/fibonacci"),
    InstantTrend: require("./indicators/instantaneous_trend"),
    SuperSmoother: require("./indicators/supersmoother"),
    Ichimoku: require("./indicators/ichimoku"),
    ATR: require("./indicators/atr"),
    RSI: require("./indicators/rsi"),
};

const globalIndicatorRegistry = new IndicatorRegistry();

for (const [key, impl] of Object.entries(indicators)) {
    globalIndicatorRegistry.register(key, impl);
}

module.exports = {
    IndicatorRegistry,
    globalIndicatorRegistry,
    indicators,
};