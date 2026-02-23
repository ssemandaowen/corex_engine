"use strict";

function extractCrossInputs(a, b, args) {
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length < 2 || b.length < 2) return null;
        return {
            pA: a[a.length - 2],
            nA: a[a.length - 1],
            pB: b[b.length - 2],
            nB: b[b.length - 1],
            opts: args[2] || {}
        };
    }

    return {
        pA: args[0],
        nA: args[1],
        pB: args[2],
        nB: args[3],
        opts: args[4] || {}
    };
}

function evaluateCross(pA, nA, pB, nB, direction) {
    if ([pA, nA, pB, nB].some((v) => v == null || typeof v !== "number")) return false;
    if (direction === "up") return pA <= pB && nA > nB;
    return pA >= pB && nA < nB;
}

module.exports = {
    extractCrossInputs,
    evaluateCross
};

