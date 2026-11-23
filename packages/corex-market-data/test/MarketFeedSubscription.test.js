"use strict";

/**
 * MarketFeed ↔ DataProviderFactory ↔ TwelveDataProvider subscription lifecycle.
 *
 * Verifies the shared contract: MarketFeed.unsubscribe() reports only the
 * symbols that lost their last subscriber, and the provider removes exactly
 * those from the upstream tracked set. Symbols still used by another runtime
 * must never produce an upstream unsubscribe.
 */

const MarketFeed = require("../src/MarketFeed");
const DataProviderFactory = require("../src/DataProviderFactory");
const { TwelveDataProvider } = require("../src/providers/TwelveDataProvider");

class FakeLegacyBroker {
    constructor() {
        this.connected = false;
        this.symbols = new Set();
        this.messages = [];
        this.__symbolNormalized = false;
    }

    connect() { this.connected = true; }

    // Mirrors src/legacy/twelvedata.js updateSymbols(): set replacement that
    // emits the add/remove deltas upstream.
    updateSymbols(symbolArray = []) {
        const next = new Set(symbolArray);
        const added = [...next].filter((s) => !this.symbols.has(s));
        const removed = [...this.symbols].filter((s) => !next.has(s));
        this.symbols = next;
        if (added.length) this.messages.push({ action: "subscribe", symbols: added });
        if (removed.length) this.messages.push({ action: "unsubscribe", symbols: removed });
    }

    getStatus() {
        return { connected: this.connected, symbols: Array.from(this.symbols) };
    }

    cleanup() { this.connected = false; }
}

function flush() {
    return new Promise((resolve) => setImmediate(resolve));
}

describe("MarketFeed subscription lifecycle", () => {
    const RUNTIME_A = "user-a::strategy-a::EURUSD::PAPER";
    const RUNTIME_B = "user-b::strategy-b::GBPUSD::PAPER";

    let broker;
    let provider;

    beforeEach(async () => {
        MarketFeed._subscribers.clear();
        broker = new FakeLegacyBroker();
        provider = new TwelveDataProvider({ broker });
        DataProviderFactory.register("fake", provider);
        DataProviderFactory.setActive("fake");
        await DataProviderFactory.connect();
    });

    afterEach(async () => {
        MarketFeed._subscribers.clear();
    });

    afterAll(async () => {
        await DataProviderFactory.cleanup();
    });

    test("a subscribed symbol is tracked upstream in provider form", async () => {
        MarketFeed.subscribe(RUNTIME_A, "EURUSD");
        MarketFeed.subscribe(RUNTIME_B, "GBPUSD");
        await flush();

        expect(Array.from(broker.symbols)).toEqual(["EUR/USD", "GBP/USD"]);
        expect(broker.messages).toEqual([
            { action: "subscribe", symbols: ["EUR/USD"] },
            { action: "subscribe", symbols: ["GBP/USD"] }
        ]);
    });

    test("removing a runtime unsubscribes only the symbols it no longer uses", async () => {
        MarketFeed.subscribe(RUNTIME_A, "EURUSD");
        MarketFeed.subscribe(RUNTIME_B, "GBPUSD");
        await flush();

        MarketFeed.unsubscribe(RUNTIME_A, "EURUSD");
        await flush();

        expect(broker.messages.filter((m) => m.action === "unsubscribe")).toEqual([
            { action: "unsubscribe", symbols: ["EUR/USD"] }
        ]);
        expect(Array.from(broker.symbols)).toEqual(["GBP/USD"]);
    });

    test("removing one of two runtimes on the same symbol keeps it subscribed", async () => {
        MarketFeed.subscribe(RUNTIME_A, "EURUSD");
        MarketFeed.subscribe(RUNTIME_B, "EURUSD");
        await flush();

        MarketFeed.unsubscribe(RUNTIME_A, "EURUSD");
        await flush();

        expect(broker.messages.filter((m) => m.action === "unsubscribe")).toEqual([]);
        expect(Array.from(broker.symbols)).toEqual(["EUR/USD"]);

        MarketFeed.unsubscribe(RUNTIME_B, "EURUSD");
        await flush();

        expect(broker.messages.filter((m) => m.action === "unsubscribe")).toEqual([
            { action: "unsubscribe", symbols: ["EUR/USD"] }
        ]);
    });
});
