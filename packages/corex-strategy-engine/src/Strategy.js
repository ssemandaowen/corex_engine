"use strict";

const rootLogger = require("@utils/logger");
const { INTENTS, SIDES, DEFAULT_STRATEGY_CONFIG, PERFORMANCE } = require("@config/constants");
const { StrategyContract } = require("@core/core/strategy/StrategyContract");
const StrategyStateStore = require("@utils/strategy/StrategyStateStore");
const StrategyDataManager = require("@utils/strategy/StrategyDataManager");
const StrategyPositionManager = require("./StrategyPositionManager");
const StrategyRuntimeUtils = require("./StrategyRuntimeUtils");
const ParamSchema = require("./ParamSchema");
const { IndicatorManager } = require("./IndicatorManager");
const { ContextBuilder } = require("./ContextBuilder");
const PlotBuffer = require("./PlotBuffer");

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

class Strategy {
    constructor(config = {}) {
        if (!config.symbols || (Array.isArray(config.symbols) && config.symbols.length === 0)) {
            if (Array.isArray(this.constructor.symbols) && this.constructor.symbols.length > 0) {
                config.symbols = [...this.constructor.symbols];
            }
        }
        if (!config.timeframe && this.constructor.timeframe) {
            config.timeframe = this.constructor.timeframe;
        }

        this.runtimeId = config.runtimeId || config.id || `strat_${Date.now()}`;
        this.id = this.runtimeId;
        this.name = config.name || this.constructor.name || "Strategy";
        this.__corexStandardized = true;

        this.symbols = Array.isArray(config.symbols) ? [...config.symbols] : [];
        if (this.symbols.length === 0) {
            throw new Error("Strategy requires at least one symbol");
        }

        const rawLookback = config.lookback !== undefined ? config.lookback : (this.constructor.lookback !== undefined ? this.constructor.lookback : 100);
        const MAX_ALLOWED_LOOKBACK = 100000;
        if (!Number.isFinite(Number(rawLookback)) || Number(rawLookback) <= 0) {
            throw new Error(`[Strategy] Invalid lookback window: ${rawLookback}. Lookback must be a positive finite number.`);
        }
        if (Number(rawLookback) > MAX_ALLOWED_LOOKBACK) {
            throw new Error(`[Strategy] Lookback window ${rawLookback} exceeds maximum allowed limit (${MAX_ALLOWED_LOOKBACK}).`);
        }
        this.lookback = Number(rawLookback);
        this.candleBased = config.candleBased !== false;
        this.timeframe = config.timeframe || "1m";

        this.max_data_history = Math.min(
            config.max_data_history || DEFAULT_STRATEGY_CONFIG.MAX_DATA_HISTORY,
            Math.max(500, this.lookback * PERFORMANCE.WARMUP_MULTIPLIER)
        );
        this.tfMs = this._getTFMs(this.timeframe);

        this._brokerRef = null;
        this._posSnapshot = { positions: {}, openCount: 0, totalUnrealized: 0 };

        this.env = Object.freeze({
            mode: "UNKNOWN",
            isBacktest: false,
            isPaper: false,
            isLive: false,
            runtimeId: this.runtimeId,
            symbol: this.symbols[0] || "",
        });

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

        // Resolve schema and params
        const staticParams = ParamSchema.collectFromClass(this.constructor);
        this.schema = ParamSchema.toSchema(staticParams);
        this.params = {};
        this._applyDefaults();
        if (config.params) {
            for (const [key, val] of Object.entries(config.params)) {
                this.params[key] = val;
            }
        }

        this.dataManager = new StrategyDataManager({
            symbols: this.symbols,
            maxHistory: this.max_data_history
        });

        this.lastTick = null;
        this.currentBar = null;
        this._signalState = {};
        this._flipNext = null;
        this.positions = new StrategyPositionManager();
        this.state = new StrategyStateStore(this.runtimeId);
        this.plotBuffer = new PlotBuffer(config.plotBufferOptions || {});

        this._declarativeInitialized = false;
        this._started = false;
        this._userHooks = {};
        this._indicatorManager = null;
        this._ctxBuilder = null;

        this._captureAndShadowHooks();
    }

    _attachRuntime({ broker, mode, runtimeId, symbol }) {
        this._brokerRef = broker || null;
        const m = String(mode || "UNKNOWN").toUpperCase();
        this.env = Object.freeze({
            mode: m,
            isBacktest: m === "BACKTEST",
            isPaper: m === "PAPER",
            isLive: m === "LIVE",
            runtimeId: runtimeId || this.runtimeId,
            symbol: symbol || this.symbols[0] || "",
        });
        if (broker && typeof broker.getPositionSnapshot === "function") {
            this._posSnapshot = broker.getPositionSnapshot() ||
                { positions: {}, openCount: 0, totalUnrealized: 0 };
        }
    }

    _syncPositionSnapshot(snapshot) {
        if (snapshot && typeof snapshot === "object") {
            this._posSnapshot = snapshot;
        }
    }

    _applyDefaults() {
        for (const [key, spec] of Object.entries(this.schema || {})) {
            const def = spec && Object.prototype.hasOwnProperty.call(spec, "default") ? spec.default : null;
            if (def && typeof def === "object" && !Array.isArray(def)) {
                try {
                    this.params[key] = JSON.parse(JSON.stringify(def));
                } catch {
                    this.params[key] = def;
                }
            } else {
                this.params[key] = def;
            }
        }
    }

    _captureAndShadowHooks() {
        const hooks = ["onStart", "onBar", "onTick", "onFill", "onStop"];
        for (const hook of hooks) {
            const fn = this[hook];
            if (typeof fn === "function" && fn !== Strategy.prototype[hook]) {
                this._userHooks[hook] = fn.bind(this);
                if (hook === "onBar") {
                    this.onBar = (packet) => this._processData(packet, { source: "bar" });
                } else if (hook === "onTick") {
                    this.onTick = (packet) => this._processData(packet, { source: "tick" });
                } else if (hook === "onFill") {
                    this.onFill = (fill) => {
                        this._ensureInitialized();
                        const ctx = this._ctxBuilder.buildContext(
                            { symbol: fill.symbol, time: fill.filled_at || Date.now(), close: fill.fill_price }, false
                        );
                        return this._userHooks.onFill(ctx, fill);
                    };
                }
            }
        }
    }

    _ensureInitialized() {
        if (this._declarativeInitialized) return;
        this._declarativeInitialized = true;

        this._indicatorManager = new IndicatorManager(this);
        this._indicatorManager.initialize();

        this._ctxBuilder = new ContextBuilder(this, this._indicatorManager);
        this._ctxBuilder.ensureInitialized();
    }

    series(symbol, field = "close", n = null) {
        const window = this.dataManager.getLookbackWindow(symbol || this.symbols[0], n || undefined);
        return window.map(b => b[field]);
    }

    getPlotDelta() {
        return this.plotBuffer ? this.plotBuffer.getPlotDelta() : { series: {}, marks: [] };
    }

    resetState() {
        this.dataManager?.data?.clear?.();
        this.dataManager = new StrategyDataManager({
            symbols: this.symbols,
            maxHistory: this.max_data_history
        });
        this.lastTick = null;
        this.currentBar = null;
        this._signalState = {};
        this._flipNext = null;
        this.positions = new StrategyPositionManager();
    }

    destroy() {
        this._ensureInitialized();
        if (this._userHooks.onStop) {
            try {
                const ctx = this._ctxBuilder.buildContext(
                    { symbol: this.symbols[0], time: Date.now(), close: 0 }, false
                );
                this._userHooks.onStop(ctx);
            } catch (_) {}
        }
        if (this.state && typeof this.state.flush === "function") {
            this.state.flush().catch(() => {});
        }
        this.resetState();
    }

    _processData(packet, meta = {}) {
        this._ensureInitialized();

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

        if (!this._started) {
            const ctxInit = this._ctxBuilder.buildContext(packet, isBar);
            if (typeof this._userHooks.onStart === "function") {
                this._userHooks.onStart(ctxInit);
            }
            this._started = true;
        }

        const ctx = this._ctxBuilder.buildContext(packet, isBar);
        let signal = null;

        if (isBar && typeof this._userHooks.onBar === "function") {
            signal = this._userHooks.onBar(ctx, packet);
        } else if (!isBar && typeof this._userHooks.onTick === "function") {
            signal = this._userHooks.onTick(ctx, packet);
        } else if (typeof this.generateSignal === "function" && this.generateSignal !== Strategy.prototype.generateSignal) {
            signal = this.generateSignal(packet, { isWarmup: false });
        }

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

    buy(params) { return this.entryLong(params); }
    sell(params) { return this.entryShort(params); }
    exit(params) { return this.exitAll(params); }
    long(params) { return this.entryLong(params); }
    short(params) { return this.entryShort(params); }
    close(params) { return this.exitAll(params); }

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

    updateParams(newParams = {}) {
        this._ensureInitialized();
        if (!newParams || typeof newParams !== "object" || Array.isArray(newParams)) return;

        let changed = false;
        for (const [key, val] of Object.entries(newParams)) {
            if (this.params[key] !== val) {
                this.params[key] = val;
                changed = true;
            }
        }

        if (changed && this._indicatorManager) {
            this._indicatorManager.reseedIndicators();
        }
    }

    onStart(ctx) {}
    onStop(ctx) {}
    onFill(ctx, fill) {}
}

Object.assign(Strategy.prototype, SignalHelpers);
Object.assign(Strategy.prototype, StrategyRuntimeUtils);
StrategyContract.adapt(Strategy.prototype);

module.exports = { Strategy };
