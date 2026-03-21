"use strict";

/**
 * A simple class for tracking metrics like counts and drops, both globally and for individual items.
 */
class Metrics {
    constructor() {
        this.total = 0;
        this.dropped = 0;
        this.lastAt = 0;
        this.startedAt = Date.now();
        this.items = new Map(); // For per-item stats
    }

    /**
     * Ensures an entry for a given key exists in the items map.
     * @param {*} key The key for the item.
     * @returns {object} The stats object for the item.
     * @private
     */
    _ensureItem(key) {
        if (!this.items.has(key)) {
            this.items.set(key, { count: 0, dropped: 0, lastAt: 0 });
        }
        return this.items.get(key);
    }

    /**
     * Records a successful event for a given item key.
     * @param {*} key The key of the item to record.
     */
    record(key) {
        this.total++;
        this.lastAt = Date.now();
        const item = this._ensureItem(key);
        item.count++;
        item.lastAt = this.lastAt;
    }

    /**
     * Records a dropped event for a given item key.
     * @param {*} key The key of the item to record as dropped.
     */
    recordDrop(key) {
        this.dropped++;
        const item = this._ensureItem(key);
        item.dropped++;
    }

    /**
     * Returns a snapshot of the current metrics.
     * @returns {object} A snapshot of the metrics.
     */
    getSnapshot() {
        const items = [];
        for (const [key, value] of this.items.entries()) {
            items.push({ key, ...value });
        }
        return {
            total: this.total,
            dropped: this.dropped,
            lastAt: this.lastAt,
            items
        };
    }

    /**
     * Resets all metrics to their initial state.
     */
    reset() {
        this.total = 0;
        this.dropped = 0;
        this.lastAt = 0;
        this.startedAt = Date.now();
        this.items.clear();
    }
}

module.exports = Metrics;
