"use strict";

/**
 * WARMUP_BAR error-semantics verification for the dormant strategy worker.
 *
 * The worker is driven exactly as workerPool.js drives it: a real forked child
 * process, real IPC messages. No production export surface is added for testing.
 *
 * Scope guard: WARMUP_BAR only. Other handlers are exercised here solely to load
 * a strategy instance so a warmup can be attempted.
 */

const path = require("path");
const crypto = require("crypto");
const { fork } = require("child_process");
require("module-alias/register");

const WORKER_PATH = path.resolve(__dirname, "../engine/workers/strategyWorker.js");

function makeWorker() {
    return fork(WORKER_PATH, [], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...process.env, COREX_STRATEGY_WORKER_CHILD: "1" }
    });
}

function waitForReady(child) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WORKER_BOOT_TIMEOUT")), 20000);
        const onMsg = (msg) => {
            if (String(msg?.type || "").toUpperCase() === "READY") {
                clearTimeout(timer);
                child.off("message", onMsg);
                resolve(true);
            }
        };
        child.on("message", onMsg);
    });
}

function request(child, type, payload) {
    return new Promise((resolve, reject) => {
        const reqId = crypto.randomUUID();
        const timer = setTimeout(() => reject(new Error(`WORKER_TIMEOUT:${type}`)), 20000);
        const onMsg = (msg) => {
            if (msg?.reqId !== reqId) return;
            clearTimeout(timer);
            child.off("message", onMsg);
            resolve(msg);
        };
        child.on("message", onMsg);
        child.send({ reqId, type, payload });
    });
}

const THROWING_STRATEGY = `
class ThrowingOnWarmup {
    constructor() {
        this.symbols = ["EURUSD"];
        this.timeframe = "1m";
        this.calls = 0;
    }
    generateSignal() {
        this.calls += 1;
        throw new Error("WARMUP_FAILURE_MARKER");
    }
    onBar() { return null; }
}
module.exports = ThrowingOnWarmup;
`;

const HEALTHY_STRATEGY = `
class HealthyOnWarmup {
    constructor() {
        this.symbols = ["EURUSD"];
        this.timeframe = "1m";
        this.calls = 0;
    }
    generateSignal() {
        this.calls += 1;
        return null;
    }
    onBar() { return null; }
}
module.exports = HealthyOnWarmup;
`;

describe("strategyWorker WARMUP_BAR (dormant worker path)", () => {
    let child;

    beforeAll(async () => {
        child = makeWorker();
        await waitForReady(child);
    });

    afterAll(async () => {
        if (!child || child.killed || child.exitCode !== null) return;
        await new Promise((resolve) => {
            child.once("exit", resolve);
            try { child.kill("SIGTERM"); } catch (_) { resolve(); }
            setTimeout(() => {
                try { child.kill("SIGKILL"); } catch (_) { /* ignore */ }
                resolve();
            }, 5000).unref();
        });
    });

    test("returns ok:false and the error message when warmup throws", async () => {
        const strategyId = "warmup_thrower";
        const loaded = await request(child, "LOAD_STRATEGY", {
            strategyId,
            code: THROWING_STRATEGY,
            runtimeParams: {}
        });
        expect(loaded.ok).toBe(true);

        const res = await request(child, "WARMUP_BAR", { strategyId, bar: { price: 1.1 } });

        // The IPC envelope is ok:true because the handler itself completed;
        // the handler's own result must report the warmup failure.
        expect(res.ok).toBe(true);
        expect(res.result).toEqual({
            strategyId,
            ok: false,
            error: "WARMUP_FAILURE_MARKER"
        });
        expect(res.result.ok).not.toBe(true);
    });

    test("returns ok:true when warmup completes normally (no regression)", async () => {
        const strategyId = "warmup_healthy";
        const loaded = await request(child, "LOAD_STRATEGY", {
            strategyId,
            code: HEALTHY_STRATEGY,
            runtimeParams: {}
        });
        expect(loaded.ok).toBe(true);

        const res = await request(child, "WARMUP_BAR", { strategyId, bar: { price: 1.1 } });

        expect(res.ok).toBe(true);
        expect(res.result).toEqual({ strategyId, ok: true });
    });

    test("still rejects an unknown strategy id", async () => {
        const res = await request(child, "WARMUP_BAR", { strategyId: "does_not_exist", bar: {} });
        expect(res.ok).toBe(false);
        expect(res.error).toBe("STRATEGY_NOT_LOADED");
    });
});
