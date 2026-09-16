"use strict";

const { Strategy } = require("./src/Strategy");
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

module.exports = {
    Strategy,
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
};