"use strict";

const { fetchGuardedHistory, MAX_BARS_LIMIT } = require("../src/backtestDataResolver");
const { DataProviderError } = require("../src/DataProviderContract");

describe("backtestDataResolver", () => {
    describe("fetchGuardedHistory", () => {
        test("fetches bars from a mock broker", async () => {
            const mockBroker = {
                fetchHistory: async ({ symbol, interval, outputsize }) => {
                    return Array.from({ length: outputsize }, (_, i) => ({
                        time: 1700000000000 + i * 60000,
                        open: 100, high: 101, low: 99, close: 100.5, volume: 100, symbol
                    }));
                },
                constructor: { name: "MockBroker" }
            };

            const bars = await fetchGuardedHistory(mockBroker, {
                symbol: "AAPL",
                interval: "1m",
                outputsize: 10
            });

            expect(bars).toHaveLength(10);
            expect(bars[0].open).toBe(100);
        });

        test("throws DataProviderError with MAX_CANDLES_EXCEEDED for oversized requests", async () => {
            const mockBroker = { fetchHistory: async () => [] };

            await expect(
                fetchGuardedHistory(mockBroker, {
                    symbol: "AAPL",
                    interval: "1m",
                    outputsize: 6000
                })
            ).rejects.toMatchObject({ code: "MAX_CANDLES_EXCEEDED" });
        });

        test("throws DataProviderError with PROVIDER_UNAVAILABLE for missing fetchHistory", async () => {
            await expect(
                fetchGuardedHistory({}, { symbol: "AAPL", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
        });

        test("throws DataProviderError with SYMBOL_NOT_FOUND for empty symbol", async () => {
            const mockBroker = { fetchHistory: async () => [] };
            await expect(
                fetchGuardedHistory(mockBroker, { symbol: "", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND" });
        });

        test("throws DataProviderError with INVALID_INTERVAL for empty interval", async () => {
            const mockBroker = { fetchHistory: async () => [] };
            await expect(
                fetchGuardedHistory(mockBroker, { symbol: "AAPL", interval: "", outputsize: 10 })
            ).rejects.toMatchObject({ code: "INVALID_INTERVAL" });
        });

        test("wraps generic broker errors as PROVIDER_UNAVAILABLE", async () => {
            const mockBroker = {
                fetchHistory: async () => { throw new Error("Network error"); },
                constructor: { name: "TestBroker" }
            };

            await expect(
                fetchGuardedHistory(mockBroker, { symbol: "AAPL", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
        });

        test("MAX_BARS_LIMIT is 5000", () => {
            expect(MAX_BARS_LIMIT).toBe(5000);
        });
    });
});
