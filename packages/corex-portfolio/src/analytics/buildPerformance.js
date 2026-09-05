"use strict";

const { buildEquityAnalytics } = require("./buildEquityAnalytics");

const toNum = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

function buildPerformance(trades = [], initialCapital = 10000) {
    const safeTrades = Array.isArray(trades) ? trades : [];
    const netProfit = safeTrades.reduce((acc, t) => acc + toNum(t.profit, 0), 0);
    const wins = safeTrades.filter((t) => toNum(t.profit, 0) > 0).length;
    const losses = safeTrades.filter((t) => toNum(t.profit, 0) < 0).length;
    const winRate = safeTrades.length > 0 ? (wins / safeTrades.length) * 100 : 0;
    const grossProfit = safeTrades.filter((t) => toNum(t.profit, 0) > 0).reduce((s, t) => s + toNum(t.profit, 0), 0);
    const grossLoss = Math.abs(safeTrades.filter((t) => toNum(t.profit, 0) < 0).reduce((s, t) => s + toNum(t.profit, 0), 0));
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : 0;
    const avgWin = wins > 0 ? grossProfit / wins : 0;
    const avgLoss = losses > 0 ? grossLoss / losses : 0;
    const expectancy = ((winRate / 100) * avgWin) - ((1 - (winRate / 100)) * avgLoss);

    const analytics = buildEquityAnalytics(initialCapital, safeTrades, safeTrades[0]?.entryTime || Date.now());
    const maxDrawdown = Math.abs(Math.min(0, ...analytics.drawdownCurve.map((p) => toNum(p.drawdown, 0))));

    return {
        performance: {
            netProfit: Number(netProfit.toFixed(8)),
            roiPercent: initialCapital > 0 ? Number(((netProfit / initialCapital) * 100).toFixed(8)) : 0,
            maxDrawdownPercent: Number(maxDrawdown.toFixed(8)),
            totalTrades: safeTrades.length,
            winRate: Number(winRate.toFixed(8)),
            sharpeRatio: Number((analytics.rollingSharpe[analytics.rollingSharpe.length - 1]?.sharpe || 0).toFixed(8)),
            profitFactor: Number(profitFactor.toFixed(8)),
            grossProfit: Number(grossProfit.toFixed(8)),
            grossLoss: Number(grossLoss.toFixed(8)),
            avgWin: Number(avgWin.toFixed(8)),
            avgLoss: Number(avgLoss.toFixed(8)),
            expectancy: Number(expectancy.toFixed(8))
        },
        analytics
    };
}

module.exports = { buildPerformance };
