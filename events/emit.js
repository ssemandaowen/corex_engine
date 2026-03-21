"use strict";

const { bus } = require("./bus");
const { normalizeMeta } = require("./schema");

function emit(event, payload, meta = {}) {
  bus.emit(event, payload, normalizeMeta(meta));
}

function on(event, handler) {
  if (typeof handler !== "function") return;
  bus.on(event, (payload, meta) => handler(payload, normalizeMeta(meta)));
}

module.exports = {
  emit,
  on
};

