"use strict";

const strategyValidator = require("@utils/strategy/StrategyValidator");

class StrategyValidator {
    static validate(StrategyClass, options = {}) {
        return strategyValidator.validate(StrategyClass, options);
    }

    static formatResult(result) {
        return strategyValidator.formatResult(result);
    }

    static async validateFile(filePath) {
        return strategyValidator.validateFile(filePath);
    }
}

StrategyValidator.DEFAULT_VALIDATION_OPTS = strategyValidator.DEFAULT_VALIDATION_OPTS;

module.exports = { StrategyValidator };
