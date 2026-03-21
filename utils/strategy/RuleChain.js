"use strict";

class RuleChain {
    constructor(strategy, ctx = {}, state = null, gate = true) {
        this.strategy = strategy;
        this._state = state || { matched: false, signal: null };
        this._gate = Boolean(gate);
        this._lastBranchGate = null;
        this._barTime = ctx.barTime || strategy.currentBar?.time || strategy.lastTick?.time;
    }

    _spawn(gate = true) {
        return new RuleChain(
            this.strategy,
            { barTime: this._barTime },
            this._state,
            gate
        );
    }

    _alive() {
        return !this._state.matched;
    }

    when(condition) {
        if (!this._alive()) return this;
        this._gate = Boolean(condition);
        return this;
    }

    and(condition) {
        if (!this._alive()) return this;
        this._gate = this._gate && Boolean(condition);
        return this;
    }

    whenPos(state, symbol) {
        return this.when(this.strategy.pos(state, symbol));
    }

    whenCrossUp(a, b, key = "default") {
        return this.when(this.strategy.crossover(a, b, { key, barTime: this._barTime }));
    }

    whenCrossDown(a, b, key = "default") {
        return this.when(this.strategy.crossunder(a, b, { key, barTime: this._barTime }));
    }

    then(handler) {
        const gate = Boolean(this._gate);
        this._lastBranchGate = gate;
        if (!this._alive() || !gate) return this;
        if (typeof handler !== "function") return this;
        handler(this._spawn(true));
        return this;
    }

    else(handler) {
        const gate = this._lastBranchGate == null ? Boolean(this._gate) : Boolean(this._lastBranchGate);
        this._lastBranchGate = null;
        if (!this._alive() || gate) return this;
        if (typeof handler !== "function") return this;
        handler(this._spawn(true));
        return this;
    }

    _commit(signal) {
        if (!this._alive()) return this;
        if (this._gate && signal) {
            this._state.signal = signal;
            this._state.matched = true;
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

    matched() { return this._state.matched; }
    end() { return this._state.signal; }
    value() { return this._state.signal; }
    valueOf() { return this._state.signal; }
}

module.exports = RuleChain;
