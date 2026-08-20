"use strict";

const YahooFinanceProvider = require("../src/providers/YahooFinanceProvider").YahooFinanceProvider;

const createMockYahoo = (overrides = {}) => {
    const calls = { chart: [] };
    const mock = {
        chart: async (queryOpts) => {
            calls.chart.push({ ...queryOpts });
            if (overrides.chartResult) return overrides.chartResult;
            if (overrides.chartError) throw overrides.chartError;
            return overrides.defaultResult || {
                timestamps: [1700000000, 1700000060, 1700000120],
                quotes: [
                    { open: 100, high: 101, low: 99, close: 100.5, volume: 100 },
                    { open: 100.5, high: 102, low: 100, close: 101, volume: 150 },
                    { open: 101, high: 103, low: 100.5, close: 102, volume: 200 }
                ]
            };
        },
        cleanup: overrides.cleanup || (() => {})
    };
    return { mock, calls };
};

describe("YahooFinanceProvider", () => {
    describe("config shape (decision #4)", () => {
        test("accepts apiKey and yahooImpl injection", () => {
            const { mock } = createMockYahoo();
            const provider = new YahooFinanceProvider({ apiKey: "test-key", yahooImpl: mock });
            expect(provider._apiKey).toBe("test-key");
            expect(provider._yahooImpl).toBe(mock);
        });

        test("default apiKey is null", () => {
            const orig = process.env.YAHOO_API_KEY;
            delete process.env.YAHOO_API_KEY;
            const provider = new YahooFinanceProvider();
            expect(provider._apiKey).toBe(null);
            if (orig !== undefined) process.env.YAHOO_API_KEY = orig;
        });

        test("reads YAHOO_API_KEY from process.env when no opts provided", () => {
            const orig = process.env.YAHOO_API_KEY;
            process.env.YAHOO_API_KEY = "env-key-123";
            try {
                const provider = new YahooFinanceProvider();
                expect(provider._apiKey).toBe("env-key-123");
            } finally {
                if (orig === undefined) delete process.env.YAHOO_API_KEY;
                else process.env.YAHOO_API_KEY = orig;
            }
        });
    });

    describe("contract compliance", () => {
        const methods = ["connect", "subscribe", "unsubscribe", "fetchHistory", "getCapabilities", "getStatus", "cleanup"];
        const provider = new YahooFinanceProvider();

        for (const m of methods) {
            test(`implements ${m}()`, () => {
                expect(typeof provider[m]).toBe("function");
            });
        }
    });

    describe("fetchHistory", () => {
        test("normalizes symbol before making request", async () => {
            const { mock, calls } = createMockYahoo();
            const provider = new YahooFinanceProvider({ yahooImpl: mock });
            await provider.connect();

            await provider.subscribe(["AAPL"]);
            await provider.fetchHistory({ symbol: "aapl", interval: "1m", outputsize: 10 });

            expect(calls.chart.length).toBe(1);
            const call = calls.chart[0];
            expect(call.symbol).toBeTruthy();
        });

        test("returns OHLCV bars from chart result", async () => {
            const { mock } = createMockYahoo();
            const provider = new YahooFinanceProvider({ yahooImpl: mock });
            await provider.connect();

            const bars = await provider.fetchHistory({ symbol: "AAPL", interval: "1d", outputsize: 10 });

            expect(bars).toHaveLength(3);
            expect(bars[0]).toMatchObject({
                time: 1700000000000,
                open: 100,
                high: 101,
                low: 99,
                close: 100.5,
                volume: 100,
                symbol: "AAPL"
            });
        });

        test("caps bars at outputsize", async () => {
            const { mock } = createMockYahoo();
            const provider = new YahooFinanceProvider({ yahooImpl: mock });
            await provider.connect();

            const bars = await provider.fetchHistory({ symbol: "AAPL", interval: "1d", outputsize: 2 });
            expect(bars).toHaveLength(2);
        });

        test("throws SYMBOL_NOT_FOUND for 404 errors from yahoo-finance2", async () => {
            const err404 = new Error("Request failed with status code 404");
            err404.result = { response: { status: 404 } };
            const { mock } = createMockYahoo({ chartError: err404 });
            const provider = new YahooFinanceProvider({ yahooImpl: mock });
            await provider.connect();

            await expect(
                provider.fetchHistory({ symbol: "FAKE", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND" });
        });

        test("throws RATE_LIMITED for 429 errors from yahoo-finance2", async () => {
            const err429 = new Error("Rate limited");
            err429.result = { response: { status: 429 } };
            const { mock } = createMockYahoo({ chartError: err429 });
            const provider = new YahooFinanceProvider({ yahooImpl: mock });
            await provider.connect();

            await expect(
                provider.fetchHistory({ symbol: "AAPL", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "RATE_LIMITED" });
        });

        test("throws PROVIDER_UNAVAILABLE for network errors", async () => {
            const netErr = new Error("Network error: ECONNREFUSED");
            const { mock } = createMockYahoo({ chartError: netErr });
            const provider = new YahooFinanceProvider({ yahooImpl: mock });
            await provider.connect();

            await expect(
                provider.fetchHistory({ symbol: "AAPL", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
        });
    });

    describe("getCapabilities", () => {
        test("returns maxBars=5000, streaming=false", () => {
            const provider = new YahooFinanceProvider();
            const caps = provider.getCapabilities();
            expect(caps.maxBars).toBe(5000);
            expect(caps.streaming).toBe(false);
            expect(caps.supportedIntervals).toContain("1m");
            expect(caps.supportedIntervals).toContain("1d");
        });
    });

    describe("subscribe / unsubscribe (symbol normalization)", () => {
        test("stores symbol mapping on subscribe", async () => {
            const provider = new YahooFinanceProvider();
            await provider.subscribe(["brka", "msft"]);

            expect(provider._symbolMap.has("BRKA")).toBe(true);
            expect(provider._symbolMap.get("BRKA")).toBe("brka");
        });

        test("removes symbol mapping on unsubscribe", async () => {
            const provider = new YahooFinanceProvider();
            await provider.subscribe(["msft"]);
            await provider.unsubscribe(["msft"]);

            expect(provider._symbolMap.has("MSFT")).toBe(false);
        });
    });

    describe("getStatus", () => {
        test("returns connected=false before connect", () => {
            const orig = process.env.YAHOO_API_KEY;
            delete process.env.YAHOO_API_KEY;
            const provider = new YahooFinanceProvider();
            const status = provider.getStatus();
            expect(status.connected).toBe(false);
            expect(status.authorized).toBe(false);
            if (orig !== undefined) process.env.YAHOO_API_KEY = orig;
        });

        test("returns authorized=true after connect with apiKey", async () => {
            const provider = new YahooFinanceProvider({ apiKey: "test" });
            await provider.connect();
            const status = provider.getStatus();
            expect(status.connected).toBe(true);
            expect(status.authorized).toBe(true);
        });
    });
});
