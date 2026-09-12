"use strict";

const baseManifest = require("@utils/strategy/StrategyManifest");

const DECLARATIVE_CTX_METHODS = [
    {
        label: "ctx.go.long",
        category: "signal",
        detail: "Declarative long entry",
        signature: "ctx.go.long(quantity?, price?)",
        documentation: "Emits a long entry signal via the declarative context. Quantity defaults to auto-sized; price defaults to current close.",
        insertText: "ctx.go.long(1)"
    },
    {
        label: "ctx.go.short",
        category: "signal",
        detail: "Declarative short entry",
        signature: "ctx.go.short(quantity?, price?)",
        documentation: "Emits a short entry signal via the declarative context.",
        insertText: "ctx.go.short(1)"
    },
    {
        label: "ctx.go.scale",
        category: "signal",
        detail: "Declarative scale-in",
        signature: "ctx.go.scale(quantity?, price?)",
        documentation: "Adds to an existing position via the declarative context.",
        insertText: "ctx.go.scale(1)"
    },
    {
        label: "ctx.go.protect",
        category: "signal",
        detail: "Declarative protection assignment",
        signature: "ctx.go.protect({ sl?, tp?, trailPct? })",
        documentation: "Assigns stop-loss, take-profit, or trailing stop via the declarative context.",
        insertText: "ctx.go.protect({ sl: 1.0900, tp: 1.1500 })"
    },
    {
        label: "ctx.flat",
        category: "signal",
        detail: "Declarative exit",
        signature: "ctx.flat(quantity?, price?)",
        documentation: "Exits any exposure for the symbol via the declarative context.",
        insertText: "ctx.flat()"
    },
    {
        label: "ctx.ta",
        category: "ta",
        detail: "Technical analysis helpers",
        signature: "ctx.ta.crossover(a, b)",
        documentation: "TradingView-style TA helpers available on ctx.ta: crossover, crossunder, highest, lowest, rising, falling, change.",
        insertText: "ctx.ta.crossover(a, b)"
    },
    {
        label: "ctx.util",
        category: "util",
        detail: "Quantitative utilities",
        signature: "ctx.util.round(val, decimals)",
        documentation: "Utility functions for rounding and position sizing, available on ctx.util.",
        insertText: "ctx.util.positionSize(capital, riskPct, stopLossPips)"
    },
    {
        label: "ctx.indicators.*",
        category: "indicator",
        detail: "Incremental indicator values",
        signature: "ctx.indicators.<name>",
        documentation: "Access to static incremental indicators declared via static indicators = { ema: { type: 'EMA', period: 5 } }. Each indicator exposes { value, prev } with bar-time deduplication.",
        insertText: "ctx.indicators.ema.value"
    },
    {
        label: "ctx.position",
        category: "position",
        detail: "Position state",
        signature: "ctx.position.{ side, entryPrice, size, unrealizedPnL }",
        documentation: "Current position snapshot for the active symbol, updated in-place on every tick.",
        insertText: "ctx.position.side"
    },
    {
        label: "ctx.params",
        category: "params",
        detail: "Strategy parameters",
        signature: "ctx.params.<key>",
        documentation: "Static parameter values declared via static params = { key: { default, min, max } }, applied with runtime overrides.",
        insertText: "ctx.params.threshold"
    },
    {
        label: "ctx.state",
        category: "state",
        detail: "Persistent state",
        signature: "ctx.state.set(key, value)",
        documentation: "Persistent key-value store that survives crashes and restarts. Backed by StrategyStateStore.",
        insertText: "ctx.state.set('trend', 'bull')"
    },
    {
        label: "ctx.price",
        category: "data",
        detail: "Current market price",
        signature: "Number",
        documentation: "The current close price for the active symbol, updated in-place on every tick.",
        insertText: "ctx.price"
    },
    {
        label: "ctx.barTime",
        category: "data",
        detail: "Current bar time",
        signature: "Number",
        documentation: "The timestamp of the current bar (for bar processing) or the last bar close time.",
        insertText: "ctx.barTime"
    }
];

const DECLARATIVE_ENTRYPOINTS = ["onStart", "onBar", "onTick", "onFill", "onStop"];

const combinedManifests = baseManifest.CORE_METHOD_MANIFEST.concat(DECLARATIVE_CTX_METHODS);

const combinedEntrypoints = Array.from(new Set(
    (baseManifest.ENTRYPOINT_METHODS || []).concat(DECLARATIVE_ENTRYPOINTS)
));

class StrategyManifest {
    static ENTRYPOINT_METHODS = combinedEntrypoints;
    static CORE_METHOD_MANIFEST = combinedManifests;
    static DECLARATIVE_CTX_METHODS = DECLARATIVE_CTX_METHODS;

    static getIndicatorManifest() {
        return baseManifest.getIndicatorManifest();
    }

    static getIndicatorNameSet() {
        return baseManifest.getIndicatorNameSet();
    }

    static getIndicatorNameLowerSet() {
        return baseManifest.getIndicatorNameLowerSet();
    }

    static getStrategyManifestPayload() {
        const base = baseManifest.getStrategyManifestPayload();
        const ctxMethods = DECLARATIVE_CTX_METHODS.map((m) => ({
            label: m.label,
            detail: m.detail,
            signature: m.signature,
            documentation: m.documentation,
            category: m.category,
            insertText: `${m.label}(`
        }));
        return {
            ...base,
            entrypoints: combinedEntrypoints,
            ctxMethods: ctxMethods,
            methods: combinedManifests.map((m) => ({
                label: m.label,
                detail: m.detail,
                signature: m.signature,
                documentation: m.documentation,
                category: m.category,
                insertText: `${m.label}(`
            })),
            declarativeEntrypoints: DECLARATIVE_ENTRYPOINTS
        };
    }
}

module.exports = {
    StrategyManifest,
    ENTRYPOINT_METHODS: combinedEntrypoints,
    CORE_METHOD_MANIFEST: combinedManifests,
    DECLARATIVE_CTX_METHODS,
    DECLARATIVE_ENTRYPOINTS,
    getIndicatorManifest: baseManifest.getIndicatorManifest,
    getIndicatorNameSet: baseManifest.getIndicatorNameSet,
    getIndicatorNameLowerSet: baseManifest.getIndicatorNameLowerSet
};
