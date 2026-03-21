"use strict";

require("module-alias/register");

jest.mock("@core/services/postgres", () => ({
  hasDbConfig: jest.fn(() => true),
  query: jest.fn(),
  withTransaction: jest.fn()
}));

const db = require("@core/services/postgres");
const mt5Bridge = require("@core/services/mt5Bridge");

describe("MT5Bridge order_result persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("marks order rejected when bridge returns failure", async () => {
    await mt5Bridge._persistOrderResult({
      ok: false,
      payload: { orderId: "ord_live_1" }
    });

    expect(db.query).toHaveBeenCalledWith(
      "UPDATE orders SET status = $2 WHERE id = $1",
      ["ord_live_1", "REJECTED"]
    );
  });

  test("updates order and inserts fill when bridge returns success", async () => {
    const txQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: "ord_live_1", quantity: 1 }] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE orders status
      .mockResolvedValueOnce({ rows: [] }) // fill dedupe check
      .mockResolvedValueOnce({ rowCount: 1 }); // INSERT fill

    db.withTransaction.mockImplementation(async (cb) => cb({ query: txQuery }));

    await mt5Bridge._persistOrderResult({
      ok: true,
      payload: {
        orderId: "ord_live_1",
        price: 1.10123,
        fillQuantity: 0.5,
        commission: 0.02,
        dealId: "deal_1"
      }
    });

    expect(txQuery).toHaveBeenCalledWith(
      "UPDATE orders SET status = $2 WHERE id = $1",
      ["ord_live_1", "FILLED"]
    );
    expect(txQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO order_fills"),
      ["ord_live_1", "deal_1", 1.10123, 0.5, 0.02]
    );
  });
});

