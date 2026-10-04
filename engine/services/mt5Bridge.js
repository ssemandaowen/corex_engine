"use strict";

const mt5Bridge = require("../../packages/corex-broker-contract/src/mt5Bridge");
const db = require("@core/services/postgres");

// Wire the real postgres module into the MT5 bridge.
// This is the existing wiring spot for the bridge — the
// corex-broker-contract package itself carries no @core
// require of its own.
mt5Bridge.configure({ db });

module.exports = mt5Bridge;
