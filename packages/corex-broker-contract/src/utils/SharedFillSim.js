"use strict";

class SharedFillSim {
    constructor(config = {}) {
        this.commissionPct = config.commissionPct || 0;
        this.slippageBps = config.slippageBps || 0;
        this.spread = config.spread || 0;
        this.fillPolicy = config.fillPolicy || "next_bar";
        this.useATR = config.useATR || false;
    }

    calculateCommission(notional) {
        if (!this.commissionPct) return 0;
        return notional * (this.commissionPct / 100);
    }

    calculateSlippage(bar, side) {
        if (this.slippageBps === 0) return 0;
        const refPrice = bar.close || bar.open;
        if (this.useATR && bar.atr) {
            const atrSlippage = (bar.atr * this.slippageBps) / 10000;
            return side === "long" ? atrSlippage : -atrSlippage;
        }
        const pctSlippage = refPrice * (this.slippageBps / 10000);
        return side === "long" ? pctSlippage : -pctSlippage;
    }

    calculateSpread(bar) {
        if (this.spread === 0) return 0;
        return bar.bid ? bar.bid - bar.ask : this.spread * 0.5;
    }

    applySpreadToPrice(price, bar, side) {
        if (this.spread === 0) return price;
        const halfSpread = (bar.bid ? (bar.bid - bar.ask) / 2 : this.spread / 2);
        return side === "long" ? price + halfSpread : price - halfSpread;
    }

    fillMarketOrder(intent, bar) {
        const symbol = String(intent.symbol || intent.Symbol || "").toUpperCase();
        const side = String(intent.side || "").toLowerCase();
        const quantity = Number(intent.quantity || intent.Volume || 0);
        const orderType = side === "short" || side === "sell" ? "SELL" : "BUY";

        if (!quantity || quantity <= 0) return null;

        const refPrice = bar.close || bar.open;
        const slippage = this.calculateSlippage(bar, side);
        const directionMultiplier = orderType === "BUY" ? 1 : -1;

        let fillPrice;
        if (this.fillPolicy === "next_bar") {
            fillPrice = refPrice;
        } else {
            fillPrice = refPrice;
        }

        fillPrice = fillPrice + directionMultiplier * slippage;
        fillPrice = this.applySpreadToPrice(fillPrice, bar, side);

        const notional = Math.abs(quantity) * fillPrice;
        const commission = this.calculateCommission(notional);

        return {
            orderId: `fill_${Date.now()}`,
            status: "FILLED",
            avgFillPrice: Number(fillPrice.toFixed(8)),
            filled: Math.abs(quantity),
            remaining: 0,
            commission,
            timestamp: bar.time || Date.now(),
            side,
            symbol,
            direction: orderType,
            entryPrice: Number(fillPrice.toFixed(8)),
            raw: { refPrice, slippage, commission }
        };
    }

    fillLimitOrder(intent, bar) {
        const symbol = String(intent.symbol || intent.Symbol || "").toUpperCase();
        const side = String(intent.side || "").toLowerCase();
        const quantity = Number(intent.quantity || intent.Volume || 0);
        const limitPrice = Number(intent.price || intent.Price || 0);

        if (!quantity || quantity <= 0) return null;

        const range = (bar.high || 0) - (bar.low || 0);
        const crosses = side === "long" ? (limitPrice >= bar.low && limitPrice <= bar.high) : (limitPrice >= bar.low && limitPrice <= bar.high);

        if (!crosses) {
            return {
                orderId: `order_${Date.now()}`,
                status: "PENDING",
                avgFillPrice: 0,
                filled: 0,
                remaining: quantity,
                commission: 0,
                timestamp: bar.time || Date.now(),
                side,
                symbol,
                raw: { reason: "price not in range" }
            };
        }

        const fillPrice = side === "long" ? Math.min(limitPrice, bar.open) : Math.max(limitPrice, bar.open);
        const notional = Math.abs(quantity) * fillPrice;
        const commission = this.calculateCommission(notional);

        return {
            orderId: `fill_${Date.now()}`,
            status: "FILLED",
            avgFillPrice: Number(fillPrice.toFixed(8)),
            filled: Math.abs(quantity),
            remaining: 0,
            commission,
            timestamp: bar.time || Date.now(),
            side,
            symbol,
            entryPrice: Number(fillPrice.toFixed(8)),
            raw: { limitPrice, barOpen: bar.open }
        };
    }

    fillStopOrder(intent, bar) {
        const symbol = String(intent.symbol || intent.Symbol || "").toUpperCase();
        const side = String(intent.side || "").toLowerCase();
        const quantity = Number(intent.quantity || intent.Volume || 0);
        const stopPrice = Number(intent.stopPrice || intent.StopPrice || 0);

        if (!quantity || quantity <= 0) return null;

        const triggered = side === "long" ? (bar.high >= stopPrice) : (bar.low <= stopPrice);

        if (!triggered) {
            return {
                orderId: `order_${Date.now()}`,
                status: "PENDING",
                avgFillPrice: 0,
                filled: 0,
                remaining: quantity,
                commission: 0,
                timestamp: bar.time || Date.now(),
                side,
                symbol,
                raw: { reason: "stop not triggered" }
            };
        }

        let fillPrice;
        if (side === "long") {
            fillPrice = stopPrice;
            if (bar.gap) fillPrice = bar.open > stopPrice ? bar.open : stopPrice;
        } else {
            fillPrice = stopPrice;
            if (bar.gap) fillPrice = bar.open < stopPrice ? bar.open : stopPrice;
        }

        const notional = Math.abs(quantity) * fillPrice;
        const commission = this.calculateCommission(notional);

        return {
            orderId: `fill_${Date.now()}`,
            status: "FILLED",
            avgFillPrice: Number(fillPrice.toFixed(8)),
            filled: Math.abs(quantity),
            remaining: 0,
            commission,
            timestamp: bar.time || Date.now(),
            side,
            symbol,
            entryPrice: Number(fillPrice.toFixed(8)),
            raw: { stopPrice, barOpen: bar.open, barGap: bar.gap }
        };
    }

    execute(intent, bar) {
        const orderType = String((intent.orderType || intent.OrderType || "MARKET")).toUpperCase();

        switch (orderType) {
        case "MARKET":
        case "BUY":
        case "SELL":
            return this.fillMarketOrder(intent, bar);
        case "LIMIT":
            return this.fillLimitOrder(intent, bar);
        case "STOP":
        case "STOP_LIMIT":
            return this.fillStopOrder(intent, bar);
        default:
            return {
                orderId: `order_${Date.now()}`,
                status: "REJECTED",
                avgFillPrice: 0,
                filled: 0,
                remaining: 0,
                commission: 0,
                timestamp: Date.now(),
                side: String(intent.side || "").toLowerCase(),
                symbol: String(intent.symbol || intent.Symbol || "").toUpperCase(),
                raw: { error: `Unknown order type: ${orderType}` }
            };
        }
    }

    resetState() {
        this.commissionPct = this.commissionPct;
        this.slippageBps = this.slippageBps;
        this.spread = this.spread;
        this.fillPolicy = this.fillPolicy;
        this.useATR = this.useATR;
    }
}

module.exports = SharedFillSim;
