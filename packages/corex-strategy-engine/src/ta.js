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
        if (!Array.isArray(arr) || arr.length === 0) return 0;
        const slice = arr.slice(-length);
        return Math.max(...slice);
    },

    lowest(arr, length) {
        if (!Array.isArray(arr) || arr.length === 0) return 0;
        const slice = arr.slice(-length);
        return Math.min(...slice);
    },

    rising(arr, length = 1) {
        if (!Array.isArray(arr) || arr.length <= length) return false;
        for (let i = arr.length - length; i < arr.length; i++) {
            if (arr[i] <= arr[i - 1]) return false;
        }
        return true;
    },

    falling(arr, length = 1) {
        if (!Array.isArray(arr) || arr.length <= length) return false;
        for (let i = arr.length - length; i < arr.length; i++) {
            if (arr[i] >= arr[i - 1]) return false;
        }
        return true;
    },

    change(arr, length = 1) {
        if (!Array.isArray(arr) || arr.length <= length) return 0;
        return arr[arr.length - 1] - arr[arr.length - 1 - length];
    }
};

module.exports = ta;
