"use strict";

const rootLogger = require("@utils/logger");
const { INTENTS, SIDES, DEFAULT_STRATEGY_CONFIG, PERFORMANCE } = require("@config/constants");
let _sharedMath = null; 
const getSharedMath = () => { 
    if (_sharedMath) return _sharedMath; 
    try { 
        _sharedMath = require("mathjs"); 
    } catch { 
        _sharedMath = null; 
    } 
    return _sharedMath; 
}; 
const { StrategyContract } = require("@core/core/strategy/StrategyContract");
const IndicatorAdapter = require("./strategy/IndicatorAdapter");
const {
    StrategyDataManager,
    StrategySignalUtils,
    StrategyDevHelpers,
    StrategyPositionManager,
    StrategyParamUtils,
    StrategyRuntimeUtils,
    RuleChain
} = require("./strategy");
const StrategyStateStore = require("./strategy/StrategyStateStore");

const SignalHelpers = {
    entryLong(params = {}) {
        const signal = this._createSignal(this.INTENT.ENTER, this.SIDE.LONG, params);
        if (signal) {
            const qty = this._resolveOrderQuantity({ signal, params });
            if (!Number.isFinite(qty) || qty <= 0) {
                this.log?.warn?.(`[${this.id}] entryLong rejected: invalid quantity`);
                return null;
            }
            this.positions.open(signal.symbol, "long", qty, signal.price);
            signal.quantity = qty;
            const protection = this._resolveProtectionLevels({
                side: this.SIDE.LONG,
                price: signal.price,
                params
            });
            if (protection.sl > 0)       signal.sl       = protection.sl;
            if (protection.tp > 0)       signal.tp       = protection.tp;
            if (protection.trailPct > 0) signal.trailPct = protection.trailPct;
        }
        return signal;
    },
    entryShort(params = {}) {
        const signal = this._createSignal(this.INTENT.ENTER, this.SIDE.SHORT, params);
        if (signal) {
            const qty = this._resolveOrderQuantity({ signal, params });
            if (!Number.isFinite(qty) || qty <= 0) {
                this.log?.warn?.(`[${this.id}] entryShort rejected: invalid quantity`);
                return null;
            }
            this.positions.open(signal.symbol, "short", qty, signal.price);
            signal.quantity = qty;
            const protection = this._resolveProtectionLevels({
                side: this.SIDE.SHORT,
                price: signal.price,
                params
            });
            if (protection.sl > 0)       signal.sl       = protection.sl;
            if (protection.tp > 0)       signal.tp       = protection.tp;
            if (protection.trailPct > 0) signal.trailPct = protection.trailPct;
        }
        return signal;
    },
    exitLong(params = {}) {
        const signal = this._createSignal(this.INTENT.EXIT, this.SIDE.LONG, params);
        if (signal) {
            const qty = this._resolveExitQuantity(signal.symbol, params.quantity);
            if (Number.isFinite(qty) && qty > 0) signal.quantity = qty;
            this.positions.close(signal.symbol, signal.price);
        }
        return signal;
    },
    exitShort(params = {}) {
        const signal = this._createSignal(this.INTENT.EXIT, this.SIDE.SHORT, params);
        if (signal) {
            const qty = this._resolveExitQuantity(signal.symbol, params.quantity);
            if (Number.isFinite(qty) && qty > 0) signal.quantity = qty;
            this.positions.close(signal.symbol, signal.price);
        }
        return signal;
    },
    exitAll(params = {}) {
        const signal = this._createSignal(this.INTENT.EXIT, this.SIDE.FLAT, params);
        if (signal) {
            const qty = this._resolveExitQuantity(signal.symbol, params.quantity);
            if (Number.isFinite(qty) && qty > 0) signal.quantity = qty;
            this.positions.close(signal.symbol, signal.price);
        }
        return signal;
    },

    /**
     * Flip helpers: exit now, enter opposite side on next bar.
     * Note: true same-bar flip isn't supported by grademark's exitRule.
     */
    flipToLong(params = {}) {
        this._flipNext = { side: this.SIDE.LONG, params };
        return this.exitAll(params);
    },

    flipToShort(params = {}) {
        this._flipNext = { side: this.SIDE.SHORT, params };
        return this.exitAll(params);
    },

    applyFlip(symbol) {
        if (!this._flipNext) return null;
        const next = this._flipNext;
        this._flipNext = null;
        return next.side === this.SIDE.LONG
            ? this.entryLong({ symbol, ...next.params })
            : this.entryShort({ symbol, ...next.params });
    }
};

/**
 * BaseStrategy – Pure Signal Generator
 * Focuses on efficiency, statistical access, and logical rule-chaining.
 */
class BaseStrategy {
    /**
     * @param {Object} config
     */
    constructor(config = {}) {
        this.runtimeId = config.runtimeId || config.id || `strat_${Date.now()}`;
        this.id = this.runtimeId;
        this.name = config.name || "BaseStrategy";
        this.__corexStandardized = true;
        this.symbols = Array.isArray(config.symbols) ? [...config.symbols] : [];
        if (this.symbols.length === 0) {
            throw new Error("BaseStrategy requires at least one symbol");
        }

        this.lookback = Math.max(10, config.lookback || 100);
        this.candleBased = config.candleBased !== false;
        this.timeframe = config.timeframe || "1m";

        this.max_data_history = Math.min(
            config.max_data_history || DEFAULT_STRATEGY_CONFIG.MAX_DATA_HISTORY,
            Math.max(500, this.lookback * PERFORMANCE.WARMUP_MULTIPLIER)
        );
        this.tfMs = this._getTFMs(this.timeframe);

        // ── Runtime context (injected by RuntimeLifecycle after broker boots) ──
        // These are set to safe defaults here; RuntimeLifecycle.boot() overwrites
        // them immediately after new StrategyClass() before any tick arrives.
        this._brokerRef    = null;
        this._posSnapshot  = { positions: {}, openCount: 0, totalUnrealized: 0 };

        /**
         * this.env — read-only execution environment block.
         * Set to real values by RuntimeLifecycle.boot() via _attachRuntime().
         * Safe to read in next() — will never be undefined.
         */
        this.env = Object.freeze({
            mode:       "UNKNOWN",
            isBacktest: false,
            isPaper:    false,
            isLive:     false,
            runtimeId:  this.runtimeId,
            symbol:     this.symbols[0] || "",
        });

        // Expose enums & dependencies
        this.INTENT = INTENTS;
        this.SIDE = SIDES;
        this.log = rootLogger.createModuleLogger(`STRATEGY:${this.id}`, {
            category: "strategy",
            ui: true,
            uiLevels: ["debug", "info", "warn", "error"]
        });
        Object.defineProperty(this, "math", { 
            configurable: false, 
            enumerable: true, 
            get: () => getSharedMath() 
        }); 
        this._indicatorAdapter = new IndicatorAdapter();
        Object.defineProperty(this, "indicators", { 
            configurable: false, 
            enumerable: true, 
            get: () => IndicatorAdapter.proxyFor(this._indicatorAdapter)
        }); 

        // Parameter system
        this.schema = this.defineSchema ? this.defineSchema() : {}; 
        this.params = {}; 
        this._applyDefaults(); 

        // Data stores
        this.dataManager = new StrategyDataManager({
            symbols: this.symbols,
            maxHistory: this.max_data_history
        });

        this.lastTick = null;
        this.currentBar = null;
        this._signalState = {}; // Used by StrategySignalUtils for cross-logic 
        this._flipNext = null; 
        this.positions = new StrategyPositionManager();

        /**
         * this.state — persistent key-value store.
         * Survives crashes and server restarts.
         * Flush callback is injected by strategyLoader after boot.
         *
         *   this.state.set("trend", "bull");
         *   this.state.get("trend");   // → "bull" even after restart
         */
        this.state = new StrategyStateStore(this.runtimeId);
        this._plugins = new Map(); 
        if (typeof this.definePlugins === "function") { 
            try { 
                const plugins = this.definePlugins(); 
                this.applyPlugins(plugins); 
            } catch (err) { 
                this.log?.warn?.(`[${this.id}] definePlugins failed: ${err.message}`); 
            } 
        } 
    } 

    /**
     * Called by RuntimeLifecycle.boot() immediately after the broker is ready.
     * Wires the live broker reference and env block into the strategy instance.
     * Never called for backtest runs (backtestManager wires broker directly).
     *
     * @param {object} opts
     * @param {object} opts.broker     - Live BaseBroker subclass instance
     * @param {string} opts.mode       - "PAPER" | "LIVE" | "BACKTEST"
     * @param {string} opts.runtimeId
     * @param {string} opts.symbol
     */
    _attachRuntime({ broker, mode, runtimeId, symbol }) {
        this._brokerRef = broker || null;
        const m = String(mode || "UNKNOWN").toUpperCase();
        this.env = Object.freeze({
            mode:       m,
            isBacktest: m === "BACKTEST",
            isPaper:    m === "PAPER",
            isLive:     m === "LIVE",
            runtimeId:  runtimeId || this.runtimeId,
            symbol:     symbol    || this.symbols[0] || "",
        });
        // Sync initial position snapshot from broker
        if (broker && typeof broker.getPositionSnapshot === "function") {
            this._posSnapshot = broker.getPositionSnapshot() ||
                { positions: {}, openCount: 0, totalUnrealized: 0 };
        }
    }

    /**
     * Sync the position snapshot from broker. Called by MarketFeed after
     * every broker.handle() so this.pos() always reflects real state.
     * @param {object} snapshot
     */
    _syncPositionSnapshot(snapshot) {
        if (snapshot && typeof snapshot === "object") {
            this._posSnapshot = snapshot;
        }
    }

    /** * Statistical Helper: Get array of values for indicators 
     */
    series(symbol, field = "close", n = null) { 
        const window = this.dataManager.getLookbackWindow(symbol || this.symbols[0], n || undefined); 
        return window.map(b => b[field]); 
    } 
 
    /** 
     * Plugin system: hot-swappable, per-strategy feature hooks. 
     * plugin = { name: string, apply(strategy) } 
     */ 
    use(plugin) { 
        if (!plugin || typeof plugin !== "object") return; 
        const name = String(plugin.name || "").trim(); 
        if (!name || this._plugins.has(name)) return; 
        if (typeof plugin.apply === "function") { 
            plugin.apply(this); 
        } 
        this._plugins.set(name, plugin); 
    } 
 
    applyPlugins(list = []) { 
        if (!Array.isArray(list)) return; 
        list.forEach((p) => { 
            if (typeof p === "string") { 
                let registry = null; 
                try { registry = require("./strategy/StrategyPluginRegistry"); } catch { registry = null; } 
                const resolved = registry?.get ? registry.get(p) : null; 
                if (resolved) this.use(resolved); 
                return; 
            } 
            this.use(p); 
        }); 
    } 
 
    /** 
     * Reset runtime state without losing configuration. 
     * Helps clean restarts and keeps memory stable. 
     */ 
    resetState() { 
        this.dataManager?.data?.clear?.(); 
        this.dataManager = new StrategyDataManager({ 
            symbols: this.symbols, 
            maxHistory: this.max_data_history 
        }); 
        this.lastTick = null; 
        this.currentBar = null; 
        this._signalState = {}; 
        this._featureState = {}; 
        this._flipNext = null; 
        this.positions = new StrategyPositionManager();
        // NOTE: this.state is intentionally NOT reset — persistent state
        // survives resets within a session. Use this.state.clear() explicitly
        // if you need to wipe it from within a strategy.
    } 
 
    destroy() { 
        // Flush persistent state synchronously before teardown
        if (this.state && typeof this.state.flush === "function") {
            this.state.flush().catch(() => {});
        }
        this.resetState(); 
        this._plugins?.clear?.(); 
    } 

    _processData(packet, meta = {}) {
        this._indicatorAdapter?._tickReset();

        const source = meta.source || meta.type || "tick";
        const isBar = source === "bar";

        if (!packet?.symbol || typeof packet.time !== "number") return null;

        const symbol = packet.symbol;

        if (isBar) {
            this.dataManager.ingestBar(packet);
            this.currentBar = packet;
        } else {
            this.lastTick = packet;
            const result = this.dataManager.updateTick({
                symbol,
                time: packet.time,
                price: packet.price ?? packet.close,
                volume: packet.volume ?? 0
            }, this.tfMs);
            if (this.candleBased && !result.closed) return null;
        }

        let signal = this.next(packet);

        if (!signal && this._flipNext) {
            signal = this.applyFlip(symbol);
        }

        if (signal) {
            signal.symbol = symbol;
            signal.time = packet.time;
            signal.barTime = this.currentBar?.time;
            signal.tf = this.timeframe;
        }

        return signal;
    }

    onTick(tick) {
        return this._processData(tick, { source: "tick" });
    }

    onBar(bar) {
        return this._processData(bar, { source: "bar" });
    }

    onMarketData(packet, context = {}) {
        if (context?.source === "bar") return this.onBar(packet);
        return this.onTick(packet);
    }

    generateSignal(packet, context = {}) {
        return this.onMarketData(packet, context);
    }

    next(data) { return null; }

    buy(params) { return this.entryLong(params); }
    sell(params) { return this.entryShort(params); }
    exit(params) { return this.exitAll(params); }
    long(params) { return this.entryLong(params); }
    short(params) { return this.entryShort(params); }
    close(params) { return this.exitAll(params); }

    rule(bar) {
        const ctx = bar && bar.time ? { barTime: bar.time } : {};
        return new RuleChain(this, ctx);
    }

    chain(bar) {
        return this.rule(bar);
    }

    /**
     * Position helper. If set=true, update position state.
     */
    pos(state, symbol, set = false) {
        const sym = symbol || this.symbols[0];
        if (set) {
            if (state === "flat") {
                this.positions.close(sym, this._resolveCurrentPrice({ symbol: sym }));
            } else {
                this.positions.open(sym, state, 1, this._resolveCurrentPrice({ symbol: sym }));
            }
            return true;
        }
        const record = this._posSnapshot.positions?.[sym];
        if (state === "flat") return !record || record.side === "flat";
        return record?.side === state;
    }

    _resolveOrderQuantity({ signal, params = {} } = {}) {
        const minQty = params.minQty ?? this.params?.minQty ?? 0;
        const maxQty = params.maxQty ?? this.params?.maxQty;
        const step = params.step ?? this.params?.qtyStep;

        const explicit = this._normalizeQuantity(params.quantity, {
            fallbackQty: 0,
            minQty,
            maxQty,
            step
        });
        if (explicit > 0) return explicit;

        const sized = this.sizePosition({
            symbol: signal?.symbol,
            price: signal?.price,
            riskPct: this.params?.riskPct ?? 1,
            minQty,
            maxQty,
            step,
            fallbackQty: 1
        });

        return this._normalizeQuantity(sized, {
            fallbackQty: 0,
            minQty,
            maxQty,
            step
        });
    }

    _resolveExitQuantity(symbol, requestedQty) {
        const openQty = Number(this._posSnapshot.positions?.[symbol]?.quantity || 0);
        const normalizedRequested = this._normalizeQuantity(requestedQty, {
            fallbackQty: 0,
            minQty: 0
        });
        if (normalizedRequested > 0 && openQty > 0) return Math.min(normalizedRequested, openQty);
        if (normalizedRequested > 0) return normalizedRequested;
        if (openQty > 0) return openQty;
        return 0;
    }
}
Object.assign(BaseStrategy.prototype, SignalHelpers);
Object.assign(BaseStrategy.prototype, StrategySignalUtils);
Object.assign(BaseStrategy.prototype, StrategyDevHelpers);
Object.assign(BaseStrategy.prototype, StrategyParamUtils);
Object.assign(BaseStrategy.prototype, StrategyRuntimeUtils);
StrategyContract.adapt(BaseStrategy.prototype);

module.exports = BaseStrategy;