"use strict";

const { globalIndicatorRegistry } = require("./IndicatorRegistry");

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
            const instance = this._createIndicator(indDef, Cls);
            if (instance) {
                const updateMode = this._classifyUpdate(Cls);
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
            } else if (mode === "volume") {
                instance.update(close, volume);
            } else if (mode === "rvi") {
                instance.update(close, open, high, low);
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

                if (mode === "multi" || mode === "volume" || mode === "rvi") {
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

module.exports = { IndicatorManager, collectStaticIndicators };
