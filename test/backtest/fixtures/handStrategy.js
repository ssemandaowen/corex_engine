"use strict";
const StrategyContract = require("@core/core/strategy/StrategyContract").StrategyContract;

const BASE = 1700000000000;
const STEP = 60000;

class HandStrategy {
    constructor() {
        this.id = "hand-strategy";
        this.name = "HandStrategy";
        this.symbols = ["TEST"];
        this.timeframe = "1m";
        this.mode = "BACKTEST";
    }
    onBar(bar) {
        const idx = Math.round((Number(bar.time) - BASE) / STEP);
        if (idx === 4) return { intent: "ENTER", side: "long", quantity: 10, symbol: "TEST" };
        if (idx === 9) return { intent: "EXIT", side: "long", quantity: 10, symbol: "TEST" };
        return null;
    }
}

const instance = new HandStrategy();
StrategyContract.validateAndAdapt(instance);
module.exports = instance;
module.exports.HandStrategy = HandStrategy;
module.exports.BASE = BASE;
module.exports.STEP = STEP;
