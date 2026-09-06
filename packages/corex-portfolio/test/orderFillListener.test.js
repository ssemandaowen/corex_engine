"use strict";

const { bus, EVENTS } = require("@events/bus");
const { OrderFillListener } = require("../src/orderFillListener");
const CoreXPaperDriver = require("corex-broker-contract/src/drivers/CoreXPaperDriver");
const BacktestDriver = require("corex-broker-contract/src/drivers/BacktestDriver");

describe("OrderFillListener & Fill Emission", () => {
    let mockPool;
    let listener;

    beforeEach(() => {
        jest.clearAllMocks();
        mockPool = {
            connect: jest.fn(() => ({
                query: jest.fn(async (sql) => {
                    if (sql.includes("SELECT id FROM orders")) {
                        return { rows: [] };
                    }
                    return { rows: [] };
                }),
                release: jest.fn()
            }))
        };
        listener = new OrderFillListener(mockPool);
        listener.start();
    });

    afterEach(() => {
        listener.stop();
    });

    test("CoreXPaperDriver settling a trade emits EVENTS.ORDER.FILLED with accountId", async () => {
        const emitSpy = jest.spyOn(bus, "emit");
        const driver = new CoreXPaperDriver({
            runtimeId: "test_runtime",
            symbol: "EURUSD",
            userId: "u1",
            accountId: "cx_pap_123456789012345678901234",
            initialCash: 10000,
            mode: "PAPER"
        });
        await driver.initialize({ runtimeId: "test_runtime", mode: "PAPER" });

        // Force a trade settlement
        driver._settlePosition("EURUSD", 1, 1.1000, "long", 0.1, 0, 0, Date.now());

        expect(emitSpy).toHaveBeenCalledWith(EVENTS.ORDER.FILLED, expect.objectContaining({
            accountId: "cx_pap_123456789012345678901234",
            symbol: "EURUSD",
            quantity: 1,
            price: 1.1000,
            status: "FILLED"
        }));
    });

    test("BacktestDriver produces zero order:filled events", async () => {
        const emitSpy = jest.spyOn(bus, "emit");
        const driver = new BacktestDriver({
            runtimeId: "bt_runtime",
            symbol: "EURUSD",
            initialCash: 10000,
            mode: "BACKTEST"
        });
        await driver.initialize({ runtimeId: "bt_runtime", mode: "BACKTEST" });

        await driver.submit({ Symbol: "EURUSD", Volume: 1, Side: "BUY", OrderType: "MARKET" });

        const fillCalls = emitSpy.mock.calls.filter(([evt]) => evt === EVENTS.ORDER.FILLED);
        expect(fillCalls.length).toBe(0);
    });

    test("OrderFillListener persists fill into orders and order_fills using mockPool", async () => {
        const clientQueryMock = jest.fn(async (sql) => {
            if (sql.includes("SELECT id FROM orders")) {
                return { rows: [] };
            }
            return { rows: [] };
        });
        const clientMock = {
            query: clientQueryMock,
            release: jest.fn()
        };
        mockPool.connect = jest.fn(async () => clientMock);

        const payload = {
            orderId: "ord_test_1",
            accountId: "cx_pap_123456789012345678901234",
            userId: "u1",
            environment: "PAPER",
            symbol: "EURUSD",
            side: "BUY",
            quantity: 1.5,
            price: 1.1234,
            commission: 0.05,
            orderType: "MARKET",
            status: "FILLED",
            timestamp: Date.now()
        };

        bus.emit(EVENTS.ORDER.FILLED, payload);

        // Wait async event handler
        await new Promise((r) => setTimeout(r, 30));

        expect(clientQueryMock).toHaveBeenCalledWith("BEGIN");
        expect(clientQueryMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO orders"), expect.any(Array));
        expect(clientQueryMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO order_fills"), expect.any(Array));
        expect(clientQueryMock).toHaveBeenCalledWith("COMMIT");
        expect(clientMock.release).toHaveBeenCalled();
    });

    test("Settlement path latency benchmark (< 5ms)", async () => {
        const driver = new CoreXPaperDriver({
            runtimeId: "bench_runtime",
            symbol: "EURUSD",
            userId: "u1",
            accountId: "cx_pap_123456789012345678901234",
            initialCash: 10000,
            mode: "PAPER"
        });
        await driver.initialize({ runtimeId: "bench_runtime", mode: "PAPER" });

        const start = process.hrtime.bigint();
        for (let i = 0; i < 100; i++) {
            driver._settlePosition("EURUSD", 1, 1.1000, i % 2 === 0 ? "long" : "short", 0.01, 0, 0, Date.now());
        }
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;
        const avgMs = durationMs / 100;

        console.log(`[Benchmark] Average settlement + event emission time: ${avgMs.toFixed(3)}ms per trade`);
        expect(avgMs).toBeLessThan(5); // well within non-blocking budget
    });

    test("TradeHistoryService.getHistoryReport(accountId) returns persisted trade rows", async () => {
        const { TradeHistoryService } = require("../index");
        const { Pool } = require("pg");
        const queryMock = jest.fn(async (sql) => {
            if (sql.includes("FROM orders")) {
                return {
                    rows: [{
                        order_id: "ord_test_1",
                        strategy_id: null,
                        strategy_name: null,
                        symbol: "EURUSD",
                        side: "BUY",
                        order_type: "MARKET",
                        status: "FILLED",
                        environment: "PAPER",
                        created_at: new Date(),
                        fill_id: "fill_1",
                        external_deal_id: null,
                        fill_price: 1.1234,
                        fill_quantity: 1.5,
                        commission: 0.05,
                        filled_at: new Date(),
                        account_id: "cx_pap_123456789012345678901234"
                    }]
                };
            }
            return { rows: [] };
        });
        const pool = new Pool();
        pool.query = queryMock;
        const service = new TradeHistoryService(pool);
        const report = await service.getHistoryReport({ accountId: "cx_pap_123456789012345678901234", environment: "PAPER" });
        expect(report.fills.length).toBe(1);
        expect(report.fills[0].orderId).toBe("ord_test_1");
        expect(report.fills[0].price).toBe(1.1234);
    });
});
