"use strict";

const toNum = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

function buildEquityAnalytics(initialCapital, trades = [], fallbackTime = Date.now()) {
    const points = [{
        time: Number(fallbackTime),
        equity: Number(initialCapital)
    }];

    const sorted = [...trades]
        .map((t) => ({
            ...t,
            profit: toNum(t?.profit, 0),
            exitTs: toNum(t?.exitTime, toNum(t?.entryTime, fallbackTime))
        }))
        .filter((t) => Number.isFinite(t.exitTs))
        .sort((a, b) => a.exitTs - b.exitTs);

    let equity = Number(initialCapital);
    for (const t of sorted) {
        equity += Number.isFinite(t.profit) ? t.profit : 0;
        points.push({ time: t.exitTs, equity: Number(equity) });
    }

    let peak = points[0]?.equity || Number(initialCapital);
    const drawdownCurve = points.map((p) => {
        if (p.equity > peak) peak = p.equity;
        const drawdown = peak > 0 ? ((p.equity / peak) - 1) * 100 : 0;
        return { time: p.time, drawdown };
    });

    const returns = [];
    for (let i = 1; i < points.length; i += 1) {
        const prev = Number(points[i - 1].equity || 0);
        const cur = Number(points[i].equity || 0);
        if (prev !== 0) {
            returns.push({ time: points[i].time, value: (cur / prev) - 1 });
        }
    }

    const rollingWindow = 20;
    const rollingSharpe = [];
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < returns.length; i += 1) {
        const r = Number(returns[i].value || 0);
        sum += r;
        sumSq += r * r;
        if (i >= rollingWindow) {
            const old = Number(returns[i - rollingWindow].value || 0);
            sum -= old;
            sumSq -= old * old;
        }
        if (i >= rollingWindow - 1) {
            const n = rollingWindow;
            const mean = sum / n;
            const variance = Math.max(0, (sumSq / n) - (mean * mean));
            const std = Math.sqrt(variance);
            const sharpe = std === 0 ? 0 : (mean / std) * Math.sqrt(n);
            rollingSharpe.push({ time: returns[i].time, sharpe });
        }
    }

    return {
        equityCurve: points,
        drawdownCurve,
        returns,
        rollingSharpe
    };
}

module.exports = { buildEquityAnalytics };
