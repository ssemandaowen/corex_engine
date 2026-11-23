"use strict";

const SlidingWma = require("../../../src/kernel/math/SlidingWma");

function naiveWma(arr) {
    const n = arr.length;
    if (n === 0) return 0;
    let S = 0, N = 0;
    for (let i = 0; i < n; i++) {
        S += arr[i];
        N += (i + 1) * arr[i];
    }
    return N / (n * (n + 1) / 2);
}

describe("kernel/math/SlidingWma", () => {
    test("basic WMA", () => {
        const w = new SlidingWma(3);
        w.push(1);
        expect(w.wma).toBe(1);
        w.push(3);
        expect(w.wma).toBeCloseTo((1 * 1 + 2 * 3) / 3, 10); // 7/3
        w.push(5);
        expect(w.wma).toBeCloseTo((1 * 1 + 2 * 3 + 3 * 5) / 6, 10); // 22/6
    });

    test("sliding drops oldest", () => {
        const w = new SlidingWma(2);
        w.push(10);
        w.push(20);
        expect(w.wma).toBeCloseTo((1 * 10 + 2 * 20) / 3, 10);
        w.push(30);
        expect(w.wma).toBeCloseTo((1 * 20 + 2 * 30) / 3, 10);
    });

    test("drift test: 1e6 pushes vs naive recompute at 1e-9", () => {
        const w = 50;
        const wma = new SlidingWma(w);
        const window = [];
        const total = 1e6;
        const rng = (() => {
            let seed = 555;
            return () => {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                return (seed / 0x7fffffff) * 100;
            };
        })();

        for (let i = 0; i < total; i++) {
            const x = rng();
            wma.push(x);
            window.push(x);
            if (window.length > w) window.shift();
            if (i % 10000 === 0 && i > 0 && window.length > 0) {
                expect(wma.wma).toBeCloseTo(naiveWma(window), 9);
            }
        }
        if (window.length > 0) {
            expect(wma.wma).toBeCloseTo(naiveWma(window), 9);
        }
    });
});
