"use strict";

class DummyIndicator {
    static updateMode = "single";
    static resolveParams(indDef, resolvePeriod) {
        const period = resolvePeriod ? resolvePeriod(indDef) : (indDef.period ?? 10);
        return [period, Number(indDef.customParam || 42)];
    }

    constructor(period, customParam) {
        this.period = period;
        this.customParam = customParam;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
    }

    update(price) {
        this.prev = this.value;
        this.value = price + this.customParam;
        this.ready = true;
        return this.value;
    }

    reseed(values) {
        if (values.length > 0) {
            this.update(values[values.length - 1]);
        }
        return this.value;
    }
}

module.exports = DummyIndicator;
