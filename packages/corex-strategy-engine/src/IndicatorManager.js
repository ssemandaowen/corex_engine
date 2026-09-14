"use strict";

const { globalIndicatorRegistry } = require("./IndicatorRegistry");

const MULTI_ARG_INDICATORS = new Set([
    "ATR", "SUPERTREND", "KELTNERCHANNELS", "DONCHIANCHANNELS", "STOCHASTIC",
    "WILLIAMSR", "ULTIMATEOSCILLATOR", "ADX", "VORTEX", "CHOPPINGINDEX",
    "CMF", "AD", "EASEOFMOVEMENT", "BOLLINGERBANDS", "ICHIMOKU"
]);

const VOLUME_INDICATORS = new Set(["OBV", "MFI", "CMF", "AD", "EASEOFMOVEMENT", "VWAP", "ANCHOREDVWAP"]);

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
                const type = String(indDef.type || "").toUpperCase();
                const updateMode = this._classifyUpdate(type);
                this._indicators.set(name, { instance, def: indDef, type, updateMode });
            }
        }
    }

    _classifyUpdate(type) {
        if (MULTI_ARG_INDICATORS.has(type)) return "multi";
        if (VOLUME_INDICATORS.has(type)) return "volume";
        if (type === "RVI") return "rvi";
        return "single";
    }

    _createIndicator(indDef) {
        const type = String(indDef.type || "").toUpperCase();
        const Cls = globalIndicatorRegistry.get(type);
        if (!Cls) return null;

        const params = this._resolveParams(indDef);
        try {
            return new Cls(...params);
        } catch (e) {
            return null;
        }
    }

    _resolveParams(indDef) {
        const type = String(indDef.type || "").toUpperCase();
        const period = this._resolvePeriod(indDef);
        const multiplier = Number(indDef.multiplier || 2);

        if (type === "MACD") {
            return [
                Number(indDef.fast || 12),
                Number(indDef.slow || 26),
                Number(indDef.signal || 9)
            ];
        }

        if (type === "BOLLINGERBANDS") {
            return [period, multiplier];
        }

        if (type === "KELTNERCHANNELS") {
            return [period, multiplier];
        }

        if (type === "ICHIMOKU") {
            return [
                Number(indDef.conversion || 9),
                Number(indDef.base || 26),
                Number(indDef.lagging || 52),
                Number(indDef.displacement || 26)
            ];
        }

        if (type === "PARABOLICSAR") {
            return [
                Number(indDef.step || 0.02),
                Number(indDef.maxStep || 0.2)
            ];
        }

        if (type === "SUPERTREND") {
            return [period, multiplier];
        }

        if (type === "WMA") {
            return [period];
        }

        if (type === "ALMA") {
            return [
                period,
                Number(indDef.offset || 6),
                Number(indDef.sigma || 3)
            ];
        }

        if (type === "KAMA") {
            return [
                period,
                Number(indDef.fast || 2),
                Number(indDef.slow || 30)
            ];
        }

        if (type === "VIDYA") {
            return [
                period,
                Number(indDef.fast || 2),
                Number(indDef.slow || 30)
            ];
        }

        if (type === "LINEARREGRESSION") {
            return [period];
        }

        if (type === "ULTIMATEOSCILLATOR") {
            return [
                Number(indDef.period1 || 7),
                Number(indDef.period2 || 14),
                Number(indDef.period3 || 28)
            ];
        }

        if (type === "STC") {
            return [
                Number(indDef.cycle || 10),
                Number(indDef.entry || 0.3),
                Number(indDef.signal || 5)
            ];
        }

        if (type === "LAGUERRERI") {
            return [Number(indDef.gamma || 0.5)];
        }

        if (type === "CONNORSPERI") {
            return [
                Number(indDef.rsi || 3),
                Number(indDef.streak || 2),
                Number(indDef.roc || 2)
            ];
        }

        if (type === "FISHER") {
            return [period];
        }

        if (type === "ZSCORE") {
            return [period];
        }

        if (type === "DPO") {
            return [period];
        }

        if (type === "COPPOCKE") {
            return [period, Number(indDef.period2 || 14)];
        }

        if (type === "HURST") {
            return [period];
        }

        if (type === "FDI") {
            return [period];
        }

        return [period];
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