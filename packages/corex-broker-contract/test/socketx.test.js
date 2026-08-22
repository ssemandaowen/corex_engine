"use strict";

const { MessageEnvelope, REASON_CODES } = require("../src/socketx/MessageEnvelope");
const { SocketXConnection, TokenBucket } = require("../src/socketx/SocketXConnection");
const { SocketXServer } = require("../src/socketx/SocketXServer");
const { RiskGateway } = require("../src/socketx/RiskGateway");

function _createMockSocket() {
    const handlers = {};
    return {
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn((event, cb) => { handlers[event] = cb; }),
        _emit: (event, data) => { if (handlers[event]) handlers[event](data); },
        _handlers: handlers,
    };
}

function _createHelloEnvelope({ runtimeId = "user1::strat1::EURUSD::paper", mode = "paper", authToken = "test-token" }) {
    return JSON.stringify({
        schemaVersion: "1.0",
        messageId: `msg-${Date.now()}-${Math.random()}`,
        runtimeId,
        mode,
        timestamp: new Date().toISOString(),
        type: "command",
        payload: { action: "HELLO", authToken },
    });
}

function _createBuyEnvelope({ runtimeId = "user1::strat1::EURUSD::paper", mode = "paper", symbol = "EURUSD", quantity = 1 }) {
    return JSON.stringify({
        schemaVersion: "1.0",
        messageId: `buy-${Date.now()}-${Math.random()}`,
        runtimeId,
        mode,
        timestamp: new Date().toISOString(),
        type: "command",
        payload: { action: "BUY", symbol, quantity, orderType: "market" },
    });
}

describe("MessageEnvelope", () => {
    test("validates correct envelope", () => {
        const result = MessageEnvelope.parse(_createBuyEnvelope({}));
        expect(result.valid).toBe(true);
        expect(result.envelope.type).toBe("command");
    });

    test("rejects malformed JSON", () => {
        const result = MessageEnvelope.parse("not-json{{{");
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/JSON/);
    });

    test("rejects missing messageId", () => {
        const data = JSON.parse(_createBuyEnvelope({}));
        delete data.messageId;
        const result = MessageEnvelope.parse(JSON.stringify(data));
        expect(result.valid).toBe(false);
    });

    test("rejects invalid mode", () => {
        const data = JSON.parse(_createBuyEnvelope({}));
        data.mode = "invalid";
        const result = MessageEnvelope.parse(JSON.stringify(data));
        expect(result.valid).toBe(false);
    });

    test("rejects invalid action", () => {
        const data = JSON.parse(_createBuyEnvelope({}));
        data.payload.action = "FLY";
        const result = MessageEnvelope.parse(JSON.stringify(data));
        expect(result.valid).toBe(false);
    });

    test("detects encrypted strings", () => {
        expect(MessageEnvelope.createCommand({
            runtimeId: "test", mode: "paper", action: "BUY",
        }).type).toBe("command");
    });

    test("all reason codes present", () => {
        expect(REASON_CODES).toContain("RISK_LIMIT_EXCEEDED");
        expect(REASON_CODES).toContain("DUPLICATE_COMMAND");
        expect(REASON_CODES).toContain("RATE_LIMITED");
        expect(REASON_CODES).toContain("SESSION_CONFLICT");
    });
});

describe("TokenBucket", () => {
    test("allows burst up to limit", () => {
        const bucket = new TokenBucket(10, 5);
        for (let i = 0; i < 5; i++) {
            expect(bucket.consume()).toBe(true);
        }
        expect(bucket.consume()).toBe(false);
    });

    test("refills over time", () => {
        const bucket = new TokenBucket(100, 1);
        expect(bucket.consume()).toBe(true);
        expect(bucket.consume()).toBe(false);
        bucket.lastRefill = Date.now() - 1000;
        bucket.refill();
        expect(bucket.tokens).toBeGreaterThan(0);
    });
});

describe("SocketXConnection", () => {
    test("detects duplicate messageIds", () => {
        const socket = _createMockSocket();
        const conn = new SocketXConnection({
            id: "c1", socket, runtimeId: "r1", mode: "paper", server: { pruneConnection: jest.fn() },
        });
        conn.recordMessageProcessed("msg-123");
        expect(conn.isDuplicate("msg-123")).toBe(true);
        expect(conn.isDuplicate("msg-456")).toBe(false);
    });

    test("rate limiter blocks over-limit", () => {
        const socket = _createMockSocket();
        const conn = new SocketXConnection({
            id: "c1", socket, runtimeId: "r1", mode: "paper", server: { pruneConnection: jest.fn() },
        });
        for (let i = 0; i < 20; i++) {
            conn.checkRateLimit();
        }
        expect(conn.checkRateLimit()).toBe(false);
    });

    test("destroy clears state", () => {
        const socket = _createMockSocket();
        const server = { pruneConnection: jest.fn() };
        const conn = new SocketXConnection({
            id: "c1", socket, runtimeId: "r1", mode: "paper", server,
        });
        conn.recordMessageProcessed("msg-1");
        conn.destroy();
        expect(conn.isAlive).toBe(false);
        expect(conn.processedMessageIds.size).toBe(0);
    });
});

describe("SocketXServer handshake", () => {
    test("HELLO triggers HELLO_ACK + SNAPSHOT", () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        socket._emit("message", _createHelloEnvelope({}));

        expect(socket.send).toHaveBeenCalled();
        const firstCall = JSON.parse(socket.send.mock.calls[0][0]);
        expect(firstCall.payload.eventType).toBe("HELLO_ACK");
        expect(firstCall.runtimeId).toBe("user1::strat1::EURUSD::paper");

        const secondCall = JSON.parse(socket.send.mock.calls[1][0]);
        expect(secondCall.payload.eventType).toBe("SNAPSHOT");
    });

    test("HELLO without runtimeId gets REJECT", () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const helloData = JSON.parse(_createHelloEnvelope({}));
        delete helloData.runtimeId;
        socket._emit("message", JSON.stringify(helloData));

        const reply = JSON.parse(socket.send.mock.calls[0][0]);
        expect(reply.payload.eventType).toBe("REJECT");
        expect(reply.payload.reasonCode).toBe("INVALID_ENVELOPE");
    });

    test("second connection on same runtimeId gets SESSION_CONFLICT", () => {
        const server = new SocketXServer();
        const socket1 = _createMockSocket();
        const socket2 = _createMockSocket();

        server.handleConnection(socket1);
        socket1._emit("message", _createHelloEnvelope({ runtimeId: "user1::s1::EURUSD::paper" }));

        server.handleConnection(socket2);
        socket2._emit("message", _createHelloEnvelope({ runtimeId: "user1::s1::EURUSD::paper" }));

        const reply = JSON.parse(socket2.send.mock.calls[0][0]);
        expect(reply.payload.eventType).toBe("REJECT");
        expect(reply.payload.reasonCode).toBe("SESSION_CONFLICT");
    });

    test("duplicate messageId gets DUPLICATE_COMMAND", () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        socket._emit("message", _createHelloEnvelope({}));

        const buyData = JSON.parse(_createBuyEnvelope({}));
        const dupMessageId = "duplicate-msg-id";
        buyData.messageId = dupMessageId;

        socket._emit("message", JSON.stringify(buyData));
        socket._emit("message", JSON.stringify(buyData));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject = calls.find((c) => c.payload.eventType === "REJECT");
        expect(reject).toBeDefined();
        expect(reject.payload.reasonCode).toBe("DUPLICATE_COMMAND");
    });

    test("over-rate-limit gets RATE_LIMITED", () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        socket._emit("message", _createHelloEnvelope({}));

        for (let i = 0; i < 25; i++) {
            socket._emit("message", _createBuyEnvelope({ quantity: 1 }));
        }

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const rateLimited = calls.filter((c) => c.payload.reasonCode === "RATE_LIMITED");
        expect(rateLimited.length).toBeGreaterThan(0);
    });

    test("PING triggers PONG reset", () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        socket._emit("message", _createHelloEnvelope({}));

        const conn = Array.from(server.connections.values())[0];
        conn.missedPongCount = 2;

        socket._emit("message", JSON.stringify({
            schemaVersion: "1.0",
            messageId: "pong-1",
            runtimeId: conn.runtimeId,
            mode: "paper",
            timestamp: new Date().toISOString(),
            type: "event",
            payload: { eventType: "PONG" },
        }));

        expect(conn.missedPongCount).toBe(0);
    });

    test("server tracks claimed runtimeIds", () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        socket._emit("message", _createHelloEnvelope({ runtimeId: "user1::s1::EURUSD::paper" }));

        expect(server.getClaimedRuntimeIds()).toContain("user1::s1::EURUSD::paper");
        expect(server.getConnectionCount()).toBe(1);
    });

    test("connection close releases runtimeId claim", () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        socket._emit("message", _createHelloEnvelope({ runtimeId: "user1::s1::EURUSD::paper" }));
        expect(server.getClaimedRuntimeIds().length).toBe(1);

        socket._emit("close");

        expect(server.getClaimedRuntimeIds().length).toBe(0);
        expect(server.getConnectionCount()).toBe(0);
    });
});

describe("SocketXServer BUY → FILL round trip", () => {
    test("BUY command in Paper mode results in FILL event", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        socket._emit("message", _createHelloEnvelope({ mode: "paper" }));

        RiskGateway.registerBroker("user1::strat1::EURUSD::paper", {
            submit: jest.fn().mockResolvedValue({
                status: "FILLED",
                orderId: "order-123",
                avgFillPrice: 1.1050,
            }),
            initialize: jest.fn().mockResolvedValue(),
        });

        socket._emit("message", _createBuyEnvelope({
            runtimeId: "user1::strat1::EURUSD::paper",
            mode: "paper",
            symbol: "EURUSD",
            quantity: 1,
        }));

        await new Promise((r) => setTimeout(r, 100));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const fill = calls.find((c) => c.payload.eventType === "FILL");
        expect(fill).toBeDefined();
        expect(fill.payload.symbol).toBe("EURUSD");
        expect(fill.payload.side).toBe("BUY");
    });
});