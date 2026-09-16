"use strict";

function _scalar(v) {
    return typeof v === "object" && v !== null ? v.value : v;
}

function _prevScalar(v) {
    return typeof v === "object" && v !== null ? v.prev : v;
}

const ta = {
    crossover(a, b) {
        const valA = _scalar(a);
        const prevA = _prevScalar(a);
        const valB = _scalar(b);
        const prevB = _prevScalar(b);
        return prevA <= prevB && valA > valB;
    },

    crossunder(a, b) {
        const valA = _scalar(a);
        const prevA = _prevScalar(a);
        const valB = _scalar(b);
        const prevB = _prevScalar(b);
        return prevA >= prevB && valA < valB;
    },

    highest(arr, length) {
        if (!arr || typeof arr.length !== "number" || arr.length === 0) return 0;
        const len = Math.min(length, arr.length);
        if (len <= 0) return 0;
        let max = -Infinity;
        const start = arr.length - len;
        for (let i = start; i < arr.length; i++) {
            const val = arr[i];
            if (val > max) max = val;
        }
        return max === -Infinity ? 0 : max;
    },

    lowest(arr, length) {
        if (!arr || typeof arr.length !== "number" || arr.length === 0) return 0;
        const len = Math.min(length, arr.length);
        if (len <= 0) return 0;
        let min = Infinity;
        const start = arr.length - len;
        for (let i = start; i < arr.length; i++) {
            const val = arr[i];
            if (val < min) min = val;
        }
        return min === Infinity ? 0 : min;
    },

    rising(arr, length = 1) {
        if (!arr || typeof arr.length !== "number" || arr.length <= length) return false;
        const len = Math.min(length, arr.length - 1);
        const start = arr.length - len;
        for (let i = start; i < arr.length; i++) {
            if (arr[i] <= arr[i - 1]) return false;
        }
        return true;
    },

    falling(arr, length = 1) {
        if (!arr || typeof arr.length !== "number" || arr.length <= length) return false;
        const len = Math.min(length, arr.length - 1);
        const start = arr.length - len;
        for (let i = start; i < arr.length; i++) {
            if (arr[i] >= arr[i - 1]) return false;
        }
        return true;
    },

    change(arr, length = 1) {
        if (!arr || typeof arr.length !== "number" || arr.length <= length) return 0;
        return arr[arr.length - 1] - arr[arr.length - 1 - length];
    }
};

module.exports = ta;
