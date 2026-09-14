"use strict";

const FLUSH_DEBOUNCE_MS = 5000;

class StrategyStateStore {
    constructor(strategyId, onFlush = null) {
        this._id      = strategyId;
        this._data    = new Map();
        this._dirty   = false;
        this._timer   = null;
        this._onFlush = onFlush;
    }

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

    snapshot() {
        const out = {};
        for (const [k, v] of this._data) out[k] = v;
        return out;
    }

    restore(data) {
        if (!data || typeof data !== "object") return;
        for (const [k, v] of Object.entries(data)) {
            this._data.set(String(k), v);
        }
    }

    setFlushCallback(fn) {
        this._onFlush = fn;
    }

    async flush() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        await this._persist();
    }

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
            this._dirty = true;
        }
    }
}

module.exports = StrategyStateStore;
