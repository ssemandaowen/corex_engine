"use strict";

const path = require("path");
const { fork } = require("child_process");
const logger = require("@utils/logger");
const { bus, EVENTS } = require("@events/bus");

const log = logger.createModuleLogger("JOB_SUPERVISOR", { category: "worker" });

class JobWorkerSupervisor {
    constructor() {
        this.proc = null;
        this.stopping = false;
        this.restartTimer = null;
        this.restarts = 0;
    }

    isRunning() {
        return !!(this.proc && !this.stopping);
    }

    _enabled() {
        return !["0", "false", "no", "off"].includes(
            String(process.env.COREX_JOB_WORKER_AUTOSTART || "true").trim().toLowerCase()
        );
    }

    start() {
        if (!this._enabled()) return false;
        if (this.proc) return true;
        this.stopping = false;
        this._spawn();
        return true;
    }

    _spawn() {
        const workerPath = path.resolve(__dirname, "../workers/jobWorker.js");
        this.proc = fork(workerPath, [], {
            stdio: ["ignore", "inherit", "inherit", "ipc"],
            env: {
                ...process.env,
                COREX_JOB_WORKER_SUPERVISED: "1"
            }
        });

        const child = this.proc;
        const pid = Number(child.pid || 0);
        log.info(`Backtest job worker started (pid=${pid || "n/a"})`);

        child.on("message", (msg) => {
            const type = String(msg?.type || "").trim().toUpperCase();
            if (type !== "BACKTEST_PROGRESS") return;
            const payload = msg?.payload && typeof msg.payload === "object" ? msg.payload : {};
            const userId = String(payload.userId || "").trim();
            try {
                bus.emit(
                    EVENTS.SYSTEM.JOB_PROGRESS,
                    {
                        jobId: String(payload.jobId || ""),
                        status: String(payload.status || ""),
                        progress: payload.progress && typeof payload.progress === "object" ? payload.progress : {},
                        resultMeta: payload.resultMeta && typeof payload.resultMeta === "object" ? payload.resultMeta : null,
                        error: payload.error ? String(payload.error) : "",
                        runtimeId: payload.runtimeId ? String(payload.runtimeId) : "",
                        type: String(payload.type || "backtest.run")
                    },
                    { ...(userId ? { userId } : {}) }
                );
            } catch {
                // best effort only
            }
        });

        child.on("exit", (code, signal) => {
            const wasCurrent = this.proc === child;
            if (wasCurrent) this.proc = null;
            if (this.stopping) return;
            if (!this._enabled()) return;
            this.restarts += 1;
            const delayMs = Math.min(15_000, Math.max(1_000, 750 * this.restarts));
            log.warn(`Backtest job worker exited (code=${code}, signal=${signal}). Restarting in ${delayMs}ms.`);
            if (this.restartTimer) clearTimeout(this.restartTimer);
            this.restartTimer = setTimeout(() => {
                this.restartTimer = null;
                if (!this.stopping) this._spawn();
            }, delayMs);
        });
    }

    async stop() {
        this.stopping = true;
        this.restarts = 0;

        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }

        if (!this.proc) return false;
        const child = this.proc;
        this.proc = null;

        const done = new Promise((resolve) => {
            let settled = false;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                resolve(ok);
            };
            const t = setTimeout(() => {
                try { child.kill("SIGKILL"); } catch { /* ignore */ }
                finish(false);
            }, Number(process.env.COREX_JOB_WORKER_STOP_TIMEOUT_MS || 4000));
            child.once("exit", () => {
                clearTimeout(t);
                finish(true);
            });
            try { child.kill("SIGTERM"); } catch {
                clearTimeout(t);
                finish(false);
            }
        });

        const stoppedCleanly = await done;
        if (stoppedCleanly) log.info("Backtest job worker stopped.");
        else log.warn("Backtest job worker force-stopped.");
        return true;
    }
}

module.exports = new JobWorkerSupervisor();