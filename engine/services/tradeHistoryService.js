"use strict";

const postgres = require("@core/services/postgres");
const { TradeHistoryService } = require("@portfolio/corex-portfolio");

if (!postgres.hasDbConfig()) {
    module.exports = {
        async getHistoryReport() {
            return {
                meta: { environment: "PAPER", strategyId: null, symbol: null },
                performance: {
                    netProfit: 0, roiPercent: 0, maxDrawdownPercent: 0, totalTrades: 0, winRate: 0,
                    sharpeRatio: 0, profitFactor: 0, grossProfit: 0, grossLoss: 0, avgWin: 0, avgLoss: 0, expectancy: 0
                },
                fills: [],
                trades: [],
                equityCurve: [{ time: Date.now(), equity: 10000 }],
                analytics: { drawdownCurve: [], returns: [], rollingSharpe: [] }
            };
        }
    };
} else {
    const pool = postgres.getPool ? postgres.getPool() : new (require("pg").Pool)();
    module.exports = new TradeHistoryService(pool);
}
