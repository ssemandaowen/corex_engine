"use strict";

require("module-alias/register");

const Position = require("@utils/strategy/Position");
const StrategyPositionManager = require("@utils/strategy/StrategyPositionManager");

describe("Lot-level accounting", () => {
  test("Position reduces FIFO lots for long side", () => {
    const pos = new Position("BTC/USD", "long", 1, 100);
    pos.add(1, 110);

    const out = pos.reduceDetailed(1.5, 120);
    expect(out.closedQty).toBeCloseTo(1.5, 8);
    expect(out.realized).toBeCloseTo(25, 8); // 1*(120-100) + 0.5*(120-110)
    expect(pos.quantity).toBeCloseTo(0.5, 8);
    expect(pos.avgEntryPrice).toBeCloseTo(110, 8);
  });

  test("Position reduces FIFO lots for short side", () => {
    const pos = new Position("BTC/USD", "short", 2, 100);
    pos.add(1, 90);

    const out = pos.reduceDetailed(2, 80);
    expect(out.closedQty).toBeCloseTo(2, 8);
    expect(out.realized).toBeCloseTo(40, 8); // 2*(100-80)
    expect(pos.quantity).toBeCloseTo(1, 8);
    expect(pos.avgEntryPrice).toBeCloseTo(90, 8);
  });

  test("StrategyPositionManager captures realized pnl on flip", () => {
    const mgr = new StrategyPositionManager();
    mgr.applyDelta("BTC/USD", 2, 100); // long 2
    const pos = mgr.applyDelta("BTC/USD", -3, 90); // close 2, open short 1

    const delta = mgr.getLastDelta();
    expect(delta.realizedPnl).toBeCloseTo(-20, 8); // 2*(90-100)
    expect(pos.side).toBe("short");
    expect(pos.quantity).toBeCloseTo(1, 8);
    expect(pos.avgEntryPrice).toBeCloseTo(90, 8);
  });
});

