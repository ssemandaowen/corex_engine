"use strict";

const { bus, EVENTS } = require('../events/bus');
const logger = require('./logger');
const math = require('mathjs');
const indicators = require('technicalindicators');

/**
 * @class BaseStrategy
 * @description Core resource provider with Dynamic Settings Schema Support.
 * Refactored to align with Grademark/BacktestManager signal requirements.
 */
class BaseStrategy {
    constructor(config = {}) {
        // --- 1. CORE IDENTITY ---
        this.id = config.id || `strat_${Date.now()}`;
        this.name = config.name || "BaseStrategy";
        this.symbols = config.symbols || [];
        this.lookback = config.lookback || 100;
        this.candleBased = config.candleBased !== undefined ? config.candleBased : true;
        this.timeframe = config.timeframe || "1m";

        // --- EXECUTION CONTEXT ---
        this.mode = 'LIVE'; // Default; set to 'BACKTEST' by BacktestManager

        // --- DATA WINDOW MANAGEMENT ---
        this.max_data_history = config.max_data_history || 5000;

        // --- 2. RESOURCE INJECTION ---
        this.log = logger;
        this.math = math;
        this.indicators = indicators;
        this.bus = bus;
        this.EVENTS = EVENTS;

        // --- 3. DYNAMIC PARAMETER SYSTEM ---
        this.schema = {};
        this.params = {};
        this._applyDefaults(); 

        // --- 4. STATE & DATA ---
        this.enabled = false;
        this.startTime = null;
        this.lastTickTime = 0;
        this.position = null;
        this.data = new Map();
        this.lastTick = null; 
        this.currentBar = null; 
        
        this._initializeStores();
    }

    /**
     * @public
     * Engine Alias: Maps schema defaults to this.params.
     */
    initParams() {
        this._applyDefaults();
    }

    /**
     * @public
     * Sets the execution mode. Called by BacktestManager.run()
     */
    setMode(mode) {
        if (['LIVE', 'BACKTEST'].includes(mode)) {
            this.mode = mode;
            this.log.info(`[MODE_SET][${this.id}] Mode set to ${mode}`);
        }
    }

    /**
     * @private
     */
    _applyDefaults() {
        if (!this.schema || typeof this.schema !== 'object') return;
        for (const [key, spec] of Object.entries(this.schema)) {
            this.params[key] = spec.default !== undefined ? spec.default : null;
        }
    }

    /**
     * @public
     * UI Bridge for parameter updates.
     */
    updateParams(newParams) {
        if (!newParams || typeof newParams !== 'object') return;
        let hasChanged = false;

        for (const [key, rawValue] of Object.entries(newParams)) {
            const spec = this.schema[key];
            if (!spec) continue;

            let val = rawValue;
            if (spec.type === 'number') val = parseInt(rawValue);
            if (spec.type === 'float') val = parseFloat(rawValue);
            if (spec.type === 'boolean') val = (rawValue === true || rawValue === 'true');

            if (this.params[key] !== val) {
                this.params[key] = val;
                hasChanged = true;
            }
        }

        if (hasChanged) {
            this.bus.emit(this.EVENTS.SYSTEM.SETTINGS_UPDATED, {
                id: this.id,
                params: { ...this.params },
                timestamp: Date.now()
            });
        }
    }

    _initializeStores() {
        for (const symbol of this.symbols) {
            this.data.set(symbol, { candleHistory: [], activeCandle: null });
        }
    }

    _enforceWindow(store) {
        if (store.candleHistory.length > this.max_data_history) {
            store.candleHistory.shift();
        }
    }

    /**
     * @public
     * Primary entry for Tick Data.
     */
    onTick(tick, isWarmup = false) {
        if (!this.enabled && !isWarmup) return null;
        this.lastTick = tick;
        const store = this.data.get(tick.symbol);
        if (!store) return null;

        const price = tick.price || tick.close;
        const closed = this._updateCandle(store, tick.time, price);
        this._enforceWindow(store);

        try {
            if (!this.candleBased || closed) {
                return this.next(tick, isWarmup);
            }
        } catch (err) {
            this.log.error(`[EXEC_ERROR][${this.id}] ${err.message}`);
        }
        return null;
    }

    /**
     * @public
     * Primary entry for Bar Data. Utilized by BacktestManager.
     */
    onBar(bar, isWarmup = false) {
        if (!this.enabled && !isWarmup) return null;
        this.currentBar = bar;
        try {
            return this.next(bar, isWarmup);
        } catch (err) {
            this.log.error(`[EXEC_ERROR][${this.id}] ${err.message}`);
        }
        return null;
    }

    _updateCandle(store, ts, price) {
        let closed = false;
        const tfMs = this._getTFMs();
        const candleStart = Math.floor(ts / tfMs) * tfMs;

        if (!store.activeCandle || store.activeCandle.time !== candleStart) {
            if (store.activeCandle) {
                store.candleHistory.push({ ...store.activeCandle });
                closed = true;
            }
            store.activeCandle = { time: candleStart, open: price, high: price, low: price, close: price, volume: 0 };
        } else {
            store.activeCandle.high = Math.max(store.activeCandle.high, price);
            store.activeCandle.low = Math.min(store.activeCandle.low, price);
            store.activeCandle.close = price;
        }
        return closed;
    }

    _getTFMs() {
        const tf = this.timeframe.toString().toLowerCase();
        const units = { 's': 1000, 'm': 60000, 'h': 3600000, 'd': 86400000 };
        const val = parseInt(tf) || 1;
        const unit = tf.includes('min') ? 'm' : tf.slice(-1);
        return val * (units[unit] || 60000);
    }

    next(data, isWarmup) { return null; }

    executeLiveOrder(type, price, params) {
        this.log.info(`[LIVE_EXEC][${this.id}] ${type} at ${price}`);
        return { action: `ENTER_${type}`, price, ...params };
    }

    // --- TRADING LOGIC (Context-Aware) ---

   buy(params = {}) {
        if (this.position) return null;
        const price = this._resolveCurrentPrice(params);
        const symbol = params.symbol || this.symbols[0];
        
        this.position = { type: 'LONG', entry: price, time: Date.now(), symbol };
        return { action: 'ENTER_LONG', price, symbol, ...params };
    }

    sell(params = {}) {
        if (this.position) return null;
        const price = this._resolveCurrentPrice(params);
        const symbol = params.symbol || this.symbols[0];

        this.position = { type: 'SHORT', entry: price, time: Date.now(), symbol };
        return { action: 'ENTER_SHORT', price, symbol, ...params };
    }

    exit(params = {}) {
    if (!this.position) return null;
    const price = this._resolveCurrentPrice(params);
    const action = this.position.type === 'LONG' ? 'EXIT_LONG' : 'EXIT_SHORT';

    this.position = null; // Important: Clear local state

    return { action, price, ...params };
}

    /**
     * @private
     * Safe price resolution for both Grademark bars and Live ticks.
     */
    _resolveCurrentPrice(params) {
        if (params.price) return params.price;
        if (this.mode === 'BACKTEST') return this.currentBar ? this.currentBar.close : 0;
        
        const symbol = params.symbol || this.symbols[0];
        const store = this.data.get(symbol);
        return this.lastTick?.price || store?.activeCandle?.close || 0;
    }
}

module.exports = BaseStrategy;