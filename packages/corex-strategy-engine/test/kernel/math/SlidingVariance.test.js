"use strict";

const SlidingVariance = require("../../../src/kernel/math/SlidingVariance");

function naiveVariance(arr) {
    if (arr.length < 2) return 0;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    const mean = sum / arr.length;
    let m2 = 0;
    for (let i = 0; i < arr.length; i++) {
        const d = arr[i] - mean;
        m2 += d * d;
    }
    return m2 / (arr.length - 1);
}

describe("kernel/math/SlidingVariance", () => {
    test("basic variance", () => {
        const v = new SlidingVariance(3);
        v.push(1);
        expect(v.variance).toBe(0);
        v.push(3);
        expect(v.variance).toBeCloseTo(2, 10); // ((1-2)^2+(3-2)^2)/1 = 2
        v.push(5);
        expect(v.variance).toBeCloseTo(4, 10); // mean=3, ((1-3)^2+(3-3)^2+(5-3)^2)/2 = 4
    });

    test("sliding drops oldest", () => {
        const v = new SlidingVariance(2);
        v.push(10);
        v.push(20);
        expect(v.variance).toBeCloseTo(50, 10);
        v.push(30);
        expect(v.variance).toBeCloseTo(50, 10); // [20,30], same variance
    });

    test("drift test: 1e6 pushes vs naive recompute at 1e-9", () => {
        const w = 50;
        const v = new SlidingVariance(w);
        const window = [];
        const total = 1e6;
        const rng = (() => {
            let seed = 999;
            return () => {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                return (seed / 0x7fffffff) * 100;
            };
        })();

        for (let i = 0; i < total; i++) {
            const x = rng();
            v.push(x);
            window.push(x);
            if (window.length > w) window.shift();
            if (i % 10000 === 0 && i > 0 && window.length > 1) {
                expect(v.variance).toBeCloseTo(naiveVariance(window), 9);
            }
        }
        if (window.length > 1) {
            expect(v.variance).toBeCloseTo(naiveVariance(window), 9);
        }
    });
});
