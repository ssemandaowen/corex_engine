"use strict";

const { Strategy, globalIndicatorRegistry, IndicatorManager } = require("../index");
const DummyIndicator = require("./fixtures/DUMMY");

describe("Pluggable Indicator Registry & Zero Core-File Edit Claim", () => {
    test("registers a brand-new dummy indicator type purely from an external fixture with zero IndicatorManager edits", () => {
        globalIndicatorRegistry.register("DUMMY", DummyIndicator);

        class DummyTestStrategy extends Strategy {
            static symbols = ["EURUSD"];
            static timeframe = "1m";
            static indicators = {
                testDummy: { type: "DUMMY", period: 5, customParam: 250 }
            };
            onBar(ctx, bar) { return null; }
        }

        const strategy = new DummyTestStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        strategy._ensureInitialized();

        const dummyInst = strategy._indicatorManager.getIndicatorValue("testDummy");
        expect(dummyInst).toBeDefined();
        expect(dummyInst.period).toBe(5);
        expect(dummyInst.customParam).toBe(250);

        const res = dummyInst.update(100);
        expect(res).toBe(350);
        expect(dummyInst.value).toBe(350);
        expect(dummyInst.ready).toBe(true);

        strategy.destroy();
    });
});
