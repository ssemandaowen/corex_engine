"use strict";

const StateLedger = require("@utils/LinkedList");
const logger = require("@utils/logger");
const { bus, EVENTS } = require("@events/bus");

class StateController {
    constructor() {
        this.registry = new Map(); // strategyId -> StateLedger

        // SERVER CONTROL RULES: Define legal logic flow
        this.rules = {
            "OFFLINE": ["STAGED", "WARMING_UP"],
            "STAGED": ["WARMING_UP", "OFFLINE"],
            "WARMING_UP": ["ACTIVE", "ERROR", "OFFLINE"],
            "ACTIVE": ["PAUSED", "STOPPING", "ERROR", "OFFLINE"],
            "PAUSED": ["ACTIVE", "STOPPING", "OFFLINE"],
            "STOPPING": ["OFFLINE"],
            "ERROR": ["STAGED", "OFFLINE", "WARMING_UP", "STOPPING"] // Allow stopping from error
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
            logger.error(`🚫 [STATE COLLISION] Cannot move ${id} from ${current} to ${target}`);
            return false;
        }

        ledger.push(target, meta);
        logger.info(`🔄 [${id}] ${current} -> ${target}`);
        try {
            bus.emit(EVENTS.SYSTEM.STATE_CHANGED, {
                id,
                from: current,
                to: target,
                meta,
                at: new Date().toISOString()
            });
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
