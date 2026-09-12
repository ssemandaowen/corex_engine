"use strict";

const ta = require("../src/ta");

describe("Technical Analysis (ta) Helpers", () => {
    test("crossover and crossunder detection", () => {
        const a = { value: 12, prev: 8 };
        const b = { value: 10, prev: 10 };
        expect(ta.crossover(a, b)).toBe(true);
        expect(ta.crossunder(a, b)).toBe(false);

        const a2 = { value: 9, prev: 11 };
        const b2 = { value: 10, prev: 10 };
        expect(ta.crossunder(a2, b2)).toBe(true);
        expect(ta.crossover(a2, b2)).toBe(false);
    });

    test("highest and lowest slice functions", () => {
        const arr = [10, 20, 15, 30, 25];
        expect(ta.highest(arr, 3)).toBe(30);
        expect(ta.lowest(arr, 3)).toBe(15);
        expect(ta.highest([], 3)).toBe(0);
        expect(ta.lowest([], 3)).toBe(0);
    });

    test("rising and falling series checks", () => {
        const risingArr = [10, 12, 14, 16];
        expect(ta.rising(risingArr, 2)).toBe(true);
        expect(ta.falling(risingArr, 2)).toBe(false);

        const fallingArr = [16, 14, 12, 10];
        expect(ta.falling(fallingArr, 2)).toBe(true);
        expect(ta.rising(fallingArr, 2)).toBe(false);
    });

    test("change calculation", () => {
        const arr = [10, 12, 15];
        expect(ta.change(arr, 1)).toBe(3);
        expect(ta.change(arr, 2)).toBe(5);
    });
});
