"use strict";

const { SocketXServer } = require("../src/socketx/SocketXServer");
const { MessageEnvelope } = require("../src/socketx/MessageEnvelope");
const { signToken } = require("../../corex-auth/src/AuthService");

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

function _createHelloEnvelope({ accountId = "cx_pap_01HZX89K329RVTNABCDEF1234", role = "controller", mode = "paper", authToken = null }) {
    return JSON.stringify({
        schemaVersion: "1.0",
        messageId: `msg-${Date.now()}-${Math.random()}`,
        runtimeId: accountId,
        mode,
        timestamp: new Date().toISOString(),
        type: "command",
        payload: { action: "HELLO", accountId, role, authToken },
    });
}

describe("SocketXServer auth verifier injection", () => {
    afterEach(() => {
        SocketXServer.setAuthVerifier(null);
    });

    test("setAuthVerifier stores the verifier function", () => {
        const verifier = jest.fn().mockReturnValue({ ok: true, userId: "user_abc" });
        SocketXServer.setAuthVerifier(verifier);
        expect(SocketXServer._authVerifier).toBe(verifier);
    });

    test("HELLO uses injected verifier to authenticate", async () => {
        const verifier = jest.fn().mockReturnValue({ ok: true, userId: "user_abc" });
        SocketXServer.setAuthVerifier(verifier);

        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const token = signToken({ userId: "user_abc" });
        socket._emit("message", _createHelloEnvelope({ authToken: token }));
        await new Promise((r) => setTimeout(r, 50));

        expect(verifier).toHaveBeenCalledWith(token);

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const helloAck = calls.find((c) => c.payload.eventType === "HELLO_ACK");
        expect(helloAck).toBeDefined();
    });

    test("HELLO rejects when injected verifier returns not-ok", async () => {
        const verifier = jest.fn().mockReturnValue({ ok: false, error: "TOKEN_EXPIRED" });
        SocketXServer.setAuthVerifier(verifier);

        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        socket._emit("message", _createHelloEnvelope({ authToken: "bad-token" }));
        await new Promise((r) => setTimeout(r, 50));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject = calls.find((c) => c.payload.eventType === "REJECT");
        expect(reject).toBeDefined();
        expect(reject.payload.reasonCode).toBe("UNAUTHORIZED");
        expect(reject.payload.reasonMessage).toContain("TOKEN_EXPIRED");
    });

    test("HELLO with no verifier in test environment uses fallback and warns", async () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        SocketXServer.setAuthVerifier(null);

        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const token = signToken({ userId: "user_abc" });
        socket._emit("message", _createHelloEnvelope({ authToken: token }));
        await new Promise((r) => setTimeout(r, 50));

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("No auth verifier injected")
        );

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const helloAck = calls.find((c) => c.payload.eventType === "HELLO_ACK");
        expect(helloAck).toBeDefined();

        warnSpy.mockRestore();
    });

    test("HELLO with no verifier in production throws", async () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        SocketXServer.setAuthVerifier(null);

        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        socket._emit("message", _createHelloEnvelope({ authToken: "some-token" }));
        await new Promise((r) => setTimeout(r, 50));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject = calls.find((c) => c.payload.eventType === "REJECT");
        expect(reject).toBeDefined();
        expect(reject.payload.reasonCode).toBe("UNAUTHORIZED");

        process.env.NODE_ENV = originalEnv;
    });

    test("default fallback verifier extracts userId from valid JWT", () => {
        const token = signToken({ userId: "user_xyz" });
        const result = SocketXServer._defaultVerifyToken(token);
        expect(result).toEqual({ ok: true, userId: "user_xyz" });
    });

    test("default fallback verifier returns error for missing token", () => {
        const result = SocketXServer._defaultVerifyToken(null);
        expect(result).toEqual({ ok: false, error: "TOKEN_MISSING" });
    });

    test("default fallback verifier returns error for invalid JWT", () => {
        const result = SocketXServer._defaultVerifyToken("not.a.jwt");
        expect(result.ok).toBe(false);
        expect(result.error).toBeDefined();
    });

    test("default fallback verifier returns error for JWT without userId", () => {
        const token = signToken({ something: "else" });
        const result = SocketXServer._defaultVerifyToken(token);
        expect(result).toEqual({ ok: false, error: "TOKEN_NO_USER" });
    });

    test("injected verifier takes precedence over default fallback", () => {
        const token = signToken({ userId: "real_user" });
        const injectedVerifier = jest.fn().mockReturnValue({ ok: true, userId: "injected_user" });
        SocketXServer.setAuthVerifier(injectedVerifier);

        const result = SocketXServer._verifyToken(token);
        expect(result).toEqual({ ok: true, userId: "injected_user" });
        expect(injectedVerifier).toHaveBeenCalledWith(token);
    });
});
