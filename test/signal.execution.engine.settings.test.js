"use strict";

require("module-alias/register");

const SignalExecutionEngine = require("@core/core/pipeline/SignalExecutionEngine");

describe("SignalExecutionEngine runtime settings", () => {
  test("updates concurrency and maxQueue with sane bounds", () => {
    const exec = new SignalExecutionEngine({ concurrency: 2, maxQueue: 500 });
    const out = exec.updateSettings({ concurrency: 12, maxQueue: 12000 });

    expect(out.concurrency).toBe(12);
    expect(out.maxQueue).toBe(12000);
  });

  test("ignores invalid settings and keeps existing values", () => {
    const exec = new SignalExecutionEngine({ concurrency: 4, maxQueue: 700 });
    exec.updateSettings({ concurrency: -1, maxQueue: 0 });
    const out = exec.getMetrics();

    expect(out.concurrency).toBe(4);
    expect(out.maxQueue).toBe(700);
  });
});

