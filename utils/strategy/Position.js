"use strict";

class Position {
    constructor(symbol, side, quantity, entryPrice) {
        this.symbol = symbol;
        this.side = side;
        this.quantity = Math.abs(quantity || 0);
        this.entryPrice = entryPrice;
        this.avgEntryPrice = entryPrice;
        this.timestamp = Date.now();
        this.status = "open";
        this.takeProfit = null;
        this.stopLoss = null;
    }

    getPnL(currentPrice, qty = this.quantity) {
        const multiplier = this.side === "long" ? 1 : -1;
        return (currentPrice - this.avgEntryPrice) * qty * multiplier;
    }

    add(quantity, price) {
        const q = Math.abs(quantity || 0);
        if (!q) return this;
        const newQty = this.quantity + q;
        this.avgEntryPrice = ((this.avgEntryPrice * this.quantity) + (price * q)) / newQty;
        this.entryPrice = this.avgEntryPrice;
        this.quantity = newQty;
        this.timestamp = Date.now();
        this.status = "open";
        return this;
    }

    reduce(quantity, price) {
        const q = Math.abs(quantity || 0);
        if (!q) return 0;
        const realizedQty = Math.min(this.quantity, q);
        const realized = this.getPnL(price, realizedQty);
        this.quantity -= realizedQty;
        if (this.quantity <= 0) {
            this.quantity = 0;
            this.status = "closed";
        }
        this.timestamp = Date.now();
        return realized;
    }
}

module.exports = Position;
