"use strict";

/**
 * StrategyStateStore
 *
 * Lightweight key-value store for strategy-level state that must survive
 * process restarts and crashes.
 *
 * Design principles:
 *  - Transparent: this.state.set/get feel like a Map. No async in hot path.
 *  - Lazy DB: writes are debounced 5 s so every bar doesn't hit the DB.
 *  - Zero deps in user-facing API: user code never awaits anything.
 *  - Restored on boot: strategyLoader reads the stored JSON and calls
 *    store.restore(data) before the first tick arrives.
 *
 * Usage in a strategy:
 *
 *   this.state.set("trend", "bull");
 *   this.state.get("trend");          // → "bull"
 *   this.state.has("trend");          // → true
 *   this.state.delete("trend");
 *   this.state.keys();                // → ["trend", ...]
 *
 * The store is wired into the DB by strategyLoader — strategy code never
 * needs to know about persistence.
 */

const FLUSH_DEBOUNCE_MS = 5000;

class StrategyStateStore {
    /**
     * @param {string} strategyId  - scoped strategy id (userId::name)
     * @param {Function} [onFlush] - async (id, data) => void, injected by loader
     */
    constructor(strategyId, onFlush = null) {
        this._id      = strategyId;
        this._data    = new Map();
        this._dirty   = false;
        this._timer   = null;
        this._onFlush = onFlush;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    set(key, value) {
        this._data.set(String(key), value);
        this._schedulePersist();
        return this;
    }

    get(key, fallback = undefined) {
        const k = String(key);
        return this._data.has(k) ? this._data.get(k) : fallback;
    }

    has(key) {
        return this._data.has(String(key));
    }

    delete(key) {
        const existed = this._data.delete(String(key));
        if (existed) this._schedulePersist();
        return existed;
    }

    clear() {
        if (this._data.size > 0) {
            this._data.clear();
            this._schedulePersist();
        }
    }

    keys() {
        return Array.from(this._data.keys());
    }

    /**
     * Return a plain-object snapshot — used by the flush callback and
     * for debugging. Shallow copy; values should be JSON-serialisable.
     */
    snapshot() {
        const out = {};
        for (const [k, v] of this._data) out[k] = v;
        return out;
    }

    // ── Internal: loader integration ──────────────────────────────────────────

    /**
     * Called by strategyLoader.startStrategy() after reading the stored
     * JSON from the DB. Populates the in-memory store WITHOUT scheduling
     * a flush (no round-trip write for data we just read).
     * @param {Object} data - Plain object from DB
     */
    restore(data) {
        if (!data || typeof data !== "object") return;
        for (const [k, v] of Object.entries(data)) {
            this._data.set(String(k), v);
        }
    }

    /**
     * Inject the async flush callback after construction (set by loader).
     * @param {Function} fn - async (id, data) => void
     */
    setFlushCallback(fn) {
        this._onFlush = fn;
    }

    /**
     * Force an immediate flush (called on graceful shutdown / terminate).
     * @returns {Promise<void>}
     */
    async flush() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        await this._persist();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _schedulePersist() {
        this._dirty = true;
        if (this._timer) return;
        this._timer = setTimeout(() => {
            this._timer = null;
            this._persist().catch(() => {});
        }, FLUSH_DEBOUNCE_MS);
    }

    async _persist() {
        if (!this._dirty || typeof this._onFlush !== "function") return;
        this._dirty = false;
        try {
            await this._onFlush(this._id, this.snapshot());
        } catch (err) {
            // Non-fatal: next write will retry
            this._dirty = true;
        }
    }
}

module.exports = StrategyStateStore;
