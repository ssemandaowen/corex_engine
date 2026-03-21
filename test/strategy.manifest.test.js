"use strict";

require("module-alias/register");

const {
  ENTRYPOINT_METHODS,
  CORE_METHOD_MANIFEST,
  getStrategyManifestPayload
} = require("@utils/strategy/StrategyManifest");

describe("StrategyManifest", () => {
  test("exports required contract sections", () => {
    expect(Array.isArray(ENTRYPOINT_METHODS)).toBe(true);
    expect(ENTRYPOINT_METHODS.length).toBeGreaterThan(0);
    expect(Array.isArray(CORE_METHOD_MANIFEST)).toBe(true);
    expect(CORE_METHOD_MANIFEST.length).toBeGreaterThan(0);
  });

  test("builds payload with methods and indicators", () => {
    const payload = getStrategyManifestPayload();
    expect(payload).toBeTruthy();
    expect(Array.isArray(payload.entrypoints)).toBe(true);
    expect(Array.isArray(payload.methods)).toBe(true);
    expect(Array.isArray(payload.indicators)).toBe(true);
    expect(payload.methods.length).toBeGreaterThan(0);
    expect(payload.indicators.length).toBeGreaterThan(0);
    expect(typeof payload.generatedAt).toBe("string");
  });
});
