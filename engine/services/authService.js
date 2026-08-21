"use strict";

/**
 * Re-export shim — corex-auth package.
 *
 * This file re-exports AuthService from packages/corex-auth/src/AuthService.js
 * to maintain backward compatibility with existing @core/services/authService requires.
 */

module.exports = require("../../packages/corex-auth/src/AuthService");