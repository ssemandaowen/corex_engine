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
        const symbol = params.symbol || this.symbols[0];
        return {
            intent,
            side,
            symbol,
            price: this._resolveCurrentPrice(params),
            strategyId: this.id,
            timestamp: this.lastTick?.time || this.currentBar?.time || Date.now(),
            barTime: this.currentBar?.time,
            tf: this.timeframe,
            ...params
        };
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
        const broker = this.executionContext?.broker;
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
        return qty;
    }
};

module.exports = StrategyRuntimeUtils;

