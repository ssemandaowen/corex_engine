"use strict";

const { IncrementalEMA, IncrementalRSI, IncrementalATR } = require("@utils/strategy/IncrementalIndicators");

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
            const instance = this._createIndicator(indDef);
            if (instance) {
                this._indicators.set(name, { instance, def: indDef });
            }
        }
    }

    _createIndicator(indDef) {
        const type = String(indDef.type || "").toUpperCase();
        const period = this._resolvePeriod(indDef);
        if (type === "EMA") return new IncrementalEMA(period);
        if (type === "RSI") return new IncrementalRSI(period);
        if (type === "ATR") return new IncrementalATR(period);
        return null;
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
        const close = packet.close ?? price;

        for (const [, entry] of this._indicators) {
            const def = entry.def;
            const instance = entry.instance;
            if (!instance) continue;

            const source = def.source || "close";
            let val = close;
            if (source === "high") val = high;
            else if (source === "low") val = low;
            else if (source === "open") val = packet.open ?? price;

            if (instance instanceof IncrementalATR) {
                instance.update(high, low, close);
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

            if (instance.period !== newPeriod) {
                instance.period = newPeriod;
                if (instance.constructor.name === "IncrementalEMA") {
                    instance.multiplier = 2 / (newPeriod + 1);
                }

                const source = def.source || "close";
                const history = this.strategy.series(this.strategy.symbols[0], source);

                if (history && history.length > 0) {
                    if (instance instanceof IncrementalATR) {
                        const candles = this.strategy.dataManager.getLookbackWindow(this.strategy.symbols[0]);
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
