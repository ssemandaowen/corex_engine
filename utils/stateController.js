"use strict";

// Use the correct filename casing for production on Linux.
const StateLedger = require("@utils/linkedList");
const logger = require("@utils/logger");
const { bus, EVENTS } = require("@events/bus");

class StateController {
    constructor() {
        this.registry = new Map(); // strategyId -> StateLedger

        // SERVER CONTROL RULES: Define legal logic flow
        // NOTE: "STOPPED" and "OFFLINE" are treated as equivalent terminal/idle
        // states. Most of the codebase commits "STOPPED" (RuntimeLifecycle.terminate,
        // strategyLoader.stopStrategy, the runtime_state DB column convention);
        // both are accepted here so those calls aren't silently rejected.
        this.rules = {
            "OFFLINE": ["STAGED", "WARMING_UP", "STOPPING"],
            "STOPPED": ["STAGED", "WARMING_UP", "STOPPING"],
            "STAGED": ["WARMING_UP", "ACTIVE", "OFFLINE", "STOPPED", "STOPPING"],
            "WARMING_UP": ["ACTIVE", "ERROR", "OFFLINE", "STOPPED", "DISABLED"],
            "ACTIVE": ["PAUSED", "STOPPING", "ERROR", "OFFLINE", "STOPPED", "DISABLED"],
            "PAUSED": ["ACTIVE", "STOPPING", "OFFLINE", "STOPPED"],
            "STOPPING": ["OFFLINE", "STOPPED"],
            "ERROR": ["STAGED", "OFFLINE", "STOPPED", "WARMING_UP", "STOPPING", "DISABLED"], // Allow stopping from error
            "DISABLED": ["STAGED"]
        };
    }

    /**
     * @param {string} id - Strategy ID
     * @param {string} target - The state we want to move to
     * @param {Object} meta - Why we are doing this
     */
    commit(id, target, meta = {}) {
        if (!this.registry.has(id)) {
            this.registry.set(id, new StateLedger());
        }

        const ledger = this.registry.get(id);
        const current = ledger.last();

        if (current === target) return true;

        // Validation Logic
        const allowed = this.rules[current] || [];
        if (!allowed.includes(target)) {
            // Shutdown/start races can legitimately issue redundant STOPPING while already OFFLINE.
            if (current === "OFFLINE" && target === "STOPPING") {
                logger.warn(`[STATE_SYNC] Redundant transition ignored for ${id}: ${current} -> ${target}`);
                return true;
            }
            logger.error(`[STATE_COLLISION] Cannot move ${id} from ${current} to ${target}`);
            return false;
        }

        ledger.push(target, meta);
        logger.info(`[STATE] [${id}] ${current} -> ${target}`);
        try {
            // Extract userId from strategyId if available
            const userId = String(id || "").split("::")[0] || null;
            bus.emit(EVENTS.SYSTEM.STATE_CHANGED, {
                id,
                from: current,
                to: target,
                meta,
                at: new Date().toISOString()
            }, { userId });
        } catch {
            // ignore bus errors
        }
        return true;
    }

    getStatus(id) {
        return this.registry.get(id)?.last() || "OFFLINE";
    }

    resetAll() {
        this.registry.clear();
        logger.info("State registry cleared (all strategies -> OFFLINE).");
        return true;
    }
}

// Export as Singleton to ensure Engine and Loader share the same registry
module.exports = new StateController();