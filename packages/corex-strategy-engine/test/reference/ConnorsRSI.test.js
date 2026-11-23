"use strict";

const reference = require("../helpers/reference/ConnorsRSI");

describe("ConnorsRSI reference (independent, published definition — Connors)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: ConnorsRSI(3,3,3)", () => {
        // Signed streaks are [0,1,-1,1,2,-1,-2,-3,-4,1].
        // Final price RSI(3) = 56.7754077792.
        // Final streak RSI(3) = 71.2629099475.
        // Last three one-bar ROC values are [-9.0909,-10,22.2222]%;
        // current ROC is above both prior values, so PercentRank = 100.
        // CRSI = (56.7754077792 + 71.2629099475 + 100)/3 = 76.0127725755.
        const result = reference(closes, 3, 3, 3);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(76.01277257554204, 10);
    });

    test("insufficient warmup until RSI and PercentRank components exist", () => {
        const result = reference([10, 12, 11], 3, 3, 3);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("zero previous close inside the ROC rank window leaves it unavailable", () => {
        const result = reference([10, 11, 0, 12, 13, 14], 3, 3, 3);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });
});
