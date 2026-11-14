"use strict";

jest.mock("../src/mt5Bridge", () => ({
    openPosition: jest.fn(),
    closePosition: jest.fn(),
    closeAllPositions: jest.fn()
}));

const mt5Bridge = require("../src/mt5Bridge");
const MT5MQL5Connector = require("../src/connectors/MT5MQL5Connector");

describe("MT5MQL5Connector bridge protocol", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("executeOrder uses the bridge openPosition request and maps an executed payload", async () => {
        mt5Bridge.openPosition.mockResolvedValue({ status: "executed", ticket: 987654, id: "req_1" });

        const connector = new MT5MQL5Connector();
        const result = await connector.executeOrder({
            symbol: "EURUSD",
            side: "long",
            quantity: 2,
            sl: 1.0,
            tp: 1.2,
            runtimeId: "r1"
        });

        expect(mt5Bridge.openPosition).toHaveBeenCalledTimes(1);
        const payload = mt5Bridge.openPosition.mock.calls[0][0];
        expect(payload.action).toBe("BUY");
        expect(payload.symbol).toBe("EURUSD");
        expect(payload.volume).toBe(2);

        expect(result.success).toBe(true);
        expect(result.orderId).toBe(987654);
        expect(result.raw).toEqual({ status: "executed", ticket: 987654, id: "req_1" });
    });

    test("executeOrder maps a short intent to SELL", async () => {
        mt5Bridge.openPosition.mockResolvedValue({ status: "executed", ticket: 1 });

        const connector = new MT5MQL5Connector();
        await connector.executeOrder({ symbol: "GBPUSD", side: "short", quantity: 1 });

        expect(mt5Bridge.openPosition.mock.calls[0][0].action).toBe("SELL");
    });

    test("executeOrder returns a failure result when the bridge rejects the request", async () => {
        mt5Bridge.openPosition.mockRejectedValue(new Error("MT5_BRIDGE_DISCONNECTED"));

        const connector = new MT5MQL5Connector();
        const result = await connector.executeOrder({ symbol: "EURUSD", side: "long", quantity: 1 });

        expect(result.success).toBe(false);
        expect(result.error).toBe("MT5_BRIDGE_DISCONNECTED");
    });

    test("liquidatePosition uses the bridge closePosition request", async () => {
        mt5Bridge.closePosition.mockResolvedValue({ status: "executed", closed: 1 });

        const connector = new MT5MQL5Connector();
        const result = await connector.liquidatePosition("EURUSD", "r1");

        expect(mt5Bridge.closePosition).toHaveBeenCalledWith(expect.objectContaining({
            symbol: "EURUSD",
            volume: 1,
            comment: "r1"
        }));
        expect(result.success).toBe(true);
    });
});