"use strict";

const { bus, EVENTS } = require('../events/bus');
const logger = require('./logger');
const math = require('mathjs');
const indicators = require('data-forge-indicators');

/**
 * @class BaseStrategy
 * @description Core resource provider with Dynamic Settings Schema Support.
 */
class BaseStrategy {
    constructor(config = {}) {
        // --- 1. CORE IDENTITY ---
        this.id = config.id || `strat_${Date.now()}`;
        this.name = config.name || "BaseStrategy";
        this.symbols = config.symbols || [];
        this.timeframe = config.timeframe || "1m";
        this.lookback = config.lookback || 100;
        this.candleBased = config.candleBased !== undefined ? config.candleBased : true;

        // --- 2. RESOURCE INJECTION ---
        this.log = logger;
        this.math = math;
        this.indicators = indicators;
        this.bus = bus;
        this.EVENTS = EVENTS;

        // --- 3. DYNAMIC PARAMETER SYSTEM (New) ---
        // Child classes define 'this.schema' in their constructor.
        this.schema = {}; 
        this.params = {}; 

        // --- 4. STATE & DATA ---
        this.enabled = false;
        this.startTime = null;
        this.lastTickTime = 0;
        this.position = null; 
        this.data = new Map();
        this.max_data_history = 1000;

        this._initializeStores();
    }

    /**
     * @private
     * Initializes params using schema defaults.
     * Logic: Bootstraps the strategy state. Ensures that even without UI input, 
     * the strategy has a valid operational baseline.
     */
    _applyDefaults() {
        if (!this.schema || typeof this.schema !== 'object') {
            this.log.warn(`[INIT][${this.id}] No schema defined. Operating with empty params.`);
            return;
        }

        for (const [key, spec] of Object.entries(this.schema)) {
            // Priority: Default value from schema, otherwise null
            this.params[key] = spec.default !== undefined ? spec.default : null;
        }
        this.log.debug(`[INIT][${this.id}] Strategy parameters initialized from schema.`);
    }

    /**
     * @public
     * UI/API Bridge: Updates strategy parameters with strict validation and type safety.
     * Logic: Acts as a "Firewall" between untrusted UI/API inputs and the trading logic.
     */
    updateParams(newParams) {
        if (!newParams || typeof newParams !== 'object') return;

        let hasChanged = false;

        for (const [key, rawValue] of Object.entries(newParams)) {
            const spec = this.schema[key];
            
            // 1. Availability Check: Ignore params not defined in the schema
            if (!spec) continue;

            // 2. Type Casting & Normalization
            let sanitizedValue = rawValue;
            if (spec.type === 'number' || spec.type === 'float') {
                sanitizedValue = spec.type === 'number' ? parseInt(rawValue) : parseFloat(rawValue);
                
                // 3. Range Validation
                if (isNaN(sanitizedValue) || sanitizedValue < spec.min || sanitizedValue > spec.max) {
                    this.log.warn(`[VALIDATION][${this.id}] Rejecting ${key}: Value ${rawValue} out of bounds [${spec.min}-${spec.max}]`);
                    continue;
                }
            } else if (spec.type === 'boolean') {
                sanitizedValue = (rawValue === true || rawValue === 'true');
            }

            // 4. Change Detection: Prevent unnecessary event noise
            if (this.params[key] !== sanitizedValue) {
                this.params[key] = sanitizedValue;
                hasChanged = true;
                this.log.info(`[PARAM_SYNC][${this.id}] ${key} => ${sanitizedValue}`);
            }
        }

        // 5. System Notification: Only emit if data actually changed
        if (hasChanged) {
            this.bus.emit(this.EVENTS.SYSTEM.SETTINGS_UPDATED, { 
                id: this.id, 
                params: { ...this.params }, // Send a copy to prevent mutation
                timestamp: Date.now()
            });
        }
    }

    /**
     * @private
     * Optimized memory allocation for symbol data
     */
    _initializeStores() {
        for (const symbol of this.symbols) {
            this.data.set(symbol, {
                currentTick: null,
                candleHistory: [],
                activeCandle: null
            });
        }
    }

    /**
     * @public
     * Primary entry point for market data.
     */
    onPrice(tick, isWarmup = false) {
        if (!this.enabled && !isWarmup) return;

        if (tick.time <= this.lastTickTime) return;
        this.lastTickTime = tick.time;

        const store = this.data.get(tick.symbol);
        if (!store) return;

        store.currentTick = tick;
        const closed = this._updateCandle(store, tick.time, tick.price);

        // Memory Management: Keep history lean
        if (closed && store.candleHistory.length > this.max_data_history) {
            store.candleHistory.shift(); 
        }

        try {
            if (!this.candleBased || closed) {
                this.next(tick, isWarmup);
            }
        } catch (err) {
            this.log.error(`[EXEC_ERROR][${this.id}] ${err.message}`);
        }
    }

    _updateCandle(store, ts, price) {
        let closed = false;
        const tfMs = this._getTFMs();
        const candleStart = Math.floor(ts / tfMs) * tfMs;

        if (!store.activeCandle || store.activeCandle.timestamp !== candleStart) {
            if (store.activeCandle) {
                store.candleHistory.push({ ...store.activeCandle });
                closed = true;
            }
            store.activeCandle = { timestamp: candleStart, open: price, high: price, low: price, close: price, volume: 0 };
        } else {
            store.activeCandle.high = Math.max(store.activeCandle.high, price);
            store.activeCandle.low = Math.min(store.activeCandle.low, price);
            store.activeCandle.close = price;
        }
        return closed;
    }

    _getTFMs() {
        const units = { m: 60000, h: 3600000, d: 86400000 };
        return (parseInt(this.timeframe) || 1) * (units[this.timeframe.slice(-1)] || 60000);
    }

    next(tick, isWarmup) {}

    // --- EXECUTION TOOLS ---

    buy(params = {}) {
        if (this.position) return;
        const symbol = params.symbol || this.symbols[0];
        const store = this.data.get(symbol);
        const price = params.price || store.currentTick.price;

        this.position = { type: 'LONG', entry: price, time: Date.now() };
        this.bus.emit(this.EVENTS.ORDER.CREATE, { 
            strategyId: this.id, side: 'BUY', symbol, price, timestamp: this.position.time 
        });
    }

    sell(params = {}) {
        if (!this.position) return;
        const symbol = params.symbol || this.symbols[0];
        const store = this.data.get(symbol);
        const price = params.price || store.currentTick.price;

        this.bus.emit(this.EVENTS.ORDER.CREATE, { 
            strategyId: this.id, side: 'SELL', symbol, price, timestamp: Date.now() 
        });
        this.position = null;
    }
}

module.exports = BaseStrategy;