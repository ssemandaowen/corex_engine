"use strict";

const StrategyDevHelpers = {
    /**
     * Resolve symbol with sane fallback order:
     * explicit -> packet -> first strategy symbol.
     */
    resolveSymbol({ symbol, packet } = {}) {
        if (symbol) return String(symbol);
        if (packet?.symbol) return String(packet.symbol);
        return String(this.symbols?.[0] || "");
    },

    /**
     * True if strategy has at least n completed bars for symbol.
     */
    hasBars(symbol, n = 1) {
        const sym = this.resolveSymbol({ symbol });
        const count = this.getLookbackWindow(sym)?.length || 0;
        return count >= Math.max(1, Number(n) || 1);
    },

    /**
     * Guard helper for early returns in next().
     * Returns null and optionally logs debug context when insufficient bars.
     */
    requireBars(symbol, n = 1, context = "requireBars") {
        const sym = this.resolveSymbol({ symbol });
        if (this.hasBars(sym, n)) return true;
        this.log?.debug?.(`[${this.id}] ${context}: insufficient bars for ${sym}`);
        return false;
    },

    /**
     * Return a series safely; never throws, always returns array.
     */
    safeSeries(symbol, field = "close", fallback = []) {
        try {
            const sym = this.resolveSymbol({ symbol });
            const s = this.series(sym, field);
            return Array.isArray(s) ? s : fallback;
        } catch {
            return fallback;
        }
    },

    /**
     * Ensures an action happens once per bar for a key.
     * Useful for preventing duplicate entries when using intra-bar updates.
     */
    oncePerBar(key, barTime) {
        const bt = Number(barTime || this.currentBar?.time || this.lastTick?.time || 0);
        if (!bt) return false;
        if (!this._featureState) this._featureState = {};
        const k = String(key || "default");
        if (this._featureState[k] === bt) return false;
        this._featureState[k] = bt;
        return true;
    },

    /**
     * Lightweight strategy metadata block for UI/telemetry.
     */
    describe(features = {}) {
        return {
            id: this.id,
            name: this.name,
            symbols: Array.isArray(this.symbols) ? [...this.symbols] : [],
            timeframe: this.timeframe,
            lookback: this.lookback,
            params: { ...(this.params || {}) },
            features: { ...(features || {}) }
        };
    },

    /**
     * Wrap rule logic and convert runtime errors into null signals.
     * Prevents strategy crash loops from transient logic failures.
     */
    safeRule(fn, fallback = null) {
        try {
            return fn();
        } catch (err) {
            this.log?.warn?.(`[${this.id}] safeRule error: ${err.message}`);
            return fallback;
        }
    },

    /**
     * Standardized structured strategy log line.
     */
    logDecision(message, meta = {}, level = "info") {
        const method = typeof this.log?.[level] === "function" ? level : "info";
        this.log?.[method]?.(`[STRATEGY:${this.id}] ${String(message || "")}`, {
            strategyId: this.id,
            strategyName: this.name,
            timeframe: this.timeframe,
            symbols: this.symbols,
            ...meta
        });
    },

    /**
     * Standardized signal tracing log.
     */
    logSignal(signal, stage = "EMIT", level = "info") {
        const s = signal || {};
        this.logDecision(`SIGNAL_${String(stage).toUpperCase()}`, {
            signal: {
                strategyId: s.strategyId,
                symbol: s.symbol,
                intent: s.intent,
                side: s.side,
                quantity: s.quantity,
                tf: s.tf
            }
        }, level);
    },

    /**
     * Standardized guard evaluation log for warmup/risk/filters.
     */
    logGuard(name, passed, details = {}) {
        this.logDecision(`GUARD_${String(name || "UNKNOWN").toUpperCase()}`, {
            passed: !!passed,
            ...details
        }, passed ? "debug" : "warn");
    }
};

module.exports = StrategyDevHelpers;
