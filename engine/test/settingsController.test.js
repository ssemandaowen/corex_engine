"use strict";

jest.mock("@core/services/postgres", () => ({ query: jest.fn() }));
jest.mock("@core/services/pgStore", () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock("@core/services/historicalCache", () => ({ get: jest.fn(), set: jest.fn(), invalidate: jest.fn() }));

const mockGetConnectorConfig = jest.fn();
const mockListForUser = jest.fn(() => [
    { connectorType: "twelvedata", schema: {} },
    { connectorType: "metaapi", schema: {} },
]);
const mockGetSchema = jest.fn((t) => (t === "metaapi" ? { config: {}, secrets: ["token"] } : null));
const mockGetPublicConfig = jest.fn();

jest.mock("@core/services/connectorSettingsService", () => ({
    getConnectorConfig: (...args) => mockGetConnectorConfig(...args),
    listForUser: (...args) => mockListForUser(...args),
    getSchema: (...args) => mockGetSchema(...args),
    getPublicConfig: (...args) => mockGetPublicConfig(...args),
    saveConnectorConfig: jest.fn(),
}));

const mockGetDefaultForUser = jest.fn();
jest.mock("../../packages/corex-gateway/src/account/TradingAccountRepository", () => ({
    TradingAccountRepository: jest.fn(() => ({
        getDefaultForUser: (userId, mode) => mockGetDefaultForUser(userId, mode),
    })),
}));

// Capture the convenience route handler by inspecting the exported router stack.
const settingsController = require("../routes/settingsController");
const convenienceRoute = settingsController.stack.find(
    (l) => l.route && l.route.path === "/connectors/:type" && l.route.methods.get
);

function makeReqRes({ query = {}, params = {}, user = { sub: "u1" } } = {}) {
    const req = { query, params, user, body: {} };
    let capturedStatus = 200;
    const res = {
        status(code) { capturedStatus = code; return this; },
        json(body) { return { status: capturedStatus, body }; },
    };
    // Wrap res.json to capture synchronously
    let result = null;
    res.json = (body) => { result = { status: capturedStatus, body }; return result; };
    return { req, res, getResult: () => result, getStatus: () => capturedStatus };
}

describe("settingsController GET /connectors/:type convenience route", () => {
    beforeEach(() => {
        mockGetConnectorConfig.mockReset();
        mockGetPublicConfig.mockReset();
        mockGetDefaultForUser.mockReset();
    });

    test("route is registered", () => {
        expect(convenienceRoute).toBeDefined();
    });

    test("returns 400 when ?mode= is missing", async () => {
        const { req, res, getResult } = makeReqRes({ params: { type: "metaapi" } });
        await convenienceRoute.route.stack[0].handle(req, res);
        const r = getResult();
        expect(r.status).toBe(400);
        expect(r.body.error).toBe("mode query param required (paper|live)");
    });

    test("returns 400 when ?mode= is invalid", async () => {
        const { req, res, getResult } = makeReqRes({ params: { type: "metaapi" }, query: { mode: "backtest" } });
        await convenienceRoute.route.stack[0].handle(req, res);
        const r = getResult();
        expect(r.status).toBe(400);
        expect(r.body.error).toBe("mode query param required (paper|live)");
    });

    test("passes mode through to getDefaultForUser as accountType", async () => {
        mockGetDefaultForUser.mockResolvedValue({ accountId: "cx_pap_abc123" });
        mockGetConnectorConfig.mockResolvedValue({ config: {}, secrets: {} });
        const { req, res, getResult } = makeReqRes({ params: { type: "metaapi" }, query: { mode: "paper" } });
        await convenienceRoute.route.stack[0].handle(req, res);
        const r = getResult();
        expect(r.status).toBe(200);
        expect(mockGetDefaultForUser).toHaveBeenCalledWith("u1", "paper");
    });

    test("?mode=paper and ?mode=live return different connector configs", async () => {
        mockGetDefaultForUser.mockImplementation((userId, mode) =>
            Promise.resolve(mode === "paper" ? { accountId: "cx_pap_abc" } : { accountId: "cx_liv_xyz" })
        );
        mockGetConnectorConfig.mockImplementation((accountId) =>
            Promise.resolve({ config: { accountId }, secrets: { token: accountId === "cx_pap_abc" ? "paper-token" : "live-token" } })
        );
        const paper = makeReqRes({ params: { type: "metaapi" }, query: { mode: "paper" } });
        const live = makeReqRes({ params: { type: "metaapi" }, query: { mode: "live" } });
        await convenienceRoute.route.stack[0].handle(paper.req, paper.res);
        await convenienceRoute.route.stack[0].handle(live.req, live.res);
        const paperR = paper.getResult();
        const liveR = live.getResult();
        expect(paperR.status).toBe(200);
        expect(liveR.status).toBe(200);
        expect(paperR.body.payload.config.accountId).toBe("cx_pap_abc");
        expect(liveR.body.payload.config.accountId).toBe("cx_liv_xyz");
        expect(paperR.body.payload.secrets.token).toBe("paper-token");
        expect(liveR.body.payload.secrets.token).toBe("live-token");
    });

    test("returns 404 NO_DEFAULT_ACCOUNT when no default for that type", async () => {
        mockGetDefaultForUser.mockResolvedValue(null);
        const { req, res, getResult } = makeReqRes({ params: { type: "metaapi" }, query: { mode: "live" } });
        await convenienceRoute.route.stack[0].handle(req, res);
        const r = getResult();
        expect(r.status).toBe(404);
        expect(r.body.error).toBe("NO_DEFAULT_ACCOUNT");
    });
});
