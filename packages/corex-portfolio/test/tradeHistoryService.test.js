"use strict";

const mockQuery = jest.fn();
jest.mock("pg", () => ({
    Pool: jest.fn(() => ({
        query: mockQuery
    }))
}));

const { TradeHistoryService } = require("../index");

describe("corex-portfolio tradeHistoryService", () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rows: [] });
    });

    test("accountId-based query uses WHERE account_id", async () => {
        const service = new TradeHistoryService(new (require("pg").Pool)());
        await service.getHistoryReport({
            userId: "u1",
            accountId: "cx_pap_01HZX89K329RVTNABCDEF1234",
            environment: "PAPER"
        });

        const sql = mockQuery.mock.calls[0][0];
        expect(sql).toContain("o.account_id = $2");
        expect(sql).not.toContain("o.user_id");
    });

    test("legacy userId+environment query falls back to WHERE user_id", async () => {
        const service = new TradeHistoryService(new (require("pg").Pool)());
        await service.getHistoryReport({
            userId: "u1",
            environment: "PAPER"
        });

        const sql = mockQuery.mock.calls[0][0];
        expect(sql).toContain("o.user_id = $2");
        expect(sql).not.toContain("o.account_id");
    });

    test("two accounts with same user return non-overlapping results when filtered by accountId", async () => {
        const service = new TradeHistoryService(new (require("pg").Pool)());

        const rowsA = [
            { order_id: "o1", strategy_id: "s1", strategy_name: "strat1", symbol: "EURUSD", side: "BUY", order_type: "MARKET", status: "FILLED", environment: "LIVE", created_at: "2026-01-01T00:00:00Z", fill_id: "f1", external_deal_id: null, fill_price: 1.1, fill_quantity: 1, commission: 0.01, filled_at: "2026-01-01T00:00:00Z", account_id: "cx_liv_A" },
            { order_id: "o2", strategy_id: "s1", strategy_name: "strat1", symbol: "EURUSD", side: "SELL", order_type: "MARKET", status: "FILLED", environment: "LIVE", created_at: "2026-01-02T00:00:00Z", fill_id: "f2", external_deal_id: null, fill_price: 1.2, fill_quantity: 1, commission: 0.01, filled_at: "2026-01-02T00:00:00Z", account_id: "cx_liv_A" }
        ];
        const rowsB = [
            { order_id: "o3", strategy_id: "s1", strategy_name: "strat1", symbol: "EURUSD", side: "BUY", order_type: "MARKET", status: "FILLED", environment: "LIVE", created_at: "2026-01-03T00:00:00Z", fill_id: "f3", external_deal_id: null, fill_price: 1.3, fill_quantity: 1, commission: 0.01, filled_at: "2026-01-03T00:00:00Z", account_id: "cx_liv_B" },
            { order_id: "o4", strategy_id: "s1", strategy_name: "strat1", symbol: "EURUSD", side: "SELL", order_type: "MARKET", status: "FILLED", environment: "LIVE", created_at: "2026-01-04T00:00:00Z", fill_id: "f4", external_deal_id: null, fill_price: 1.4, fill_quantity: 1, commission: 0.01, filled_at: "2026-01-04T00:00:00Z", account_id: "cx_liv_B" }
        ];

        mockQuery.mockResolvedValueOnce({ rows: rowsA });
        const reportA = await service.getHistoryReport({ userId: "u1", accountId: "cx_liv_A", environment: "LIVE" });

        mockQuery.mockResolvedValueOnce({ rows: rowsB });
        const reportB = await service.getHistoryReport({ userId: "u1", accountId: "cx_liv_B", environment: "LIVE" });

        expect(reportA.trades.length).toBe(1);
        expect(reportA.trades[0].entryPrice).toBeCloseTo(1.1);
        expect(reportA.trades[0].exitPrice).toBeCloseTo(1.2);
        expect(reportA.trades[0].profit).toBeCloseTo(0.08, 2);

        expect(reportB.trades.length).toBe(1);
        expect(reportB.trades[0].entryPrice).toBeCloseTo(1.3);
    });

    test("legacy call without accountId returns same combined result as before", async () => {
        const service = new TradeHistoryService(new (require("pg").Pool)());
        const rows = [
            { order_id: "o1", strategy_id: "s1", strategy_name: "strat1", symbol: "EURUSD", side: "BUY", order_type: "MARKET", status: "FILLED", environment: "PAPER", created_at: "2026-01-01T00:00:00Z", fill_id: "f1", external_deal_id: null, fill_price: 1.0, fill_quantity: 1, commission: 0, filled_at: "2026-01-01T00:00:00Z" },
            { order_id: "o2", strategy_id: "s1", strategy_name: "strat1", symbol: "EURUSD", side: "SELL", order_type: "MARKET", status: "FILLED", environment: "PAPER", created_at: "2026-01-02T00:00:00Z", fill_id: "f2", external_deal_id: null, fill_price: 1.1, fill_quantity: 1, commission: 0, filled_at: "2026-01-02T00:00:00Z" }
        ];
        mockQuery.mockResolvedValue({ rows });

        const report = await service.getHistoryReport({ userId: "u1", environment: "PAPER" });

        expect(report.trades.length).toBe(1);
        expect(report.trades[0].entryPrice).toBeCloseTo(1.0);
        expect(report.trades[0].exitPrice).toBeCloseTo(1.1);
        expect(report.trades[0].profit).toBeCloseTo(0.1, 2);
        expect(report.performance.netProfit).toBeCloseTo(0.1, 2);
        expect(report.performance.totalTrades).toBe(1);
        expect(report.performance.winRate).toBeCloseTo(100, 2);
    });
});

describe("corex-portfolio analytics regression", () => {
    const { buildClosedTrades } = require("../src/analytics/buildClosedTrades");
    const { buildEquityAnalytics } = require("../src/analytics/buildEquityAnalytics");
    const { buildPerformance } = require("../src/analytics/buildPerformance");

    test("buildClosedTrades produces identical output to pre-change baseline", () => {
        const fills = [
            { strategyId: "s1", symbol: "EURUSD", side: "BUY", quantity: 1, price: 1.0, commission: 0.01, filledAt: 1000 },
            { strategyId: "s1", symbol: "EURUSD", side: "SELL", quantity: 1, price: 1.1, commission: 0.01, filledAt: 2000 }
        ];
        const trades = buildClosedTrades(fills);
        expect(trades.length).toBe(1);
        expect(trades[0].entryPrice).toBeCloseTo(1.0);
        expect(trades[0].exitPrice).toBeCloseTo(1.1);
        expect(trades[0].profit).toBeCloseTo(0.08, 2);
        expect(trades[0].profitPct).toBeCloseTo(8, 1);
    });

    test("buildEquityAnalytics produces identical output to pre-change baseline", () => {
        const trades = [
            { profit: 100, entryTime: 1000, exitTime: 2000 },
            { profit: -50, entryTime: 2000, exitTime: 3000 }
        ];
        const result = buildEquityAnalytics(1000, trades, 1000);
        expect(result.equityCurve.length).toBe(3);
        expect(result.equityCurve[0]).toEqual({ time: 1000, equity: 1000 });
        expect(result.equityCurve[1]).toEqual({ time: 2000, equity: 1100 });
        expect(result.equityCurve[2]).toEqual({ time: 3000, equity: 1050 });
        expect(result.drawdownCurve.length).toBe(3);
        expect(result.returns.length).toBe(2);
        expect(result.rollingSharpe.length).toBeGreaterThanOrEqual(0);
    });

    test("buildPerformance produces identical output to pre-change baseline", () => {
        const trades = [
            { profit: 100, entryTime: 1000, exitTime: 2000 },
            { profit: -50, entryTime: 2000, exitTime: 3000 }
        ];
        const result = buildPerformance(trades, 1000);
        expect(result.performance.netProfit).toBeCloseTo(50, 2);
        expect(result.performance.roiPercent).toBeCloseTo(5, 1);
        expect(result.performance.totalTrades).toBe(2);
        expect(result.performance.winRate).toBeCloseTo(50, 1);
        expect(result.performance.profitFactor).toBeCloseTo(2, 1);
        expect(result.performance.expectancy).toBeCloseTo(25, 1);
    });
});
