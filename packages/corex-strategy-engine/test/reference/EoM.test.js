"use strict";

const reference = require("../helpers/reference/EoM");

describe("EoM reference (independent, published definition — Arms)", () => {
    const highs = [10, 12, 13, 12, 14, 15];
    const lows = [8, 9, 10, 8, 10, 11];
    const volumes = [100, 120, 110, 90, 80, 70];

    test("hand-computed worked example: EoM(5, scale=10000)", () => {
        // Midpoint move = ((high+low) - (previousHigh+previousLow))/2.
        // EMV = midpointMove * (high-low) * scale / volume.
        //   bar1: move=(21-18)/2=1.5; range=3; EMV=1.5*3*10000/120=375
        //   bar2: move=(23-21)/2=1;   range=3; EMV=1*3*10000/110=272.7272727
        //   bar3: move=(20-23)/2=-1.5;range=4; EMV=-1.5*4*10000/90=-666.6666667
        //   bar4: move=(24-20)/2=2;   range=4; EMV=2*4*10000/80=1000
        //   bar5: move=(26-24)/2=1;   range=4; EMV=1*4*10000/70=571.4285714
        //   EoM = (375 + 272.7272727 - 666.6666667 + 1000 + 571.4285714)/5
        //       = 310.4978355 (approximately).
        const result = reference(highs, lows, volumes, 5, 10000);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(310.4978354978355, 8);
    });

    test("insufficient warmup: period EMV values require period+1 bars", () => {
        const result = reference([10, 12], [8, 9], [100, 120], 2, 10000);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("zero range and zero midpoint movement contribute zero", () => {
        const result = reference([10, 10, 10], [10, 10, 10], [100, 100, 100], 2, 10000);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("zero volume makes a nonzero-range EMV undefined", () => {
        const result = reference([10, 12, 13], [8, 9, 10], [100, 0, 100], 2, 10000);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });
});
