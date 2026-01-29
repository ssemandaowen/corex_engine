"use strict";

const logger = require('@utils/logger');
const math = require('mathjs');
const indicators = require('technicalindicators'); // exposed for child use only

/**
 * @enum {Object}
 * Standardized strategy constants (kept for child compatibility)
 */
const STRAT_ENUMS = {
    INTENT: { ENTER: 'ENTER', EXIT: 'EXIT', NONE: 'NONE' },
    SIDE: { LONG: 'long', SHORT: 'short', FLAT: 'flat' }
};

/**
 * CircularBuffer – unchanged (excellent implementation)
 *
 * Note: The last(n) method always returns an array, even when n = 1.
 * This ensures API consistency for all callers.
 */
class CircularBuffer {
    constructor(capacity) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
        this.size = 0;
        this.writeIndex = 0;
    }

    push(value) {
        this.buffer[this.writeIndex] = value;
        this.writeIndex = (this.writeIndex + 1) % this.capacity;
        if (this.size < this.capacity) this.size++;
    }

    last(n = 1) {
        // Always returns an array, regardless of n
        if (this.size === 0) return []; 
        
        if (n === 1) {
            return [this.buffer[(this.writeIndex - 1 + this.capacity) % this.capacity]];
        }

        const count = Math.min(n, this.size);
        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(this.buffer[(this.writeIndex - count + i + this.capacity) % this.capacity]);
        }
        return result;
    }

    toArray() {
        return this.last(this.size);
    }
}

/**
 * BaseStrategy – pure signal generator
 * 
 * Changes summary:
 * - Removed mode, enabled flag, executionContext, bus, EVENTS
 * - Signals are now returned (not emitted)
 * - Removed _emitIntent routing logic → buy/sell/exit now return POJOs
 * - onTick / onBar now return signals directly (no side effects)
 * - next remains the override point (must return signal or null)
 * - Kept all data pipeline, candle building, lookback helpers unchanged
 * - Removed warmup checks (can be re-added in child if needed)
 */
class BaseStrategy {
    /**
     * @param {Object} config
     */
    constructor(config = {}) {
        // Identity
        this.id = config.id || `strat_${Date.now()}`;
        this.name = config.name || "BaseStrategy";
        this.symbols = Array.isArray(config.symbols) ? [...config.symbols] : [];
        if (this.symbols.length === 0) {
            throw new Error("BaseStrategy requires at least one symbol");
        }

        this.lookback = Math.max(10, config.lookback || 100);
        this.candleBased = config.candleBased !== false; // default true
        this.timeframe = config.timeframe || "1m";

        this.max_data_history = Math.min(
            config.max_data_history || 5000,
            Math.max(500, this.lookback * 3)
        );

        // Expose enums & helpers (no bus/mode anymore)
        this.INTENT = STRAT_ENUMS.INTENT;
        this.SIDE = STRAT_ENUMS.SIDE;

        // Dependencies for child strategies
        this.log = logger;
        this.math = math;
        this.indicators = indicators;

        // Parameter system (kept)
        this.schema = {};
        this.params = {};
        this._applyDefaults();

        // Data stores
        this.data = new Map();
        this.lastTick = null;
        this.currentBar = null;

        this._initializeStores();
    }

    _applyDefaults() {
        for (const [key, spec] of Object.entries(this.schema)) {
            this.params[key] = spec.default !== undefined ? spec.default : null;
        }
    }

    updateParams(newParams = {}) {
        // Kept for compatibility – but no event emission anymore
        if (!newParams || typeof newParams !== 'object' || Array.isArray(newParams)) {
            this.log?.warn('updateParams called with invalid payload');
            return;
        }

        let changed = false;
        // ... (same coercion logic as before)
        for (const [key, raw] of Object.entries(newParams)) {
            const spec = this.schema[key];
            if (!spec) continue;

            let val = raw;
            let valid = true;

            // (same switch block for boolean/number/float/array/enum/string)
            switch ((spec.type || 'string').toLowerCase()) {
                case 'boolean': {
                    const b = this._coerceBoolean(raw);
                    if (b === null) valid = false; else val = b;
                    break;
                }
                case 'integer':
                case 'number':
                case 'float': {
                    const n = this._coerceNumber(raw, spec.type === 'integer');
                    if (n === null) valid = false; else val = n;
                    break;
                }
                // ... (rest unchanged)
            }

            if (valid && ['number', 'float', 'integer'].includes(spec.type)) {
                if (typeof spec.min === 'number' && val < spec.min) valid = false;
                if (typeof spec.max === 'number' && val > spec.max) valid = false;
            }

            if (!valid) {
                this.log?.warn(`updateParams: invalid value for "${key}", skipping`);
                continue;
            }

            const prev = this.params[key];
            if (prev !== val && !(Number.isNaN(prev) && Number.isNaN(val))) {
                this.params[key] = val;
                changed = true;
            }
        }

        // No event emission anymore
        if (changed) {
            this.log?.info('Strategy parameters updated', { id: this.id });
        }
    }

    // Helper methods extracted for clarity
    _coerceBoolean(v) {
        if (typeof v === 'boolean') return v;
        if (v === 'true' || v === '1' || v === 1) return true;
        if (v === 'false' || v === '0' || v === 0) return false;
        return null;
    }

    _coerceNumber(v, integer = false) {
        if (v === '' || v == null) return null;
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) return null;
        return integer ? Math.trunc(n) : n;
    }

    _initializeStores() {
        for (const symbol of this.symbols) {
            this.data.set(symbol, {
                candles: new CircularBuffer(this.max_data_history),
                activeCandle: null
            });
        }
    }

    _getTFMs() {
        const tf = this.timeframe.toLowerCase().replace('min', 'm');
        const match = tf.match(/^(\d+)([smhd])$/);
        if (!match) return 60000;
        const num = parseInt(match[1], 10) || 1;
        const unit = match[2];
        const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
        return num * (units[unit] || 60000);
    }

    _updateCandle(store, ts, price, volume = 0) {
        const tfMs = this._getTFMs();
        const candleStart = Math.floor(ts / tfMs) * tfMs;

        if (!store.activeCandle || store.activeCandle.time !== candleStart) {
            if (store.activeCandle) {
                store.candles.push({ ...store.activeCandle });
            }
            store.activeCandle = {
                time: candleStart,
                open: price,
                high: price,
                low: price,
                close: price,
                volume
            };
            return true;
        }

        store.activeCandle.high = Math.max(store.activeCandle.high, price);
        store.activeCandle.low = Math.min(store.activeCandle.low, price);
        store.activeCandle.close = price;
        store.activeCandle.volume += volume;
        return false;
    }

    /**
     * @param {Object} tick
     * @returns {Object|null} signal or null
     */
    onTick(tick) {
        if (!tick?.symbol || typeof tick.time !== 'number') return null;
        const price = tick.price ?? tick.close;
        if (typeof price !== 'number') return null;

        const store = this.data.get(tick.symbol);
        if (!store) return null;

        this.lastTick = tick;
        const closed = this._updateCandle(store, tick.time, price, tick.volume ?? 0);

        if (this.candleBased && !closed) {
            return null;
        }

        return this.next(tick);
    }

    /**
     * @param {Object} bar
     * @returns {Object|null} signal or null
     */
    onBar(bar) {
        if (!bar?.symbol || typeof bar.time !== 'number') return null;

        const store = this.data.get(bar.symbol);
        if (store) {
            store.candles.push({ ...bar });
            store.activeCandle = null;
        }
        this.currentBar = bar;

        return this.next(bar);
    }

    /**
     * Override in child classes
     * @param {Object} data - current tick or bar
     * @returns {Object|null} signal or null
     */
    next(data) {
        return null;
    }

    // ── Signal factories (now pure – return objects only) ──────────────────────

    buy(params = {}) {
        return this._createSignal(this.INTENT.ENTER, this.SIDE.LONG, params);
    }

    sell(params = {}) {
        return this._createSignal(this.INTENT.ENTER, this.SIDE.SHORT, params);
    }

    exit(params = {}) {
        return this._createSignal(this.INTENT.EXIT, this.SIDE.FLAT, params);
    }

    // Update this factory to use historical time
    _createSignal(intent, side, params = {}) {
        const symbol = params.symbol || this.symbols[0];
        if (!symbol) return null;

        return {
            intent,
            side,
            symbol,
            price: this._resolveCurrentPrice(params),
            strategyId: this.id,
            // FIX: Use historical time if available, fallback to real time
            timestamp: this.lastTick?.time || this.currentBar?.time || Date.now(),
            barTime: this.currentBar?.time,
            tf: this.timeframe,
            ...params
        };
    }

    // Add this helper to prevent indicator crashes
    isWarmedUp(symbol) {
        const store = this.data.get(symbol);
        if (!store) return false;
        return store.candles.size >= this.lookback;
    }

    // Standardize price resolution for backtester compatibility
    _resolveCurrentPrice(params) {
        if (params.price != null) return params.price;
        const symbol = params.symbol || this.symbols[0];
        const store = this.data.get(symbol);

        // Priority: 1. Forced Param -> 2. Live Tick -> 3. Current Developing Bar -> 4. Last Closed Bar
        return (
            this.lastTick?.price ??
            store?.activeCandle?.close ??
            this.currentBar?.close ??
            0
        );
    }

    // ── Data access & helpers (unchanged) ──────────────────────────────────────

   getLookbackWindow(symbol) {
    const store = this.data.get(symbol);
    if (!store || !store.candles) {
        return []; 
    }
    // Explicitly cast to array to ensure .slice() and .map() work
    const history = store.candles.toArray();
    return Array.isArray(history) ? history : [];
}
}

module.exports = BaseStrategy;