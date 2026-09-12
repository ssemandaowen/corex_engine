"use strict";

const { Strategy } = require("./src/Strategy");
const ta = require("./src/ta");
const util = require("./src/util");
const ParamSchema = require("./src/ParamSchema");
const { IndicatorManager } = require("./src/IndicatorManager");
const { ContextBuilder } = require("./src/ContextBuilder");
const { StrategyValidator } = require("./src/validation/StrategyValidator");
const { StrategyManifest } = require("./src/validation/StrategyManifest");

module.exports = {
    Strategy,
    ta,
    util,
    ParamSchema,
    IndicatorManager,
    ContextBuilder,
    StrategyValidator,
    StrategyManifest,
};
