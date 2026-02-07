"use strict";

const Position = require("./Position");

class StrategyPositionManager {
    constructor() {
        this._positions = new Map();
    }

    open(symbol, side, quantity, price) {
        const existing = this._positions.get(symbol);
        if (existing) {
            if (existing.side === side) {
                existing.add(quantity, price);
                return existing;
            }
            this._positions.delete(symbol);
        }
        const pos = new Position(symbol, side, quantity, price);
        this._positions.set(symbol, pos);
        return pos;
    }

    get(symbol) {
        return this._positions.get(symbol) || null;
    }

    all() {
        return Array.from(this._positions.values());
    }

    getState(symbol) {
        const pos = this.get(symbol);
        return pos ? pos.side : "flat";
    }

    close(symbol, exitPrice) {
        const pos = this.get(symbol);
        if (!pos) return 0;
        const pnl = pos.getPnL(exitPrice);
        this._positions.delete(symbol);
        return pnl;
    }

    is(symbol, side) {
        return this.getState(symbol) === side;
    }

    reset() {
        this._positions.clear();
    }

    applyDelta(symbol, quantityDelta, price) {
        const delta = Number(quantityDelta);
        if (!Number.isFinite(delta) || delta === 0) return null;

        const existing = this._positions.get(symbol);
        if (!existing) {
            const side = delta > 0 ? "long" : "short";
            return this.open(symbol, side, Math.abs(delta), price);
        }

        if (existing.side === "long") {
            if (delta > 0) {
                existing.add(delta, price);
                return existing;
            }
            const qtyToReduce = Math.abs(delta);
            const prevQty = existing.quantity;
            existing.reduce(qtyToReduce, price);
            if (qtyToReduce > prevQty) {
                const remainder = qtyToReduce - prevQty;
                if (remainder > 0) {
                    return this.open(symbol, "short", remainder, price);
                }
            }
            if (existing.quantity === 0) this._positions.delete(symbol);
            return existing.quantity ? existing : null;
        }

        if (delta < 0) {
            existing.add(Math.abs(delta), price);
            return existing;
        }

        const qtyToReduce = Math.abs(delta);
        const prevQty = existing.quantity;
        existing.reduce(qtyToReduce, price);
        if (qtyToReduce > prevQty) {
            const remainder = qtyToReduce - prevQty;
            if (remainder > 0) {
                return this.open(symbol, "long", remainder, price);
            }
        }
        if (existing.quantity === 0) this._positions.delete(symbol);
        return existing.quantity ? existing : null;
    }
}

module.exports = StrategyPositionManager;
