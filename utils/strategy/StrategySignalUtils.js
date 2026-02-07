"use strict";

const StrategySignalUtils = {
    crossover(a, b, opts = {}) {
        // Support both (a, b, data) and (a, b, { time, symbol })
        const normalized = (opts && opts.time) ? { barTime: opts.time, key: opts.key, symbol: opts.symbol } : opts;
        return this._evaluateCross(a, b, normalized || {}, 'up');
    },

    crossunder(a, b, opts = {}) {
        const normalized = (opts && opts.time) ? { barTime: opts.time, key: opts.key, symbol: opts.symbol } : opts;
        return this._evaluateCross(a, b, normalized || {}, 'down');
    },

    _evaluateCross(a, b, opts, direction) {
        let pA, nA, pB, nB;
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length < 2 || b.length < 2) return false;
            pA = a[a.length - 2];
            nA = a[a.length - 1];
            pB = b[b.length - 2];
            nB = b[b.length - 1];
        } else {
            // Handle direct value passing: pA, nA, pB, nB, opts
            pA = arguments[0]; nA = arguments[1];
            pB = arguments[2]; nB = arguments[3];
            opts = arguments[4] || {};
        }

        // Validate numbers
        if ([pA, nA, pB, nB].some(v => v == null || typeof v !== 'number')) return false;

        // Core logic
        const isCrossed = direction === 'up'
            ? (pA <= pB && nA > nB)
            : (pA >= pB && nA < nB);
            
        if (!isCrossed) return false;

        // --- FIXED STATE MANAGEMENT ---
        const barTime = opts.barTime || this.currentBar?.time || this.lastTick?.time;
        
        if (barTime && this._signalState) {
            const symbol = opts.symbol || (this.symbols ? this.symbols[0] : 'default');
            
            /**
             * We add the current position state to the key.
             * This allows the crossover to return 'true' during the exitRule (when long/short)
             * AND 'true' during the entryRule (when flat) on the exact same bar.
             */
            const currentPos = this.positions?.get(symbol)?.direction || 'flat';
            const autoKey = opts.key || `${direction}:${symbol}:${currentPos}`;
            
            if (this._signalState[autoKey] === barTime) return false;
            
            this._signalState[autoKey] = barTime;
        }
        return true;
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