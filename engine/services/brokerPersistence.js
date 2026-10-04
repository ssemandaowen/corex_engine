"use strict";

const accounts = require("corex-accounts");
const pgStore = require("@core/services/pgStore");
const secretsVault = require("@core/services/secretsVault");
const logger = require("@utils/logger");
const { bus } = require("@events/bus");

// Wire the broker persistence service with the engine's real
// dependencies. This is the wiring spot for brokerPersistence —
// the corex-accounts package itself carries no @core / @utils /
// @events requires.
const wired = accounts.createAccounts({
    db: pgStore,
    secretsVault,
    logger,
    bus,
});

module.exports = { persistBrokerSettings: wired.persistBrokerSettings };
