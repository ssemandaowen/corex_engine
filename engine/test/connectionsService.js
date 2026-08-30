"use strict";

// Minimal ConnectionsService for test mocking — mirrors the real one's saveConnection/getConnection SQL
const secretsVault = require("@core/services/secretsVault");

class ConnectionsService {
    constructor({ pool } = {}) {
        this._pool = pool || { query: async () => ({ rows: [] }) };
    }

    async getConnection(accountId, connectorType) {
        const { rows } = await this._pool.query(
            `SELECT credentials
             FROM connections
             WHERE account_id = $1 AND connector_type = $2 AND status = 'active'
             LIMIT 1`,
            [accountId, connectorType]
        );
        if (!rows?.[0]) return null;
        const row = rows[0];
        let secrets = {};
        const creds = typeof row.credentials === "string" ? JSON.parse(row.credentials) : row.credentials;
        try {
            secrets = creds && typeof creds === "object" ? this._decryptSecrets(creds) : {};
        } catch (err) {}
        return { config: {}, secrets };
    }

    async saveConnection(accountId, connectorType, credentials) {
        const encryptedCredentials = this._encryptSecrets(credentials);
        const sql = `
            INSERT INTO connections (connection_id, account_id, connector_type, credentials)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (account_id, connector_type) DO UPDATE
            SET credentials = EXCLUDED.credentials, status = 'active'
            RETURNING connection_id
        `;
        const connectionId = require("crypto").randomUUID();
        await this._pool.query(sql, [connectionId, accountId, connectorType, JSON.stringify(encryptedCredentials)]);
    }

    _encryptSecrets(secrets = {}) {
        const out = {};
        for (const [key, value] of Object.entries(secrets)) {
            if (value === undefined || value === null || value === "") continue;
            out[key] = secretsVault.encryptString(String(value));
        }
        return out;
    }

    _decryptSecrets(encryptedObj = {}) {
        const out = {};
        for (const [key, value] of Object.entries(encryptedObj)) {
            if (!value || typeof value !== "string") continue;
            if (!secretsVault.isEncryptedString(value)) {
                out[key] = value;
                continue;
            }
            out[key] = secretsVault.decryptString(value);
        }
        return out;
    }
}

module.exports = { ConnectionsService };
