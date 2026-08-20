"use strict";

const { BrokerContract, UnsupportedOperationError, STANDARD_METRICS_SHAPE, TRADE_RECORD_SHAPE, ACCOUNT_SNAPSHOT_SHAPE, ORDER_RESULT_SHAPE, STANDARD_ORDER_PAYLOAD } = require("./src/base/BrokerContract");
const BaseBroker = require("./src/base/BaseBroker");
const BacktestDriver = require("./src/drivers/BacktestDriver");
const CoreXPaperDriver = require("./src/drivers/CoreXPaperDriver");
const MetaApiDriver = require("./src/drivers/MetaApiDriver");
const RestDriver = require("./src/drivers/RestDriver");
const MT5MQL5Connector = require("./src/connectors/MT5MQL5Connector");
const MetaApiConnector = require("./src/connectors/MetaApiConnector");
const RestConnector = require("./src/connectors/RestConnector");
const RuntimeBrokerFactory = require("./src/RuntimeBrokerFactory");
const mt5Bridge = require("./src/mt5Bridge");
const SharedFillSim = require("./src/utils/SharedFillSim");
const SymbolNormalizer = require("./src/utils/SymbolNormalizer");
const DataPaginationLayer = require("./src/utils/DataPaginationLayer");

module.exports = {
    BrokerContract,
    BaseBroker,
    UnsupportedOperationError,
    BacktestDriver,
    CoreXPaperDriver,
    MetaApiDriver,
    RestDriver,
    MT5MQL5Connector,
    MetaApiConnector,
    RestConnector,
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
    LiveBroker: MetaApiDriver
};
