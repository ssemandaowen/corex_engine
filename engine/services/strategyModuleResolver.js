"use strict";

const vm = require("node:vm");

const compileFunction = vm.compileFunction.bind(vm);

const STRATEGY_MODULE_LOADERS = new Map([
    ["corex-strategy-engine", () => require("corex-strategy-engine")],
    ["mathjs", () => require("mathjs")],
    ["technicalindicators", () => require("technicalindicators")],
    ["@utils/BaseStrategy", () => require("@utils/BaseStrategy")],
]);

const getModuleLoader = STRATEGY_MODULE_LOADERS.get.bind(STRATEGY_MODULE_LOADERS);

class StrategyModuleResolutionError extends Error {
    constructor(specifier, strategyId) {
        const description = typeof specifier === "string"
            ? `"${specifier}"`
            : `<${typeof specifier} specifier>`;

        super(`STRATEGY_MODULE_NOT_ALLOWED: Strategy module resolution denied for ${description}`);
        this.name = "StrategyModuleResolutionError";
        this.code = "STRATEGY_MODULE_NOT_ALLOWED";
        this.strategyId = strategyId;

        if (typeof specifier === "string") {
            this.specifier = specifier;
        } else {
            this.specifierType = typeof specifier;
        }
    }
}

function createStrategyRequire(strategyId) {
    const strategyRequire = (specifier) => {
        if (typeof specifier !== "string") {
            throw new StrategyModuleResolutionError(specifier, strategyId);
        }

        const loadAllowedModule = getModuleLoader(specifier);
        if (typeof loadAllowedModule !== "function") {
            throw new StrategyModuleResolutionError(specifier, strategyId);
        }

        return loadAllowedModule();
    };

    return Object.freeze(strategyRequire);
}

/**
 * Compile strategy source with a restricted CommonJS-compatible wrapper.
 *
 * vm.compileFunction is used only to inject the compiler-owned require function.
 * It does not isolate the strategy's global execution environment and is not a
 * security sandbox.
 *
 * @param {string} code
 * @param {string} id
 * @returns {*}
 */
function loadStrategyModule(code, id) {
    if (typeof code !== "string") {
        throw new TypeError("Strategy source must be a string");
    }

    const strategyId = typeof id === "string" && id.length > 0 ? id : "unknown";
    const filename = `db://strategies/${strategyId}.js`;
    const dirname = "db://strategies";

    // Match the useful CommonJS surface without exposing Node's Module object,
    // parent, paths, require cache, extensions, or generated require function.
    const moduleRecord = Object.create(null);
    moduleRecord.exports = {};

    const initialExports = moduleRecord.exports;
    const strategyRequire = createStrategyRequire(strategyId);
    const wrapper = compileFunction(
        code,
        ["exports", "require", "module", "__filename", "__dirname"],
        { filename, displayErrors: true }
    );

    wrapper.call(
        initialExports,
        initialExports,
        strategyRequire,
        moduleRecord,
        filename,
        dirname
    );

    return moduleRecord.exports;
}

module.exports = {
    loadStrategyModule,
    StrategyModuleResolutionError,
};
