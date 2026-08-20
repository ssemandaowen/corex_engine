"use strict";

const { BrokerContract, STANDARD_METRICS_SHAPE, TRADE_RECORD_SHAPE, ACCOUNT_SNAPSHOT_SHAPE } = require("./src/base/BrokerContract");
const BaseBroker = require("./src/base/BaseBroker");
const BacktestBroker = require("./src/modes/BacktestBroker");
const PaperBroker = require("./src/modes/PaperBroker");
const LiveBroker = require("./src/modes/LiveBroker");
const MT5MQL5Connector = require("./src/connectors/MT5MQL5Connector");
const MetaApiConnector = require("./src/connectors/MetaApiConnector");
const RestConnector = require("./src/connectors/RestConnector");
const RuntimeBrokerFactory = require("./src/RuntimeBrokerFactory");
const mt5Bridge = require("./src/mt5Bridge");

module.exports = {
    BrokerContract,
    BaseBroker,
    BacktestBroker,
    PaperBroker,
    LiveBroker,
    MT5MQL5Connector,
    MetaApiConnector,
    RestConnector,
    RuntimeBrokerFactory,
    mt5Bridge,
    STANDARD_METRICS_SHAPE,
    TRADE_RECORD_SHAPE,
    ACCOUNT_SNAPSHOT_SHAPE
};
