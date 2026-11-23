"use strict";
const reference = require("../helpers/reference/Coppock");
describe("Coppock reference — WMA of long and short ROC sum", () => {
    const close = [100, 102, 101, 104, 103, 106, 108, 107];
    test("hand calculation: WMA(3) of ROC(3)+ROC(2)", () => {
        // Last three combined ROC values:
        // i=5: 100*(106/104-1)+100*(106/101-1)=6.8735719726.
        // i=6: 100*(108/104-1)+100*(108/103-1)=8.7005227782.
        // i=7: 100*(107/103-1)+100*(107/106-1)=4.8268913720.
        // WMA newest-heaviest = (1*6.8735719726+2*8.7005227782+3*4.8268913720)/6
        // = 6.459215274184294.
        expect(reference(close, 3, 3, 2).value).toBeCloseTo(6.459215274184294, 10);
    });
    test("technicalindicators third opinion: ROC components and WMA composition", () => {
        const ti = require("technicalindicators");
        const longRoc = ti.ROC.calculate({ period: 3, values: close });
        const shortRoc = ti.ROC.calculate({ period: 2, values: close });
        const aligned = longRoc.map((v, i) => v + shortRoc[i + 1]);
        const thirdOpinion = ti.WMA.calculate({ period: 3, values: aligned }).at(-1);
        expect(thirdOpinion).toBeCloseTo(reference(close, 3, 3, 2).value, 10);
    });
    test("insufficient ROC/WMA history is not ready", () => {
        expect(reference([100, 102, 101, 104, 103], 3, 3, 2).ready).toBe(false);
    });
    test("zero ROC reference price is not treated as a valid return", () => {
        expect(reference([1, 2, 3, 4, 0, 6, 7, 8], 3, 3, 2).ready).toBe(false);
    });
});
