"use strict";

require("module-alias/register");

const fs = require("fs");
const os = require("os");
const path = require("path");
const BaseStrategy = require("@utils/BaseStrategy");
const StrategyValidator = require("@utils/strategy/StrategyValidator");

class ValidStrategy extends BaseStrategy {
  constructor() {
    super({ symbols: ["BTC/USD"], timeframe: "1m", lookback: 100 });
    this.name = "valid";
    this.schema = {
      period: { type: "integer", min: 2, max: 200, default: 20 }
    };
  }

  next() {
    return null;
  }
}

describe("StrategyValidator", () => {
  test("returns error for non-class input", () => {
    const result = StrategyValidator.validate(null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_CLASS")).toBe(true);
  });

  test("returns error when strategy does not extend BaseStrategy", () => {
    class NoBase {
      constructor() {
        this.symbols = ["BTC/USD"];
      }
      next() {
        return null;
      }
    }

    const result = StrategyValidator.validate(NoBase);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_INHERITANCE")).toBe(true);
  });

  test("accepts a valid strategy implementation", () => {
    const result = StrategyValidator.validate(ValidStrategy);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.status).toBe("PASS");
  });

  test("detects infinite loops with whitespace variants", () => {
    class LoopStrategy extends BaseStrategy {
      constructor() {
        super({ symbols: ["BTC/USD"] });
      }
      next() {
        while (true) return null;
      }
    }

    const result = StrategyValidator.validate(LoopStrategy);
    expect(result.errors.some((e) => e.code === "INFINITE_LOOP")).toBe(true);
    expect(result.valid).toBe(false);
  });

  test("validateFile loads file and reports result", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "corex-validator-"));
    const filePath = path.join(tmpDir, "tmp.strategy.js");
    const code = `
      const BaseStrategy = require("@utils/BaseStrategy");
      module.exports = class TmpStrategy extends BaseStrategy {
        constructor() {
          super({ symbols: ["BTC/USD"], timeframe: "1m", lookback: 120 });
          this.schema = { period: { type: "integer", min: 2, max: 50, default: 14 } };
        }
        next() { return null; }
      };
    `;
    fs.writeFileSync(filePath, code, "utf8");

    const result = await StrategyValidator.validateFile(filePath);
    expect(result.file).toBe(filePath);
    expect(result.errors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  test("warns when strategy references unknown indicator export", () => {
    class UnknownIndicatorStrategy extends BaseStrategy {
      constructor() {
        super({ symbols: ["BTC/USD"] });
      }
      next() {
        const close = this.series("BTC/USD", "close");
        this.indicators.NotARealIndicator?.calculate?.({ values: close, period: 14 });
        return null;
      }
    }

    const result = StrategyValidator.validate(UnknownIndicatorStrategy);
    expect(result.warnings.some((w) => w.code === "UNKNOWN_INDICATOR")).toBe(true);
  });
});
