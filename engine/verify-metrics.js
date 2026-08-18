"use strict";

require("module-alias/register");
const { MetricsAccumulator } = require("@utils/metrics");
const { trades: tradeAnalytics } = require("@utils/analytics");

function verify() {
    const initialCapital = 10000;
    const accumulator = new MetricsAccumulator();
    accumulator.init(initialCapital);

    const mockTrades = [
        { profit: 100, profitPct: 1, entryTime: 1000, exitTime: 2000, direction: "LONG" },
        { profit: -50, profitPct: -0.5, entryTime: 3000, exitTime: 4000, direction: "LONG" },
        { profit: 200, profitPct: 2, entryTime: 5000, exitTime: 6000, direction: "LONG" },
        { profit: -100, profitPct: -1, entryTime: 7000, exitTime: 8000, direction: "LONG" },
    ];

    mockTrades.forEach(t => accumulator.recordTrade(t));

    const snapshot = accumulator.getSnapshot();
    const supplement = {
        profit: snapshot.netProfit,
        maxDrawdownPct: snapshot.maxDrawdownPercent,
        sharpeRatio: snapshot.sharpeRatio
    };
    
    const analyticsStats = tradeAnalytics.computeStats(mockTrades, initialCapital, supplement);

    console.log("=== Metrics Verification ===");
    console.log("Accumulator Net Profit:", snapshot.netProfit);
    console.log("Analytics Net Profit:", analyticsStats.raw.netProfit);
    
    console.log("Accumulator Max DD %:", snapshot.maxDrawdownPercent.toFixed(2));
    console.log("Analytics Max DD %:", analyticsStats.raw.maxDrawdownPercent.toFixed(2));

    console.log("Accumulator Sharpe:", snapshot.sharpeRatio.toFixed(4));
    console.log("Analytics Sharpe:", analyticsStats.raw.sharpeRatio.toFixed(4));

    const ok = snapshot.netProfit === analyticsStats.raw.netProfit;
    console.log("\nVerification Result:", ok ? "PASS" : "FAIL");
    
    if (!ok) process.exit(1);
}

verify();