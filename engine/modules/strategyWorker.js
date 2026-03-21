"use strict";

// This file runs in a separate thread for each sandboxed strategy.
// It has no access to the main process's memory or event loop.

require("module-alias/register");
const { parentPort, workerData } = require('worker_threads');
const { StrategyCompiler } = require("@core/services/strategyCompiler");
const { StrategyContract } = require("@core/core/strategy/StrategyContract");

let strategyInstance = null;
const { strategyId, code, runtimeParams } = workerData;

/**
 * Creates a proxy for the logger that forwards log messages to the main thread.
 */
function createLoggerProxy(id) {
    const proxy = {};
    const levels = ['info', 'warn', 'error', 'debug'];
    for (const level of levels) {
        proxy[level] = (message, meta) => {
            try {
                // We can't send functions or complex objects, so we serialize what we can.
                // The main thread's logger will handle the rest.
                parentPort.postMessage({
                    type: 'log',
                    payload: { level, message: String(message), meta }
                });
            } catch (e) {
                // Failsafe, don't crash the worker if logging fails.
            }
        };
    }
    return proxy;
}

/**
 * Main worker initialization function.
 */
async function initialize() {
    try {
        const compiler = new StrategyCompiler();
        const result = await compiler.compile(code, strategyId);

        if (!result.success) {
            throw new Error(`Compilation failed: ${result.error}`);
        }

        strategyInstance = result.instance;

        // Inject the logger proxy
        strategyInstance.log = createLoggerProxy(strategyId);

        // Apply initial params
        if (runtimeParams && typeof strategyInstance.updateParams === 'function') {
            strategyInstance.updateParams(runtimeParams);
        }

        // Standardize the interface to ensure it has the `generateSignal` method
        StrategyContract.adapt(strategyInstance);

        // Signal to main thread that we are ready
        parentPort.postMessage({
            type: 'ready',
            strategyId,
            payload: {
                meta: {
                    symbols: strategyInstance.symbols,
                    timeframe: strategyInstance.timeframe,
                    lookback: strategyInstance.lookback,
                    max_data_history: strategyInstance.max_data_history,
                    schema: strategyInstance.schema,
                    params: strategyInstance.params
                }
            }
        });

    } catch (err) {
        parentPort.postMessage({
            type: 'init_error',
            strategyId,
            payload: { error: err.message }
        });
    }
}

/**
 * Handle messages from the main thread.
 */
parentPort.on('message', (msg) => {
    if (!msg || !msg.type) {
        return;
    }
    const reqId = msg.reqId || null;
    const payload = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
    const type = String(msg.type || "").trim().toUpperCase();

    const execSignal = (packet, context = {}) => {
        if (!strategyInstance || typeof strategyInstance.generateSignal !== "function") return null;
        return strategyInstance.generateSignal(packet, context) || null;
    };

    const resolvePacket = () => payload.packet || payload.tick || payload.bar || null;
    const resolveContext = (fallbackSource = "tick") => ({
        ...(payload.context && typeof payload.context === "object" ? payload.context : {}),
        ...(payload.meta && typeof payload.meta === "object" ? payload.meta : {}),
        source: payload?.context?.source || payload?.meta?.source || fallbackSource
    });

    try {
        let result = {};

        switch (type) {
            case 'TICK':
            case 'EXEC_TICK': {
                const packet = payload.tick || resolvePacket();
                const signal = execSignal(packet, resolveContext("tick"));
                result = { signal };
                if (!reqId && signal) {
                    parentPort.postMessage({ type: 'signal', payload: signal });
                }
                break;
            }

            case 'BAR':
            case 'MARKET_DATA':
            case 'EXEC_BAR': {
                const packet = payload.bar || resolvePacket();
                const signal = execSignal(packet, resolveContext("bar"));
                result = { signal };
                if (!reqId && signal) {
                    parentPort.postMessage({ type: 'signal', payload: signal });
                }
                break;
            }

            case 'WARMUP_BAR': {
                const packet = payload.bar || resolvePacket();
                execSignal(packet, { ...resolveContext("bar"), isWarmup: true });
                result = { ok: true };
                break;
            }

            case 'UPDATE_PARAMS': {
                const params = payload.params && typeof payload.params === "object" ? payload.params : {};
                if (strategyInstance && typeof strategyInstance.updateParams === 'function') {
                    strategyInstance.updateParams(params);
                }
                result = { ok: true };
                break;
            }

            default:
                throw new Error(`UNKNOWN_MESSAGE_TYPE: ${String(msg.type || "")}`);
        }

        if (reqId) {
            parentPort.postMessage({ reqId, ok: true, result });
        }
    } catch (err) {
        parentPort.postMessage({
            type: 'error',
            payload: { error: err.message, stack: err.stack }
        });
        if (reqId) {
            parentPort.postMessage({ reqId, ok: false, error: err.message });
        }
    }
});

// Start the initialization process.
initialize();
