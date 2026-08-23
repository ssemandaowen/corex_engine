"use strict";

const { BrokerContract, UnsupportedOperationError, STANDARD_METRICS_SHAPE, TRADE_RECORD_SHAPE, ACCOUNT_SNAPSHOT_SHAPE, ORDER_RESULT_SHAPE, STANDARD_ORDER_PAYLOAD } = require("./src/base/BrokerContract");
const BaseBroker = require("./src/base/BaseBroker");
const BacktestDriver = require("./src/drivers/BacktestDriver");
const CoreXPaperDriver = require("./src/drivers/CoreXPaperDriver");
const MetaApiDriver = require("./src/drivers/MetaApiDriver");
const MT5MQL5Connector = require("./src/connectors/MT5MQL5Connector");
const MetaApiConnector = require("./src/connectors/MetaApiConnector");
const RuntimeBrokerFactory = require("./src/RuntimeBrokerFactory");
const mt5Bridge = require("./src/mt5Bridge");
const SharedFillSim = require("./src/utils/SharedFillSim");
const SymbolNormalizer = require("./src/utils/SymbolNormalizer");
const DataPaginationLayer = require("./src/utils/DataPaginationLayer");
const { MessageEnvelope, REASON_CODES } = require("./src/socketx/MessageEnvelope");
const { SocketXConnection } = require("./src/socketx/SocketXConnection");
const { SocketXServer } = require("./src/socketx/SocketXServer");
const { RiskGateway } = require("./src/socketx/RiskGateway");
const { Account } = require("./src/account/Account");
const { TradingAccountRepository } = require("./src/account/TradingAccountRepository");
const { InMemoryAccountRepository } = require("./src/account/InMemoryAccountRepository");
const { generateAccountId, generateUlid, parseAccountId } = require("./src/account/AccountId");

module.exports = {
    BrokerContract,
    BaseBroker,
    UnsupportedOperationError,
    BacktestDriver,
    CoreXPaperDriver,
    MetaApiDriver,
    MT5MQL5Connector,
    MetaApiConnector,
    RuntimeBrokerFactory,
    mt5Bridge,
    SharedFillSim,
    SymbolNormalizer,
    DataPaginationLayer,
    STANDARD_METRICS_SHAPE,
    TRADE_RECORD_SHAPE,
    ACCOUNT_SNAPSHOT_SHAPE,
    ORDER_RESULT_SHAPE,
    STANDARD_ORDER_PAYLOAD,
    BacktestBroker: BacktestDriver,
    PaperBroker: CoreXPaperDriver,
    LiveBroker: MetaApiDriver,
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
};
