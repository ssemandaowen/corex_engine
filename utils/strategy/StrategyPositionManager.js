"use strict";

const Position = require("./Position");

class StrategyPositionManager {
    constructor() {
        this._positions = new Map();
        this._lastDelta = null;
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
        const qtyBefore = Number(pos.quantity || 0);
        const reduced = pos.reduceDetailed(qtyBefore, exitPrice);
        const pnl = Number(reduced.realized || 0);
        this._positions.delete(symbol);
        this._lastDelta = {
            symbol,
            price: Number(exitPrice || 0),
            quantityDelta: -Math.abs(qtyBefore),
            realizedPnl: pnl,
            closedLots: reduced.closedLots || [],
            openedLots: [],
            resultingSide: "flat",
            resultingQuantity: 0
        };
        return pnl;
    }

    is(symbol, side) {
        return this.getState(symbol) === side;
    }

    reset() {
        this._positions.clear();
        this._lastDelta = null;
    }

    applyDelta(symbol, quantityDelta, price) {
        const delta = Number(quantityDelta);
        const px = Number(price || 0);
        if (!Number.isFinite(delta) || delta === 0) {
            this._lastDelta = null;
            return null;
        }
        if (!Number.isFinite(px) || px <= 0) {
            this._lastDelta = null;
            return null;
        }

        const now = Date.now();
        const openedLots = [];
        const closedLots = [];
        const DUST_THRESHOLD = 1e-10;
        let realizedPnl = 0;

        const existing = this._positions.get(symbol);
        if (!existing) {
            const side = delta > 0 ? "long" : "short";
            const qty = Math.abs(delta);
            if (qty < DUST_THRESHOLD) return null;
            const opened = this.open(symbol, side, qty, px);
            openedLots.push({
                side,
                quantity: qty,
                entryPrice: px,
                entryTime: now
            });
            this._lastDelta = {
                symbol,
                price: px,
                quantityDelta: delta,
                realizedPnl,
                closedLots,
                openedLots,
                resultingSide: opened?.side || "flat",
                resultingQuantity: Number(opened?.quantity || 0)
            };
            return opened;
        }

        if (existing.side === "long") {
            if (delta > 0) {
                existing.add(delta, px);
                openedLots.push({
                    side: "long",
                    quantity: Math.abs(delta),
                    entryPrice: px,
                    entryTime: now
                });
                this._lastDelta = {
                    symbol,
                    price: px,
                    quantityDelta: delta,
                    realizedPnl,
                    closedLots,
                    openedLots,
                    resultingSide: existing.side,
                    resultingQuantity: Number(existing.quantity || 0)
                };
                return existing;
            }
            const qtyToReduce = Math.abs(delta);
            const reduced = existing.reduceDetailed(qtyToReduce, px);
            realizedPnl += Number(reduced.realized || 0);
            closedLots.push(...(reduced.closedLots || []));
            
            if (reduced.remainingQty > DUST_THRESHOLD) {
                const remainder = Number(reduced.remainingQty);
                if (remainder > DUST_THRESHOLD) {
                    const flipped = this.open(symbol, "short", remainder, px);
                    openedLots.push({
                        side: "short",
                        quantity: remainder,
                        entryPrice: px,
                        entryTime: now
                    });
                    this._lastDelta = {
                        symbol,
                        price: px,
                        quantityDelta: delta,
                        realizedPnl,
                        closedLots,
                        openedLots,
                        resultingSide: flipped?.side || "flat",
                        resultingQuantity: Number(flipped?.quantity || 0)
                    };
                    return flipped;
                }
            }
            if (existing.quantity <= DUST_THRESHOLD) this._positions.delete(symbol);
            this._lastDelta = {
                symbol,
                price: px,
                quantityDelta: delta,
                realizedPnl,
                closedLots,
                openedLots,
                resultingSide: existing.quantity ? existing.side : "flat",
                resultingQuantity: Number(existing.quantity || 0)
            };
            return existing.quantity ? existing : null;
        }

        if (delta < 0) {
            existing.add(Math.abs(delta), px);
            openedLots.push({
                side: "short",
                quantity: Math.abs(delta),
                entryPrice: px,
                entryTime: now
            });
            this._lastDelta = {
                symbol,
                price: px,
                quantityDelta: delta,
                realizedPnl,
                closedLots,
                openedLots,
                resultingSide: existing.side,
                resultingQuantity: Number(existing.quantity || 0)
            };
            return existing;
        }

        const qtyToReduce = Math.abs(delta);
        const reduced = existing.reduceDetailed(qtyToReduce, px);
        realizedPnl += Number(reduced.realized || 0);
        closedLots.push(...(reduced.closedLots || []));

        if (reduced.remainingQty > DUST_THRESHOLD) {
            const remainder = Number(reduced.remainingQty);
            if (remainder > DUST_THRESHOLD) {
                const flipped = this.open(symbol, "long", remainder, px);
                openedLots.push({
                    side: "long",
                    quantity: remainder,
                    entryPrice: px,
                    entryTime: now
                });
                this._lastDelta = {
                    symbol,
                    price: px,
                    quantityDelta: delta,
                    realizedPnl,
                    closedLots,
                    openedLots,
                    resultingSide: flipped?.side || "flat",
                    resultingQuantity: Number(flipped?.quantity || 0)
                };
                return flipped;
            }
        }
        if (existing.quantity <= DUST_THRESHOLD) this._positions.delete(symbol);
        this._lastDelta = {
            symbol,
            price: px,
            quantityDelta: delta,
            realizedPnl,
            closedLots,
            openedLots,
            resultingSide: existing.quantity ? existing.side : "flat",
            resultingQuantity: Number(existing.quantity || 0)
        };
        return existing.quantity ? existing : null;
    }

    getLastDelta() {
        if (!this._lastDelta) return null;
        return {
            ...this._lastDelta,
            closedLots: Array.isArray(this._lastDelta.closedLots) ? [...this._lastDelta.closedLots] : [],
            openedLots: Array.isArray(this._lastDelta.openedLots) ? [...this._lastDelta.openedLots] : []
        };
    }
}

module.exports = StrategyPositionManager;
