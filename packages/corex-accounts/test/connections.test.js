"use strict";

// Mock pg pool
const mockQuery = jest.fn();
jest.mock("pg", () => ({
    Pool: jest.fn(() => ({
        query: mockQuery
    }))
}));

// Mock secretsVault
jest.mock("@core/services/secretsVault", () => ({
    encryptString: jest.fn((s) => `enc:${s}`),
    decryptString: jest.fn((s) => s.replace("enc:", "")),
    isEncryptedString: jest.fn((s) => s.startsWith("enc:"))
}));

// Import AFTER mocks
const { connectionsService, CONNECTOR_SCHEMAS } = require("../index");

describe("corex-accounts connectionsService", () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    test("CONNECTOR_SCHEMAS contains only twelvedata and metaapi", () => {
        const keys = Object.keys(CONNECTOR_SCHEMAS);
        expect(keys).toEqual(["twelvedata", "metaapi"]);
        expect(keys).not.toContain("mt5_bridge");
        expect(keys).not.toContain("oanda");
    });

    test("Two metaapi connections on different accounts coexist independently", async () => {
        const accA = "cx_pap_01HZX89K329RVTNABCDEF1234";
        const accB = "cx_pap_01HZX89K329RVTNABCDEF5678";

        mockQuery.mockResolvedValueOnce({ rows: [{ connection_id: "conn1" }] }); // saveConnection A
        mockQuery.mockResolvedValueOnce({ rows: [{ connection_id: "conn2" }] }); // saveConnection B
        mockQuery.mockResolvedValueOnce({ rows: [{ credentials: { token: "secretA" } }] }); // getConnection A
        mockQuery.mockResolvedValueOnce({ rows: [{ credentials: { token: "secretB" } }] }); // getConnection B

        await connectionsService.saveConnection(accA, "metaapi", { token: "secretA" });
        await connectionsService.saveConnection(accB, "metaapi", { token: "secretB" });

        const connA = await connectionsService.getConnection(accA, "metaapi");
        const connB = await connectionsService.getConnection(accB, "metaapi");

        expect(connA.secrets.token).toBe("secretA");
        expect(connB.secrets.token).toBe("secretB");
    });

    test("saveConnection uses ON CONFLICT (account_id, connector_type)", async () => {
        const accId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        mockQuery.mockResolvedValueOnce({ rows: [{ connection_id: "conn1" }] });

        await connectionsService.saveConnection(accId, "metaapi", { token: "tok" });

        const sql = mockQuery.mock.calls[0][0];
        expect(sql).toContain("ON CONFLICT (account_id, connector_type) DO UPDATE");
    });
});
