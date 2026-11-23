"use strict";

const reference = require("../helpers/reference/Vortex");

describe("Vortex reference (independent, published definition — Botes/Siepman)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: Vortex(5) over bars 5..9", () => {
        // VM+ = |high_t - low_(t-1)|; VM- = |low_t - high_(t-1)|.
        // TR = max(high-low, |high-prevClose|, |low-prevClose|).
        //   bar5: VM+=|9-8|=1, VM-=|7-10|=3, TR=max(2,|9-9|=0,|7-9|=2)=2
        //   bar6: VM+=|11-7|=4, VM-=|9-9|=0, TR=max(2,|11-8|=3,|9-8|=1)=3
        //   bar7: VM+=|12-9|=3, VM-=|10-11|=1, TR=max(2,|12-10|=2,|10-10|=0)=2
        //   bar8: VM+=|13-10|=3, VM-=|11-12|=1, TR=max(2,|13-11|=2,|11-11|=0)=2
        //   bar9: VM+=|14-11|=3, VM-=|12-13|=1, TR=max(2,|14-12|=2,|12-12|=0)=2
        //   sumVM+=14; sumVM-=6; sumTR=11
        //   VI+ = 14/11 = 1.272727...; VI- = 6/11 = 0.545454...
        const result = reference(highs, lows, closes, 5);
        expect(result.ready).toBe(true);
        expect(result.viPlus).toBeCloseTo(14 / 11, 10);
        expect(result.viMinus).toBeCloseTo(6 / 11, 10);
        expect(result.value).toBeCloseTo(14 / 11, 10);
    });

    test("first bar not ready (seeds previous high, low and close)", () => {
        const result = reference([13], [11], [12], 5);
        expect(result.ready).toBe(false);
    });

    test("zero summed TR: both Vortex lines are zero", () => {
        const h = [10, 10, 10];
        const l = [10, 10, 10];
        const c = [10, 10, 10];
        const result = reference(h, l, c, 2);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
        expect(result.viPlus).toBe(0);
        expect(result.viMinus).toBe(0);
    });
});
