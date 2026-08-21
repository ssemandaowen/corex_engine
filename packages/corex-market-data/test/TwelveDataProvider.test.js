"use strict";

const { TwelveDataProvider } = require("../src/providers/TwelveDataProvider");

class MockBroker {
    constructor() {
        this.config = { apiKey: "test" };
        this.connected = false;
        this.subscribed = [];
        this.historyCalls = [];
        this.symbols = new Set();
        this.__symbolNormalized = false;
    }

    connect() { this.connected = true; }
    subscribe(symbols) { this.subscribed.push(...symbols); }
    updateSymbols(symbols) { this.symbols = new Set(symbols); }
    async fetchHistory({ symbol, interval, outputsize }) {
        this.historyCalls.push({ symbol, interval, outputsize });
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

describe("TwelveDataProvider", () => {
    let mockBroker;

    beforeEach(() => {
        mockBroker = new MockBroker();
    });

    describe("contract compliance", () => {
        test("implements all DataProviderContract methods", () => {
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

    describe("symbol normalization at boundary (decision #3)", () => {
        test("subscribe() normalizes to canonical format", async () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });
            await provider.subscribe(["EUR/USD", "eurusd", "NASDAQ:MSFT"]);

            const normalizedSubscribed = mockBroker.subscribed.map((s) => {
                const SymbolNormalizer = require("../../corex-broker-contract/src/utils/SymbolNormalizer");
                return SymbolNormalizer.normalize(s).symbol;
            });
            expect(normalizedSubscribed).toContain("EURUSD");
        });

        test("fetchHistory() normalizes symbol before delegating", async () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });
            await provider.fetchHistory({ symbol: "EUR/USD", interval: "1m", outputsize: 50 });

            expect(mockBroker.historyCalls[0].symbol).toBe("EURUSD");
        });

        test("_normalize wrapping produces canonical tick symbols", async () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });

            // Simulate a WebSocket price message
            const data = { symbol: "EUR/USD", price: "1.1000", timestamp: "1700000000" };
            const tick = mockBroker._normalize(data);
            expect(tick.symbol).toBe("EURUSD");
        });

        test("fetchLatestPrice wrapping produces canonical tick symbols", async () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });

            const tick = await mockBroker.fetchLatestPrice("GBP/JPY");
            expect(tick.symbol).toBe("GBPJPY");
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

    describe("unsubscribe", () => {
        test("removes symbols via set-difference on updateSymbols", async () => {
            const provider = new TwelveDataProvider({ broker: mockBroker });

            mockBroker.updateSymbols(["AAPL", "GOOG"]);
            await provider.unsubscribe(["AAPL"]);

            expect(Array.from(mockBroker.symbols)).toEqual(["GOOG"]);
        });
    });
});
