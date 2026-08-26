"use strict";

const { RiskGateway } = require("../packages/corex-gateway/src/socketx/RiskGateway");
const { SocketXRiskEngine } = require("../engine/core/pipeline/SocketXRiskEngine");

describe("RiskGateway risk engine injection", () => {
    beforeEach(() => {
        RiskGateway.setRiskEngine(null);
        RiskGateway._engineInjected = false;
    });

    test("setRiskEngine marks engine as injected", () => {
        expect(RiskGateway._engineInjected).toBe(false);
        RiskGateway.setRiskEngine(SocketXRiskEngine);
        expect(RiskGateway._engineInjected).toBe(true);
        expect(RiskGateway._riskEngine).toBe(SocketXRiskEngine);
    });

    test("SocketXRiskEngine.check rejects drawdown breach", () => {
        const mockBroker = {
            getEquity: () => 800,
            initialCash: 1000,
            getPositionSnapshot: () => ({ side: "FLAT" }),
        };
        const intent = { intent: "ENTER", side: "long", symbol: "EURUSD" };

        const result = SocketXRiskEngine.check(mockBroker, intent);
        expect(result).toBeDefined();
        expect(result.reasonCode).toBe("RISK_LIMIT_EXCEEDED");
    });

    test("SocketXRiskEngine.check accepts within limits", () => {
        const mockBroker = {
            getEquity: () => 950,
            initialCash: 1000,
            getPositionSnapshot: () => ({ side: "FLAT" }),
        };
        const intent = { intent: "ENTER", side: "long", symbol: "EURUSD" };

        const result = SocketXRiskEngine.check(mockBroker, intent);
        expect(result).toBeNull();
    });

    test("SocketXRiskEngine.check blocks ENTER when already in position", () => {
        const mockBroker = {
            getEquity: () => 1000,
            initialCash: 1000,
            getPositionSnapshot: () => ({ side: "long" }),
        };
        const intent = { intent: "ENTER", side: "long", symbol: "EURUSD" };

        const result = SocketXRiskEngine.check(mockBroker, intent);
        expect(result).toBeDefined();
        expect(result.reasonCode).toBe("RISK_LIMIT_EXCEEDED");
    });

    test("SocketXRiskEngine.check allows scaling when allowScaling is set", () => {
        const mockBroker = {
            getEquity: () => 1000,
            initialCash: 1000,
            getPositionSnapshot: () => ({ side: "long" }),
        };
        const intent = { intent: "ENTER", side: "long", symbol: "EURUSD", allowScaling: true };

        const result = SocketXRiskEngine.check(mockBroker, intent);
        expect(result).toBeNull();
    });

    test("submit uses injected engine when set", async () => {
        RiskGateway.setRiskEngine(SocketXRiskEngine);

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        const mockBroker = {
            handle: jest.fn().mockResolvedValue({ status: "FILLED", orderId: "o1", avgFillPrice: 1.1 }),
            initialize: jest.fn().mockResolvedValue(),
            getEquity: () => 800,
            initialCash: 1000,
            getPositionSnapshot: () => ({ side: "FLAT" }),
        };
        RiskGateway.registerBroker(accountId, mockBroker);

        const command = {
            runtimeId: accountId,
            mode: "paper",
            payload: { action: "BUY", symbol: "EURUSD", quantity: 1 },
        };

        const result = await RiskGateway.submit({ connection: {}, command });
        expect(result.status).toBe("REJECTED");
        expect(result.reasonCode).toBe("RISK_LIMIT_EXCEEDED");
    });

    test("submit throws in production when no engine injected", async () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        delete process.env.JEST_WORKER_ID;

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        const mockBroker = {
            handle: jest.fn().mockResolvedValue({ status: "FILLED", orderId: "o1", avgFillPrice: 1.1 }),
            initialize: jest.fn().mockResolvedValue(),
            getEquity: () => 950,
            initialCash: 1000,
            getPositionSnapshot: () => ({ side: "FLAT" }),
        };
        RiskGateway.registerBroker(accountId, mockBroker);

        const command = {
            runtimeId: accountId,
            mode: "paper",
            payload: { action: "BUY", symbol: "EURUSD", quantity: 1 },
        };

        await expect(RiskGateway.submit({ connection: {}, command }))
            .rejects
            .toThrow("RiskGateway: no risk engine injected");

        process.env.NODE_ENV = originalEnv;
    });

    test("submit warns in test when no engine injected", async () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "test";

        const accountId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        const mockBroker = {
            handle: jest.fn().mockResolvedValue({ status: "FILLED", orderId: "o1", avgFillPrice: 1.1 }),
            initialize: jest.fn().mockResolvedValue(),
            getEquity: () => 950,
            initialCash: 1000,
            getPositionSnapshot: () => ({ side: "FLAT" }),
        };
        RiskGateway.registerBroker(accountId, mockBroker);

        const command = {
            runtimeId: accountId,
            mode: "paper",
            payload: { action: "BUY", symbol: "EURUSD", quantity: 1 },
        };

        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

        const result = await RiskGateway.submit({ connection: {}, command });
        expect(result.status).toBe("FILLED");
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("No risk engine injected")
        );

        warnSpy.mockRestore();
        process.env.NODE_ENV = originalEnv;
    });
});

describe("Engine startup wiring", () => {
    test("_wireSocketX injects SocketXRiskEngine into RiskGateway", () => {
        const fs = require("fs");
        const path = require("path");
        const enginePath = path.join(__dirname, "../engine/core/engine.js");
        const engineSource = fs.readFileSync(enginePath, "utf8");

        expect(engineSource).toContain("RiskGateway.setRiskEngine(SocketXRiskEngine)");
        expect(engineSource).toContain("_wireSocketX()");
        expect(engineSource).toContain("SocketXRiskEngine");
    });

    test("RiskGateway.setRiskEngine accepts SocketXRiskEngine and marks injection", () => {
        const originalInjected = RiskGateway._engineInjected;
        const originalEngine = RiskGateway._riskEngine;

        RiskGateway.setRiskEngine(SocketXRiskEngine);

        expect(RiskGateway._engineInjected).toBe(true);
        expect(RiskGateway._riskEngine).toBe(SocketXRiskEngine);

        RiskGateway._engineInjected = originalInjected;
        RiskGateway._riskEngine = originalEngine;
    });
});