"use strict";

const technicalIndicators = require("technicalindicators");

const ENTRYPOINT_METHODS = ["next", "generateSignal", "onMarketData", "onTick", "onBar", "_processData"];

const CORE_METHOD_MANIFEST = [
    {
        label: "resolveSymbol",
        category: "helper",
        detail: "Resolve active symbol",
        signature: "resolveSymbol({ symbol?, packet? })",
        documentation: "Resolves symbol from explicit input, packet data, or strategy defaults."
    },
    {
        label: "hasBars",
        category: "helper",
        detail: "Check history depth",
        signature: "hasBars(symbol, n = 1)",
        documentation: "Returns true when at least n completed bars exist for symbol."
    },
    {
        label: "requireBars",
        category: "helper",
        detail: "Guard for bar count",
        signature: "requireBars(symbol, n = 1, context = 'requireBars')",
        documentation: "Guard helper that returns false when not enough bars are available."
    },
    { 
        label: "safeSeries", 
        category: "helper", 
        detail: "Safe series accessor", 
        signature: "safeSeries(symbol, field = 'close', fallback = [], n?)", 
        documentation: "Reads a numeric series safely without throwing on missing data. Optional n limits lookback." 
    }, 
    {
        label: "oncePerBar",
        category: "helper",
        detail: "One-shot bar gate",
        signature: "oncePerBar(key, barTime?)",
        documentation: "Returns true once per bar/key pair to prevent duplicate actions."
    },
    {
        label: "safeRule",
        category: "helper",
        detail: "Defensive execution wrapper",
        signature: "safeRule(fn, fallback = null)",
        documentation: "Executes fn and returns fallback when logic throws."
    },
    {
        label: "describe",
        category: "helper",
        detail: "Strategy metadata block",
        signature: "describe(features = {})",
        documentation: "Returns lightweight metadata for UI and telemetry."
    },
    {
        label: "logDecision",
        category: "helper",
        detail: "Structured decision log",
        signature: "logDecision(message, meta = {}, level = 'info')",
        documentation: "Logs decision events with consistent strategy metadata."
    },
    {
        label: "logSignal",
        category: "helper",
        detail: "Structured signal log",
        signature: "logSignal(signal, stage = 'EMIT', level = 'info')",
        documentation: "Logs signal payloads in a normalized format."
    },
    {
        label: "logGuard",
        category: "helper",
        detail: "Structured guard log",
        signature: "logGuard(name, passed, details = {})",
        documentation: "Logs warmup/risk/filter guard pass-fail decisions."
    },
    {
        label: "entryLong",
        category: "signal",
        detail: "Emit long entry",
        signature: "entryLong(params = {})",
        documentation: "Creates normalized ENTER/LONG signal and resolves quantity + SL/TP."
    },
    {
        label: "entryShort",
        category: "signal",
        detail: "Emit short entry",
        signature: "entryShort(params = {})",
        documentation: "Creates normalized ENTER/SHORT signal and resolves quantity + SL/TP."
    },
    {
        label: "exitLong",
        category: "signal",
        detail: "Exit long position",
        signature: "exitLong(params = {})",
        documentation: "Creates normalized EXIT/LONG signal with resolved close quantity."
    },
    {
        label: "exitShort",
        category: "signal",
        detail: "Exit short position",
        signature: "exitShort(params = {})",
        documentation: "Creates normalized EXIT/SHORT signal with resolved close quantity."
    },
    {
        label: "exitAll",
        category: "signal",
        detail: "Exit any exposure",
        signature: "exitAll(params = {})",
        documentation: "Creates normalized EXIT/FLAT signal."
    },
    {
        label: "flipToLong",
        category: "signal",
        detail: "Flip short to long",
        signature: "flipToLong(params = {})",
        documentation: "Queues opposite-side entry on next bar after exit."
    },
    {
        label: "flipToShort",
        category: "signal",
        detail: "Flip long to short",
        signature: "flipToShort(params = {})",
        documentation: "Queues opposite-side entry on next bar after exit."
    },
    {
        label: "rule",
        category: "flow",
        detail: "RuleChain builder",
        signature: "rule(packet?)",
        documentation: "Fluent conditional chain for guarded entry/exit/flip emission (supports when, and, then, else, end/value)."
    },
    {
        label: "series",
        category: "data",
        detail: "Raw series accessor",
        signature: "series(symbol, field = 'close')",
        documentation: "Returns raw numeric lookback series for indicators."
    },
    {
        label: "pos",
        category: "position",
        detail: "Position state checker",
        signature: "pos(state, symbol, set = false)",
        documentation: "Checks or mutates strategy position state (long/short/flat)."
    },
    {
        label: "sizePosition",
        category: "risk",
        detail: "Risk-based quantity sizing",
        signature: "sizePosition({ price?, symbol?, riskPct = 1, minQty = 0, maxQty?, step?, fallbackQty = 1 })",
        documentation: "Sizes quantity from account equity and risk percentage."
    },
    {
        label: "crossover",
        category: "signal",
        detail: "Cross-up detection",
        signature: "crossover(a, b, opts = {})",
        documentation: "Returns true when series/value A crosses above B."
    },
    {
        label: "crossunder",
        category: "signal",
        detail: "Cross-down detection",
        signature: "crossunder(a, b, opts = {})",
        documentation: "Returns true when series/value A crosses below B."
    },
    {
        label: "above",
        category: "signal",
        detail: "Above comparison",
        signature: "above(a, b)",
        documentation: "Returns true when latest A > latest B."
    },
    {
        label: "below",
        category: "signal",
        detail: "Below comparison",
        signature: "below(a, b)",
        documentation: "Returns true when latest A < latest B."
    },
    {
        label: "rising",
        category: "signal",
        detail: "Series rising check",
        signature: "rising(series)",
        documentation: "Returns true when latest value is greater than previous."
    },
    {
        label: "falling",
        category: "signal",
        detail: "Series falling check",
        signature: "falling(series)",
        documentation: "Returns true when latest value is less than previous."
    },
    {
        label: "between",
        category: "signal",
        detail: "Range check",
        signature: "between(val, min, max, inclusive = true)",
        documentation: "Returns true when value is inside specified range."
    },
    {
        label: "pctChange",
        category: "signal",
        detail: "Percent change",
        signature: "pctChange(series)",
        documentation: "Returns percent change between latest and previous values."
    }
];

const INDICATOR_DOC_OVERRIDES = {
    RSI: {
        signature: "RSI.calculate({ values, period })",
        detail: "Relative Strength Index",
        documentation: "Momentum oscillator in range 0..100."
    },
    MACD: {
        signature: "MACD.calculate({ values, fastPeriod, slowPeriod, signalPeriod, SimpleMAOscillator?, SimpleMASignal? })",
        detail: "MACD oscillator",
        documentation: "Returns MACD line, signal line, and histogram."
    },
    SMA: {
        signature: "SMA.calculate({ values, period })",
        detail: "Simple Moving Average",
        documentation: "Arithmetic mean over rolling period."
    },
    EMA: {
        signature: "EMA.calculate({ values, period })",
        detail: "Exponential Moving Average",
        documentation: "Exponentially weighted moving average."
    },
    ATR: {
        signature: "ATR.calculate({ high, low, close, period })",
        detail: "Average True Range",
        documentation: "Volatility measure based on true range."
    },
    BollingerBands: {
        signature: "BollingerBands.calculate({ values, period, stdDev })",
        detail: "Bollinger Bands",
        documentation: "Returns upper, middle, and lower volatility bands."
    },
    ADX: {
        signature: "ADX.calculate({ high, low, close, period })",
        detail: "Average Directional Index",
        documentation: "Trend strength indicator with +DI/-DI."
    },
    Stochastic: {
        signature: "Stochastic.calculate({ high, low, close, period, signalPeriod })",
        detail: "Stochastic Oscillator",
        documentation: "Returns %K and %D momentum values."
    },
    MFI: {
        signature: "MFI.calculate({ high, low, close, volume, period })",
        detail: "Money Flow Index",
        documentation: "Volume-weighted oscillator in range 0..100."
    },
    OBV: {
        signature: "OBV.calculate({ close, volume })",
        detail: "On-Balance Volume",
        documentation: "Cumulative volume trend indicator."
    },
    VWAP: {
        signature: "VWAP.calculate({ high, low, close, volume })",
        detail: "Volume Weighted Average Price",
        documentation: "Volume-weighted average traded price."
    },
    IchimokuCloud: {
        signature: "IchimokuCloud.calculate({ high, low, conversionPeriod, basePeriod, spanPeriod, displacement })",
        detail: "Ichimoku Cloud",
        documentation: "Multi-line trend/support-resistance framework."
    },
    KeltnerChannels: {
        signature: "KeltnerChannels.calculate({ high, low, close, maPeriod, atrPeriod, multiplier })",
        detail: "Keltner Channels",
        documentation: "EMA and ATR-based volatility envelope."
    },
    PSAR: {
        signature: "PSAR.calculate({ high, low, step, max })",
        detail: "Parabolic SAR",
        documentation: "Trend-following stop and reversal series."
    },
    doji: {
        signature: "doji({ open, high, low, close })",
        detail: "Candlestick pattern",
        documentation: "Returns true when doji pattern is detected."
    },
    bullishengulfingpattern: {
        signature: "bullishengulfingpattern({ open, high, low, close })",
        detail: "Candlestick pattern",
        documentation: "Returns true on bullish engulfing detection."
    },
    bearishengulfingpattern: {
        signature: "bearishengulfingpattern({ open, high, low, close })",
        detail: "Candlestick pattern",
        documentation: "Returns true on bearish engulfing detection."
    },
    morningstar: {
        signature: "morningstar({ open, high, low, close })",
        detail: "Candlestick pattern",
        documentation: "Returns true when morning star pattern is detected."
    },
    eveningstar: {
        signature: "eveningstar({ open, high, low, close })",
        detail: "Candlestick pattern",
        documentation: "Returns true when evening star pattern is detected."
    }
};

let indicatorManifestCache = null;
let indicatorNameSetCache = null;
let indicatorNameSetLowerCache = null;

function _buildIndicatorEntry(name) {
    const ref = technicalIndicators[name];
    const isFunction = typeof ref === "function";
    const hasCalculate = isFunction && typeof ref.calculate === "function";
    const lower = String(name).toLowerCase();
    const doc = INDICATOR_DOC_OVERRIDES[name] || INDICATOR_DOC_OVERRIDES[lower];

    const signature = doc?.signature || (
        hasCalculate
            ? `${name}.calculate(input)`
            : `${name}(input)`
    );

    return {
        name,
        label: name,
        kind: hasCalculate ? "class.calculate" : "function",
        signature,
        detail: doc?.detail || (hasCalculate ? "Technical indicator" : "Technical utility/pattern"),
        documentation: doc?.documentation || "Technical indicator/utility from technicalindicators package.",
        insertText: hasCalculate
            ? `${name}.calculate({ values: [], period: 14 })`
            : `${name}({ open: [], high: [], low: [], close: [] })`
    };
}

function getIndicatorManifest() {
    if (indicatorManifestCache) return indicatorManifestCache;

    const keys = Object.keys(technicalIndicators || {})
        .filter((key) => !["setConfig", "getConfig", "getAvailableIndicators", "AvailableIndicators"].includes(key))
        .sort((a, b) => a.localeCompare(b));

    indicatorManifestCache = keys.map(_buildIndicatorEntry);
    return indicatorManifestCache;
}

function getIndicatorNameSet() {
    if (!indicatorNameSetCache) {
        indicatorNameSetCache = new Set(getIndicatorManifest().map((item) => item.name));
    }
    return indicatorNameSetCache;
}

function getIndicatorNameLowerSet() {
    if (!indicatorNameSetLowerCache) {
        indicatorNameSetLowerCache = new Set(Array.from(getIndicatorNameSet()).map((v) => v.toLowerCase()));
    }
    return indicatorNameSetLowerCache;
}

function getStrategyManifestPayload() {
    return {
        generatedAt: new Date().toISOString(),
        entrypoints: [...ENTRYPOINT_METHODS],
        methods: CORE_METHOD_MANIFEST.map((m) => ({
            label: m.label,
            detail: m.detail,
            signature: m.signature,
            documentation: m.documentation,
            category: m.category,
            insertText: `${m.label}(`
        })),
        indicators: getIndicatorManifest().map((i) => ({
            label: i.label,
            detail: i.detail,
            signature: i.signature,
            documentation: i.documentation,
            kind: i.kind,
            insertText: i.insertText
        }))
    };
}

module.exports = {
    ENTRYPOINT_METHODS,
    CORE_METHOD_MANIFEST,
    getIndicatorManifest,
    getIndicatorNameSet,
    getIndicatorNameLowerSet,
    getStrategyManifestPayload
};
