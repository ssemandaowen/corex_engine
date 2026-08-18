"use strict";

const registry = new Map();

const normalizeName = (name) => String(name || "").trim();

module.exports = {
    register(name, plugin) {
        const key = normalizeName(name || plugin?.name);
        if (!key || !plugin) return false;
        registry.set(key, plugin);
        return true;
    },

    unregister(name) {
        const key = normalizeName(name);
        if (!key) return false;
        return registry.delete(key);
    },

    get(name) {
        const key = normalizeName(name);
        if (!key) return null;
        return registry.get(key) || null;
    },

    list() {
        return Array.from(registry.keys());
    }
};
