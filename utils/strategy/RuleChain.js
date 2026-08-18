"use strict";

/**
 * CoreX RuleChain DSL
 * Optimized for high-frequency execution and strategy readability.
 */
class RuleChain {
    constructor(strategy, ctx = {}, state = null, gate = true) {
        this.strategy = strategy;
        
        // Shared state object ensures that if one branch matches, the whole chain stops.
        this._state = state || { matched: false, signal: null };
        this._gate = Boolean(gate);
        this._lastBranchGate = null;
        
        // Pin time at the root to prevent look-ahead bias during tick processing.
        this._barTime = ctx.barTime || strategy.currentBar?.time || strategy.lastTick?.time || Date.now();
    }

    /**
     * Standardized Spawning
     * Creates a branch while maintaining a reference to the same result state.
     */
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

    // ── Logic Gates (The Primary Four) ───────────────────────────────────────

    when(condition) {
        if (!this._alive()) return this;
        this._gate = Boolean(condition);
        return this;
    }

    and(condition) {
        if (!this._alive() || !this._gate) return this;
        this._gate = this._gate && Boolean(condition);
        return this;
    }

    or(condition) {
        if (!this._alive()) return this;
        // Optimization: Only evaluate the OR condition if the gate is currently closed.
        if (!this._gate) {
            this._gate = Boolean(condition);
        }
        return this;
    }

    not() {
        if (!this._alive()) return this;
        this._gate = !this._gate;
        return this;
    }

    /**
     * Grouped OR: Opens the gate if ANY condition in the array is true.
     * Use anonymous functions for conditions to enable lazy evaluation.
     */
    any(conditions = []) {
        if (!this._alive() || !this._gate || !Array.isArray(conditions)) return this;
        
        const hasMatch = conditions.some(c => {
            return typeof c === "function" ? Boolean(c()) : Boolean(c);
        });
        
        this._gate = this._gate && hasMatch;
        return this;
    }

    // ── Standardized Predicates (Domain Specific) ───────────────────────────

    whenPos(state, symbol) {
        if (!this._alive() || !this._gate) return this;
        return this.when(this.strategy.pos(state, symbol));
    }

    whenCrossUp(a, b, key = "default") {
        if (!this._alive() || !this._gate) return this;
        return this.when(this.strategy.crossover(a, b, { key, barTime: this._barTime }));
    }

    whenCrossDown(a, b, key = "default") {
        if (!this._alive() || !this._gate) return this;
        return this.when(this.strategy.crossunder(a, b, { key, barTime: this._barTime }));
    }

    // ── Branching ───────────────────────────────────────────────────────────

    then(handler) {
        const currentGate = this._gate;
        this._lastBranchGate = currentGate;
        
        if (this._alive() && currentGate && typeof handler === "function") {
            handler(this._spawn(true));
        }
        return this;
    }

    else(handler) {
        // Logic: Runs only if the PREVIOUS 'then' branch did not trigger.
        const wasActive = this._lastBranchGate !== null ? this._lastBranchGate : this._gate;
        this._lastBranchGate = null;

        if (this._alive() && !wasActive && typeof handler === "function") {
            handler(this._spawn(true));
        }
        return this;
    }

    // ── Execution & Commitment ──────────────────────────────────────────────

    _commit(actionFn, params) {
        if (!this._alive() || !this._gate) return this;

        // Execute the strategy action (e.g., entryLong).
        const result = actionFn.call(this.strategy, params);

        // Standardize: Match is locked even if signal is rejected by the engine.
        this._state.matched = true;
        this._state.signal = result;

        return this;
    }

    enterLong(params)   { return this._commit(this.strategy.entryLong, params); }
    enterShort(params)  { return this._commit(this.strategy.entryShort, params); }
    exitLong(params)    { return this._commit(this.strategy.exitLong, params); }
    exitShort(params)   { return this._commit(this.strategy.exitShort, params); }
    exitAll(params)     { return this._commit(this.strategy.exitAll, params); }
    flipToLong(params)  { return this._commit(this.strategy.flipToLong, params); }
    flipToShort(params) { return this._commit(this.strategy.flipToShort, params); }

    // ── Finalization ────────────────────────────────────────────────────────

    matched() { return this._state.matched; }
    end()     { return this._state.signal; }
}

module.exports = RuleChain;