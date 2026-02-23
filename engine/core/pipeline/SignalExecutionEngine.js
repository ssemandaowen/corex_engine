"use strict";

class SignalExecutionEngine {
    constructor(options = {}) {
        this.concurrency = Math.max(1, Number(options.concurrency || process.env.SIGNAL_EXEC_CONCURRENCY || 8));
        this.maxQueue = Math.max(100, Number(options.maxQueue || process.env.SIGNAL_EXEC_MAX_QUEUE || 20000));
        this.queue = [];
        this.inFlight = 0;
        this.metrics = {
            enqueued: 0,
            executed: 0,
            failed: 0,
            dropped: 0
        };
    }

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

    getMetrics() {
        return {
            ...this.metrics,
            inFlight: this.inFlight,
            queueDepth: this.queue.length,
            concurrency: this.concurrency,
            maxQueue: this.maxQueue
        };
    }
}

module.exports = SignalExecutionEngine;

