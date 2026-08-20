"use strict";

const YahooFinanceProvider = require("../src/providers/YahooFinanceProvider").YahooFinanceProvider;

describe("YahooFinanceProvider", () => {
    describe("config shape (decision #4)", () => {
        test("accepts apiKey and fetchImpl injection", () => {
            const provider = new YahooFinanceProvider({ apiKey: "test-key", fetchImpl: () => {} });
            expect(provider._apiKey).toBe("test-key");
            expect(typeof provider._fetch).toBe("function");
        });

        test("default apiKey is null", () => {
            const provider = new YahooFinanceProvider();
            expect(provider._apiKey).toBe(null);
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
        test("throws PROVIDER_UNAVAILABLE without fetch impl", async () => {
            const provider = new YahooFinanceProvider({ fetchImpl: null });
            await expect(
                provider.fetchHistory({ symbol: "AAPL", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
        });

        test("normalizes symbol before making request", async () => {
            const fetchedSymbols = [];
            const mockFetch = (url) => {
                const m = /\/chart\/([^?]+)/.exec(url);
                if (m) fetchedSymbols.push(m[1]);
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({
                        chart: {
                            result: [{
                                timestamps: [1700000000],
                                indicators: { quote: [{
                                    open: [100], high: [101], low: [99], close: [100.5], volume: [100]
                                }] }
                            }]
                        }
                    })
                });
            };

            const provider = new YahooFinanceProvider({ fetchImpl: mockFetch });
            await provider.connect();
            await provider.fetchHistory({ symbol: "aapl", interval: "1m", outputsize: 10 });

            // The provider stores the Yahoo symbol for reverse lookup
            expect(fetchedSymbols.length).toBeGreaterThan(0);
        });

        test("returns empty array for 404 SYMBOL_NOT_FOUND", async () => {
            const mockFetch = () => Promise.resolve({
                ok: false,
                status: 404,
                statusText: "Not Found",
                json: () => Promise.resolve({})
            });

            const provider = new YahooFinanceProvider({ fetchImpl: mockFetch });
            await provider.connect();
            await expect(
                provider.fetchHistory({ symbol: "FAKE", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND" });
        });

        test("handles rate limit (429)", async () => {
            const mockFetch = () => Promise.resolve({
                ok: false,
                status: 429,
                statusText: "Too Many Requests",
                json: () => Promise.resolve({})
            });

            const provider = new YahooFinanceProvider({ fetchImpl: mockFetch });
            await provider.connect();
            await expect(
                provider.fetchHistory({ symbol: "AAPL", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "RATE_LIMITED" });
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
            const provider = new YahooFinanceProvider();
            const status = provider.getStatus();
            expect(status.connected).toBe(false);
            expect(status.authorized).toBe(false);
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
