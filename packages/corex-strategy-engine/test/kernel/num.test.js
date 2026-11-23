"use strict";

const { isPos, clamp, roundTo, snapToStep } = require("../../src/kernel/num");

describe("kernel/num", () => {
    describe("isPos", () => {
        test("positive finite numbers", () => {
            expect(isPos(1)).toBe(true);
            expect(isPos(0.5)).toBe(true);
            expect(isPos(1e10)).toBe(true);
        });
        test("zero and negatives", () => {
            expect(isPos(0)).toBe(false);
            expect(isPos(-1)).toBe(false);
            expect(isPos(-0.5)).toBe(false);
        });
        test("non-finite", () => {
            expect(isPos(NaN)).toBe(false);
            expect(isPos(Infinity)).toBe(false);
            expect(isPos(-Infinity)).toBe(false);
        });
    });

    describe("clamp", () => {
        test("inside range", () => {
            expect(clamp(5, 0, 10)).toBe(5);
        });
        test("below min", () => {
            expect(clamp(-3, 0, 10)).toBe(0);
        });
        test("above max", () => {
            expect(clamp(15, 0, 10)).toBe(10);
        });
        test("boundaries", () => {
            expect(clamp(0, 0, 10)).toBe(0);
            expect(clamp(10, 0, 10)).toBe(10);
        });
        test("NaN propagates", () => {
            expect(Number.isNaN(clamp(NaN, 0, 10))).toBe(true);
            expect(Number.isNaN(clamp(5, NaN, 10))).toBe(true);
            expect(Number.isNaN(clamp(5, 0, NaN))).toBe(true);
        });
    });

    describe("roundTo", () => {
        test("decimal places", () => {
            expect(roundTo(1.2345, 2)).toBe(1.23);
            expect(roundTo(1.2355, 2)).toBe(1.24);
            expect(roundTo(1.999, 0)).toBe(2);
            expect(roundTo(1.004, 2)).toBe(1);
        });
        test("negative", () => {
            expect(roundTo(-1.2345, 2)).toBe(-1.23);
        });
        test("no toFixed artifacts", () => {
            // toFixed would produce string, roundTo returns number
            expect(typeof roundTo(1.5, 0)).toBe("number");
        });
    });

    describe("snapToStep", () => {
        test("exact multiples", () => {
            expect(snapToStep(10, 5, 0)).toBe(10);
            expect(snapToStep(15, 5, 0)).toBe(15);
        });
        test("floor to step", () => {
            expect(snapToStep(12, 5, 0)).toBe(10);
            expect(snapToStep(13, 5, 0)).toBe(10);
        });
        test("min floor", () => {
            expect(snapToStep(3, 5, 0)).toBe(0);
            expect(snapToStep(3, 5, 4)).toBe(4);
        });
        test("zero and non-finite", () => {
            expect(snapToStep(0, 5, 0)).toBe(0);
            expect(snapToStep(-5, 5, 0)).toBe(0);
            expect(snapToStep(10, 0, 0)).toBe(0);
            expect(snapToStep(NaN, 5, 0)).toBe(0);
        });
    });
});
