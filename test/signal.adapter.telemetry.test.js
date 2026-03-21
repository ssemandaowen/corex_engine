"use strict";

require("module-alias/register");

jest.mock("@core/services/postgres", () => ({
  hasDbConfig: jest.fn(() => false),
  query: jest.fn(async () => ({ rows: [] })),
  withTransaction: jest.fn(async (cb) => cb({ query: jest.fn(async () => ({ rows: [] })) }))
}));

const SignalAdapter = require("@core/signalAdapter");

describe("SignalAdapter telemetry", () => {
  test("returns traceId, metrics and recent events", async () => {
    const broker = {
      execute: jest.fn(() => true),
      getLastExecution: jest.fn(() => ({
        ok: true,
        symbol: "EURUSD",
        side: "BUY",
        quantity: 0.1,
        price: 1.1,
        commission: 0,
        timestamp: Date.now()
      }))
    };

    const adapter = new SignalAdapter({ mode: "PAPER", broker, brokers: { PAPER: broker } });
    const result = await adapter.handle({
      strategyId: "test",
      symbol: "EURUSD",
      intent: "ENTER",
      side: "long",
      quantity: 0.1
    });

    expect(result.traceId).toBeTruthy();
    const metrics = adapter.getMetrics();
    expect(metrics.handled).toBeGreaterThanOrEqual(1);
    expect(metrics.lastHandledAt).toBeGreaterThan(0);
    const events = adapter.getRecentEvents(10);
    expect(events.length).toBeGreaterThan(0);
  });
});

