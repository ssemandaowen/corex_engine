"use strict";

const toNum = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

function buildClosedTrades(fills = []) {
    const sorted = [...fills]
        .filter((f) => f.quantity > 0 && f.price > 0)
        .sort((a, b) => a.filledAt - b.filledAt);

    const positions = new Map();
    const closed = [];

    for (const f of sorted) {
        const key = `${f.strategyId}::${f.symbol}`;
        const incomingSide = f.side === "BUY" ? "long" : "short";
        const oppositeSide = incomingSide === "long" ? "short" : "long";
        const incomingQtyOriginal = f.quantity;
        let remainingQty = f.quantity;
        let remainingCommission = f.commission;

        const current = positions.get(key);
        if (!current) {
            positions.set(key, {
                side: incomingSide,
                quantity: remainingQty,
                avgPrice: f.price,
                entryTime: f.filledAt,
                entryCommission: remainingCommission
            });
            continue;
        }

        if (current.side === incomingSide) {
            const totalQty = current.quantity + remainingQty;
            const weightedPrice = totalQty > 0
                ? ((current.avgPrice * current.quantity) + (f.price * remainingQty)) / totalQty
                : f.price;
            current.avgPrice = weightedPrice;
            current.quantity = totalQty;
            current.entryCommission += remainingCommission;
            positions.set(key, current);
            continue;
        }

        while (remainingQty > 0 && current.quantity > 0 && current.side === oppositeSide) {
            const closeQty = Math.min(current.quantity, remainingQty);
            const exitCommissionPortion = incomingQtyOriginal > 0
                ? (f.commission * (closeQty / incomingQtyOriginal))
                : 0;
            const entryCommissionPortion = current.quantity > 0
                ? (current.entryCommission * (closeQty / current.quantity))
                : 0;

            const grossPnl = current.side === "long"
                ? ((f.price - current.avgPrice) * closeQty)
                : ((current.avgPrice - f.price) * closeQty);

            const totalCommission = entryCommissionPortion + exitCommissionPortion;
            const profit = grossPnl - totalCommission;
            const entryNotional = current.avgPrice * closeQty;
            const profitPct = entryNotional > 0 ? (profit / entryNotional) * 100 : 0;

            closed.push({
                strategyId: f.strategyId,
                symbol: f.symbol,
                direction: current.side,
                quantity: Number(closeQty.toFixed(8)),
                entryPrice: Number(current.avgPrice.toFixed(8)),
                exitPrice: Number(f.price.toFixed(8)),
                entryTime: current.entryTime,
                exitTime: f.filledAt,
                commission: Number(totalCommission.toFixed(8)),
                profit: Number(profit.toFixed(8)),
                profitPct: Number(profitPct.toFixed(8))
            });

            current.entryCommission = Math.max(0, current.entryCommission - entryCommissionPortion);
            current.quantity = Math.max(0, current.quantity - closeQty);
            remainingQty = Math.max(0, remainingQty - closeQty);
            remainingCommission = Math.max(0, remainingCommission - exitCommissionPortion);

            if (current.quantity <= 0) break;
        }

        if (current.quantity <= 0) {
            positions.delete(key);
        } else {
            positions.set(key, current);
        }

        if (remainingQty > 0) {
            positions.set(key, {
                side: incomingSide,
                quantity: remainingQty,
                avgPrice: f.price,
                entryTime: f.filledAt,
                entryCommission: remainingCommission
            });
        }
    }

    return closed;
}

module.exports = { buildClosedTrades };
