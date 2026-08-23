"use strict";

const MT5MQL5Connector = require("../src/connectors/MT5MQL5Connector");
const MetaApiConnector = require("../src/connectors/MetaApiConnector");
const { NETWORK_TUNING, EVENTS } = require("@config/constants");

describe("Connectors", () => {
    describe("MT5MQL5Connector", () => {
        test("constructor sets host and port from NETWORK_TUNING", () => {
            const connector = new MT5MQL5Connector();
            expect(connector.host).toBe(NETWORK_TUNING.MT5_HOST || "127.0.0.1");
            expect(connector.port).toBe(NETWORK_TUNING.MT5_PORT || 8082);
        });

        test("executeOrder returns error object on failure", async () => {
            const connector = new MT5MQL5Connector();
            const result = await connector.executeOrder({ symbol: "EURUSD", side: "long", quantity: 1, runtimeId: "r1" });
            expect(result.success).toBe(false);
            expect(result).toHaveProperty("error");
        });
    });

    describe("MetaApiConnector", () => {
        test("constructor stores config, userId, mode", () => {
            const connector = new MetaApiConnector({ userId: "u1", mode: "LIVE" });
            expect(connector.type).toBe("METAAPI");
            expect(connector.userId).toBe("u1");
            expect(connector.mode).toBe("LIVE");
        });

        test("executeOrder returns skeleton success response", async () => {
            const connector = new MetaApiConnector({ userId: "u1", mode: "LIVE" });
            const result = await connector.executeOrder({ symbol: "EURUSD", side: "long", quantity: 1, price: 1.1 });
            expect(result.success).toBe(true);
            expect(result).toHaveProperty("orderId");
            expect(result.executionPrice).toBe(1.1);
        });

        test("getPositionSnapshot returns empty structure", async () => {
            const connector = new MetaApiConnector();
            const snap = await connector.getPositionSnapshot("EURUSD");
            expect(snap.positions).toEqual({});
            expect(snap.openCount).toBe(0);
            expect(snap.totalUnrealized).toBe(0);
        });

        test("getEquity returns 0", async () => {
            const connector = new MetaApiConnector();
            expect(await connector.getEquity()).toBe(0);
        });

        test("liquidatePosition returns success", async () => {
            const connector = new MetaApiConnector();
            const result = await connector.liquidatePosition("EURUSD", "r1");
            expect(result.success).toBe(true);
        });
    });
});
