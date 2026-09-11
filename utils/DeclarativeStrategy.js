"use strict";

const BaseStrategy = require("./BaseStrategy");
const { IncrementalEMA, IncrementalRSI, IncrementalATR } = require("./strategy/IncrementalIndicators");

/**
 * TA (TradingView-style Technical Analysis) helpers
 */
const ta = {
    crossover(a, b) {
        const valA = typeof a === "object" ? a.value : a;
        const prevA = typeof a === "object" ? a.prev : a;
        const valB = typeof b === "object" ? b.value : b;
        const prevB = typeof b === "object" ? b.prev : b;
        return prevA <= prevB && valA > valB;
    },
    crossunder(a, b) {
        const valA = typeof a === "object" ? a.value : a;
        const prevA = typeof a === "object" ? a.prev : a;
        const valB = typeof b === "object" ? b.value : b;
        const prevB = typeof b === "object" ? b.prev : b;
        return prevA >= prevB && valA < valB;
    },
    highest(arr, length) {
        if (!Array.isArray(arr) || arr.length === 0) return 0;
        const slice = arr.slice(-length);
        return Math.max(...slice);
    },
    lowest(arr, length) {
        if (!Array.isArray(arr) || arr.length === 0) return 0;
        const slice = arr.slice(-length);
        return Math.min(...slice);
    },
    rising(arr, length = 1) {
        if (!Array.isArray(arr) || arr.length <= length) return false;
        for (let i = arr.length - length; i < arr.length; i++) {
            if (arr[i] <= arr[i - 1]) return false;
        }
        return true;
    },
    falling(arr, length = 1) {
        if (!Array.isArray(arr) || arr.length <= length) return false;
        for (let i = arr.length - length; i < arr.length; i++) {
            if (arr[i] >= arr[i - 1]) return false;
        }
        return true;
    },
    change(arr, length = 1) {
        if (!Array.isArray(arr) || arr.length <= length) return 0;
        return arr[arr.length - 1] - arr[arr.length - 1 - length];
    }
};

const util = {
    round(val, decimals = 2) {
        const factor = Math.pow(10, decimals);
        return Math.round(val * factor) / factor;
    },
    positionSize(capital, riskPct, stopLossPips) {
        if (!stopLossPips || stopLossPips <= 0) return 1;
        const riskAmount = capital * (riskPct / 100);
        return riskAmount / stopLossPips;
    }
};

class DeclarativeStrategy extends BaseStrategy {
    constructor(config = {}) {
        super(config);
        this._config = config;
        this.params = {};
        this._incrementalIndicators = {};
        this._declarativeInitialized = false;
        this._initialized = false;
        this._ensureInitialized();
    }

    _ensureInitialized() {
        if (this._declarativeInitialized) return;
        this._declarativeInitialized = true;

        // Capture user-defined hooks and shadow prototype methods with engine wrappers
        if (typeof this.onBar === "function" && this.onBar !== DeclarativeStrategy.prototype.onBar) {
            this._userOnBar = this.onBar;
            this.onBar = (packet) => this._processData(packet, { source: "bar" });
        }
        if (typeof this.onTick === "function" && this.onTick !== DeclarativeStrategy.prototype.onTick) {
            this._userOnTick = this.onTick;
            this.onTick = (packet) => this._processData(packet, { source: "tick" });
        }
        if (typeof this.onStart === "function" && this.onStart !== DeclarativeStrategy.prototype.onStart) {
            this._userOnStart = this.onStart;
        }
        if (typeof this.onFill === "function" && this.onFill !== DeclarativeStrategy.prototype.onFill) {
            this._userOnFill = this.onFill;
            this.onFill = (fill) => {
                this._ensureInitialized();
                const ctx = this._buildCtx({ symbol: fill.symbol, time: fill.filled_at || Date.now(), close: fill.fill_price }, false);
                return this._userOnFill(ctx, fill);
            };
        }
        if (typeof this.onStop === "function" && this.onStop !== DeclarativeStrategy.prototype.onStop) {
            this._userOnStop = this.onStop;
        }

        // Walk prototype chain to collect static params
        let currP = this.constructor;
        let StaticParams = {};
        while (currP && currP !== BaseStrategy && currP !== Object) {
            if (currP.params) {
                StaticParams = { ...currP.params, ...StaticParams };
            }
            currP = Object.getPrototypeOf(currP);
        }

        this.params = {};
        for (const [key, def] of Object.entries(StaticParams)) {
            const defVal = def !== null && typeof def === "object" && def.default !== undefined ? def.default : def;
            this.params[key] = this._config.params?.[key] !== undefined ? this._config.params[key] : defVal;
        }

        // Walk prototype chain to collect static indicators
        let currI = this.constructor;
        let StaticIndicators = {};
        while (currI && currI !== BaseStrategy && currI !== Object) {
            if (currI.indicators) {
                StaticIndicators = { ...currI.indicators, ...StaticIndicators };
            }
            currI = Object.getPrototypeOf(currI);
        }

        this._incrementalIndicators = {};
        for (const [name, indDef] of Object.entries(StaticIndicators)) {
            const type = String(indDef.type || "").toUpperCase();
            const period = (indDef.periodKey && this.params[indDef.periodKey]) || indDef.period || 14;
            if (type === "EMA") {
                this._incrementalIndicators[name] = new IncrementalEMA(period);
            } else if (type === "RSI") {
                this._incrementalIndicators[name] = new IncrementalRSI(period);
            } else if (type === "ATR") {
                this._incrementalIndicators[name] = new IncrementalATR(period);
            }
        }
    }

    /**
     * Dynamic parameter update with indicator re-seeding without strategy restart
     */
    updateParams(newParams = {}) {
        this._ensureInitialized();
        let indicatorsAffected = false;
        for (const [key, val] of Object.entries(newParams)) {
            if (this.params[key] !== val) {
                this.params[key] = val;
                indicatorsAffected = true;
            }
        }

        if (indicatorsAffected) {
            let currI = this.constructor;
            let StaticIndicators = {};
            while (currI && currI !== BaseStrategy && currI !== Object) {
                if (currI.indicators) {
                    StaticIndicators = { ...currI.indicators, ...StaticIndicators };
                }
                currI = Object.getPrototypeOf(currI);
            }

            for (const [name, indDef] of Object.entries(StaticIndicators)) {
                const period = (indDef.periodKey && this.params[indDef.periodKey]) || indDef.period || 14;
                const ind = this._incrementalIndicators[name];
                if (ind && ind.period !== period) {
                    ind.period = period;
                    if (ind instanceof IncrementalEMA) {
                        ind.multiplier = 2 / (period + 1);
                    }
                    // Re-seed from available historical data
                    const source = indDef.source || "close";
                    const history = this.series(this.symbols[0], source);
                    if (history && history.length > 0) {
                        if (ind instanceof IncrementalATR) {
                            const candles = this.dataManager.getLookbackWindow(this.symbols[0]);
                            ind.reseed(candles);
                        } else {
                            ind.reseed(history);
                        }
                    }
                }
            }
        }
    }

    _buildCtx(packet, isBar) {
        this._ensureInitialized();
        const symbol = packet.symbol || this.symbols[0];
        const pos = this.positions?.get(symbol) || null;
        
        // Update incremental indicators with current packet values
        const price = packet.price ?? packet.close ?? 0;
        const high = packet.high ?? price;
        const low = packet.low ?? price;
        const close = packet.close ?? price;

        let currI = this.constructor;
        let StaticIndicators = {};
        while (currI && currI !== BaseStrategy && currI !== Object) {
            if (currI.indicators) {
                StaticIndicators = { ...currI.indicators, ...StaticIndicators };
            }
            currI = Object.getPrototypeOf(currI);
        }

        for (const [name, ind] of Object.entries(this._incrementalIndicators)) {
            const indDef = StaticIndicators[name];
            const sourceField = indDef?.source || "close";
            const val = sourceField === "high" ? high : sourceField === "low" ? low : sourceField === "open" ? (packet.open ?? price) : close;
            
            if (ind instanceof IncrementalATR) {
                ind.update(high, low, close);
            } else {
                ind.update(val);
            }
        }

        const indicatorsProxy = {};
        for (const [name, ind] of Object.entries(this._incrementalIndicators)) {
            indicatorsProxy[name] = ind; // exposes .value, .prev, .ready
        }

        const self = this;
        const ctx = {
            params: this.params,
            indicators: indicatorsProxy,
            ta,
            util,
            position: {
                side: pos?.side || "FLAT",
                entryPrice: pos?.entryPrice || 0,
                size: pos?.quantity || pos?.size || 0,
                unrealizedPnL: pos?.unrealizedPnL || 0
            },
            state: this.state,
            engine: {
                mode: this.mode,
                barsReceived: this.currentBar ? 1 : 0,
                connected: true
            },
            go: {
                long(qty = 1, price = null) {
                    return self.buy({ quantity: qty, price: price ?? close, symbol });
                },
                short(qty = 1, price = null) {
                    return self.sell({ quantity: qty, price: price ?? close, symbol });
                },
                scale(qty = 1, price = null) {
                    return self.buy({ quantity: qty, price: price ?? close, symbol, allowScaling: true });
                },
                protect({ sl, tp, trailPct } = {}) {
                    return { intent: "PROTECT", sl, tp, trailPct, symbol };
                }
            },
            flat() {
                return self.close({ symbol });
            }
        };

        return ctx;
    }

    _processData(packet, meta = {}) {
        this._ensureInitialized();
        if (!this._initialized) {
            const ctxInit = this._buildCtx(packet, meta.source === "bar");
            if (typeof this._userOnStart === "function") {
                this._userOnStart(ctxInit);
            }
            this._initialized = true;
        }

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

        const ctx = this._buildCtx(packet, isBar);
        let signal = null;

        if (isBar && typeof this._userOnBar === "function") {
            signal = this._userOnBar(ctx, packet);
        } else if (!isBar && typeof this._userOnTick === "function") {
            signal = this._userOnTick(ctx, packet);
        } else if (typeof this.generateSignal === "function" && this.generateSignal !== DeclarativeStrategy.prototype.generateSignal) {
            signal = this.generateSignal(packet, { isWarmup: false });
        }

        if (signal) {
            signal.symbol = symbol;
            signal.time = packet.time;
            signal.barTime = this.currentBar?.time;
            signal.tf = this.timeframe;
        }

        return signal;
    }

    onBar(packet) {
        this._ensureInitialized();
        return this._processData(packet, { source: "bar" });
    }

    onTick(packet) {
        this._ensureInitialized();
        return this._processData(packet, { source: "tick" });
    }

    destroy() {
        this._ensureInitialized();
        if (typeof this._userOnStop === "function") {
            try {
                const ctx = this._buildCtx({ symbol: this.symbols[0], time: Date.now(), close: 0 }, false);
                this._userOnStop(ctx);
            } catch {}
        }
        super.destroy();
    }
}

module.exports = DeclarativeStrategy;
