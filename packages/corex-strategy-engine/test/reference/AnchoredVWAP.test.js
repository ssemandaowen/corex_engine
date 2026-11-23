"use strict";

const reference = require("../helpers/reference/AnchoredVWAP");

describe("AnchoredVWAP reference (independent, published definition — anchored VWAP)", () => {
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];
    const volumes = [1000, 1200, 1100, 900, 800, 700, 900, 1000, 1100, 1200];

    test("hand-computed worked example: AnchoredVWAP anchored at index 3", () => {
        // Convention: anchor index = 3; accumulate bars at/after index 3.
        //   bars from index 3: price=[10,9,8,10,11,12,13], volume=[900,800,700,900,1000,1100,1200]
        //   sum(price*volume) = 10*900 + 9*800 + 8*700 + 10*900 + 11*1000 + 12*1100 + 13*1200
        //                     = 9000 + 7200 + 5600 + 9000 + 11000 + 13200 + 15600 = 70600
        //   sum(volume) = 900+800+700+900+1000+1100+1200 = 6600
        //   VWAP = 70600 / 6600 = 10.696969696969697
        //   Bars before the anchor (indices 0..2) contribute nothing.
        const result = reference(closes, volumes, 3);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(70600 / 6600, 10);
        expect(result.anchorIndex).toBe(3);
    });

    test("anchor at 0 behaves like VWAP", () => {
        const full = reference(closes, volumes, 0);
        const anchored = reference(closes, volumes, 3);
        expect(full.ready).toBe(true);
        expect(anchored.ready).toBe(true);
        expect(anchored.value).not.toBe(full.value);
    });

    test("anchor bar with zero volume and no later volume: not ready", () => {
        const result = reference([12, 13], [1000, 0], 1);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("anchor bar with zero volume followed by positive volume: ready", () => {
        const result = reference([12, 13, 14], [1000, 0, 100], 1);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(14);
    });
});
