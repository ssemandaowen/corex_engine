"use strict";

function getStrategyApi(instance) {
    if (!instance || (typeof instance !== "object" && typeof instance !== "function")) return [];
    const out = new Set();
    let proto = instance;

    while (proto && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (name === "constructor") continue;
            if (name.startsWith("_")) continue;
            const descriptor = Object.getOwnPropertyDescriptor(proto, name);
            if (descriptor && typeof descriptor.value === "function") out.add(name);
        }
        proto = Object.getPrototypeOf(proto);
    }

    return Array.from(out).sort((a, b) => a.localeCompare(b));
}

module.exports = {
    getStrategyApi
};

