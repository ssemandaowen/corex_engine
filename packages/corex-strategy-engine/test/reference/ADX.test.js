"use strict";
const reference = require("../helpers/reference/ADX");
describe("ADX reference — Wilder directional movement", () => {
    const high = [13, 14, 13, 15, 14, 16, 17, 16];
    const low  = [11, 12, 10, 12, 11, 13, 14, 13];
    const close= [12, 13, 11, 14, 12, 15, 16, 14];
    test("hand calculation: Wilder ADX(3)", () => {
        // First three transition TR values are [2,3,4], +DM=[1,0,2], -DM=[0,2,0].
        // Initial sums: TR=9,+DM=3,-DM=2 => +DI=33.3333,-DI=22.2222,DX=20.
        // Wilder updates give DX at bars 3,4,5: [20,7.6923076923,36.3636363636].
        // Initial ADX=(20+7.6923076923+36.3636363636)/3=21.35198135198135.
        // Bar 6 DX=51.3043478261 => ADX=(2*21.351981352+51.3043478261)/3=31.3361035100.
        // Bar 7 DX=11.8971061093 => ADX=(2*31.3361035100+11.8971061093)/3
        // = 24.85643770978595.
        expect(reference(high, low, close, 3).value).toBeCloseTo(24.85643770978595, 9);
    });
    test("technicalindicators third opinion: Wilder ADX after its seed offset", () => {
        const ti = require("technicalindicators");
        const actual = ti.ADX.calculate({ high, low, close, period: 3 });
        const ours = reference(high, low, close, 3).series.filter(Number.isFinite);
        expect(actual[actual.length - 1].adx).toBeCloseTo(ours[ours.length - 1], 6);
    });
    test("six bars are sufficient for the first ADX(3) value", () => {
        expect(reference(high.slice(0, 6), low.slice(0, 6), close.slice(0, 6), 3).ready).toBe(true);
    });
    test("flat range is finite and warmup is explicit", () => {
        const flat = reference([10,10,10,10,10,10,10], [10,10,10,10,10,10,10], [10,10,10,10,10,10,10], 3);
        expect(flat.ready).toBe(true);
        expect(Number.isFinite(flat.value)).toBe(true);
        expect(reference([10,11,10,11,10], [9,10,9,10,9], [9.5,10.5,9.5,10.5,9.5], 3).ready).toBe(false);
    });
});
