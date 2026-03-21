"use strict";

require("module-alias/register");

const RuleChain = require("@utils/strategy/RuleChain");
const BaseStrategy = require("@utils/BaseStrategy");

function makeStrategy() {
    const calls = [];
    const strategy = {
        currentBar: { time: 1700000000000 },
        lastTick: { time: 1700000000100 },
        pos: (state, symbol) => state === "flat" && symbol === "BTC/USD",
        crossover: (_a, _b, opts = {}) => {
            calls.push({ type: "crossover", opts });
            return true;
        },
        crossunder: () => false,
        entryLong: (params = {}) => ({ intent: "ENTER", side: "LONG", ...params }),
        entryShort: (params = {}) => ({ intent: "ENTER", side: "SHORT", ...params }),
        exitLong: (params = {}) => ({ intent: "EXIT", side: "LONG", ...params }),
        exitShort: (params = {}) => ({ intent: "EXIT", side: "SHORT", ...params }),
        exitAll: (params = {}) => ({ intent: "EXIT", side: "FLAT", ...params }),
        flipToLong: (params = {}) => ({ intent: "FLIP", side: "LONG", ...params }),
        flipToShort: (params = {}) => ({ intent: "FLIP", side: "SHORT", ...params })
    };
    return { strategy, calls };
}

describe("RuleChain", () => {
    test("supports when + and + action commit", () => {
        const { strategy } = makeStrategy();
        const signal = new RuleChain(strategy)
            .when(true)
            .and(true)
            .enterLong({ symbol: "BTC/USD", quantity: 1 })
            .end();

        expect(signal).toBeTruthy();
        expect(signal.intent).toBe("ENTER");
        expect(signal.side).toBe("LONG");
    });

    test("supports then/else branching", () => {
        const { strategy } = makeStrategy();
        const signal = new RuleChain(strategy)
            .when(false)
            .then((chain) => chain.enterLong({ quantity: 1 }))
            .else((chain) => chain.enterShort({ quantity: 2 }))
            .end();

        expect(signal).toBeTruthy();
        expect(signal.side).toBe("SHORT");
        expect(signal.quantity).toBe(2);
    });

    test("locks after first matched leaf (short-circuit)", () => {
        const { strategy } = makeStrategy();
        const signal = new RuleChain(strategy)
            .when(true)
            .enterLong({ quantity: 1 })
            .when(true)
            .enterShort({ quantity: 9 })
            .end();

        expect(signal).toBeTruthy();
        expect(signal.side).toBe("LONG");
        expect(signal.quantity).toBe(1);
    });

    test("passes consistent barTime into cross checks", () => {
        const { strategy, calls } = makeStrategy();
        const barTime = 1711111111111;
        new RuleChain(strategy, { barTime })
            .whenCrossUp([1, 2], [1, 1], "k1")
            .enterLong({ quantity: 1 })
            .end();

        expect(calls[0]?.type).toBe("crossover");
        expect(calls[0]?.opts?.barTime).toBe(barTime);
        expect(calls[0]?.opts?.key).toBe("k1");
    });
});

describe("BaseStrategy chain alias", () => {
    class TestStrategy extends BaseStrategy {
        constructor() {
            super({
                name: "rule_chain_alias_test",
                symbols: ["BTC/USD"],
                timeframe: "1m",
                lookback: 20
            });
        }
    }

    test("chain() returns RuleChain instance", () => {
        const s = new TestStrategy();
        const chain = s.chain({ time: 1711111111111 });
        expect(chain).toBeInstanceOf(RuleChain);
    });
});

