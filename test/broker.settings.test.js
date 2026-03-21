"use strict";

require("module-alias/register");

jest.mock("@core/services/pgStore", () => ({
  getSystemSettings: jest.fn(async () => ({})),
  getBrokerSettings: jest.fn(async () => null),
  upsertBrokerSettings: jest.fn(async () => ({})),
  getBrokerSettingsForUser: jest.fn(async () => null),
  upsertBrokerSettingsForUser: jest.fn(async () => ({}))
}));

jest.mock("@events/bus", () => ({
  bus: { emit: jest.fn(), on: jest.fn(), removeListener: jest.fn(), removeAllListeners: jest.fn() },
  EVENTS: {
    ORDER: { FILLED: "ORDER_FILLED" },
    POSITION: { PORTFOLIO_UPDATE: "POSITION_PORTFOLIO_UPDATE", UPDATED: "POSITION_UPDATED" },
    SYSTEM: { CONFIG_REFRESH: "SYSTEM_CONFIG_REFRESH" }
  }
}));

const PaperBroker = require("@broker/paper");
const LiveBroker = require("@broker/live");

describe("Broker settings application", () => {
  test("paper broker applies config and caps order size", () => {
    const broker = new PaperBroker(1000);
    broker.updateConfig({
      commissionPerShare: 0,
      commissionMin: 0,
      slippageBps: 0,
      marginRequirement: 1,
      maxOrderSize: 0.01,
      minOrderSize: 0.001
    }, { persist: false });
    broker.updatePrice("BTC/USD", 100);

    const ok = broker.execute("BTC/USD", "BUY", 1);
    expect(ok).toBe(true);

    const pos = broker.positions.get("BTC/USD");
    expect(Number(pos.quantity)).toBeCloseTo(0.01, 8);
  });

  test("paper broker rejects invalid cash update", () => {
    const broker = new PaperBroker(1000);
    expect(broker.setCash(-1)).toBe(false);
    expect(broker.setInitialCash("abc")).toBe(false);
  });

  test("paper broker enforces short-selling margin headroom", () => {
    const broker = new PaperBroker(1000);
    broker.updateConfig({
      commissionPerShare: 0,
      commissionMin: 0,
      slippageBps: 0,
      marginRequirement: 1,
      maxOrderSize: 1000,
      minOrderSize: 0.0001
    }, { persist: false });
    broker.updatePrice("BTC/USD", 100);

    expect(broker.execute("BTC/USD", "SELL", 10)).toBe(true); // consumes full free margin
    expect(broker.getFreeMargin()).toBeCloseTo(0, 8);
    expect(broker.execute("BTC/USD", "SELL", 1)).toBe(false); // rejects over-margin short add
  });

  test("live broker exposes runtime settings and reset", () => {
    const broker = new LiveBroker(5000);
    broker.updateConfig({ riskFloor: 0.2, maxSlippageBps: 12 }, { persist: false });
    expect(broker.config.riskFloor).toBe(0.2);
    expect(broker.config.maxSlippageBps).toBe(12);
    broker.setInitialCash(3000);
    broker.resetAccount();
    expect(broker.getAccountSnapshot().cash).toBe(3000);
  });
});
