"use strict";

const { bus } = require("./bus");
const { normalizeMeta } = require("./schema");

function emit(event, payload, meta = {}) {
    const normalizedMeta = normalizeMeta(meta);
    // Offload to the next turn of the event loop to prevent blocking
    setImmediate(() => {
        bus.emit(event, payload, normalizedMeta);
    });
}

function on(event, handler) {
    if (typeof handler !== "function") return;
    // Remove the double-normalization here; normalize once at emission
    bus.on(event, handler);
}

module.exports = { emit, on };