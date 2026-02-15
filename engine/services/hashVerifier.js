"use strict";

const crypto = require("crypto");
const db = require("@core/services/postgres");
const logger = require("@utils/logger");

function envTrue(v) {
    return ["1", "true", "yes", "on"].includes(String(v || "").trim().toLowerCase());
}

function sha256(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
}

async function getStrategyRecordByName(name) {
    const { rows: tables } = await db.query(
        "SELECT to_regclass('public.strategies') AS strategies"
    );
    if (!tables[0]?.strategies) {
        return { skipped: true, reason: "MISSING_TABLES" };
    }

    const { rows } = await db.query(
        `SELECT name, script_hash, script_body
         FROM strategies
         WHERE name = $1
         LIMIT 1`,
        [String(name || "")]
    );
    if (!rows[0]) return { missing: true };
    return { record: rows[0] };
}

async function verifyStrategyFile({ strategyName, filePath, code }) {
    const enforce = envTrue(process.env.COREX_STRATEGY_HASH_ENFORCE);
    const allowMissing = process.env.COREX_STRATEGY_HASH_ALLOW_MISSING == null
        ? true
        : envTrue(process.env.COREX_STRATEGY_HASH_ALLOW_MISSING);

    const providedCode = code != null ? String(code) : null;
    const actualHash = sha256(providedCode || "");

    if (!db.hasDbConfig()) {
        const reason = "NO_DB_CONFIG";
        if (enforce) return { ok: false, reason, actualHash };
        return { ok: true, reason, actualHash, skipped: true };
    }

    try {
        const found = await getStrategyRecordByName(strategyName);
        if (found.skipped) {
            const reason = found.reason || "SKIPPED";
            const actualHash = sha256(providedCode || "");
            if (enforce) return { ok: false, reason, actualHash };
            return { ok: true, reason, actualHash, skipped: true };
        }

        if (found.missing) {
            const reason = "STRATEGY_NOT_REGISTERED";
            const actualHash = sha256(providedCode || "");
            if (!allowMissing && enforce) return { ok: false, reason, actualHash };
            if (!allowMissing) return { ok: false, reason, actualHash };
            return { ok: true, reason, actualHash, skipped: true };
        }

        const expectedHash = String(found.record.script_hash || "").trim().toLowerCase();
        if (!expectedHash) {
            const reason = "MISSING_SCRIPT_HASH";
            const actualHash = sha256(providedCode || found.record.script_body || "");
            if (enforce) return { ok: false, reason, actualHash };
            return { ok: true, reason, actualHash, skipped: true };
        }

        const actualHash = sha256(providedCode || found.record.script_body || "");
        const matches = expectedHash === actualHash;
        if (!matches) {
            return {
                ok: false,
                reason: "HASH_MISMATCH",
                expectedHash,
                actualHash,
                strategyVersionId: null
            };
        }

        return {
            ok: true,
            reason: "HASH_OK",
            expectedHash,
            actualHash,
            strategyVersionId: null
        };
    } catch (err) {
        const reason = "HASH_VERIFY_ERROR";
        logger.warn(`[HASH] ${reason} for ${strategyName || "unknown"}: ${err.message}`);
        if (enforce) return { ok: false, reason, actualHash };
        return { ok: true, reason, actualHash, skipped: true };
    }
}

module.exports = {
    verifyStrategyFile
};
