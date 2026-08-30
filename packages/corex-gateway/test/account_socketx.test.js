"use strict";

const { generateAccountId, generateUlid, parseAccountId } = require("../src/account/AccountId");
const { Account } = require("../src/account/Account");
const { InMemoryAccountRepository } = require("../src/account/InMemoryAccountRepository");
const { MessageEnvelope, REASON_CODES } = require("../src/socketx/MessageEnvelope");
const { SocketXConnection } = require("../src/socketx/SocketXConnection");
const { SocketXServer } = require("../src/socketx/SocketXServer");
const { RiskGateway } = require("../src/socketx/RiskGateway");
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

function _createToken(userId = "user_abc") {
    return signToken({ userId });
}

function _createHelloEnvelope({ accountId = "cx_pap_01HZX89K329RVTNABCDEF1234", role = "controller", mode = "paper", userId = "user_abc" }) {
    return JSON.stringify({
        schemaVersion: "1.0",
        messageId: `msg-${Date.now()}-${Math.random()}`,
        runtimeId: accountId,
        mode,
        timestamp: new Date().toISOString(),
        type: "command",
        payload: { action: "HELLO", accountId, role, authToken: _createToken(userId) },
    });
}

function _createBuyEnvelope({ accountId = "cx_pap_01HZX89K329RVTNABCDEF1234", symbol = "EURUSD", quantity = 1 }) {
    return JSON.stringify({
        schemaVersion: "1.0",
        messageId: `buy-${Date.now()}-${Math.random()}`,
        runtimeId: accountId,
        mode: "paper",
        timestamp: new Date().toISOString(),
        type: "command",
        payload: { action: "BUY", symbol, quantity, orderType: "market" },
    });
}

describe("AccountId", () => {
    test("generateUlid produces 26-char Crockford base32", () => {
        const ulid = generateUlid();
        expect(ulid.length).toBe(26);
        expect(ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    });

    test("generateAccountId produces cx_pap_ prefix for paper", () => {
        const id = generateAccountId("paper");
        expect(id.startsWith("cx_pap_")).toBe(true);
        expect(id.length).toBe(33);
    });

    test("generateAccountId produces cx_liv_ prefix for live", () => {
        const id = generateAccountId("live");
        expect(id.startsWith("cx_liv_")).toBe(true);
        expect(id.length).toBe(33);
    });

    test("parseAccountId validates correct paper ID", () => {
        const result = parseAccountId("cx_pap_01HZX89K329RVTNABCDEF1234");
        expect(result.valid).toBe(true);
        expect(result.type).toBe("paper");
        expect(result.ulid).toBe("01HZX89K329RVTNABCDEF1234");
    });

    test("parseAccountId validates correct live ID", () => {
        const result = parseAccountId("cx_liv_01HZX89K329RVTNABCDEF1234");
        expect(result.valid).toBe(true);
        expect(result.type).toBe("live");
    });

    test("parseAccountId rejects malformed IDs", () => {
        expect(parseAccountId("invalid").valid).toBe(false);
        expect(parseAccountId("cx_foo_01HZX89K329RVTNABCDEF1234").valid).toBe(false);
        expect(parseAccountId("cx_pap_short").valid).toBe(false);
        expect(parseAccountId("cx_pap_!!!invalid!!!").valid).toBe(false);
    });

    test("fast-reject prefix check works before DB", () => {
        const result = parseAccountId("bad_prefix_1234567890123456789012345");
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/must start with/);
    });
});

describe("Account model", () => {
    test("valid paper account passes validation", () => {
        const errors = Account.validate({ userId: "u1", type: "paper", label: "My Paper" });
        expect(errors).toEqual([]);
    });

    test("valid live account passes validation", () => {
        const errors = Account.validate({
            userId: "u1",
            type: "live",
            brokerBinding: { adapter: "metaapi", credentialRef: "ref1" },
        });
        expect(errors).toEqual([]);
    });

    test("paper account with brokerBinding fails", () => {
        const errors = Account.validate({
            userId: "u1",
            type: "paper",
            brokerBinding: { adapter: "metaapi", credentialRef: "ref1" },
        });
        expect(errors.length).toBeGreaterThan(0);
    });

    test("live account without brokerBinding fails", () => {
        const errors = Account.validate({ userId: "u1", type: "live" });
        expect(errors.length).toBeGreaterThan(0);
    });

    test("invalid type fails", () => {
        const errors = Account.validate({ userId: "u1", type: "invalid" });
        expect(errors.length).toBeGreaterThan(0);
    });

    test("missing userId fails", () => {
        const errors = Account.validate({ type: "paper" });
        expect(errors.length).toBeGreaterThan(0);
    });

    test("toJSON returns plain object", () => {
        const acc = new Account({ accountId: "cx_pap_01HZX89K329RVTNABCDEF1234", userId: "u1", type: "paper", label: "Test" });
        const json = acc.toJSON();
        expect(json.accountId).toBe("cx_pap_01HZX89K329RVTNABCDEF1234");
        expect(json.type).toBe("paper");
    });
});

describe("InMemoryAccountRepository", () => {
    test("create returns account with generated ID", async () => {
        const repo = new InMemoryAccountRepository();
        const result = await repo.create({ userId: "u1", type: "paper", label: "Test" });
        expect(result.ok).toBe(true);
        expect(result.account.accountId.startsWith("cx_pap_")).toBe(true);
        expect(result.account.userId).toBe("u1");
        expect(result.account.status).toBe("active");
    });

    test("enforces paper account limit", async () => {
        const repo = new InMemoryAccountRepository({ limits: { paper: 2, live: 1 } });
        await repo.create({ userId: "u1", type: "paper" });
        await repo.create({ userId: "u1", type: "paper" });
        const result = await repo.create({ userId: "u1", type: "paper" });
        expect(result.ok).toBe(false);
        expect(result.reasonCode).toBe("ACCOUNT_LIMIT_EXCEEDED");
    });

    test("enforces live account limit", async () => {
        const repo = new InMemoryAccountRepository({ limits: { paper: 10, live: 1 } });
        await repo.create({ userId: "u1", type: "live", brokerBinding: { adapter: "metaapi", credentialRef: "r1" } });
        const result = await repo.create({ userId: "u1", type: "live", brokerBinding: { adapter: "metaapi", credentialRef: "r2" } });
        expect(result.ok).toBe(false);
        expect(result.reasonCode).toBe("ACCOUNT_LIMIT_EXCEEDED");
    });

    test("listByUser returns only that user's accounts", async () => {
        const repo = new InMemoryAccountRepository();
        await repo.create({ userId: "u1", type: "paper" });
        await repo.create({ userId: "u2", type: "paper" });
        const list = await repo.listByUser("u1");
        expect(list.length).toBe(1);
        expect(list[0].userId).toBe("u1");
    });

    test("getByAccountId returns null for missing", async () => {
        const repo = new InMemoryAccountRepository();
        const result = await repo.getByAccountId("cx_pap_nonexistent0000000000000");
        expect(result).toBeNull();
    });

    test("archive changes status to archived", async () => {
        const repo = new InMemoryAccountRepository();
        const created = await repo.create({ userId: "u1", type: "paper" });
        const result = await repo.archive(created.account.accountId);
        expect(result.ok).toBe(true);
        expect(result.account.status).toBe("archived");
    });

    test("archive returns NOT_FOUND for missing account", async () => {
        const repo = new InMemoryAccountRepository();
        const result = await repo.archive("cx_pap_nonexistent0000000000000");
        expect(result.ok).toBe(false);
        expect(result.reasonCode).toBe("NOT_FOUND");
    });

    test("countByType returns active count", async () => {
        const repo = new InMemoryAccountRepository();
        await repo.create({ userId: "u1", type: "paper" });
        await repo.create({ userId: "u1", type: "paper" });
        await repo.create({ userId: "u1", type: "live", brokerBinding: { adapter: "metaapi", credentialRef: "r1" } });
        expect(await repo.countByType("u1", "paper")).toBe(2);
        expect(await repo.countByType("u1", "live")).toBe(1);
    });

    test("first account created for a user is auto-marked is_default = true", async () => {
        const repo = new InMemoryAccountRepository();
        const first = await repo.create({ userId: "u1", type: "paper" });
        expect(first.ok).toBe(true);
        expect(first.account.isDefault).toBe(true);
    });

    test("second account created for same user is not default", async () => {
        const repo = new InMemoryAccountRepository();
        await repo.create({ userId: "u1", type: "paper" });
        const second = await repo.create({ userId: "u1", type: "paper" });
        expect(second.ok).toBe(true);
        expect(second.account.isDefault).toBe(false);
    });

    test("getDefaultForUser returns the default account", async () => {
        const repo = new InMemoryAccountRepository();
        await repo.create({ userId: "u1", type: "paper" });
        await repo.create({ userId: "u1", type: "paper" });
        const defaultAcc = await repo.getDefaultForUser("u1", "paper");
        expect(defaultAcc).not.toBeNull();
        expect(defaultAcc.isDefault).toBe(true);
    });

    test("getDefaultForUser returns null when user has no accounts of that type", async () => {
        const repo = new InMemoryAccountRepository();
        await repo.create({ userId: "u1", type: "paper" });
        const result = await repo.getDefaultForUser("u1", "live");
        expect(result).toBeNull();
    });

    test("getDefaultForUser throws when accountType is omitted", async () => {
        const repo = new InMemoryAccountRepository();
        await repo.create({ userId: "u1", type: "paper" });
        await expect(repo.getDefaultForUser("u1")).rejects.toThrow("accountType is required");
    });

    test("getDefaultForUser throws when accountType is invalid", async () => {
        const repo = new InMemoryAccountRepository();
        await repo.create({ userId: "u1", type: "paper" });
        await expect(repo.getDefaultForUser("u1", "invalid")).rejects.toThrow("accountType is required");
    });

    test("getDefaultForUser returns correct default per type", async () => {
        const repo = new InMemoryAccountRepository();
        const paper = await repo.create({ userId: "u1", type: "paper" });
        const live = await repo.create({ userId: "u1", type: "live", brokerBinding: { adapter: "metaapi", credentialRef: "r1" } });
        const paperDefault = await repo.getDefaultForUser("u1", "paper");
        const liveDefault = await repo.getDefaultForUser("u1", "live");
        expect(paperDefault.accountId).toBe(paper.account.accountId);
        expect(liveDefault.accountId).toBe(live.account.accountId);
        expect(paperDefault.accountId).not.toBe(liveDefault.accountId);
    });

    test("setDefault changes which account is default", async () => {
        const repo = new InMemoryAccountRepository();
        const first = await repo.create({ userId: "u1", type: "paper" });
        const second = await repo.create({ userId: "u1", type: "paper" });
        expect(first.account.isDefault).toBe(true);
        expect(second.account.isDefault).toBe(false);

        const result = await repo.setDefault("u1", second.account.accountId);
        expect(result.ok).toBe(true);
        expect(result.account.isDefault).toBe(true);

        const newDefault = await repo.getDefaultForUser("u1", "paper");
        expect(newDefault.accountId).toBe(second.account.accountId);
    });

    test("setDefault on a live account does not change the paper default", async () => {
        const repo = new InMemoryAccountRepository();
        const paper1 = await repo.create({ userId: "u1", type: "paper" });
        const paper2 = await repo.create({ userId: "u1", type: "paper" });
        const live1 = await repo.create({ userId: "u1", type: "live", brokerBinding: { adapter: "metaapi", credentialRef: "r1" } });
        const live2 = await repo.create({ userId: "u1", type: "live", brokerBinding: { adapter: "metaapi", credentialRef: "r2" } });
        expect(paper1.account.isDefault).toBe(true);
        expect(paper2.account.isDefault).toBe(false);
        expect(live1.account.isDefault).toBe(true);
        expect(live2.account.isDefault).toBe(false);

        // Set a different live account as default.
        const result = await repo.setDefault("u1", live2.account.accountId);
        expect(result.ok).toBe(true);

        // Paper defaults must be untouched.
        const paperDefault = await repo.getDefaultForUser("u1", "paper");
        expect(paperDefault.accountId).toBe(paper1.account.accountId);
        const paper1Reload = await repo.getByAccountId(paper1.account.accountId);
        const paper2Reload = await repo.getByAccountId(paper2.account.accountId);
        expect(paper1Reload.isDefault).toBe(true);
        expect(paper2Reload.isDefault).toBe(false);

        // Live default changed.
        const liveDefault = await repo.getDefaultForUser("u1", "live");
        expect(liveDefault.accountId).toBe(live2.account.accountId);
    });

    test("setDefault returns NOT_FOUND for account belonging to different user", async () => {
        const repo = new InMemoryAccountRepository();
        const acc = await repo.create({ userId: "u1", type: "paper" });
        const result = await repo.setDefault("u2", acc.account.accountId);
        expect(result.ok).toBe(false);
        expect(result.reasonCode).toBe("NOT_FOUND");
    });
});

describe("MessageEnvelope new types", () => {
    test("ACK event factory works", () => {
        const ack = MessageEnvelope.ack({ runtimeId: "cx_pap_01HZX89K329RVTNABCDEF1234", mode: "paper", originalMessageId: "msg-123" });
        const json = ack.toJSON();
        expect(json.payload.eventType).toBe("ACK");
        expect(json.payload.originalMessageId).toBe("msg-123");
        expect(json.payload.status).toBe("RECEIVED");
    });

    test("FILL event includes originalMessageId", () => {
        const fill = MessageEnvelope.fill({
            runtimeId: "cx_pap_01HZX89K329RVTNABCDEF1234",
            mode: "paper",
            originalMessageId: "buy-456",
            orderId: "order-1",
            positionId: "pos-1",
            symbol: "EURUSD",
            side: "BUY",
            quantity: 1,
            fillPrice: 1.1050,
        });
        const json = fill.toJSON();
        expect(json.payload.eventType).toBe("FILL");
        expect(json.payload.originalMessageId).toBe("buy-456");
    });

    test("REASON_CODES includes new codes", () => {
        expect(REASON_CODES).toContain("BROKER_UNAUTHORIZED");
        expect(REASON_CODES).toContain("ACCOUNT_LIMIT_EXCEEDED");
        expect(REASON_CODES).toContain("ACCOUNT_DEGRADED");
        expect(REASON_CODES).toContain("NOT_FOUND");
        expect(REASON_CODES).toContain("VALIDATION_ERROR");
    });
});

describe("SocketXServer with account model", () => {
    test("HELLO with accountId resolves mode server-side", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const helloAck = calls.find((c) => c.payload.eventType === "HELLO_ACK");
        expect(helloAck).toBeDefined();
        expect(helloAck.runtimeId).toBe(accountId);
        expect(helloAck.mode).toBe("paper");
    });

    test("HELLO with live accountId resolves to live mode", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_liv_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const helloAck = calls.find((c) => c.payload.eventType === "HELLO_ACK");
        expect(helloAck.mode).toBe("live");
    });

    test("HELLO with malformed accountId rejected", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        socket._emit("message", _createHelloEnvelope({ accountId: "invalid_id", role: "controller" }));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject = calls.find((c) => c.payload.eventType === "REJECT");
        expect(reject).toBeDefined();
        expect(reject.payload.reasonCode).toBe("INVALID_ENVELOPE");
    });

    test("observer role cannot submit trading commands", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "observer" }));
        socket._emit("message", _createBuyEnvelope({ accountId }));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject = calls.find((c) => c.payload.reasonCode === "UNAUTHORIZED");
        expect(reject).toBeDefined();
        expect(reject.payload.reasonMessage).toMatch(/Observer/);
    });

    test("observer receives SNAPSHOT on connect", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "observer" }));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const snapshot = calls.find((c) => c.payload.eventType === "SNAPSHOT");
        expect(snapshot).toBeDefined();
    });

    test("two observers on same account both allowed", async () => {
        const server = new SocketXServer();
        const socket1 = _createMockSocket();
        const socket2 = _createMockSocket();
        server.handleConnection(socket1);
        server.handleConnection(socket2);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket1._emit("message", _createHelloEnvelope({ accountId, role: "observer" }));
        socket2._emit("message", _createHelloEnvelope({ accountId, role: "observer" }));

        const calls1 = socket1.send.mock.calls.map((c) => JSON.parse(c[0]));
        const calls2 = socket2.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject1 = calls1.find((c) => c.payload.reasonCode === "RATE_LIMITED");
        const reject2 = calls2.find((c) => c.payload.reasonCode === "RATE_LIMITED");
        expect(reject1).toBeUndefined();
        expect(reject2).toBeUndefined();
    });

    test("controller and observer coexist on same account", async () => {
        const server = new SocketXServer();
        const ctrlSocket = _createMockSocket();
        const obsSocket = _createMockSocket();
        server.handleConnection(ctrlSocket);
        server.handleConnection(obsSocket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        ctrlSocket._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));
        obsSocket._emit("message", _createHelloEnvelope({ accountId, role: "observer" }));

        const ctrlCalls = ctrlSocket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const obsCalls = obsSocket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const ctrlAck = ctrlCalls.find((c) => c.payload.eventType === "HELLO_ACK");
        const obsAck = obsCalls.find((c) => c.payload.eventType === "HELLO_ACK");
        expect(ctrlAck).toBeDefined();
        expect(obsAck).toBeDefined();
    });

    test("ACK arrives before FILL in BUY round trip", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        const buyData = JSON.parse(_createBuyEnvelope({ accountId }));
        const buyMessageId = buyData.messageId;

        RiskGateway.registerBroker(accountId, {
            handle: jest.fn().mockResolvedValue({
                status: "FILLED",
                orderId: "order-123",
                avgFillPrice: 1.1050,
            }),
            initialize: jest.fn().mockResolvedValue(),
        });

        socket._emit("message", JSON.stringify(buyData));

        await new Promise((r) => setTimeout(r, 100));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const ackIndex = calls.findIndex((c) => c.payload.eventType === "ACK");
        const fillIndex = calls.findIndex((c) => c.payload.eventType === "FILL");
        expect(ackIndex).toBeGreaterThanOrEqual(0);
        expect(fillIndex).toBeGreaterThan(ackIndex);

        const ack = calls[ackIndex];
        expect(ack.payload.originalMessageId).toBe(buyMessageId);

        const fill = calls[fillIndex];
        expect(fill.payload.originalMessageId).toBe(buyMessageId);
        expect(fill.payload.symbol).toBe("EURUSD");
    });

    test("BROKER_UNAUTHORIZED does not tear down connection or release controller", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        RiskGateway.registerBroker(accountId, {
            handle: jest.fn().mockRejectedValue(new Error("401 Unauthorized: token expired")),
            initialize: jest.fn().mockResolvedValue(),
        });

        socket._emit("message", _createBuyEnvelope({ accountId }));

        await new Promise((r) => setTimeout(r, 100));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject = calls.find((c) => c.payload.reasonCode === "BROKER_UNAUTHORIZED");
        expect(reject).toBeDefined();

        expect(server.runtimeIdClaims.has(accountId)).toBe(true);
        expect(socket.close).not.toHaveBeenCalled();
    });

    test("controller exclusivity: second controller rejected", async () => {
        const server = new SocketXServer();
        const socket1 = _createMockSocket();
        const socket2 = _createMockSocket();
        server.handleConnection(socket1);
        server.handleConnection(socket2);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket1._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));
        socket2._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        const calls2 = socket2.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject = calls2.find((c) => c.payload.reasonCode === "SESSION_CONFLICT");
        expect(reject).toBeDefined();
    });

    test("accountResolver used when provided", async () => {
        const accountResolver = jest.fn().mockResolvedValue({ type: "live", userId: "user_abc" });
        const server = new SocketXServer({ accountResolver });
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_liv_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        await new Promise((r) => setTimeout(r, 50));

        expect(accountResolver).toHaveBeenCalledWith(accountId);
        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const helloAck = calls.find((c) => c.payload.eventType === "HELLO_ACK");
        expect(helloAck.mode).toBe("live");
    });

    test("accountResolver returning null rejects connection", async () => {
        const accountResolver = jest.fn().mockResolvedValue(null);
        const server = new SocketXServer({ accountResolver });
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        await new Promise((r) => setTimeout(r, 50));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject = calls.find((c) => c.payload.reasonCode === "NOT_FOUND");
        expect(reject).toBeDefined();
    });
});

describe("Portfolio-level risk enforcement", () => {
    test("sequence exceeding drawdown limit gets rejected", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        let drawdownTriggered = false;
        const mockBroker = {
            handle: jest.fn().mockResolvedValue({ status: "FILLED", orderId: "o1", avgFillPrice: 1.1 }),
            initialize: jest.fn().mockResolvedValue(),
            getEquity: jest.fn().mockReturnValue(800),
            getPositionSnapshot: jest.fn().mockReturnValue({ side: "FLAT" }),
            initialCash: 1000,
            config: { maxDrawdownPct: 10 },
        };

        RiskGateway.registerBroker(accountId, mockBroker);

        for (let i = 0; i < 3; i++) {
            socket._emit("message", _createBuyEnvelope({ accountId, quantity: 1 }));
            await new Promise((r) => setTimeout(r, 50));
        }

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const riskReject = calls.find((c) => c.payload.reasonCode === "RISK_LIMIT_EXCEEDED");
        if (riskReject) drawdownTriggered = true;

        expect(drawdownTriggered).toBe(true);
    });
});

describe("Account ownership verification", () => {
    test("HELLO with accountId belonging to different user is rejected", async () => {
        const accountResolver = jest.fn().mockResolvedValue({
            type: "paper",
            userId: "user_xyz",
        });
        const server = new SocketXServer({ accountResolver });
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        const token = _createToken("user_abc");
        socket._emit("message", JSON.stringify({
            schemaVersion: "1.0",
            messageId: `msg-${Date.now()}`,
            runtimeId: accountId,
            mode: "paper",
            timestamp: new Date().toISOString(),
            type: "command",
            payload: { action: "HELLO", accountId, role: "controller", authToken: token },
        }));

        await new Promise((r) => setTimeout(r, 50));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject = calls.find((c) => c.payload.reasonCode === "UNAUTHORIZED");
        expect(reject).toBeDefined();
        expect(reject.payload.reasonMessage).toMatch(/does not belong/);
    });

    test("HELLO without authToken is rejected", async () => {
        const accountResolver = jest.fn().mockResolvedValue({
            type: "paper",
            userId: "user_abc",
        });
        const server = new SocketXServer({ accountResolver });
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", JSON.stringify({
            schemaVersion: "1.0",
            messageId: `msg-${Date.now()}`,
            runtimeId: accountId,
            mode: "paper",
            timestamp: new Date().toISOString(),
            type: "command",
            payload: { action: "HELLO", accountId, role: "controller" },
        }));

        await new Promise((r) => setTimeout(r, 50));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const reject = calls.find((c) => c.payload.reasonCode === "UNAUTHORIZED");
        expect(reject).toBeDefined();
    });
});

describe("Connection lifecycle operations", () => {
    test("CLOSE releases claim and closes socket", async () => {
        const server = new SocketXServer();
        const socket1 = _createMockSocket();
        server.handleConnection(socket1);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket1._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        expect(server.runtimeIdClaims.has(accountId)).toBe(true);

        socket1._emit("message", JSON.stringify({
            schemaVersion: "1.0",
            messageId: "close-1",
            runtimeId: accountId,
            mode: "paper",
            timestamp: new Date().toISOString(),
            type: "command",
            payload: { action: "CLOSE" },
        }));

        await new Promise((r) => setTimeout(r, 50));
        expect(server.runtimeIdClaims.has(accountId)).toBe(false);

        const socket2 = _createMockSocket();
        server.handleConnection(socket2);
        socket2._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        await new Promise((r) => setTimeout(r, 50));
        const calls2 = socket2.send.mock.calls.map((c) => JSON.parse(c[0]));
        const helloAck = calls2.find((c) => c.payload.eventType === "HELLO_ACK");
        expect(helloAck).toBeDefined();
    });

    test("PAUSE blocks BUY commands but retains claim", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        socket._emit("message", JSON.stringify({
            schemaVersion: "1.0",
            messageId: "pause-1",
            runtimeId: accountId,
            mode: "paper",
            timestamp: new Date().toISOString(),
            type: "command",
            payload: { action: "PAUSE" },
        }));

        socket._emit("message", _createBuyEnvelope({ accountId }));

        await new Promise((r) => setTimeout(r, 50));
        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const pausedReject = calls.find((c) => c.payload.reasonCode === "CONNECTION_PAUSED");
        expect(pausedReject).toBeDefined();

        expect(server.runtimeIdClaims.has(accountId)).toBe(true);

        const socket2 = _createMockSocket();
        server.handleConnection(socket2);
        socket2._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        await new Promise((r) => setTimeout(r, 50));
        const calls2 = socket2.send.mock.calls.map((c) => JSON.parse(c[0]));
        const conflict = calls2.find((c) => c.payload.reasonCode === "SESSION_CONFLICT");
        expect(conflict).toBeDefined();
    });

    test("RESUME allows commands again", async () => {
        const server = new SocketXServer();
        const socket = _createMockSocket();
        server.handleConnection(socket);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        socket._emit("message", _createHelloEnvelope({ accountId, role: "controller" }));

        socket._emit("message", JSON.stringify({
            schemaVersion: "1.0",
            messageId: "pause-1",
            runtimeId: accountId,
            mode: "paper",
            timestamp: new Date().toISOString(),
            type: "command",
            payload: { action: "PAUSE" },
        }));

        socket._emit("message", JSON.stringify({
            schemaVersion: "1.0",
            messageId: "resume-1",
            runtimeId: accountId,
            mode: "paper",
            timestamp: new Date().toISOString(),
            type: "command",
            payload: { action: "RESUME" },
        }));

        RiskGateway.registerBroker(accountId, {
            handle: jest.fn().mockResolvedValue({ status: "FILLED", orderId: "o1", avgFillPrice: 1.1 }),
            initialize: jest.fn().mockResolvedValue(),
        });

        socket._emit("message", _createBuyEnvelope({ accountId }));
        await new Promise((r) => setTimeout(r, 50));

        const calls = socket.send.mock.calls.map((c) => JSON.parse(c[0]));
        const fill = calls.find((c) => c.payload.eventType === "FILL");
        expect(fill).toBeDefined();
    });
});