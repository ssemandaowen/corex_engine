"use strict";

const util = require("../src/util");

describe("Quantitative & Risk Utilities (util)", () => {
    test("round rounds to specified decimals", () => {
        expect(util.round(1.23456, 2)).toBe(1.23);
        expect(util.round(1.23556, 3)).toBe(1.236);
    });

    test("positionSize calculates correct lot size based on risk", () => {
        const capital = 10000;
        const riskPct = 2; // $200 risk
        const stopLossPips = 50; // $4 per pip/unit
        expect(util.positionSize(capital, riskPct, stopLossPips)).toBe(4);
        expect(util.positionSize(10000, 1, 0)).toBe(1);
    });
});
