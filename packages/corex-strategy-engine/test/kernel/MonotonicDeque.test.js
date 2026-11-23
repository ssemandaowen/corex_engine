"use strict";

const MonotonicDeque = require("../../src/kernel/MonotonicDeque");

function bruteMax(arr, start, end) {
    let m = -Infinity;
    for (let i = start; i < end; i++) if (arr[i] > m) m = arr[i];
    return m;
}
function bruteMin(arr, start, end) {
    let m = Infinity;
    for (let i = start; i < end; i++) if (arr[i] < m) m = arr[i];
    return m;
}

describe("kernel/MonotonicDeque", () => {
    test("basic max/min", () => {
        const dq = new MonotonicDeque(3);
        dq.push(3);
        expect(dq.max()).toBe(3);
        expect(dq.min()).toBe(3);
        dq.push(1);
        expect(dq.max()).toBe(3);
        expect(dq.min()).toBe(1);
        dq.push(2);
        expect(dq.max()).toBe(3);
        expect(dq.min()).toBe(1);
        dq.push(5);
        expect(dq.max()).toBe(5);
        expect(dq.min()).toBe(1);
    });

    test("window eviction", () => {
        const dq = new MonotonicDeque(2);
        dq.push(10);
        dq.push(20);
        expect(dq.max()).toBe(20);
        dq.push(30); // 10 falls out
        expect(dq.max()).toBe(30);
        expect(dq.min()).toBe(20);
    });

    test("matches brute-force for windows 1..50 on random data", () => {
        const rng = (() => {
            let seed = 42;
            return () => {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                return seed / 0x7fffffff;
            };
        })();

        for (let w = 1; w <= 50; w++) {
            const dq = new MonotonicDeque(w);
            const arr = [];
            for (let i = 0; i < 200; i++) {
                const v = rng() * 1000;
                dq.push(v);
                arr.push(v);
                const start = Math.max(0, arr.length - w);
                expect(dq.max()).toBeCloseTo(bruteMax(arr, start, arr.length), 6);
                expect(dq.min()).toBeCloseTo(bruteMin(arr, start, arr.length), 6);
            }
        }
    });

    test("matches brute-force on monotone increasing data", () => {
        for (let w = 1; w <= 20; w++) {
            const dq = new MonotonicDeque(w);
            for (let i = 0; i < 100; i++) {
                dq.push(i);
                const start = Math.max(0, i - w + 1);
                expect(dq.max()).toBe(i);
                expect(dq.min()).toBe(start);
            }
        }
    });

    test("matches brute-force on monotone decreasing data", () => {
        for (let w = 1; w <= 20; w++) {
            const dq = new MonotonicDeque(w);
            for (let i = 100; i > 0; i--) {
                dq.push(i);
                const arr = [];
                for (let j = 100; j >= i; j--) arr.push(j);
                const s = Math.max(0, arr.length - w);
                expect(dq.max()).toBeCloseTo(bruteMax(arr, s, arr.length), 6);
                expect(dq.min()).toBeCloseTo(bruteMin(arr, s, arr.length), 6);
            }
        }
    });

    test("empty returns undefined", () => {
        const dq = new MonotonicDeque(3);
        expect(dq.max()).toBeUndefined();
        expect(dq.min()).toBeUndefined();
    });
});
