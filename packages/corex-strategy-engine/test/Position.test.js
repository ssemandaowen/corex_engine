"use strict";

const Position = require("../src/Position");

describe("Position O(1) incremental aggregate correctness", () => {
    test("incremental add/reduce matches full from-scratch recompute across 10+ varied sequences", () => {
        const sequences = [
            // Sequence 1: Simple adds
            [{ type: "add", q: 1, p: 100 }, { type: "add", q: 2, p: 105 }, { type: "add", q: 1.5, p: 102 }],
            // Sequence 2: Add and reduce
            [{ type: "add", q: 10, p: 50 }, { type: "reduce", q: 4, p: 55 }, { type: "add", q: 5, p: 48 }],
            // Sequence 3: Multiple reduces down to zero and add again
            [{ type: "add", q: 5, p: 10 }, { type: "reduce", q: 5, p: 12 }, { type: "add", q: 2, p: 15 }, { type: "reduce", q: 1, p: 16 }],
            // Sequence 4: Fractional quantities and prices
            [{ type: "add", q: 0.12345, p: 1.12345 }, { type: "add", q: 0.5, p: 1.13 }, { type: "reduce", q: 0.2, p: 1.14 }],
            // Sequence 5: Large quantity adds
            [{ type: "add", q: 1000, p: 2000 }, { type: "add", q: 500, p: 2100 }, { type: "reduce", q: 800, p: 2050 }],
            // Sequence 6: Alternating small adds and reduces
            [{ type: "add", q: 1, p: 10 }, { type: "reduce", q: 0.5, p: 11 }, { type: "add", q: 2, p: 9 }, { type: "reduce", q: 1.5, p: 9.5 }],
            // Sequence 7: Zero or invalid quantity/price handling
            [{ type: "add", q: 0, p: 10 }, { type: "add", q: -1, p: -5 }, { type: "add", q: 3, p: 100 }],
            // Sequence 8: Multiple adds at identical price
            [{ type: "add", q: 1, p: 50 }, { type: "add", q: 1, p: 50 }, { type: "add", q: 1, p: 50 }],
            // Sequence 9: Multiple reduces exhausting lots
            [{ type: "add", q: 10, p: 100 }, { type: "reduce", q: 3, p: 105 }, { type: "reduce", q: 4, p: 110 }, { type: "reduce", q: 3, p: 115 }],
            // Sequence 10: Complex interleaved add/reduce sequence
            [
                { type: "add", q: 2.5, p: 1000 },
                { type: "add", q: 1.2, p: 1010 },
                { type: "reduce", q: 1.0, p: 1020 },
                { type: "add", q: 3.0, p: 990 },
                { type: "reduce", q: 4.0, p: 1005 },
                { type: "add", q: 5.0, p: 980 }
            ]
        ];

        for (let idx = 0; idx < sequences.length; idx++) {
            const seq = sequences[idx];
            
            // Incremental position
            const pos = new Position("EURUSD", "long", 0, 0);
            pos.quantity = 0;
            pos.avgEntryPrice = 0;
            pos.entryPrice = 0;
            pos.lots = [];

            // Reference position (using _recomputeFromLots simulation)
            const refLots = [];
            const computeRef = () => {
                let totalQty = 0;
                let weighted = 0;
                for (const lot of refLots) {
                    const q = Number(lot.quantity || 0);
                    const p = Number(lot.price || 0);
                    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p <= 0) continue;
                    totalQty += q;
                    weighted += q * p;
                }
                return {
                    quantity: totalQty,
                    avgEntryPrice: totalQty > 0 ? (weighted / totalQty) : 0
                };
            };

            for (const step of seq) {
                if (step.type === "add") {
                    pos.add(step.q, step.p);
                    refLots.push({ quantity: Math.abs(step.q || 0), price: Number(step.p || 0), timestamp: Date.now() });
                } else if (step.type === "reduce") {
                    pos.reduceDetailed(step.q, step.p);
                    // Simulate reduce on refLots (FIFO)
                    let remaining = Math.abs(step.q || 0);
                    while (remaining > 0 && refLots.length > 0) {
                        const lot = refLots[0];
                        const take = Math.min(lot.quantity, remaining);
                        lot.quantity -= take;
                        remaining -= take;
                        if (lot.quantity <= 1e-12) {
                            refLots.shift();
                        }
                    }
                }

                const ref = computeRef();
                expect(pos.quantity).toBeCloseTo(ref.quantity, 10);
                expect(pos.avgEntryPrice).toBeCloseTo(ref.avgEntryPrice, 10);
            }
        }
    });
});
