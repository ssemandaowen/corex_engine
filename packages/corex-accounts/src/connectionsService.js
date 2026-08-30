"use strict";

const { Pool } = require("pg");
const secretsVault = require("@core/services/secretsVault");
const logger = require("@utils/logger");
const log = logger.createModuleLogger("CONNECTOR_SETTINGS");

const CONNECTOR_SCHEMAS = {
    twelvedata: {
        config: {
            wsEnabled: { type: "boolean", default: true },
            restFallback: { type: "boolean", default: true },
            rateLimit: { type: "number", default: 8 }
        },
        secrets: ["apiKey"]
    },
    metaapi: {
        config: {
            accountId: { type: "string", required: true },
            region: { type: "string", default: "mt4-us-01" }
        },
        secrets: ["token"]
    }
};

class ConnectionsService {
    constructor({ pool } = {}) {
        this._pool = pool || this._createPool();
    }

    _createPool() {
        return new Pool({
            host: process.env.PGHOST,
            port: Number(process.env.PGPORT || 5432),
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            database: process.env.PGDATABASE,
            max: 5,
        });
    }

    async getConnection(accountId, connectorType) {
        if (!accountId || !connectorType) {
            throw new Error("accountId and connectorType are required");
        }

        const { rows } = await this._pool.query(
            `SELECT credentials
             FROM connections
             WHERE account_id = $1 AND connector_type = $2 AND status = 'active'
             LIMIT 1`,
            [accountId, connectorType]
        );

        if (!rows?.[0]) {
            return null;
        }

        const row = rows[0];
        let secrets = {};
        const creds = typeof row.credentials === "string" ? JSON.parse(row.credentials) : row.credentials;
        try {
            secrets = creds && typeof creds === "object"
                ? this._decryptSecrets(creds)
                : {};
        } catch (err) {
            log.warn(`Failed to decrypt secrets for ${accountId}/${connectorType}: ${err.message}`);
        }

        return {
            config: {}, // Needs to be integrated with account config later
            secrets
        };
    }

    async saveConnection(accountId, connectorType, credentials) {
        if (!accountId || !connectorType) {
            throw new Error("accountId and connectorType are required");
        }
        
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
            const strVal = String(value);
            out[key] = secretsVault.encryptString(strVal);
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
            try {
                out[key] = secretsVault.decryptString(value);
            } catch (err) {
                log.warn(`Decryption failed for ${key}: ${err.message}`);
            }
        }
        return out;
    }
}

module.exports = { 
    ConnectionsService: new ConnectionsService(),
    CONNECTOR_SCHEMAS 
};
