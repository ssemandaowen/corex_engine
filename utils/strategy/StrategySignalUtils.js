"use strict";

function extractCrossInputs(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    if (a.length < 2 || b.length < 2) return null;
    return {
        pA: a[a.length - 2],
        nA: a[a.length - 1],
        pB: b[b.length - 2],
        nB: b[b.length - 1]
    };
}

function evaluateCross(pA, nA, pB, nB, direction) {
    if ([pA, nA, pB, nB].some((v) => v == null || typeof v !== "number")) return false;
    if (direction === "up") return pA <= pB && nA > nB;
    return pA >= pB && nA < nB;
}

const StrategySignalUtils = {
    crossover(a, b, opts = {}) {
        // Support both (a, b, data) and (a, b, { time, symbol })
        const normalized = (opts && opts.time) ? { barTime: opts.time, key: opts.key, symbol: opts.symbol } : opts;
        return this._evaluateCross(a, b, normalized || {}, "up");
    },

    crossunder(a, b, opts = {}) {
        const normalized = (opts && opts.time) ? { barTime: opts.time, key: opts.key, symbol: opts.symbol } : opts;
        return this._evaluateCross(a, b, normalized || {}, "down");
    },

    _evaluateCross(a, b, opts, direction) {
        const parsed = extractCrossInputs(a, b);
        if (!parsed) return false;
        const { pA, nA, pB, nB } = parsed;
        opts = opts || {};
        const isCrossed = evaluateCross(pA, nA, pB, nB, direction);
            
        if (!isCrossed) return false;

        // --- FIXED STATE MANAGEMENT ---
        const barTime = opts.barTime || this.currentBar?.time || this.lastTick?.time;
        
        if (barTime && this._signalState) {
            const symbol = opts.symbol || (this.symbols ? this.symbols[0] : "default");
            
            /**
             * We add the current position state to the key.
             * This allows the crossover to return 'true' during the exitRule (when long/short)
             * AND 'true' during the entryRule (when flat) on the exact same bar.
             */
            const currentPos = this._getCurrentPositionState(symbol);
            const autoKey = opts.key || `${direction}:${symbol}:${currentPos}`;
            
            if (this._signalState[autoKey] === barTime) return false;
            
            this._signalState[autoKey] = barTime;
        }
        return true;
    },

    _getCurrentPositionState(symbol) {
        const pos = this.positions?.get?.(symbol);
        if (!pos) return "flat";
        const raw = String(pos.side || pos.direction || "").toLowerCase();
        if (raw === "long" || raw === "buy") return "long";
        if (raw === "short" || raw === "sell") return "short";
        return "flat";
    },

    above(a, b) {
        const valA = Array.isArray(a) ? a[a.length - 1] : a;
        const valB = Array.isArray(b) ? b[b.length - 1] : b;
        return valA > valB;
    },

    below(a, b) {
        const valA = Array.isArray(a) ? a[a.length - 1] : a;
        const valB = Array.isArray(b) ? b[b.length - 1] : b;
        return valA < valB;
    },

    rising(series) {
        if (!Array.isArray(series) || series.length < 2) return false;
        return series[series.length - 1] > series[series.length - 2];
    },

    falling(series) {
        if (!Array.isArray(series) || series.length < 2) return false;
        return series[series.length - 1] < series[series.length - 2];
    },

    between(val, min, max, inclusive = true) {
        const v = Array.isArray(val) ? val[val.length - 1] : val;
        if (v == null) return false;
        return inclusive ? (v >= min && v <= max) : (v > min && v < max);
    },

    pctChange(series) {
        if (!Array.isArray(series) || series.length < 2) return 0;
        const now = series[series.length - 1];
        const prev = series[series.length - 2];
        return ((now - prev) / prev) * 100;
    }
};

module.exports = StrategySignalUtils;