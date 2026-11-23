"use strict";

const SlidingLinReg = require("../../../src/kernel/math/SlidingLinReg");

function naiveSlope(arr) {
    const n = arr.length;
    if (n < 2) return 0;
    let S = 0, T = 0;
    for (let i = 0; i < n; i++) {
        S += arr[i];
        T += i * arr[i];
    }
    const sumI = (n * (n - 1)) / 2;
    const sumI2 = ((n - 1) * n * (2 * n - 1)) / 6;
    const denom = n * sumI2 - sumI * sumI;
    if (denom === 0) return 0;
    return (n * T - sumI * S) / denom;
}

describe("kernel/math/SlidingLinReg", () => {
    test("basic slope", () => {
        const r = new SlidingLinReg(3);
        r.push(1);
        expect(r.slope).toBe(0);
        r.push(3);
        // positions [0,1], values [1,3]: slope = 2
        expect(r.slope).toBeCloseTo(2, 10);
        r.push(5);
        // positions [0,1,2], values [1,3,5]: slope = 2
        expect(r.slope).toBeCloseTo(2, 10);
    });

    test("perfect line slope 2", () => {
        const r = new SlidingLinReg(10);
        for (let i = 0; i < 10; i++) r.push(1 + 2 * i);
        expect(r.slope).toBeCloseTo(2, 10);
    });

    test("horizontal line slope 0", () => {
        const r = new SlidingLinReg(10);
        for (let i = 0; i < 10; i++) r.push(5);
        expect(r.slope).toBeCloseTo(0, 10);
    });

    test("sliding drops oldest", () => {
        const r = new SlidingLinReg(3);
        r.push(1);
        r.push(3);
        r.push(5);
        expect(r.slope).toBeCloseTo(2, 10);
        r.push(7); // window: [3,5,7], slope still 2
        expect(r.slope).toBeCloseTo(2, 10);
        r.push(100); // window: [5,7,100]
        expect(r.slope).toBeCloseTo(naiveSlope([5, 7, 100]), 10);
    });

    test("drift test: 1e6 pushes vs naive recompute at 1e-9", () => {
        const w = 50;
        const r = new SlidingLinReg(w);
        const window = [];
        const total = 1e6;
        const rng = (() => {
            let seed = 777;
            return () => {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                return (seed / 0x7fffffff) * 100 - 50;
            };
        })();

        for (let i = 0; i < total; i++) {
            const x = rng();
            r.push(x);
            window.push(x);
            if (window.length > w) window.shift();
            if (i % 10000 === 0 && i > 0 && window.length >= 2) {
                expect(r.slope).toBeCloseTo(naiveSlope(window), 9);
            }
        }
        if (window.length >= 2) {
            expect(r.slope).toBeCloseTo(naiveSlope(window), 9);
        }
    });
});
