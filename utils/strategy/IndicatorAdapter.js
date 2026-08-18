// utils/strategy/IndicatorAdapter.js
"use strict";

/**
 * CoreX Technical Indicator Adapter
 * Implements a library-agnostic, lazy-evaluated indicator cache.
 * Results are held for the lifetime of exactly one tick, preventing CPU thrashing.
 */
class IndicatorAdapter {
    constructor() {
        this._cache = new Map(); // Key: "NAME:JSON_string_args" -> computed array result
        this._lib = null;        // Lazy-loaded library reference handle
    }

    /**
     * Clears out all computed frames before a new strategy cycle begins.
     */
    _tickReset() {
        this._cache.clear();
    }

    /**
     * Resolves calculation signatures by checking the active single-tick cache.
     */
    _resolve(indicatorName, args) {
        const cacheKey = `${indicatorName}:${JSON.stringify(args)}`;

        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        const lib = this._getLib();
        if (!lib[indicatorName] || typeof lib[indicatorName].calculate !== "function") {
            throw new Error(`[IndicatorAdapter] Technical indicator function '${indicatorName}' is missing or unsupported.`);
        }

        const calculatedResult = lib[indicatorName].calculate(args);
        this._cache.set(cacheKey, calculatedResult);
        return calculatedResult;
    }

    /**
     * Lazy-requires technicalindicators to protect startup footprints.
     */
    _getLib() {
        if (!this._lib) {
            this._lib = require("technicalindicators");
        }
        return this._lib;
    }

    /**
     * Generates a native JavaScript Proxy wrapper.
     * Maps syntax paths such as: `this.indicators.EMA.calculate(args)`.
     */
    static proxyFor(adapterInstance) {
        return new Proxy(adapterInstance, {
            get(target, name) {
                // If checking internal lifecycle parameters, return them directly
                if (name in target) {
                    return target[name];
                }
                // Return a closure executor evaluating calculations dynamically
                return {
                    calculate: (args) => target._resolve(name, args)
                };
            }
        });
    }
}

module.exports = IndicatorAdapter;