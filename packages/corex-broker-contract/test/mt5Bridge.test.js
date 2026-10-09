"use strict";

jest.mock("ws");

const { bus, EVENTS } = require("@events/bus");
const mt5Bridge = require("../src/mt5Bridge");

describe("MT5Bridge", () => {
    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test("constructor initializes with empty state", () => {
        expect(mt5Bridge.wss).toBeNull();
        expect(mt5Bridge.clients.size).toBe(0);
        expect(mt5Bridge.pending.size).toBe(0);
        expect(mt5Bridge.accountSnapshot).toBeNull();
        expect(mt5Bridge.positions).toEqual([]);
    });

    test("runtimeConfig is initialized from env vars", () => {
        const config = mt5Bridge.getStatus().runtime;
        expect(config).toHaveProperty("bridgeToken");
        expect(config).toHaveProperty("httpToken");
        expect(config).toHaveProperty("host");
        expect(config).toHaveProperty("port");
        expect(config).toHaveProperty("heartbeatMs");
        expect(typeof config.heartbeatMs).toBe("number");
    });

    test("getStatus returns correct shape", () => {
        const status = mt5Bridge.getStatus();
        expect(status).toHaveProperty("connected");
        expect(status).toHaveProperty("authorized");
        expect(status).toHaveProperty("lastHeartbeat");
        expect(status).toHaveProperty("lastAuthFailure");
        expect(status).toHaveProperty("clients");
        expect(status).toHaveProperty("authorizedClients");
        expect(status).toHaveProperty("pending");
        expect(status).toHaveProperty("receivers");
        expect(status).toHaveProperty("runtime");
        expect(status.connected).toBe(false);
    });

    test("isConnected returns false initially", () => {
        expect(mt5Bridge.isConnected()).toBe(false);
    });

    test("applyRuntimeConfig merges config", () => {
        const before = { ...mt5Bridge.getStatus().runtime };
        mt5Bridge.applyRuntimeConfig({ bridgeToken: "new_token_123", host: "10.0.0.1" });
        const after = mt5Bridge.getStatus().runtime;
        expect(after.bridgeToken).toBe("new_token_123");
        expect(after.host).toBe("10.0.0.1");
        expect(after.httpToken).toBe(before.httpToken);
    });

    test("applyRuntimeConfig ignores non-object input", () => {
        const before = { ...mt5Bridge.getStatus().runtime };
        mt5Bridge.applyRuntimeConfig(null);
        const after = mt5Bridge.getStatus().runtime;
        expect(after).toEqual(before);
    });

    test("_normalizeOrderResultStatus returns payload status when present", () => {
        const result = mt5Bridge._normalizeOrderResultStatus({ ok: true, payload: { status: "filled" } });
        expect(result).toBe("FILLED");
    });

    test("_normalizeOrderResultStatus returns FILLED when ok and no payload status", () => {
        const result = mt5Bridge._normalizeOrderResultStatus({ ok: true });
        expect(result).toBe("FILLED");
    });

    test("_normalizeOrderResultStatus returns REJECTED when not ok", () => {
        const result = mt5Bridge._normalizeOrderResultStatus({ ok: false });
        expect(result).toBe("REJECTED");
    });

    test("getAccountSnapshot returns stored snapshot", () => {
        expect(mt5Bridge.getAccountSnapshot()).toBeNull();
        mt5Bridge.accountSnapshot = { balance: 50000, equity: 50000 };
        expect(mt5Bridge.getAccountSnapshot()).toEqual({ balance: 50000, equity: 50000 });
        mt5Bridge.accountSnapshot = null;
    });

    test("getPositions returns stored positions array", () => {
        const testPositions = [{ symbol: "EURUSD", volume: 1 }];
        mt5Bridge.positions = testPositions;
        expect(mt5Bridge.getPositions()).toEqual(testPositions);
        mt5Bridge.positions = [];
    });

    test("_isAuthorized returns false for unknown ws", () => {
        expect(mt5Bridge._isAuthorized({})).toBe(false);
    });

    test("_pickAuthorizedClient returns null when no authorized clients", () => {
        expect(mt5Bridge._pickAuthorizedClient({})).toBeNull();
    });

    test("_rejectPending rejects all pending with error", () => {
        const mockReject = jest.fn();
        mt5Bridge.pending.set("req1", { resolve: jest.fn(), reject: mockReject, timeout: setTimeout(() => {}, 999999) });
        mt5Bridge._rejectPending("TEST_ERROR");
        expect(mockReject).toHaveBeenCalledWith(new Error("TEST_ERROR"));
        expect(mt5Bridge.pending.size).toBe(0);
    });

    test("stop() cleans up all state", () => {
        mt5Bridge.clients.add({ terminate: jest.fn() });
        mt5Bridge.pending.set("req1", { timeout: setTimeout(() => {}, 999999) });
        mt5Bridge.stop();
        expect(mt5Bridge.clients.size).toBe(0);
        expect(mt5Bridge.pending.size).toBe(0);
    });

    test("initServer creates WebSocket.Server", () => {
        const WebSocket = require("ws");
        mt5Bridge.wss = null;
        mt5Bridge.initServer();
        expect(mt5Bridge.wss).not.toBeNull();
    });

    test("_audit does not crash when db has no config", () => {
        // No db injected (this._db === null) — _audit must no-op.
        mt5Bridge.configure({ db: null });
        expect(() => mt5Bridge._audit("IN", { test: "data" }, "order123")).not.toThrow();

        // db injected but hasDbConfig() === false — _audit must no-op.
        const fakeDb = { hasDbConfig: () => false, query: jest.fn(), withTransaction: jest.fn() };
        mt5Bridge.configure({ db: fakeDb });
        expect(() => mt5Bridge._audit("IN", { test: "data" }, "order123")).not.toThrow();
        expect(fakeDb.query).not.toHaveBeenCalled();
    });

    test("_audit writes a row when db is configured", async () => {
        const fakeQuery = jest.fn().mockResolvedValue({ rowCount: 1 });
        const fakeDb = { hasDbConfig: () => true, query: fakeQuery, withTransaction: jest.fn() };
        mt5Bridge.configure({ db: fakeDb });
        mt5Bridge._audit("IN", { test: "data" }, "order123");
        // _audit fires the query without awaiting; flush the microtask queue.
        await new Promise((r) => setImmediate(r));
        expect(fakeQuery.mock.calls.length).toBeGreaterThan(0);
        const call = fakeQuery.mock.calls[0];
        expect(call[0]).toContain("INSERT INTO mt5_messages");
        expect(call[1][0]).toBe("order123");
        expect(call[1][1]).toBe("IN");
        expect(typeof call[1][2]).toBe("string");
    });
});
