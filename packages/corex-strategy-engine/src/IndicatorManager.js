"use strict";

const { globalIndicatorRegistry } = require("./IndicatorRegistry");
const IndicatorBank = require("./IndicatorBank");
const BaseIndicator = require("./indicators/BaseIndicator");
const Frame = require("./kernel/Frame");
const { ConfigError } = require("./params/errors");

const DISPATCH_MODES = Object.freeze({
    single: { arity: 1 },
    hl: { arity: 2 },
    volume: { arity: 2 },
    multi: { arity: 3 },
    hlv: { arity: 3 },
    rvi: { arity: 4 },
    hlcv: { arity: 4 },
    mfi: { arity: 3 }
});
const CANDLE_DISPATCH_MODES = new Set(["hl", "volume", "multi", "hlv", "rvi", "hlcv", "mfi"]);
const SOURCE_FIELDS = Object.freeze({
    open: "o", high: "h", low: "l", close: "c",
    volume: "v", hl2: "hl2", hlc3: "hlc3", ohlc4: "ohlc4"
});

function collectStaticIndicators(StrategyClass, stopAt) {
    let curr = StrategyClass;
    let result = {};
    while (curr && curr !== stopAt && curr !== Object) {
        if (curr.indicators) result = Object.assign({}, curr.indicators, result);
        curr = Object.getPrototypeOf(curr);
    }
    return result;
}

class IndicatorManager {
    constructor(strategy, registry = globalIndicatorRegistry) {
        this.strategy = strategy;
        this._registry = registry;
        this._indicators = new Map();
        this._entries = [];
        this._frameEntries = [];
        this._frameIndicators = [];
        this._legacyEntries = [];
        this._bank = new IndicatorBank();
        this._frame = new Frame();
        this._scratchFrame = new Frame();
        this._staticIndicators = collectStaticIndicators(strategy.constructor, null);
    }

    initialize() {
        for (const [name, indDef] of Object.entries(this._staticIndicators)) {
            const type = String(indDef.type || "").toUpperCase();
            const Cls = this._registry.get(type);
            const updateMode = this._classifyUpdate(Cls);
            this._assertDispatchArity(type, updateMode, Cls);
            const instance = this._createIndicator(indDef, Cls, name);
            if (!instance) continue;
            const entry = { name, instance, def: indDef, type, updateMode };
            this._indicators.set(name, entry);
            this._entries.push(entry);
            if (instance instanceof BaseIndicator) {
                this._frameEntries.push(entry);
                this._frameIndicators.push(instance);
                this._bank.add(name, instance);
            } else {
                this._legacyEntries.push(entry);
            }
        }
        return this;
    }

    _classifyUpdate(Cls) {
        return Cls && typeof Cls.updateMode === "string" ? Cls.updateMode : "single";
    }

    _assertDispatchArity(type, updateMode, Cls) {
        const spec = DISPATCH_MODES[updateMode];
        if (!spec) throw new Error("[IndicatorManager] Indicator '" + type + "' declares unknown updateMode '" + updateMode + "'.");
        const updateFn = Cls && Cls.prototype ? Cls.prototype.update : null;
        if (typeof updateFn !== "function") throw new Error("[IndicatorManager] Indicator '" + type + "' has no update() method.");
        if (updateFn.length !== spec.arity) {
            throw new Error("[IndicatorManager] Indicator '" + type + "' dispatch mismatch: mode '" +
                updateMode + "' supplies " + spec.arity + " argument(s), update() accepts " + updateFn.length + ".");
        }
    }

    _createIndicator(indDef, Cls, name = "unknown") {
        try {
            const resolvePeriod = def => this._resolvePeriod(def);
            const isFrameIndicator = Cls.prototype instanceof BaseIndicator;
            const params = typeof Cls.resolveParams === "function"
                ? Cls.resolveParams(indDef, resolvePeriod)
                : (isFrameIndicator ? [] : [this._resolvePeriod(indDef)]);
            if (isFrameIndicator) return new Cls(...params, { source: indDef.source || "close" });
            return new Cls(...params);
        } catch (error) {
            if (error instanceof ConfigError) {
                const key = error.configKey || "parameter";
                throw new ConfigError(key,
                    "Indicator '" + name + "' parameter '" + key + "': " + error.message,
                    error.code);
            }
            return null;
        }
    }

    _resolvePeriod(indDef) {
        if (indDef.periodKey && this.strategy.params && this.strategy.params[indDef.periodKey] != null) {
            const p = Number(this.strategy.params[indDef.periodKey]);
            if (Number.isFinite(p) && p > 0) return p;
        }
        const p = Number(indDef.period == null ? 14 : indDef.period);
        return Number.isFinite(p) && p > 0 ? p : 14;
    }

    updateIndicators(input) {
        const frame = input instanceof Frame ? input : (this._frame.load(input) ? this._frame : null);
        if (!frame) return false;

        const frameIndicators = this._frameIndicators;
        for (const indicator of frameIndicators) indicator.update(frame);
        if (this._legacyEntries.length === 0) return true;

        const h = frame.h;
        const l = frame.l;
        const c = frame.c;
        const o = frame.o;
        const v = frame.v;
        const typical = frame.hlc3;

        for (let i = 0; i < this._legacyEntries.length; i++) {
            const entry = this._legacyEntries[i];
            const instance = entry.instance;
            const mode = entry.updateMode;
            const source = SOURCE_FIELDS[entry.def.source || "close"] || "c";
            const value = frame[source];

            if (mode === "multi") instance.update(h, l, c);
            else if (mode === "hlv") instance.update(h, l, v);
            else if (mode === "hlcv") instance.update(h, l, c, v);
            else if (mode === "volume") instance.update(c, v);
            else if (mode === "rvi") instance.update(c, o, h, l);
            else if (mode === "hl") instance.update(h, l);
            else if (mode === "mfi") instance.update(typical, typical * v, v);
            else instance.update(value);
        }
        return true;
    }

    reseedIndicators() {
        const symbol = this.strategy.symbols[0];
        const data = this.strategy.dataManager && this.strategy.dataManager.data;
        const symbolData = data && typeof data.get === "function" ? data.get(symbol) : null;
        const store = symbolData ? symbolData.candles : null;

        for (let i = 0; i < this._frameEntries.length; i++) {
            const entry = this._frameEntries[i];
            const newPeriod = this._resolvePeriod(entry.def);
            entry.instance.reconfigure({
                period: newPeriod,
                source: entry.def.source || "close"
            }, store, this._scratchFrame);
            if (entry.def.periodKey && this.strategy.params) this.strategy.params[entry.def.periodKey] = newPeriod;
        }

        for (let i = 0; i < this._legacyEntries.length; i++) {
            const entry = this._legacyEntries[i];
            const instance = entry.instance;
            const newPeriod = this._resolvePeriod(entry.def);
            if (instance.period !== undefined && instance.period !== newPeriod) {
                if (typeof instance.setPeriod === "function") instance.setPeriod(newPeriod);
                else instance.period = newPeriod;
            }
            if (store && store.size > 0 && typeof instance.reseed === "function") {
                if (CANDLE_DISPATCH_MODES.has(entry.updateMode)) {
                    instance.reseed(store.last(store.size));
                } else {
                    const field = SOURCE_FIELDS[entry.def.source || "close"] || "close";
                    instance.reseed(store.getFieldSlice(field));
                }
            }
            if (entry.def.periodKey && this.strategy.params) this.strategy.params[entry.def.periodKey] = newPeriod;
        }
        return this;
    }

    getIndicatorValue(name) {
        const entry = this._indicators.get(name);
        return entry ? entry.instance : null;
    }

    get indicatorNames() {
        return this._entries.map(entry => entry.name);
    }

    get indicatorDefs() {
        return this._staticIndicators;
    }
}

module.exports = { IndicatorManager, collectStaticIndicators, DISPATCH_MODES };