"use strict";

class RuleChain {
    constructor(strategy, ctx = {}) {
        this.strategy = strategy;
        this._matched = false;
        this._signal = null;
        this._barTime = ctx.barTime || strategy.currentBar?.time || strategy.lastTick?.time;
    }

    when(condition) {
        this._current = Boolean(condition);
        return this;
    }

    whenPos(state, symbol) {
        this._current = this.strategy.pos(state, symbol);
        return this;
    }

    whenCrossUp(a, b, key = "default") {
        this._current = this.strategy.crossover(a, b, { key, barTime: this._barTime });
        return this;
    }

    whenCrossDown(a, b, key = "default") {
        this._current = this.strategy.crossunder(a, b, { key, barTime: this._barTime });
        return this;
    }

    _commit(signal) {
        if (!this._matched && this._current) {
            this._signal = signal;
            this._matched = true;
        }
        return this;
    }

    enterLong(params) { return this._commit(this.strategy.entryLong(params)); }
    enterShort(params) { return this._commit(this.strategy.entryShort(params)); }
    exitLong(params) { return this._commit(this.strategy.exitLong(params)); }
    exitShort(params) { return this._commit(this.strategy.exitShort(params)); }
    exitAll(params) { return this._commit(this.strategy.exitAll(params)); }
    flipToLong(params) { return this._commit(this.strategy.flipToLong(params)); }
    flipToShort(params) { return this._commit(this.strategy.flipToShort(params)); }

    end() { return this._signal; }
    value() { return this._signal; }
    valueOf() { return this._signal; }
}

module.exports = RuleChain;

