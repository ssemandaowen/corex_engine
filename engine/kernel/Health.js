"use strict";

const STATES = Object.freeze({
    STARTING: "STARTING",
    READY: "READY",
    DEGRADED: "DEGRADED",
    STOPPING: "STOPPING"
});

function createHealth() {
    const components = new Map();
    let isStopping = false;

    return {
        STATES,
        set(name, { ok, reason = "", required = false } = {}) {
            const componentName = String(name || "").trim();
            if (!componentName) return;

            components.set(componentName, {
                ok: Boolean(ok),
                reason: reason != null ? String(reason) : "",
                required: Boolean(required),
                updatedAt: Date.now()
            });
        },
        setStopping() {
            isStopping = true;
        },
        state() {
            if (isStopping) {
                return STATES.STOPPING;
            }

            if (components.size === 0) {
                return STATES.STARTING;
            }

            let allRequiredOk = true;
            let hasAnyFailure = false;

            for (const [, comp] of components) {
                if (!comp.ok) {
                    hasAnyFailure = true;
                    if (comp.required) {
                        allRequiredOk = false;
                    }
                }
            }

            if (!allRequiredOk) {
                return STATES.DEGRADED;
            }

            if (hasAnyFailure) {
                return STATES.DEGRADED;
            }

            return STATES.READY;
        },
        snapshot() {
            const componentObj = {};
            for (const [name, comp] of components) {
                componentObj[name] = { ...comp };
            }
            return {
                state: this.state(),
                components: componentObj
            };
        }
    };
}

module.exports = { createHealth, STATES };
