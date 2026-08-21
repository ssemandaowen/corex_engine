"use strict";

const { DataProviderFactory } = require("../src/DataProviderFactory");
const { DataProviderError } = require("../src/DataProviderContract");

class MockProvider {
    constructor(name = "mock") {
        this.name = name;
        this.connected = false;
        this.subscribed = [];
        this.historyCalls = [];
    }
    async connect() { this.connected = true; }
    async subscribe(symbols) { this.subscribed.push(...symbols); }
    async unsubscribe(symbols) {
        this.subscribed = this.subscribed.filter((s) => !symbols.includes(s));
    }
    async fetchHistory({ symbol, interval, outputsize }) {
        this.historyCalls.push({ symbol, interval, outputsize });
        return Array.from({ length: Math.min(outputsize || 10, 10) }, (_, i) => ({
            time: Date.now() - (10 - i) * 60000,
            open: 100, high: 101, low: 99, close: 100.5, volume: 100, symbol
        }));
    }
    getCapabilities() {
        return { maxBars: 5000, supportedIntervals: ["1m"], streaming: true };
    }
    getStatus() {
        return { connected: this.connected, authorized: true, lastHeartbeat: Date.now() };
    }
    async cleanup() { this.connected = false; }
}

describe("DataProviderFactory", () => {
    let factory;

    beforeEach(() => {
        factory = new DataProviderFactory();
    });

    describe("register / setActive", () => {
        test("registers and activates a provider", () => {
            const provider = new MockProvider("test1");
            factory.register("test1", provider);
            factory.setActive("test1");
            expect(factory.getActive()).toBe(provider);
            expect(factory.getActiveName()).toBe("test1");
        });

        test("throws when setting unknown provider", () => {
            expect(() => factory.setActive("nonexistent")).toThrow(DataProviderError);
        });

        test("accepts a factory function as provider", () => {
            const provider = new MockProvider("factory-fn");
            factory.register("factory-fn", () => provider);
            factory.setActive("factory-fn");
            expect(factory.getActive()).toBe(provider);
        });
    });

    describe("connect (idempotent)", () => {
        test("is idempotent — calling twice does not double-connect", async () => {
            const provider = new MockProvider();
            factory.register("mock", provider);
            factory.setActive("mock");

            await factory.connect();
            await factory.connect();
            expect(provider.connected).toBe(true);
        });
    });

    describe("fetchHistorical", () => {
        test("throws when no active provider", async () => {
            await expect(factory.fetchHistorical({ symbol: "AAPL" })).rejects.toThrow(DataProviderError);
        });

        test("max_candles bypasses pagination (single-shot)", async () => {
            const provider = new MockProvider();
            factory.register("mock", provider);
            factory.setActive("mock");

            const bars = await factory.fetchHistorical({
                symbol: "AAPL",
                interval: "1m",
                max_candles: 5
            });

            expect(bars).toHaveLength(5);
            expect(provider.historyCalls).toHaveLength(1);
            expect(provider.historyCalls[0].outputsize).toBe(5);
        });

        test("max_candles caps at MAX_BARS_LIMIT (5000)", async () => {
            const provider = new MockProvider();
            factory.register("mock", provider);
            factory.setActive("mock");

            await factory.fetchHistorical({
                symbol: "AAPL",
                max_candles: 99999
            });

            expect(provider.historyCalls[0].outputsize).toBe(5000);
        });

        test("default path uses single request when under provider max", async () => {
            const provider = new MockProvider();
            factory.register("mock", provider);
            factory.setActive("mock");

            const bars = await factory.fetchHistorical({
                symbol: "AAPL",
                interval: "1m",
                outputsize: 100
            });

            expect(bars).toHaveLength(10);
            expect(provider.historyCalls).toHaveLength(1);
            expect(provider.historyCalls[0].outputsize).toBe(100);
        });

        test("throws MAX_CANDLES_EXCEEDED when outputsize > 5000 and no max_candles", async () => {
            const provider = new MockProvider();
            factory.register("mock", provider);
            factory.setActive("mock");

            await expect(
                factory.fetchHistorical({ symbol: "AAPL", outputsize: 6000 })
            ).rejects.toMatchObject({ code: "MAX_CANDLES_EXCEEDED" });
        });
    });

    describe("subscribe / unsubscribe", () => {
        test("routes through active provider", async () => {
            const provider = new MockProvider();
            factory.register("mock", provider);
            factory.setActive("mock");

            await factory.subscribe(["AAPL", "GOOG"]);
            expect(provider.subscribed).toEqual(["AAPL", "GOOG"]);

            await factory.unsubscribe(["AAPL"]);
            expect(provider.subscribed).toEqual(["GOOG"]);
        });
    });

    describe("cleanup", () => {
        test("cleans up active provider and clears state", async () => {
            const provider = new MockProvider();
            factory.register("mock", provider);
            factory.setActive("mock");
            await factory.connect();

            await factory.cleanup();
            expect(provider.connected).toBe(false);
            expect(factory.getActive()).toBeNull();
        });
    });
});
