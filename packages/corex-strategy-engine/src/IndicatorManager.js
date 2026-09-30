"use strict";

const { globalIndicatorRegistry } = require("./IndicatorRegistry");

/**
 * Dispatch modes.
 *
 * Each indicator module declares `static updateMode`, which selects the argument
 * shape `updateIndicators()` passes on every live tick. `arity` is the number of
 * arguments that mode dispatches and is asserted against the module's actual
 * `update()` arity at strategy initialization — a mismatch would otherwise feed
 * the wrong fields (or `undefined`) into the indicator silently.
 *
 *   single  -> update(value)                            (def.source resolved)
 *   hl      -> update(high, low)
 *   volume  -> update(close, volume)
 *   multi   -> update(high, low, close)
 *   hlv     -> update(high, low, volume)
 *   rvi     -> update(close, open, high, low)
 *   hlcv    -> update(high, low, close, volume)
 *   mfi     -> update(typicalPrice, typicalPrice * volume, volume)
 */
const DISPATCH_MODES = {
    single: { arity: 1 },
    hl:     { arity: 2 },
    volume: { arity: 2 },
    multi:  { arity: 3 },
    hlv:    { arity: 3 },
    rvi:    { arity: 4 },
    hlcv:   { arity: 4 },
    mfi:    { arity: 3 },
};

/**
 * Modes whose `reseed()` consumes full candle objects rather than a flat
 * value series.
 */
const CANDLE_DISPATCH_MODES = new Set(["hl", "volume", "multi", "hlv", "rvi", "hlcv", "mfi"]);

function collectStaticIndicators(StrategyClass, stopAt) {
    let curr = StrategyClass;
    let result = {};
    while (curr && curr !== stopAt && curr !== Object) {
        if (curr.indicators) {
            result = Object.assign({}, curr.indicators, result);
        }
        curr = Object.getPrototypeOf(curr);
    }
    return result;
}

class IndicatorManager {
    constructor(strategy) {
        this.strategy = strategy;
        this._indicators = new Map();
        this._staticIndicators = collectStaticIndicators(strategy.constructor, null);
    }

    initialize() {
        for (const [name, indDef] of Object.entries(this._staticIndicators)) {
            const type = String(indDef.type || "").toUpperCase();
            const Cls = globalIndicatorRegistry.get(type);
            if (!Cls) continue;
            const updateMode = this._classifyUpdate(Cls);
            this._assertDispatchArity(type, updateMode, Cls);
            const instance = this._createIndicator(indDef, Cls);
            if (instance) {
                this._indicators.set(name, { instance, def: indDef, type, updateMode });
            }
        }
    }

    _classifyUpdate(Cls) {
        if (Cls && typeof Cls.updateMode === "string") {
            return Cls.updateMode;
        }
        return "single";
    }

    /**
     * Fail loudly at strategy load time when a module's declared updateMode
     * disagrees with its real `update()` signature. Without this, a mismatch
     * only shows up as NaN or wrong values in live trading.
     */
    _assertDispatchArity(type, updateMode, Cls) {
        const spec = DISPATCH_MODES[updateMode];
        const known = Object.keys(DISPATCH_MODES).join(", ");
        if (!spec) {
            throw new Error(
                `[IndicatorManager] Indicator '${type}' declares unknown updateMode '${updateMode}'. Known modes: ${known}.`
            );
        }

        const updateFn = Cls && Cls.prototype ? Cls.prototype.update : null;
        if (typeof updateFn !== "function") {
            throw new Error(
                `[IndicatorManager] Indicator '${type}' declares updateMode '${updateMode}' but has no update() method to dispatch to.`
            );
        }

        const actual = updateFn.length;
        if (actual !== spec.arity) {
            throw new Error(
                `[IndicatorManager] Indicator '${type}' dispatch mismatch: updateMode '${updateMode}' dispatches ${spec.arity} argument(s) but update() accepts ${actual}.`
            );
        }
    }

    _createIndicator(indDef, Cls) {
        const resolvePeriod = (def) => this._resolvePeriod(def);
        const params = typeof Cls.resolveParams === "function"
            ? Cls.resolveParams(indDef, resolvePeriod)
            : [this._resolvePeriod(indDef)];
        try {
            return new Cls(...params);
        } catch (e) {
            return null;
        }
    }

    _resolvePeriod(indDef) {
        if (indDef.periodKey && this.strategy.params && this.strategy.params[indDef.periodKey] != null) {
            const p = Number(this.strategy.params[indDef.periodKey]);
            if (Number.isFinite(p) && p > 0) return p;
        }
        const fallback = indDef.period != null ? indDef.period : 14;
        const p = Number(fallback);
        return Number.isFinite(p) && p > 0 ? p : 14;
    }

    updateIndicators(packet) {
        const price = packet.price ?? packet.close ?? 0;
        const high = packet.high ?? price;
        const low = packet.low ?? price;
        const close = packet.close ?? packet.close ?? price;
        const open = packet.open ?? price;
        const volume = packet.volume ?? 0;

        for (const [, entry] of this._indicators) {
            const def = entry.def;
            const instance = entry.instance;
            if (!instance) continue;

            const mode = entry.updateMode;
            const source = def.source || "close";
            let val = close;
            if (source === "high") val = high;
            else if (source === "low") val = low;
            else if (source === "open") val = open;

            if (mode === "multi") {
                instance.update(high, low, close);
            } else if (mode === "hlv") {
                instance.update(high, low, volume);
            } else if (mode === "hlcv") {
                instance.update(high, low, close, volume);
            } else if (mode === "volume") {
                instance.update(close, volume);
            } else if (mode === "rvi") {
                instance.update(close, open, high, low);
            } else if (mode === "hl") {
                instance.update(high, low);
            } else if (mode === "mfi") {
                const typicalPrice = (high + low + close) / 3;
                instance.update(typicalPrice, typicalPrice * volume, volume);
            } else {
                instance.update(val);
            }
        }
    }

    reseedIndicators() {
        for (const [name, entry] of this._indicators) {
            const def = entry.def;
            const instance = entry.instance;
            if (!instance) continue;

            const newPeriod = this._resolvePeriod(def);
            const mode = entry.updateMode;

            if (instance.period !== undefined && instance.period !== newPeriod) {
                instance.period = newPeriod;
                if (instance.constructor.name === "IncrementalEMA") {
                    instance.multiplier = 2 / (newPeriod + 1);
                }
            }

            const source = def.source || "close";
            const history = this.strategy.series(this.strategy.symbols[0], source);

            if (history && history.length > 0) {
                const candles = this.strategy.dataManager.getLookbackWindow(this.strategy.symbols[0]);

                if (CANDLE_DISPATCH_MODES.has(mode)) {
                    instance.reseed(candles);
                } else {
                    instance.reseed(history);
                }
            }

            if (def.periodKey && this.strategy.params) {
                this.strategy.params[def.periodKey] = newPeriod;
            }
        }
    }

    getIndicatorValue(name) {
        const entry = this._indicators.get(name);
        if (!entry || !entry.instance) return null;
        return entry.instance;
    }

    get indicatorNames() {
        return Array.from(this._indicators.keys());
    }

    get indicatorDefs() {
        return this._staticIndicators;
    }
}

module.exports = { IndicatorManager, collectStaticIndicators, DISPATCH_MODES };
