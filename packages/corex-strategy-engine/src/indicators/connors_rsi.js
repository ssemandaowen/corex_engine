"use strict";

const IncrementalRSI = require("./rsi");

class ConnorsRSI {
    static updateMode = "single";
    static resolveParams = (indDef) => [Number(indDef.rsi || 3), Number(indDef.streak || 2), Number(indDef.roc || 2)];

    constructor(rsiPeriod = 3, streakPeriod = 2, rocPeriod = 2) {
        if (!rsiPeriod || rsiPeriod < 1) throw new Error("CRSI rsiPeriod must be >= 1");
        if (!streakPeriod || streakPeriod < 1) throw new Error("CRSI streakPeriod must be >= 1");
        if (!rocPeriod || rocPeriod < 1) throw new Error("CRSI rocPeriod must be >= 1");
        this.rsiPeriod = rsiPeriod;
        this.streakPeriod = streakPeriod;
        this.rocPeriod = rocPeriod;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._streak = 0;
        this._streakBuffer = [];
        this._rsiStreak = new IncrementalRSI(streakPeriod);
        this._rsiROC = new IncrementalRSI(rocPeriod);
        this._rocBuffer = [];
    }

    update(price) {
        this.prev = this.value;

        if (this._prevClose === null) {
            this._prevClose = price;
            return this.value;
        }

        const change = price - this._prevClose;
        if (change > 0) {
            this._streak = this._streak >= 0 ? this._streak + 1 : 1;
        } else if (change < 0) {
            this._streak = this._streak <= 0 ? this._streak - 1 : -1;
        } else {
            this._streak = 0;
        }

        this._streakBuffer.push(this._streak);
        if (this._streakBuffer.length > this.streakPeriod) {
            this._streakBuffer.shift();
        }

        this._rsiStreak.update(this._streak);

        this._rocBuffer.push(change);
        if (this._rocBuffer.length > this.rocPeriod) {
            this._rocBuffer.shift();
        }

        if (this._rocBuffer.length === this.rocPeriod) {
            const roc = this._rocBuffer[0] === 0 ? 0 : (this._rocBuffer[this._rocBuffer.length - 1] / Math.abs(this._rocBuffer[0])) * 100;
            this._rsiROC.update(roc);
        }

        this._prevClose = price;

        if (this._rsiStreak.ready && this._rsiROC.ready) {
            this.value = (this._rsiStreak.value + this._rsiROC.value) / 2;
            this.ready = true;
        }

        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._streak = 0;
        this._streakBuffer = [];
        this._rsiStreak = new IncrementalRSI(this.streakPeriod);
        this._rsiROC = new IncrementalRSI(this.rocPeriod);
        this._rocBuffer = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = ConnorsRSI;