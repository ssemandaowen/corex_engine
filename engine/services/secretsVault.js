"use strict";

/**
 * Re-export shim — corex-auth package.
 *
 * This file re-exports SecretsVault from packages/corex-auth/src/SecretsVault.js
 * to maintain backward compatibility with existing @core/services/secretsVault requires.
 */

module.exports = require("../../packages/corex-auth/src/SecretsVault");