"use strict";

const { Strategy, MAX_ALLOWED_LOOKBACK } = require("./src/Strategy");
const ta = require("./src/ta");
const util = require("./src/util");
const ParamSchema = require("./src/ParamSchema");
const { IndicatorManager } = require("./src/IndicatorManager");
const { IndicatorRegistry, globalIndicatorRegistry, indicators } = require("./src/IndicatorRegistry");
const { ContextBuilder } = require("./src/ContextBuilder");
const StrategyValidator = require("./src/validation/StrategyValidator");
const StrategyManifest = require("./src/validation/StrategyManifest");
const Position = require("./src/Position");
const PlotBuffer = require("./src/PlotBuffer");
const StrategyIntrospection = require("./src/StrategyIntrospection");
const StrategyPositionManager = require("./src/StrategyPositionManager");
const StrategyRuntimeUtils = require("./src/StrategyRuntimeUtils");
const StrategyStateStore = require("./src/StrategyStateStore");
const StrategyDataManager = require("./src/StrategyDataManager");
const SoACandleStore = require("./src/SoACandleStore");

module.exports = {
    Strategy,
    MAX_ALLOWED_LOOKBACK,
    ta,
    util,
    ParamSchema,
    IndicatorManager,
    IndicatorRegistry,
    globalIndicatorRegistry,
    indicators,
    ContextBuilder,
    StrategyValidator,
    StrategyManifest,
    Position,
    PlotBuffer,
    StrategyIntrospection,
    StrategyPositionManager,
    StrategyRuntimeUtils,
    StrategyStateStore,
    StrategyDataManager,
    SoACandleStore,
};
