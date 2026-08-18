// engine/core/pipeline/SignalExecutionEngine.js
"use strict";

const FastQueue = require("@utils/data/fastQueue");

/**
 * CoreX Signal Execution Engine
 * Marshals risk-cleared abstract intents into a bounded concurrent queue.
 * Routes tasks to the polymorphic runtime broker instance for network settlement.
 */
class SignalExecutionEngine {
    constructor(options = {}) {
        this.concurrency = Math.max(1, Number(options.concurrency || process.env.SIGNAL_EXEC_CONCURRENCY || 8));
        this.maxQueue = Math.max(100, Number(options.maxQueue || process.env.SIGNAL_EXEC_MAX_QUEUE || 20000));
        this.queue = new FastQueue();
        this.inFlight = 0;
        this.metrics = {
            enqueued: 0,
            executed: 0,
            failed: 0,
            dropped: 0
        };
    }

    /**
     * Adds an execution task to the bounded queue.
     * @param {Function} taskFn - Async function wrapping the broker call
     * @param {Object} meta - Context metadata for tracking
     */
    enqueue(taskFn, meta = {}) {
        if (typeof taskFn !== "function") return false;
        if (this.queue.length >= this.maxQueue) {
            this.metrics.dropped += 1;
            return false;
        }
        this.queue.push({ taskFn, meta, enqueuedAt: Date.now() });
        this.metrics.enqueued += 1;
        this._drain();
        return true;
    }

    /**
     * Internal worker loop that respects concurrency limits.
     */
    _drain() {
        while (this.inFlight < this.concurrency && this.queue.length > 0) {
            const job = this.queue.shift();
            this.inFlight += 1;

            Promise.resolve()
                .then(() => job.taskFn())
                .then(() => {
                    this.metrics.executed += 1;
                })
                .catch(() => {
                    this.metrics.failed += 1;
                })
                .finally(() => {
                    this.inFlight -= 1;
                    if (this.queue.length > 0) {
                        setImmediate(() => this._drain());
                    }
                });
        }
    }

    /**
     * Returns snapshots for the Feed Metrics broadcast.
     */
    getMetrics() {
        return {
            ...this.metrics,
            inFlight: this.inFlight,
            queueDepth: this.queue.length,
            concurrency: this.concurrency,
            maxQueue: this.maxQueue
        };
    }

    updateSettings(next = {}) {
        // Implementation for hot-reloading settings...
        try {
            const toNum = (v) => {
                const n = Number(v);
                return Number.isFinite(n) ? n : null;
            };
            const concurrency = toNum(next.concurrency);
            if (concurrency && concurrency > 0) this.concurrency = Math.max(1, Math.floor(concurrency));
            const maxQueue = toNum(next.maxQueue);
            if (maxQueue && maxQueue > 0) this.maxQueue = Math.max(100, Math.floor(maxQueue));
        } catch (e) { /* ignore */ }
        return this.getMetrics();
    }
}

module.exports = new SignalExecutionEngine({ concurrency: 8, maxQueue: 20000 });