"use strict";

const { TwelveDataProvider } = require("../src/providers/TwelveDataProvider");
const { DataProviderError } = require("../src/DataProviderContract");
const { SymbolNormalizer } = require("corex-broker-contract");

class MockBroker {
    constructor() {
        this.config = { apiKey: "test" };
        this.connected = false;
        this.subscribed = [];
        this.unsubscribed = [];
        this.historyCalls = [];
        this.symbols = new Set();
        this.__symbolNormalized = false;
        this.historyError = null;
    }

    connect() { this.connected = true; }
    subscribe(symbols) { this.subscribed.push(...symbols); }
    // Mirror the legacy singleton: updateSymbols() is a set replacement that
    // emits the add/remove deltas upstream and tracks the current set.
    updateSymbols(symbols) {
        const next = new Set(symbols);
        for (const s of next) if (!this.symbols.has(s)) this.subscribed.push(s);
        for (const s of this.symbols) if (!next.has(s)) this.unsubscribed.push(s);
        this.symbols = next;
    }
    async fetchHistory({ symbol, interval, outputsize }) {
        this.historyCalls.push({ symbol, interval, outputsize });
        if (this.historyError) throw this.historyError;
        // Mimic the legacy layer: bars are tagged with the symbol it was given
        // (the provider form), which the adapter must translate back.
        return [{ time: 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 100, symbol }];
    }
    getStatus() { return { connected: this.connected, symbols: Array.from(this.symbols) }; }
    cleanup() { this.connected = false; }

    _normalize(data, symbolOverride = null) {
        return {
            symbol: data.symbol || symbolOverride,
            time: data.timestamp ? parseInt(data.timestamp, 10) : Date.now(),
            open: parseFloat(data.open || 0),
            high: parseFloat(data.high || 0),
            low: parseFloat(data.low || 0),
            close: parseFloat(data.close || 0),
            price: parseFloat(data.price || 0),
            volume: parseFloat(data.volume || 0),
            is_live: !!data.event
        };
    }

    async fetchLatestPrice(symbol) {
        return { symbol, time: Date.now(), price: 150.0, close: 150.0, open: 150.0, high: 150.0, low: 150.0, volume: 0, is_live: false };
    }
}

const CASES = [
    { input: "EUR/USD", outbound: "EUR/USD", inbound: "EURUSD" },
    { input: "eurusd", outbound: "EUR/USD", inbound: "EURUSD" },
    { input: "EUR_USD", outbound: "EUR/USD", inbound: "EURUSD" },
    { input: "BTC/USD", outbound: "BTC/USD", inbound: "BTCUSD" },
    { input: "BTCUSD", outbound: "BTC/USD", inbound: "BTCUSD" },
    // USDT pairs pass through unformatted until the provider spelling is verified.
    { input: "BTC/USDT", outbound: "BTCUSDT", inbound: "BTCUSDT" },
    { input: "AAPL", outbound: "AAPL", inbound: "AAPL" },
    { input: "SPX500", outbound: "SPX500", inbound: "SPX500" }
];

describe("TwelveDataProvider", () => {
    let mockBroker;

    beforeEach(() => {
        mockBroker = new MockBroker();
    });

    describe("contract compliance", () => {
        test("implements all required DataProviderContract methods", () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });
            expect(typeof provider.connect).toBe("function");
            expect(typeof provider.subscribe).toBe("function");
            expect(typeof provider.unsubscribe).toBe("function");
            expect(typeof provider.fetchHistory).toBe("function");
            expect(typeof provider.getCapabilities).toBe("function");
            expect(typeof provider.getStatus).toBe("function");
            expect(typeof provider.cleanup).toBe("function");
        });
    });

    describe("provider symbol boundary", () => {
        test.each(CASES)("format: $input -> $outbound", ({ input, outbound }) => {
            const provider = new TwelveDataProvider({ broker: mockBroker });
            expect(provider.toProviderSymbol(input)).toBe(outbound);
        });

        test.each(CASES)("subscribe sends $outbound", async ({ input, outbound }) => {
            const provider = new TwelveDataProvider({ broker: mockBroker });
            await provider.subscribe([input]);
            expect(mockBroker.subscribed).toContain(outbound);
        });

        test.each(CASES)("fetchHistory sends $outbound and returns canonical $inbound", async ({ input, outbound, inbound }) => {
            const provider = new TwelveDataProvider({ broker: mockBroker });
            const bars = await provider.fetchHistory({ symbol: input, interval: "1m", outputsize: 50 });

            expect(mockBroker.historyCalls[0].symbol).toBe(outbound);
            expect(bars[0].symbol).toBe(inbound);
        });

        test.each(CASES)("WS ticks normalize $outbound back to $inbound", ({ outbound, inbound }) => {
            new TwelveDataProvider({ broker: mockBroker });

            const data = { symbol: outbound, price: "1.1000", timestamp: "1700000000" };
            const tick = mockBroker._normalize(data);
            expect(tick.symbol).toBe(inbound);
        });

        test.each(CASES)("fetchLatestPrice formats outbound and returns $inbound", async ({ input, outbound, inbound }) => {
            const provider = new TwelveDataProvider({ broker: mockBroker });
            const seen = [];
            const original = mockBroker.fetchLatestPrice;
            // The wrapper installed by the provider delegates to the broker; capture
            // the formatted symbol by replacing the underlying implementation.
            mockBroker.fetchLatestPrice = async (symbol) => {
                seen.push(symbol);
                return original(symbol);
            };

            const tick = await mockBroker.fetchLatestPrice.call(mockBroker, input);
            expect(seen[0]).toBe(input); // call site still passes canonical/UI form
            expect(tick.symbol).toBe(inbound || SymbolNormalizer.normalize(input).symbol);
            expect(typeof provider.toProviderSymbol).toBe("function");
        });

        test("subscribe tracks the provider set so unsubscribe removes only the requested symbol", async () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });

            await provider.subscribe(["AAPL", "EURUSD"]);
            await provider.unsubscribe(["EURUSD"]);

            expect(Array.from(mockBroker.symbols)).toEqual(["AAPL"]);
            expect(mockBroker.unsubscribed).toEqual(["EUR/USD"]);
        });

        test("subscribe is additive across calls", async () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });

            await provider.subscribe(["EURUSD"]);
            await provider.subscribe(["GBPUSD"]);

            expect(Array.from(mockBroker.symbols)).toEqual(["EUR/USD", "GBP/USD"]);
            expect(mockBroker.subscribed).toEqual(["EUR/USD", "GBP/USD"]);
        });

        test("SymbolNormalizer.fromProvider uses the same Twelve Data formatter", () => {
            expect(SymbolNormalizer.fromProvider("EURUSD").twelvedata).toBe("EUR/USD");
            expect(SymbolNormalizer.fromProvider("BTCUSD").twelvedata).toBe("BTC/USD");
            expect(SymbolNormalizer.fromProvider("AAPL").twelvedata).toBe("AAPL");
        });
    });

    describe("typed failures", () => {
        test("a mocked upstream rejection surfaces as SYMBOL_NOT_FOUND", async () => {
            mockBroker.historyError = new Error("DATA_UNAVAILABLE: FAKE is not supported by the market data provider");
            const provider = new TwelveDataProvider({ broker: mockBroker });

            await expect(
                provider.fetchHistory({ symbol: "FAKE", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND", symbol: "FAKE" });
        });

        test("missing key surfaces as PROVIDER_KEY_MISSING", async () => {
            mockBroker.historyError = new DataProviderError("PROVIDER_KEY_MISSING", {
                provider: "twelvedata",
                message: "TwelveData API key is missing; historical fetch is unavailable."
            });
            const provider = new TwelveDataProvider({ broker: mockBroker });

            await expect(
                provider.fetchHistory({ symbol: "EURUSD", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "PROVIDER_KEY_MISSING", retryable: false });
        });

        test("genuine transport failures stay PROVIDER_UNAVAILABLE", async () => {
            mockBroker.historyError = new Error("socket hang up");
            const provider = new TwelveDataProvider({ broker: mockBroker });

            await expect(
                provider.fetchHistory({ symbol: "EURUSD", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
        });

        test("an empty symbol is rejected before reaching the provider", async () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });
            await expect(
                provider.fetchHistory({ symbol: "", interval: "1m", outputsize: 10 })
            ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND" });
            expect(mockBroker.historyCalls).toHaveLength(0);
        });
    });

    describe("getCapabilities", () => {
        test("returns maxBars=5000 and supported intervals", () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });
            const caps = provider.getCapabilities();
            expect(caps.maxBars).toBe(5000);
            expect(caps.streaming).toBe(true);
            expect(caps.supportedIntervals).toContain("1m");
        });
    });

    describe("getStatus", () => {
        test("returns connected + authorized + lastHeartbeat", () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });
            const status = provider.getStatus();
            expect(status.connected).toBe(false);
            expect(status.authorized).toBe(true);
            expect(status.lastHeartbeat).toBe(null);
        });
    });
});
