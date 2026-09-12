"use strict";

class Position {
    constructor(symbol, side, quantity, entryPrice) {
        this.symbol = symbol;
        this.side = side;
        this.quantity = 0;
        this.entryPrice = Number(entryPrice || 0);
        this.avgEntryPrice = Number(entryPrice || 0);
        this.timestamp = Date.now();
        this.status = "open";
        this.takeProfit = null;
        this.stopLoss = null;
        this.lots = [];
        this.realizedPnl = 0;
        this.add(quantity, entryPrice, this.timestamp);
    }

    getPnL(currentPrice, qty = this.quantity) {
        const multiplier = this.side === "long" ? 1 : -1;
        return (currentPrice - this.avgEntryPrice) * qty * multiplier;
    }

    add(quantity, price, timestamp = Date.now()) {
        const q = Math.abs(quantity || 0);
        if (!q) return this;
        const px = Number(price || 0);
        if (!Number.isFinite(px) || px <= 0) return this;

        this.lots.push({
            quantity: q,
            price: px,
            timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now()
        });
        this._recomputeFromLots();
        this.timestamp = Date.now();
        this.status = "open";
        return this;
    }

    reduce(quantity, price) {
        return this.reduceDetailed(quantity, price).realized;
    }

    reduceDetailed(quantity, price) {
        const q = Math.abs(quantity || 0);
        const px = Number(price || 0);
        if (!q || !Number.isFinite(px) || px <= 0) {
            return { realized: 0, closedQty: 0, remainingQty: q, closedLots: [] };
        }

        let remaining = q;
        let realized = 0;
        let closedQty = 0;
        const closedLots = [];
        const now = Date.now();

        while (remaining > 0 && this.lots.length > 0) {
            const lot = this.lots[0];
            const lotQty = Number(lot.quantity || 0);
            if (!Number.isFinite(lotQty) || lotQty <= 0) {
                this.lots.shift();
                continue;
            }

            const exitQty = Math.min(lotQty, remaining);
            const pnlPerUnit = this.side === "long" ? (px - lot.price) : (lot.price - px);
            const lotPnl = pnlPerUnit * exitQty;
            realized += lotPnl;
            closedQty += exitQty;
            remaining -= exitQty;

            closedLots.push({
                entryPrice: Number(lot.price),
                exitPrice: px,
                quantity: exitQty,
                pnl: lotPnl,
                entryTime: Number(lot.timestamp || now),
                exitTime: now
            });

            lot.quantity = lotQty - exitQty;
            if (lot.quantity <= 1e-12) this.lots.shift();
        }

        this.realizedPnl += realized;
        this._recomputeFromLots();
        this.timestamp = now;
        if (this.quantity <= 0) {
            this.quantity = 0;
            this.status = "closed";
        }

        return {
            realized,
            closedQty,
            remainingQty: remaining,
            closedLots
        };
    }

    getLots() {
        return this.lots.map((lot) => ({
            quantity: Number(lot.quantity || 0),
            price: Number(lot.price || 0),
            timestamp: Number(lot.timestamp || 0)
        }));
    }

    setLots(rawLots = []) {
        if (!Array.isArray(rawLots)) return this;
        this.lots = rawLots
            .map((lot) => ({
                quantity: Number(lot?.quantity || 0),
                price: Number(lot?.price || 0),
                timestamp: Number(lot?.timestamp || Date.now())
            }))
            .filter((lot) => (
                Number.isFinite(lot.quantity) &&
                lot.quantity > 0 &&
                Number.isFinite(lot.price) &&
                lot.price > 0
            ));
        this._recomputeFromLots();
        this.timestamp = Date.now();
        this.status = this.quantity > 0 ? "open" : "closed";
        return this;
    }

    _recomputeFromLots() {
        let totalQty = 0;
        let weighted = 0;
        for (const lot of this.lots) {
            const q = Number(lot.quantity || 0);
            const p = Number(lot.price || 0);
            if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p <= 0) continue;
            totalQty += q;
            weighted += q * p;
        }
        this.quantity = totalQty;
        this.avgEntryPrice = totalQty > 0 ? (weighted / totalQty) : 0;
        this.entryPrice = this.avgEntryPrice;
    }
}

module.exports = Position;
