"use strict";

const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

const STATES = {
    CREATED: "CREATED",
    INITIALIZING: "INITIALIZING",
    READY: "READY",
    RUNNING: "RUNNING",
    STOPPING: "STOPPING",
    STOPPED: "STOPPED",
    ERROR: "ERROR"
};

class ComponentLifecycle {
    constructor(componentName, options = {}) {
        this.componentName = String(componentName || "COMPONENT");
        this.state = STATES.CREATED;
        this.startedAt = null;
        this.updatedAt = Date.now();
        this.lastError = null;
        this.meta = {};
        this.log = logger.createModuleLogger(this.componentName, {
            category: options.category || "system",
            ui: true,
            uiLevels: ["info", "warn", "error"]
        });
    }

    transition(nextState, meta = {}) {
        const prev = this.state;
        this.state = nextState;
        this.updatedAt = Date.now();
        this.meta = { ...this.meta, ...meta };
        if (nextState === STATES.RUNNING && !this.startedAt) this.startedAt = this.updatedAt;
        if (nextState === STATES.ERROR) this.lastError = meta.error || meta.reason || "UNKNOWN";

        this.log.info(`Lifecycle ${prev} -> ${nextState}`);
        bus.emit(EVENTS.SYSTEM.LOG, {
            level: "info",
            module: this.componentName,
            message: "COMPONENT_LIFECYCLE",
            meta: {
                previous: prev,
                current: nextState,
                component: this.componentName,
                at: this.updatedAt,
                ...meta
            }
        });
    }

    fail(error, meta = {}) {
        const errMessage = error instanceof Error ? error.message : String(error || "UNKNOWN");
        this.lastError = errMessage;
        this.transition(STATES.ERROR, { ...meta, error: errMessage });
        this.log.error(`Lifecycle failure: ${errMessage}`);
    }

    snapshot() {
        return {
            component: this.componentName,
            state: this.state,
            startedAt: this.startedAt,
            updatedAt: this.updatedAt,
            uptimeMs: this.startedAt ? Math.max(0, Date.now() - this.startedAt) : 0,
            lastError: this.lastError,
            meta: { ...this.meta }
        };
    }
}

module.exports = {
    STATES,
    ComponentLifecycle
};

