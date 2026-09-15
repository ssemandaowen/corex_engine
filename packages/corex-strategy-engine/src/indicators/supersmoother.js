"use strict";

class SuperSmootherFilter {
    static updateMode = "single";
    static resolveParams = (indDef) => [Number(indDef.alpha || 0.2)];

    constructor(alpha = 0.2) {
        if (alpha < 0.01 || alpha > 1) throw new Error("SuperSmootherFilter alpha must be between 0.01 and 1");
        this.alpha = alpha;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._x1 = 0;
        this._x2 = 0;
        this._y1 = 0;
        this._y2 = 0;
        this._initialized = false;
    }

    update(price) {
        this.prev = this.value;

        if (!this._initialized) {
            this._x1 = price;
            this._x2 = price;
            this._y1 = price;
            this._y2 = price;
            this._initialized = true;
            this.value = price;
            this.ready = true;
            return this.value;
        }

        const a = Math.exp(-Math.sqrt(this.alpha));
        const b = 2 * a;

        const c = (1 - a) * (1 - a) / (1 + b * Math.cos(Math.PI * 2 / 4) + a * a);
        const d = b * a;
        const e = -a * a;

        const y1 = c * (price + this._x2) + d * this._x1 - e * this._y1 + e * this._y2;
        this._y2 = this._y1;
        this._y1 = y1;
        this._x2 = this._x1;
        this._x1 = price;

        this.value = y1;
        this.ready = true;
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._x1 = 0;
        this._x2 = 0;
        this._y1 = 0;
        this._y2 = 0;
        this._initialized = false;
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = SuperSmootherFilter;