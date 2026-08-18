"use strict";

const { TIME } = require("@config/constants");

const StrategyRuntimeUtils = {
    _getTFMs(tfInput = this.timeframe) {
        const tf = String(tfInput || "").toLowerCase().replace("min", "m");
        const match = tf.match(TIME.TF_PATTERN);
        if (!match) return TIME.MS.MINUTE;
        const units = {
            s: TIME.MS.SECOND,
            m: TIME.MS.MINUTE,
            h: TIME.MS.HOUR,
            d: TIME.MS.DAY
        };
        return (parseInt(match[1], 10) || 1) * (units[match[2]] || TIME.MS.MINUTE);
    },

    _createSignal(intent, side, params = {}) {
        const symbol = this.resolveSymbol ? this.resolveSymbol({ symbol: params.symbol }) : (params.symbol || this.symbols[0]);
        const reserved = new Set(["intent", "side", "strategyId", "timestamp", "barTime", "tf", "symbol", "quantity"]);
        const extras = {};
        Object.entries(params || {}).forEach(([k, v]) => {
            if (!reserved.has(k)) extras[k] = v;
        });
        const qty = this._normalizeQuantity(params.quantity, {
            fallbackQty: 0,
            minQty: params.minQty ?? this.params?.minQty ?? 0,
            maxQty: params.maxQty ?? this.params?.maxQty,
            step: params.step ?? this.params?.qtyStep
        });

        return {
            intent,
            side,
            symbol,
            price: this._resolveCurrentPrice(params),
            strategyId: this.id,
            timestamp: this.lastTick?.time || this.currentBar?.time || Date.now(),
            barTime: this.currentBar?.time,
            tf: this.timeframe,
            ...(qty > 0 ? { quantity: qty } : {}),
            ...extras
        };
    },

    _resolveProtectionLevels({ side, price, params = {} } = {}) {
        const px = Number(price);
        const directSl = Number(params.sl ?? params.stopLoss ?? params.stop_loss ?? 0);
        const directTp = Number(params.tp ?? params.takeProfit ?? params.take_profit ?? 0);
        const slPct = Number(params.slPct ?? params.stopLossPct ?? params.stop_loss_pct ?? 0);
        const tpPct = Number(params.tpPct ?? params.takeProfitPct ?? params.take_profit_pct ?? 0);
        const trailPct = Number(params.trailPct ?? params.trailStopPct ?? 0);

        let sl = Number.isFinite(directSl) && directSl > 0 ? directSl : 0;
        let tp = Number.isFinite(directTp) && directTp > 0 ? directTp : 0;

        if (Number.isFinite(px) && px > 0) {
            const normalizedSide = String(side || "").toLowerCase();
            if (!sl && Number.isFinite(slPct) && slPct > 0) {
                sl = normalizedSide === "short"
                    ? px * (1 + (slPct / 100))
                    : px * (1 - (slPct / 100));
            }
            if (!tp && Number.isFinite(tpPct) && tpPct > 0) {
                tp = normalizedSide === "short"
                    ? px * (1 - (tpPct / 100))
                    : px * (1 + (tpPct / 100));
            }
        }

        return {
            sl:       Number.isFinite(sl) && sl > 0 ? Number(sl.toFixed(8)) : 0,
            tp:       Number.isFinite(tp) && tp > 0 ? Number(tp.toFixed(8)) : 0,
            trailPct: Number.isFinite(trailPct) && trailPct > 0 ? trailPct : 0,
        };
    },

    _normalizeQuantity(rawQty, { fallbackQty = 0, minQty = 0, maxQty, step } = {}) {
        let qty = Number(rawQty);
        if (!Number.isFinite(qty) || qty <= 0) qty = Number(fallbackQty || 0);
        if (!Number.isFinite(qty) || qty <= 0) return 0;

        const min = Number(minQty);
        if (Number.isFinite(min) && min > 0) qty = Math.max(min, qty);

        const max = Number(maxQty);
        if (Number.isFinite(max) && max > 0) qty = Math.min(max, qty);

        const stepSize = Number(step);
        if (Number.isFinite(stepSize) && stepSize > 0) {
            qty = Math.floor(qty / stepSize) * stepSize;
        }

        if (!Number.isFinite(qty) || qty <= 0) return 0;
        return Number(qty.toFixed(8));
    },

    _resolveCurrentPrice(params = {}) {
        if (params.price != null) return params.price;
        const symbol = params.symbol || this.symbols[0];
        const store = this.dataManager?.data?.get(symbol);
        return this.lastTick?.price ?? store?.activeCandle?.close ?? this.currentBar?.close ?? 0;
    },

    isWarmedUp(symbol) {
        return this.dataManager.isWarmedUp(symbol || this.symbols[0], this.lookback);
    },

    getLookbackWindow(symbol) {
        return this.dataManager.getLookbackWindow(symbol);
    },

    getAccountSnapshot() {
        // _brokerRef is injected by _attachRuntime() (RuntimeLifecycle.boot).
        // In backtest mode, backtestManager injects it directly via the broker arg.
        const broker = this._brokerRef;
        if (broker && typeof broker.getAccountSnapshot === "function") {
            return broker.getAccountSnapshot();
        }
        return null;
    },

    sizePosition({ price, symbol, riskPct = 1, minQty = 0, maxQty, step, fallbackQty = 1 } = {}) {
        const px = Number(price ?? this._resolveCurrentPrice({ symbol }));
        if (!Number.isFinite(px) || px <= 0) return fallbackQty;

        const snapshot = this.getAccountSnapshot();
        const equity = Number(snapshot?.equity ?? snapshot?.balance);
        if (!Number.isFinite(equity) || equity <= 0) return fallbackQty;

        const pct = Math.max(0, Number(riskPct) || 0);
        if (pct <= 0) return fallbackQty;

        let qty = (equity * (pct / 100)) / px;
        if (Number.isFinite(minQty)) qty = Math.max(minQty, qty);
        if (Number.isFinite(maxQty)) qty = Math.min(maxQty, qty);

        const stepSize = Number(step);
        if (Number.isFinite(stepSize) && stepSize > 0) {
            qty = Math.floor(qty / stepSize) * stepSize;
        }

        if (!Number.isFinite(qty) || qty <= 0) return fallbackQty;
        return this._normalizeQuantity(qty, { fallbackQty, minQty, maxQty, step });
    }
};

module.exports = StrategyRuntimeUtils;