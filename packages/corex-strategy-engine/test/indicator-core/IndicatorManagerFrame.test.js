"use strict";

const { IndicatorManager } = require("../../src/IndicatorManager");
const { IndicatorRegistry } = require("../../src/IndicatorRegistry");
const BaseIndicator = require("../../src/indicators/BaseIndicator");
const CandleStore = require("../../src/kernel/CandleStore");
const Frame = require("../../src/kernel/Frame");

class FrameCloseIndicator extends BaseIndicator {
    onFrame(frame) { this.value = frame.c; this.ready = true; }
}
class FrameSourceIndicator extends BaseIndicator {
    onFrame(frame) { this.value = this.readSource(frame); this.ready = true; }
}

describe("IndicatorManager dense Frame dispatch", () => {
    function createStore(rows) {
        const store = new CandleStore(16);
        const frame = new Frame();
        for (const row of rows) {
            expect(frame.load(row)).toBe(true);
            store.pushFrame(frame);
        }
        return store;
    }

    function createStrategy() {
        class Strategy {
            static indicators = { close: { type: "FRAME_CLOSE" } };
            constructor() {
                this.symbols = ["EURUSD"];
                this.params = {};
                this.dataManager = {
                    data: new Map([["EURUSD", {
                        candles: createStore([
                            { time: 1, open: 10, high: 11, low: 9, close: 10, volume: 2 },
                            { time: 2, open: 10, high: 13, low: 10, close: 12, volume: 3 }
                        ])
                    }]])
                };
            }
        }
        return new Strategy();
    }

    function createRegistry() {
        const registry = new IndicatorRegistry();
        registry.register("FRAME_CLOSE", FrameCloseIndicator);
        return registry;
    }

    test("updates Frame indicators through compiled dense entries", () => {
        const manager = new IndicatorManager(createStrategy(), createRegistry());
        manager.initialize();
        manager.updateIndicators({
            symbol: "EURUSD", time: 3, open: 12, high: 14, low: 11, close: 13, volume: 5
        });
        const instance = manager.getIndicatorValue("close");
        expect(instance).toBeInstanceOf(FrameCloseIndicator);
        expect(instance.value).toBe(13);
        expect(instance.ready).toBe(true);
        expect(manager._frameEntries).toHaveLength(1);
        expect(manager._frameIndicators).toHaveLength(1);
        expect(manager._frameIndicators[0]).toBe(instance);
        expect(manager._legacyEntries).toHaveLength(0);
    });

    test("precomputes configured source fields at construction", () => {
        class HighStrategy {
            static indicators = { high: { type: "FRAME_SOURCE", source: "high" } };
            constructor() {
                this.symbols = ["EURUSD"];
                this.params = {};
                this.dataManager = { data: new Map() };
            }
        }
        const registry = new IndicatorRegistry();
        registry.register("FRAME_SOURCE", FrameSourceIndicator);
        const manager = new IndicatorManager(new HighStrategy(), registry);
        manager.initialize();
        manager.updateIndicators({
            symbol: "EURUSD", time: 1, open: 10, high: 17, low: 9, close: 12, volume: 1
        });
        const instance = manager.getIndicatorValue("high");
        expect(instance.value).toBe(17);
        expect(instance.sourceField).toBe("h");
    });

    test("reseed replays typed-array history into Frame indicators", () => {
        const strategy = createStrategy();
        const manager = new IndicatorManager(strategy, createRegistry());
        manager.initialize();
        manager.reseedIndicators();
        const instance = manager.getIndicatorValue("close");
        expect(instance.value).toBe(12);
        expect(instance.count).toBe(2);
        expect(instance.prev).toBe(10);
    });

    test("rethrows ConfigError with indicator name and parameter key", () => {
        const { ConfigError } = require("../../src/params/errors");
        class InvalidConfigIndicator extends BaseIndicator {
            static resolveParams() { throw new ConfigError("length", "length must be positive"); }
            onFrame() {}
        }
        class InvalidStrategy {
            static indicators = { fastLine: { type: "INVALID_CONFIG" } };
            constructor() {
                this.symbols = ["EURUSD"];
                this.params = {};
                this.dataManager = { data: new Map() };
            }
        }
        const registry = new IndicatorRegistry();
        registry.register("INVALID_CONFIG", InvalidConfigIndicator);
        const manager = new IndicatorManager(new InvalidStrategy(), registry);
        expect(() => manager.initialize()).toThrow(/Indicator 'fastLine' parameter 'length'/);
    });
});