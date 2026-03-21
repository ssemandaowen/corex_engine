"use strict";

const path = require('path');
const { Worker } = require('worker_threads');
const logger = require('@utils/logger');
const { bus, EVENTS } = require('@events/bus');
const signalAdapter = require('@core/signalAdapter');

const log = logger.createModuleLogger("STRATEGY_RUNTIME", { category: "strategy" });

class StrategyRuntime {
    constructor() {
        this._workers = new Map(); // strategyId -> Worker
        this._enabled = ["1", "true", "yes", "on"].includes(
            String(process.env.COREX_STRATEGY_SANDBOX_ENABLED || "true").trim().toLowerCase()
        );
        // Fallback adapter instance (lazy)
        this._fallbackAdapter = null;
        // Request tracking: reqId -> { resolve, reject, timeout }
        this._pendingRequests = new Map();
        this._requestCounter = 0;
    }

    isEnabled() {
        return this._enabled;
    }

    async start() {
        if (!this.isEnabled()) return;
        log.info("Strategy sandboxed runtime starting.");
    }

    async stop() {
        log.info("Stopping all strategy workers...");
        for (const [id, worker] of this._workers.entries()) {
            await worker.terminate();
            this._workers.delete(id);
        }
        this._workers.clear();
        log.info("All strategy workers stopped.");
    }

    async loadStrategy({ strategyId, code, runtimeParams }) {
        if (!this.isEnabled()) {
            throw new Error("Strategy runtime is disabled.");
        }
        if (this._workers.has(strategyId)) {
            await this.unloadStrategy({ strategyId });
        }

        return new Promise((resolve, reject) => {
            const worker = new Worker(path.resolve(__dirname, 'strategyWorker.js'), {
                workerData: {
                    strategyId,
                    code,
                    runtimeParams: runtimeParams || {}
                }
            });
            this._emitWorkerState(strategyId, "SPAWNING", { threadId: worker.threadId || null });

            let settled = false;
            const finishResolve = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            const finishReject = (err) => {
                if (settled) return;
                settled = true;
                reject(err);
            };

            worker.on('message', (msg) => this._handleWorkerMessage(strategyId, msg));
            worker.on('error', (err) => {
                log.error(`[WORKER:${strategyId}] Error: ${err.message}`);
                this._emitWorkerState(strategyId, "ERROR", { error: err.message });
                try { worker.terminate(); } catch { /* noop */ }
                this.unloadStrategy({ strategyId }).catch(() => {});
                finishReject(err);
            });
            worker.on('exit', (code) => {
                if (code !== 0) {
                    log.warn(`[WORKER:${strategyId}] Exited with code ${code}`);
                }
                this._workers.delete(strategyId);
                this._emitWorkerState(strategyId, "EXITED", { code: Number(code || 0) });
                if (!settled) {
                    finishReject(new Error(`WORKER_EXITED_BEFORE_READY:${code}`));
                }
            });

            // The worker will send a 'ready' or 'init_error' message.
            const readyHandler = (msg) => {
                if (msg.type === 'ready') {
                    this._workers.set(strategyId, worker);
                    log.info(`[WORKER:${strategyId}] Ready and loaded.`);
                    worker.off('message', readyHandler);
                    this._emitWorkerState(strategyId, "READY", {
                        threadId: worker.threadId || null,
                        meta: msg.payload?.meta || {}
                    });
                    finishResolve({ ok: true, meta: msg.payload?.meta });
                } else if (msg.type === 'init_error') {
                    log.error(`[WORKER:${strategyId}] Init failed: ${msg.payload?.error}`);
                    worker.off('message', readyHandler);
                    this._emitWorkerState(strategyId, "INIT_ERROR", { error: msg.payload?.error || "INIT_ERROR" });
                    worker.terminate();
                    finishReject(new Error(msg.payload?.error || 'Unknown init error'));
                }
            };
            worker.on('message', readyHandler);
        });
    }

    async unloadStrategy({ strategyId }) {
        const worker = this._workers.get(strategyId);
        if (worker) {
            this._emitWorkerState(strategyId, "STOPPING", { threadId: worker.threadId || null });
            const code = await worker.terminate().catch(() => null);
            this._workers.delete(strategyId);
            this._emitWorkerState(strategyId, "STOPPED", { code: Number(code || 0) });
            log.info(`[WORKER:${strategyId}] Unloaded and terminated.`);
        }
    }

    _metaForStrategy(strategyId) {
        const userId = String(strategyId || "").split("::")[0] || "";
        return userId ? { userId } : {};
    }

    _normalizeWorkerSignal(strategyId, signal) {
        if (!signal || typeof signal !== "object") return null;
        const scopedId = String(strategyId || "").trim();
        if (!scopedId) return null;
        const userId = String(scopedId).split("::")[0] || null;
        const incomingMeta = signal.meta && typeof signal.meta === "object" ? signal.meta : {};
        return {
            ...signal,
            // Runtime ownership is authoritative; worker payload must not override tenancy.
            strategyId: scopedId,
            ...(userId ? { userId } : {}),
            meta: {
                ...incomingMeta,
                strategyId: scopedId,
                ...(userId ? { userId } : {})
            }
        };
    }

    _emitWorkerState(strategyId, state, extra = {}) {
        try {
            bus.emit(
                EVENTS.SYSTEM.WORKER_STATE,
                {
                    strategyId,
                    state: String(state || "").toUpperCase(),
                    ts: Date.now(),
                    ...(extra && typeof extra === "object" ? extra : {})
                },
                this._metaForStrategy(strategyId)
            );
        } catch {
            // best effort only
        }
    }

    _dispatch(strategyId, type, payload) {
        if (!this.isEnabled()) return;
        const worker = this._workers.get(strategyId);
        if (worker) {
            // For backward compatibility with fire-and-forget messages
            worker.postMessage({ type, payload });
        }
    }

    _dispatchWithResponse(strategyId, type, payload, timeoutMs = 5000) {
        if (!this.isEnabled()) {
            return Promise.reject(new Error("Strategy runtime is disabled"));
        }
        const worker = this._workers.get(strategyId);
        if (!worker) {
            return Promise.reject(new Error("Worker not found for " + strategyId));
        }

        return new Promise((resolve, reject) => {
            const reqId = ++this._requestCounter;
            const timeout = setTimeout(() => {
                this._pendingRequests.delete(reqId);
                reject(new Error(`Request ${reqId} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this._pendingRequests.set(reqId, { resolve, reject, timeout });
            worker.postMessage({ reqId, type, payload });
        });
    }

    async updateParams({ strategyId, params }) {
        const worker = this._workers.get(strategyId);
        if (worker) {
            try {
                const result = await this._dispatchWithResponse(strategyId, 'UPDATE_PARAMS', { strategyId, params });
                return { ok: true, ...result };
            } catch (err) {
                log.error(`Update params failed for ${strategyId}: ${err.message}`);
                return { ok: false, reason: err.message };
            }
        }
        return { ok: false, reason: 'NOT_FOUND' };
    }

    dispatchMarketData(strategyId, packet, meta) {
        this._dispatch(strategyId, 'market_data', { packet, meta });
    }

    async execTick({ strategyId, tick, context }) {
        try {
            const result = await this._dispatchWithResponse(strategyId, 'EXEC_TICK', { strategyId, tick, context });
            // Result contains { signal } — forward to adapter if present
            if (result?.signal) {
                this._forwardSignalToAdapter(strategyId, result.signal);
            }
            return { ok: true, signal: result?.signal || null };
        } catch (err) {
            log.error(`Exec tick failed for ${strategyId}: ${err.message}`);
            return { ok: false, error: err.message };
        }
    }

    async warmupBar({ strategyId, bar }) {
        try {
            await this._dispatchWithResponse(strategyId, 'WARMUP_BAR', { strategyId, bar });
            return { ok: true };
        } catch (err) {
            log.warn(`Warmup bar failed for ${strategyId}: ${err.message}`);
            return { ok: false };
        }
    }

    _forwardSignalToAdapter(strategyId, signal) {
        if (!signal) return;
        try {
            const normalizedSignal = this._normalizeWorkerSignal(strategyId, signal);
            if (!normalizedSignal) return;
            // Lazy-load loader to avoid circular dependency
            let loader = null;
            try { loader = require('@core/strategyLoader'); } catch (e) { loader = null; }
            const entry = loader?.registry?.get ? loader.registry.get(strategyId) : undefined;
            const adapter = entry?.instance?.executionContext?.adapter;
            
            if (adapter && typeof adapter.handle === 'function') {
                adapter.handle(normalizedSignal).catch(err => {
                    log.error(`[SIGNAL_ADAPTER] Error handling worker signal from ${strategyId}: ${err.message}`);
                });
            } else {
                // Fallback to a local SignalAdapter instance (lazy-init)
                if (!this._fallbackAdapter) {
                    const SignalAdapter = signalAdapter; // class
                    this._fallbackAdapter = new SignalAdapter({ mode: 'PAPER' });
                }
                this._fallbackAdapter.handle(normalizedSignal).catch(err => {
                    log.error(`[SIGNAL_ADAPTER] Fallback adapter failed for ${strategyId}: ${err.message}`);
                });
            }
        } catch (err) {
            log.error(`[SIGNAL_ADAPTER] Exception forwarding signal from ${strategyId}: ${err.message}`);
        }
    }

    _handleWorkerMessage(strategyId, msg) {
        if (!msg) return;

        // Handle request/response messages (reqId-based)
        const reqId = msg.reqId;
        if (reqId) {
            const pending = this._pendingRequests.get(reqId);
            if (pending) {
                clearTimeout(pending.timeout);
                this._pendingRequests.delete(reqId);
                if (msg.ok) {
                    pending.resolve(msg.result || {});
                } else {
                    pending.reject(new Error(msg.error || 'Unknown error'));
                }
                return;
            }
        }

        // Handle event-based messages (type-based)
        const type = String(msg.type || "").toLowerCase();
        if (!type) return;

        switch (type) {
            case 'signal': {
                // Forward signal to the strategy's configured execution adapter if available
                try {
                    const normalizedSignal = this._normalizeWorkerSignal(strategyId, msg.payload);
                    if (!normalizedSignal) break;
                    // Require loader lazily to avoid circular dependency during module init
                    let loader = null;
                    try { loader = require('@core/strategyLoader'); } catch (e) { loader = null; }
                    const entry = loader?.registry?.get ? loader.registry.get(strategyId) : undefined;
                    const adapter = entry?.instance?.executionContext?.adapter;
                    if (adapter && typeof adapter.handle === 'function') {
                        adapter.handle(normalizedSignal).catch(err => {
                            log.error(`[SIGNAL_ADAPTER] Error handling remote signal from ${strategyId}: ${err.message}`);
                        });
                    } else {
                        // Fallback to a local SignalAdapter instance (lazy-init)
                        if (!this._fallbackAdapter) {
                            const SignalAdapter = signalAdapter; // class
                            this._fallbackAdapter = new SignalAdapter({ mode: 'PAPER' });
                        }
                        this._fallbackAdapter.handle(normalizedSignal).catch(err => {
                            log.error(`[SIGNAL_ADAPTER] Fallback adapter failed for ${strategyId}: ${err.message}`);
                        });
                    }
                } catch (err) {
                    log.error(`[SIGNAL_ADAPTER] Exception routing remote signal from ${strategyId}: ${err.message}`);
                }
                break;
            }

            case 'log': {
                // Forward log to the main event bus with userId meta
                const userId = String(strategyId).split("::")[0] || null;
                bus.emit('strategy:remote_log', { strategyId, ...msg.payload }, { userId });
                break;
            }
            
            case 'error':
                log.error(`[WORKER:${strategyId}] Runtime Error: ${msg.payload?.error}`);
                break;

            // 'ready' and 'init_error' are handled by a temporary listener in loadStrategy
            case 'ready':
            case 'init_error':
                break;

            default:
                log.warn(`[WORKER:${strategyId}] Received unknown message type: ${type}`);
        }
    }
}

module.exports = new StrategyRuntime();
