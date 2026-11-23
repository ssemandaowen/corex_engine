"use strict";

const SlidingWindow = require("../../src/kernel/SlidingWindow");

describe("kernel/SlidingWindow", () => {
    test("basic push/length/at", () => {
        const w = new SlidingWindow(5);
        expect(w.length).toBe(0);
        w.push(10);
        w.push(20);
        w.push(30);
        expect(w.length).toBe(3);
        expect(w.at(0)).toBe(10);
        expect(w.at(1)).toBe(20);
        expect(w.at(2)).toBe(30);
        expect(w.at(3)).toBeUndefined();
        expect(w.at(-1)).toBeUndefined();
    });

    test("sliding drops oldest when over cap", () => {
        const w = new SlidingWindow(3);
        w.push(1);
        w.push(2);
        w.push(3);
        expect(w.length).toBe(3);
        expect(w.at(0)).toBe(1);
        w.push(4);
        expect(w.length).toBe(3);
        expect(w.at(0)).toBe(2);
        expect(w.at(1)).toBe(3);
        expect(w.at(2)).toBe(4);
        w.push(5);
        expect(w.at(0)).toBe(3);
        expect(w.at(1)).toBe(4);
        expect(w.at(2)).toBe(5);
    });

    test("matches naive array slice across 10*cap pushes incl compaction boundary", () => {
        const cap = 4;
        const w = new SlidingWindow(cap);
        const naive = [];
        const total = 10 * cap;

        for (let i = 0; i < total; i++) {
            const v = Math.sin(i) * 100 + i;
            w.push(v);
            naive.push(v);
            if (naive.length > cap) naive.shift();

            const len = Math.min(i + 1, cap);
            expect(w.length).toBe(len);
            for (let j = 0; j < len; j++) {
                expect(w.at(j)).toBeCloseTo(naive[j], 10);
            }
            // view(n) should be contiguous and correct
            const view = w.view(len);
            expect(view.length).toBe(len);
            for (let j = 0; j < len; j++) {
                expect(view[j]).toBeCloseTo(naive[j], 10);
            }
        }
    });

    test("view(n) returns latest n values zero-copy", () => {
        const w = new SlidingWindow(5);
        for (let i = 0; i < 7; i++) w.push(i * 10);
        // Window holds [20,30,40,50,60]
        const v3 = w.view(3);
        expect(v3.length).toBe(3);
        expect(v3[0]).toBe(40);
        expect(v3[1]).toBe(50);
        expect(v3[2]).toBe(60);
        const v5 = w.view(5);
        expect(v5[0]).toBe(20);
        expect(v5[4]).toBe(60);
        const v10 = w.view(10);
        expect(v10.length).toBe(5);
    });

    test("a retained view may change after the next push compacts the backing buffer", () => {
        const w = new SlidingWindow(3);
        for (const value of [0, 1, 2, 3]) w.push(value);

        const retained = w.view(3);
        expect(Array.from(retained)).toEqual([1, 2, 3]);

        w.push(4);
        expect(Array.from(retained)).toEqual([1, 2, 3]);

        w.push(5); // end reaches 2*cap and copyWithin compacts the backing buffer
        expect(w.toArray()).toEqual([3, 4, 5]);
        expect(Array.from(retained)).toEqual([4, 5, 3]);
    });

    test("view(0) returns empty", () => {
        const w = new SlidingWindow(5);
        w.push(1);
        expect(w.view(0).length).toBe(0);
    });
});
