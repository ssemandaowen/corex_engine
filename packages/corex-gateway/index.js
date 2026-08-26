"use strict";

/**
 * corex-gateway — Index
 *
 * Gateway/transport layer for CoreX. Owns Socket_X protocol, account model,
 * connection lifecycle, and the auth/risk injection points.
 *
 * Public API: re-exports all Socket_X, account, and HTTP symbols.
 */

const { MessageEnvelope, REASON_CODES } = require("./src/socketx/MessageEnvelope");
const { SocketXConnection } = require("./src/socketx/SocketXConnection");
const { SocketXServer } = require("./src/socketx/SocketXServer");
const { RiskGateway } = require("./src/socketx/RiskGateway");
const { Account } = require("./src/account/Account");
const { TradingAccountRepository } = require("./src/account/TradingAccountRepository");
const { InMemoryAccountRepository } = require("./src/account/InMemoryAccountRepository");
const { generateAccountId, generateUlid, parseAccountId } = require("./src/account/AccountId");
const { createAccountRouter } = require("./src/http/accountRoutes");

module.exports = {
    MessageEnvelope,
    REASON_CODES,
    SocketXConnection,
    SocketXServer,
    RiskGateway,
    Account,
    TradingAccountRepository,
    InMemoryAccountRepository,
    generateAccountId,
    generateUlid,
    parseAccountId,
    createAccountRouter,
};
