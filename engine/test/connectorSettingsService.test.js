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

// Mock corex-accounts to avoid BrokerPersistenceService instantiating a real pg Pool at module load
jest.mock("corex-accounts", () => {
    class ConnectionsService {
        constructor({ pool } = {}) {
            this._pool = pool || { query: async () => ({ rows: [] }) };
        }
        async getConnection(accountId, connectorType) {
            const { rows } = await this._pool.query(
                `SELECT credentials FROM connections WHERE account_id = $1 AND connector_type = $2 AND status = 'active' LIMIT 1`,
                [accountId, connectorType]
            );
            if (!rows?.[0]) return null;
            const creds = typeof rows[0].credentials === "string" ? JSON.parse(rows[0].credentials) : rows[0].credentials;
            let secrets = {};
            try { secrets = creds && typeof creds === "object" ? this._decryptSecrets(creds) : {}; } catch (e) {}
            return { config: {}, secrets };
        }
        async saveConnection(accountId, connectorType, credentials) {
            const encrypted = this._encryptSecrets(credentials);
            const sql = `INSERT INTO connections (connection_id, account_id, connector_type, credentials) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, connector_type) DO UPDATE SET credentials = EXCLUDED.credentials, status = 'active' RETURNING connection_id`;
            const connectionId = require("crypto").randomUUID();
            await this._pool.query(sql, [connectionId, accountId, connectorType, JSON.stringify(encrypted)]);
        }
        _encryptSecrets(secrets = {}) {
            const out = {};
            for (const [key, value] of Object.entries(secrets)) {
                if (value === undefined || value === null || value === "") continue;
                out[key] = require("@core/services/secretsVault").encryptString(String(value));
            }
            return out;
        }
        _decryptSecrets(encryptedObj = {}) {
            const out = {};
            const vault = require("@core/services/secretsVault");
            for (const [key, value] of Object.entries(encryptedObj)) {
                if (!value || typeof value !== "string") continue;
                if (!vault.isEncryptedString(value)) { out[key] = value; continue; }
                out[key] = vault.decryptString(value);
            }
            return out;
        }
    }
    return {
        connectionsService: new ConnectionsService({ pool: { query: mockQuery } }),
        CONNECTOR_SCHEMAS: {
            twelvedata: {
                config: { wsEnabled: { type: "boolean", default: true }, restFallback: { type: "boolean", default: true }, rateLimit: { type: "number", default: 8 } },
                secrets: ["apiKey"]
            },
            metaapi: {
                config: { accountId: { type: "string", required: true }, region: { type: "string", default: "mt4-us-01" } },
                secrets: ["token"]
            }
        }
    };
});

const connectorSettingsService = require("@core/services/connectorSettingsService");

describe("connectorSettingsService (accountId-based)", () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    test("saveConnectorConfig takes accountId directly", async () => {
        const accId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        mockQuery.mockResolvedValueOnce({ rows: [{ connection_id: "conn1" }] });
        await connectorSettingsService.saveConnectorConfig(accId, "metaapi", {}, { token: "tok" });
        const params = mockQuery.mock.calls[0][1];
        expect(params[1]).toBe(accId);
        expect(params[2]).toBe("metaapi");
    });

    test("getConnectorConfig takes accountId directly", async () => {
        const accId = "cx_pap_01HZX89K329RVTNABCDEF1234";
        mockQuery.mockResolvedValueOnce({ rows: [{ credentials: { token: "secret" } }] });
        const result = await connectorSettingsService.getConnectorConfig(accId, "metaapi");
        const params = mockQuery.mock.calls[0][1];
        expect(params[0]).toBe(accId);
        expect(params[1]).toBe("metaapi");
        expect(result.secrets.token).toBe("secret");
    });

    test("two different accounts can each hold an independent metaapi connection", async () => {
        const accA = "cx_pap_01HZX89K329RVTNABCDEF1234";
        const accB = "cx_pap_01HZX89K329RVTNABCDEF5678";
        mockQuery.mockResolvedValueOnce({ rows: [{ connection_id: "conn1" }] });
        mockQuery.mockResolvedValueOnce({ rows: [{ connection_id: "conn2" }] });
        mockQuery.mockResolvedValueOnce({ rows: [{ credentials: { token: "secretA" } }] });
        mockQuery.mockResolvedValueOnce({ rows: [{ credentials: { token: "secretB" } }] });
        await connectorSettingsService.saveConnectorConfig(accA, "metaapi", {}, { token: "secretA" });
        await connectorSettingsService.saveConnectorConfig(accB, "metaapi", {}, { token: "secretB" });
        const connA = await connectorSettingsService.getConnectorConfig(accA, "metaapi");
        const connB = await connectorSettingsService.getConnectorConfig(accB, "metaapi");
        expect(connA.secrets.token).toBe("secretA");
        expect(connB.secrets.token).toBe("secretB");
    });

    test("getSchema returns null for pruned connector types mt5_bridge and oanda", () => {
        expect(connectorSettingsService.getSchema("mt5_bridge")).toBeNull();
        expect(connectorSettingsService.getSchema("oanda")).toBeNull();
    });

    test("getSchema returns schema for valid connector types", () => {
        expect(connectorSettingsService.getSchema("metaapi")).toBeDefined();
        expect(connectorSettingsService.getSchema("twelvedata")).toBeDefined();
    });

    test("listForUser returns only twelvedata and metaapi", () => {
        const list = connectorSettingsService.listForUser();
        const types = list.map(l => l.connectorType);
        expect(types).toEqual(["twelvedata", "metaapi"]);
    });
});
