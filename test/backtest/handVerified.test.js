"use strict";
jest.mock("@core/services/postgres", () => ({ hasDbConfig: () => false, query: async () => ({ rows: [] }) }));
jest.mock("@config/constants", () => {
    const actual = jest.requireActual("@config/constants");
    return { ...actual, BACKTEST: { ...actual.BACKTEST, DB_REQUIRED: false } };
});
const path = require("path");
const fs = require("fs");
const backtestManager = require("../../engine/backtestManager");
const strategy = require("./fixtures/handStrategy");

const CSV = path.join(__dirname, "fixtures", "hand20.csv");

function baseOpts(extra = {}) {
    return Object.assign({
        runtimeId: "hand-run",
        userId: "test-user",
        dataMode: "offline",
        file: { path: CSV },
        symbol: "TEST",
        interval: "1m",
        initialCapital: 10000,
        includeTrades: true,
        rangeMode: "points",
        rangePoints: 20,
        stopLossPct: 0,
        takeProfitPct: 0,
        trailingStopLossPct: 0,
        commissionPct: 0,
        slippageBps: 0,
        spread: 0,
        barBudgetMs: 100,
        barBudgetStrikes: 5,
        batchSize: 500
    }, extra);
}

describe("hand-verified backtest", () => {
    test("Test 1 gross next-bar-open fills zero costs", async () => {
        const report = await backtestManager.run(strategy, baseOpts());
        const trades = report.trades || [];
        expect(trades.length).toBe(1);
        const t = trades[0];
        expect(t.entryPrice).toBe(105);
        expect(t.exitPrice).toBe(110);
        expect((t.exitPrice - t.entryPrice) * 10).toBeCloseTo(50.00, 2);
    }, 30000);

    test("Test 2 no lookahead", async () => {
        const report = await backtestManager.run(strategy, baseOpts());
        const t = (report.trades || [])[0];
        expect(t.entryPrice).not.toBe(107);
        expect(t.entryPrice).toBe(105);
        expect(t.exitPrice).not.toBe(108);
        expect(t.exitPrice).toBe(110);
    }, 30000);

    test("Test 3 commission 0.2% per side", async () => {
        const report = await backtestManager.run(strategy, baseOpts({ commissionPct: 0.2 }));
        const t = (report.trades || [])[0];
        const perf = report.performance || {};
        expect(perf.netProfit).toBeCloseTo(45.70, 2);
        expect(report.totalCommission || perf.totalCommission || 0).toBeCloseTo(4.30, 2);
    }, 30000);

    test("Test 4 slippage 10 bps adverse", async () => {
        const report = await backtestManager.run(strategy, baseOpts({ slippageBps: 10 }));
        const t = (report.trades || [])[0];
        expect(t.entryPrice).toBeCloseTo(105.105, 3);
        expect(t.exitPrice).toBeCloseTo(109.89, 3);
        const pnl = (t.exitPrice - t.entryPrice) * 10;
        expect(pnl).toBeCloseTo(47.85, 2);
    }, 30000);

    test("Test 5a high < low rejected", async () => {
        const p = path.join(__dirname, "fixtures", "badHighLow.csv");
        fs.writeFileSync(p, "time,open,high,low,close,volume,symbol\n1,100,99,101,100,1,TEST\n");
        let err;
        try { await backtestManager.run(strategy, baseOpts({ file: { path: p }, rangePoints: 1 })); }
        catch (e) { err = e; }
        console.log("5a error:", err && err.message);
        fs.unlinkSync(p);
        expect(err).toBeTruthy();
    }, 30000);

    test("Test 5b duplicate timestamps rejected", async () => {
        const p = path.join(__dirname, "fixtures", "badDup.csv");
        fs.writeFileSync(p, "time,open,high,low,close,volume,symbol\n1,100,104,98,101,1,TEST\n1,101,105,99,102,1,TEST\n");
        let err;
        try { await backtestManager.run(strategy, baseOpts({ file: { path: p }, rangePoints: 2 })); }
        catch (e) { err = e; }
        console.log("5b error:", err && err.message);
        fs.unlinkSync(p);
        expect(err).toBeTruthy();
    }, 30000);

    test("Test 5c NaN close rejected", async () => {
        const p = path.join(__dirname, "fixtures", "badNaN.csv");
        fs.writeFileSync(p, "time,open,high,low,close,volume,symbol\n1,100,104,98,,1,TEST\n");
        let err;
        try { await backtestManager.run(strategy, baseOpts({ file: { path: p }, rangePoints: 1 })); }
        catch (e) { err = e; }
        console.log("5c error:", err && err.message);
        fs.unlinkSync(p);
        expect(err).toBeTruthy();
    }, 30000);

    test("Test 5d out-of-order timestamps rejected", async () => {
        const p = path.join(__dirname, "fixtures", "badOrder.csv");
        fs.writeFileSync(p, "time,open,high,low,close,volume,symbol\n2,100,104,98,101,1,TEST\n1,101,105,99,102,1,TEST\n");
        let err;
        try { await backtestManager.run(strategy, baseOpts({ file: { path: p }, rangePoints: 2 })); }
        catch (e) { err = e; }
        console.log("5d error:", err && err.message);
        fs.unlinkSync(p);
        expect(err).toBeTruthy();
    }, 30000);

    test("Test 6 abort", async () => {
        const p = path.join(__dirname, "fixtures", "big.csv");
        const lines = ["time,open,high,low,close,volume,symbol"];
        for (let i = 0; i < 200000; i++) lines.push((1700000000000 + i * 60000) + ",100,104,98,101,1,TEST");
        fs.writeFileSync(p, lines.join("\n"));
        let aborted = false;
        let abortAt = null;
        let endAt = null;
        const opts = baseOpts({ file: { path: p }, rangePoints: 200000, shouldAbort: () => { if (aborted) return true; return false; } });
        // track
        const origShouldAbort = opts.shouldAbort;
        opts.shouldAbort = () => { const r = origShouldAbort(); if (r && abortAt === null) abortAt = Date.now(); return r; };
        setTimeout(() => { aborted = true; }, 50);
        const start = Date.now();
        try { await backtestManager.run(strategy, opts); } catch (e) {}
        endAt = Date.now();
        console.log("6 abort requested ms:", abortAt - start, "stopped ms:", endAt - start);
        fs.unlinkSync(p);
    }, 60000);
});
