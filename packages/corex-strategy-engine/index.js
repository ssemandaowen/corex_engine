"use strict";

const { Strategy } = require("./src/Strategy");
const ta = require("./src/ta");
const util = require("./src/util");
const ParamSchema = require("./src/ParamSchema");
const { resolveParams, ParamResolutionError } = require("./src/ParamResolver");
const { IndicatorManager } = require("./src/IndicatorManager");
const IndicatorBank = require("./src/IndicatorBank");
const BaseIndicator = require("./src/indicators/BaseIndicator");
const { EmaCore, WilderCore } = require("./src/indicators/core");
const { IndicatorRegistry, UnknownIndicatorError, globalIndicatorRegistry, indicators } = require("./src/IndicatorRegistry");
const { ContextBuilder } = require("./src/ContextBuilder");
const { getStrategyApi } = require("./src/StrategyIntrospection");
const StrategyValidator = require("./src/validation/StrategyValidator");
const StrategyManifest = require("./src/validation/StrategyManifest");
const { assertSafeInstance, UnsafeStrategyInstanceError } = require("./src/validation/assertSafeInstance");
const Position = require("./src/Position");
const PlotBuffer = require("./src/PlotBuffer");
const StrategyStateStore = require("./src/StrategyStateStore");
const StrategyRuntimeUtils = require("./src/StrategyRuntimeUtils");
const StrategyDataManager = require("./src/StrategyDataManager");

module.exports = {
    Strategy,
    ta,
    util,
    ParamSchema,
    resolveParams,
    ParamResolutionError,
    IndicatorManager,
    IndicatorBank,
    BaseIndicator,
    EmaCore,
    WilderCore,
    IndicatorRegistry,
    UnknownIndicatorError,
    globalIndicatorRegistry,
    indicators,
    ContextBuilder,
    getStrategyApi,
    StrategyValidator,
    StrategyManifest,
    assertSafeInstance,
    UnsafeStrategyInstanceError,
    Position,
    PlotBuffer,
    StrategyStateStore,
    StrategyRuntimeUtils,
    StrategyDataManager,
};