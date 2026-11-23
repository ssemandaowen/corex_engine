"use strict";

const SlidingMean = require("../../../src/kernel/math/SlidingMean");

function naiveMean(arr) {
    if (arr.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
}

describe("kernel/math/SlidingMean", () => {
    test("basic mean", () => {
        const m = new SlidingMean(3);
        m.push(1);
        expect(m.mean).toBe(1);
        m.push(3);
        expect(m.mean).toBe(2);
        m.push(5);
        expect(m.mean).toBe(3);
        m.push(7); // window: [3,5,7]
        expect(m.mean).toBe(5);
    });

    test("sliding drops oldest", () => {
        const m = new SlidingMean(2);
        m.push(10);
        m.push(20);
        expect(m.mean).toBe(15);
        m.push(30);
        expect(m.mean).toBe(25);
    });

    test("drift test: 1e6 pushes vs naive recompute at 1e-9", () => {
        const w = 50;
        const m = new SlidingMean(w);
        const window = [];
        const total = 1e6;
        const rng = (() => {
            let seed = 12345;
            return () => {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                return (seed / 0x7fffffff) * 100 - 50;
            };
        })();

        for (let i = 0; i < total; i++) {
            const v = rng();
            m.push(v);
            window.push(v);
            if (window.length > w) window.shift();
            if (i % 10000 === 0 && i > 0) {
                expect(m.mean).toBeCloseTo(naiveMean(window), 9);
            }
        }
        expect(m.mean).toBeCloseTo(naiveMean(window), 9);
    });
});
