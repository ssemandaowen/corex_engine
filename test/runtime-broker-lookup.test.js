"use strict";

const RuntimeRegistry = require("../engine/core/runtime/RuntimeRegistry");
const runtimeService = require("../engine/services/runtimeService");

describe("runtimeService.getBrokerForMode", () => {
    afterEach(() => {
        RuntimeRegistry.clear();
    });

    test("returns the active broker for a user's mode", () => {
        const paperBroker = { id: "paper-broker" };
        RuntimeRegistry.set("u1::Strat::EURUSD::PAPER", {
            instance: {},
            broker: paperBroker,
            symbol: "EURUSD",
            mode: "PAPER",
            userId: "u1",
            accountId: "u1",
            strategyName: "Strat"
        });

        expect(runtimeService.getBrokerForMode("paper", "u1")).toBe(paperBroker);
        expect(runtimeService.getBrokerForMode("PAPER", "u1")).toBe(paperBroker);
    });

    test("returns null when the user has no runtime in that mode", () => {
        const liveBroker = { id: "live-broker" };
        RuntimeRegistry.set("u1::Strat::EURUSD::LIVE", {
            instance: {},
            broker: liveBroker,
            symbol: "EURUSD",
            mode: "LIVE",
            userId: "u1",
            accountId: "u1",
            strategyName: "Strat"
        });

        expect(runtimeService.getBrokerForMode("paper", "u1")).toBeNull();
        expect(runtimeService.getBrokerForMode("live", "u2")).toBeNull();
    });

    test("matches by accountId when userId is absent", () => {
        const liveBroker = { id: "live-broker" };
        RuntimeRegistry.set("acct::Strat::EURUSD::LIVE", {
            instance: {},
            broker: liveBroker,
            symbol: "EURUSD",
            mode: "LIVE",
            userId: "system",
            accountId: "acct",
            strategyName: "Strat"
        });

        expect(runtimeService.getBrokerForMode("live", "acct")).toBe(liveBroker);
    });
});