"use strict";

const Frame = require("./kernel/Frame");
const BaseIndicator = require("./indicators/BaseIndicator");

class IndicatorBank {
    constructor(entries = []) {
        this._indicators = new Map();
        for (const entry of entries) this.add(entry.name, entry.instance);
    }

    add(name, indicator) {
        if (typeof name !== "string" || name.length === 0) throw new TypeError("IndicatorBank name must be a non-empty string");
        if (!(indicator instanceof BaseIndicator)) throw new TypeError("IndicatorBank accepts only BaseIndicator instances");
        if (this._indicators.has(name)) throw new Error("IndicatorBank already contains '" + name + "'");
        this._indicators.set(name, indicator);
        return indicator;
    }

    update(frame) {
        if (!(frame instanceof Frame)) throw new TypeError("IndicatorBank.update requires a kernel Frame");
        for (const indicator of this._indicators.values()) indicator.update(frame);
        return this;
    }

    reseed(store, scratchFrame) {
        for (const indicator of this._indicators.values()) indicator.reseed(store, scratchFrame);
        return this;
    }

    get(name) {
        return this._indicators.get(name) || null;
    }

    get names() {
        return Array.from(this._indicators.keys());
    }

    get size() {
        return this._indicators.size;
    }

    clear() {
        this._indicators.clear();
    }
}

module.exports = IndicatorBank;