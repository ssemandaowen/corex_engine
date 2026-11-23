"use strict";

const { parseTf, bucketStart } = require("../../src/kernel/timeframe");

describe("kernel/timeframe", () => {
    describe("parseTf", () => {
        test("minutes", () => {
            expect(parseTf("1m")).toBe(60000);
            expect(parseTf("5m")).toBe(300000);
            expect(parseTf("15m")).toBe(900000);
            expect(parseTf("1h")).toBe(3600000);
            expect(parseTf("4h")).toBe(14400000);
            expect(parseTf("1d")).toBe(86400000);
        });
        test("seconds", () => {
            expect(parseTf("30s")).toBe(30000);
            expect(parseTf("1s")).toBe(1000);
        });
        test("min alias", () => {
            expect(parseTf("1min")).toBe(60000);
            expect(parseTf("5MIN")).toBe(300000);
        });
        test("invalid defaults to 1m", () => {
            expect(parseTf("")).toBe(60000);
            expect(parseTf("abc")).toBe(60000);
            expect(parseTf("1x")).toBe(60000);
            expect(parseTf(undefined)).toBe(60000);
            expect(parseTf(null)).toBe(60000);
        });
        test("number without unit defaults to minute unit", () => {
            expect(parseTf("5")).toBe(60000); // no match -> default
        });
    });

    describe("bucketStart", () => {
        test("floor alignment", () => {
            expect(bucketStart(0, 60000)).toBe(0);
            expect(bucketStart(59999, 60000)).toBe(0);
            expect(bucketStart(60000, 60000)).toBe(60000);
            expect(bucketStart(123456, 60000)).toBe(120000);
            expect(bucketStart(123456, 300000)).toBe(0);
        });
        test("multiples", () => {
            expect(bucketStart(3600000, 3600000)).toBe(3600000);
            expect(bucketStart(3600001, 3600000)).toBe(3600000);
        });
    });
});
