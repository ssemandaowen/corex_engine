"use strict";

require("module-alias/register");

jest.mock("@core/services/postgres", () => ({
  hasDbConfig: jest.fn(() => true),
  query: jest.fn()
}));

jest.mock("@core/services/mt5Bridge", () => ({
  getStatus: jest.fn(() => ({ authorized: true })),
  openPosition: jest.fn(async () => ({ ok: true })),
  closePosition: jest.fn(async () => ({ ok: true }))
}));

const db = require("@core/services/postgres");
const mt5Bridge = require("@core/services/mt5Bridge");
const SignalAdapter = require("@core/signalAdapter");

describe("SignalAdapter LIVE persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockImplementation(async (sql) => {
      if (String(sql).includes("INSERT INTO orders")) {
        return { rows: [{ id: "ord_live_1" }] };
      }
      return { rows: [], rowCount: 1 };
    });
  });

  test("persists order and marks SENT when bridge dispatch succeeds", async () => {
    const adapter = new SignalAdapter({ mode: "LIVE" });
    const res = await adapter._execLive({
      strategyId: "s1",
      symbol: "EURUSD",
      intent: "ENTER",
      side: "long",
      quantity: 0.1
    });

    expect(res.ok).toBe(true);
    expect(res.dispatched).toBe(true);
    expect(res.orderId).toBe("ord_live_1");
    expect(mt5Bridge.openPosition).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(
      "UPDATE orders SET status = $2 WHERE id = $1",
      ["ord_live_1", "SENT"]
    );
  });

  test("marks REJECTED when bridge dispatch fails", async () => {
    mt5Bridge.openPosition.mockRejectedValueOnce(new Error("bridge down"));
    const adapter = new SignalAdapter({ mode: "LIVE" });

    await expect(adapter._execLive({
      strategyId: "s1",
      symbol: "EURUSD",
      intent: "ENTER",
      side: "long",
      quantity: 0.1
    })).rejects.toThrow("bridge down");

    expect(db.query).toHaveBeenCalledWith(
      "UPDATE orders SET status = $2 WHERE id = $1",
      ["ord_live_1", "REJECTED"]
    );
  });
});

