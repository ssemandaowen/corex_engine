"use strict";

const CorexError = require("../../utils/CorexError");

function createRoot({ config = {}, logger = null, health = null } = {}) {
    const registrations = new Map();
    const instances = new Map();
    const startReports = [];
    const startedNames = [];
    let isStarted = false;

    function _topologicalSort() {
        const sorted = [];
        const visited = new Map(); // name -> 'visiting' | 'visited'

        function visit(name, chain = []) {
            const status = visited.get(name);
            if (status === "visiting") {
                const cycle = [...chain, name].join(" -> ");
                throw new CorexError("DEPENDENCY_CYCLE", `Dependency cycle detected: ${cycle}`, {
                    hint: "Check component dependency registrations",
                    status: 500
                });
            }
            if (status === "visited") return;

            const reg = registrations.get(name);
            if (!reg) {
                throw new CorexError("MISSING_DEPENDENCY", `Component '${name}' depends on unregistered component '${name}'`, {
                    hint: `Register component '${name}' before starting root`,
                    status: 500
                });
            }

            visited.set(name, "visiting");
            for (const dep of reg.deps) {
                if (!registrations.has(dep)) {
                    throw new CorexError("MISSING_DEPENDENCY", `Component '${name}' depends on unregistered component '${dep}'`, {
                        hint: `Register component '${dep}' before starting root`,
                        status: 500
                    });
                }
                visit(dep, [...chain, name]);
            }
            visited.set(name, "visited");
            sorted.push(name);
        }

        for (const name of registrations.keys()) {
            if (!visited.has(name)) {
                visit(name);
            }
        }

        return sorted;
    }

    return {
        register(name, { deps = [], required = true, start = null, stop = null, health: healthFn = null } = {}) {
            const compName = String(name || "").trim();
            if (!compName) throw new CorexError("INVALID_NAME", "Component name is required");

            registrations.set(compName, {
                name: compName,
                deps: Array.isArray(deps) ? [...deps] : [],
                required: Boolean(required),
                start: typeof start === "function" ? start : async () => null,
                stop: typeof stop === "function" ? stop : async () => {},
                health: typeof healthFn === "function" ? healthFn : null
            });
        },

        async start() {
            if (isStarted) return;

            const order = _topologicalSort();

            const ctx = {
                config,
                logger,
                health,
                get: (depName) => instances.get(depName)
            };

            for (const name of order) {
                const reg = registrations.get(name);
                const startTime = process.hrtime.bigint();

                try {
                    const instance = await reg.start(ctx);
                    instances.set(name, instance);
                    startedNames.push(name);

                    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;

                    if (health) {
                        health.set(name, { ok: true, reason: "Started", required: reg.required });
                    }

                    startReports.push({
                        name,
                        status: "ok",
                        ms: Number(durationMs.toFixed(2)),
                        error: null
                    });
                } catch (err) {
                    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;

                    startReports.push({
                        name,
                        status: "failed",
                        ms: Number(durationMs.toFixed(2)),
                        error: err.message
                    });

                    if (health) {
                        health.set(name, { ok: false, reason: err.message, required: reg.required });
                    }

                    if (reg.required) {
                        if (logger && typeof logger.error === "function") {
                            logger.error(`[CompositionRoot] Required component '${name}' failed to start: ${err.message}`);
                        }
                        // Stop already started components in REVERSE order
                        await this.stop();

                        throw new CorexError("BOOT_FAILED", `Required component '${name}' failed to start: ${err.message}`, {
                            cause: err,
                            status: 500
                        });
                    } else {
                        if (logger && typeof logger.warn === "function") {
                            logger.warn(`[CompositionRoot] Optional component '${name}' failed to start: ${err.message}`);
                        }
                    }
                }
            }

            isStarted = true;
        },

        async stop() {
            // Stop in REVERSE order of starting
            const reverseNames = [...startedNames].reverse();
            startedNames.length = 0;

            if (health && typeof health.setStopping === "function") {
                health.setStopping();
            }

            for (const name of reverseNames) {
                const reg = registrations.get(name);
                if (reg && typeof reg.stop === "function") {
                    try {
                        await reg.stop(instances.get(name));
                    } catch (err) {
                        if (logger && typeof logger.error === "function") {
                            logger.error(`[CompositionRoot] Error stopping '${name}': ${err.message}`);
                        }
                    }
                }
                instances.delete(name);
            }

            isStarted = false;
        },

        get(name) {
            return instances.get(name);
        },

        report() {
            return [...startReports];
        }
    };
}

module.exports = { createRoot };
