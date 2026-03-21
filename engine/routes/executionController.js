"use strict";

const express = require('express');
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const router = express.Router();
const loader = require('@core/strategyLoader'); // Import the Loader directly
const stateManager = require('@utils/stateController');
const logger = require('@utils/logger');
const { MODES, TIME, BRIDGE_INTEGRATIONS } = require("@config/constants");
const pgStore = require("@core/services/pgStore");
const tradeHistoryService = require("@core/services/tradeHistoryService");
const engine = require("@core/core/engine");
const { toScopedId, fromScopedId } = require("@core/services/userScope");

const getUserId = (req) => String(req.user?.sub || "").trim();
const toScopedStrategyId = (req, strategyId) => toScopedId(getUserId(req), strategyId);
const toPublicStrategyId = (req, scopedId) => fromScopedId(getUserId(req), scopedId);

const readCacheCandles = async (basePath, limit = 600) => {
    const candidates = [basePath, `${basePath}.gz`];
    for (const p of candidates) {
        try {
            const raw = await fs.promises.readFile(p);
            const text = p.endsWith(".gz")
                ? zlib.gunzipSync(raw).toString("utf8")
                : raw.toString("utf8");
            const lines = String(text || "").trim().split(/\r?\n/);
            if (lines.length < 2) return [];
            const header = lines[0].split(",").map((h) => String(h || "").trim().toLowerCase());
            const idxTime = header.indexOf("time");
            const idxOpen = header.indexOf("open");
            const idxHigh = header.indexOf("high");
            const idxLow = header.indexOf("low");
            const idxClose = header.indexOf("close");
            const idxVolume = header.indexOf("volume");
            if ([idxTime, idxOpen, idxHigh, idxLow, idxClose].some((idx) => idx < 0)) return [];

            const out = [];
            for (let i = 1; i < lines.length; i += 1) {
                const line = String(lines[i] || "").trim();
                if (!line) continue;
                const cols = line.split(",");
                const time = Number(cols[idxTime]);
                const open = Number(cols[idxOpen]);
                const high = Number(cols[idxHigh]);
                const low = Number(cols[idxLow]);
                const close = Number(cols[idxClose]);
                const volume = idxVolume >= 0 ? Number(cols[idxVolume] || 0) : 0;
                if (!Number.isFinite(time) || ![open, high, low, close].every(Number.isFinite)) continue;
                out.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
            }
            return out.slice(-Math.max(1, Number(limit) || 600));
        } catch (err) {
            if (err?.code === "ENOENT") continue;
            return [];
        }
    }
    return [];
};

/**
 * EXECUTION DOMAIN
 * Handles Tab 3: Run (Live/Paper/Backtest)
 */

// 1. GET ENGINE STATUS
router.get('/status', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    // We use the loader's list method because it aggregates 
    // status + instance params + uptime into one payload.
    const strategies = loader.listStrategies()
        .filter((s) => String(s.id || "").startsWith(`${userId}::`))
        .map((s) => ({
            ...s,
            id: toPublicStrategyId(req, s.id),
            name: toPublicStrategyId(req, s.name || s.id)
        }))
        .filter((s) => !!s.id);
    
    // Convert array to Key-Value object for the Frontend Object.entries mapping
    const payload = {};
    strategies.forEach(s => { payload[s.id] = s; });

    res.json({ success: true, payload });
});

router.get('/telemetry/:id', async (req, res) => {
    try {
        const scopedId = toScopedStrategyId(req, req.params.id);
        if (!scopedId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const entry = loader.registry.get(scopedId);
        if (!entry || !entry.instance) {
            return res.status(404).json({ success: false, error: "STRATEGY_NOT_FOUND" });
        }

        const barsRaw = Number(req.query?.bars ?? 600);
        const bars = Math.max(10, Math.min(5000, Number.isFinite(barsRaw) ? barsRaw : 600));
        const strategySymbols = Array.isArray(entry.instance.symbols) ? entry.instance.symbols : [];
        const requestedSymbol = String(req.query?.symbol || strategySymbols[0] || "");
        const timeframe = String(entry.instance.timeframe || "1m");
        const dm = entry.instance.dataManager;
        const dmSymbols = dm?.data && typeof dm.data.keys === "function" ? Array.from(dm.data.keys()) : [];
        const dataSymbols = dmSymbols.length > 0 ? dmSymbols : strategySymbols;
        const symbol = (requestedSymbol && dataSymbols.includes(requestedSymbol))
            ? requestedSymbol
            : (dataSymbols[0] || requestedSymbol);
        const store = symbol && dm?.data?.get?.(symbol) ? dm.data.get(symbol) : null;

        let candleSource = "instance";
        const historical = symbol ? (entry.instance.getLookbackWindow?.(symbol) || []) : [];
        const trimmed = Array.isArray(historical) ? historical.slice(-bars) : [];
        const active = store?.activeCandle ? [{ ...store.activeCandle, symbol }] : [];
        let candles = [...trimmed, ...active]
            .filter((c) => c && Number.isFinite(Number(c.time)))
            .map((c) => ({
                symbol,
                time: Number(c.time),
                open: Number(c.open),
                high: Number(c.high),
                low: Number(c.low),
                close: Number(c.close),
                volume: Number(c.volume || 0)
            }))
            .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
            .sort((a, b) => a.time - b.time)
            .slice(-bars);

        if (candles.length === 0 && symbol) {
            try {
                const safeSym = String(symbol).replace(/[^a-zA-Z0-9-]/g, "-");
                const cacheBasePath = path.resolve(
                    process.cwd(),
                    "data",
                    "cache",
                    `candles_${safeSym}_${timeframe}.csv`
                );
                const cached = await readCacheCandles(cacheBasePath, bars);
                if (Array.isArray(cached) && cached.length > 0) {
                    candles = cached
                        .map((c) => ({
                            symbol,
                            time: Number(c.time),
                            open: Number(c.open),
                            high: Number(c.high),
                            low: Number(c.low),
                            close: Number(c.close),
                            volume: Number(c.volume || 0)
                        }))
                        .filter((c) => Number.isFinite(c.time) && [c.open, c.high, c.low, c.close].every(Number.isFinite))
                        .sort((a, b) => a.time - b.time)
                        .slice(-bars);
                    if (candles.length > 0) candleSource = "cache";
                }
            } catch {
                // best effort fallback only
            }
        }

        const status = stateManager.getStatus(scopedId);
        const summary = loader.listStrategies().find((s) => s.id === scopedId) || null;
        return res.json({
            success: true,
            payload: {
                id: req.params.id,
                status,
                symbol,
                symbols: strategySymbols,
                dataSymbols,
                mode: entry.instance.mode || null,
                timeframe,
                lookback: entry.instance.lookback || null,
                maxDataHistory: entry.instance.max_data_history || null,
                params: entry.instance.params || {},
                schema: entry.instance.schema || {},
                api: Array.isArray(entry.instance.__corexApi) ? entry.instance.__corexApi : [],
                dataPoints: summary?.dataPoints ?? 0,
                historyPoints: summary?.historyPoints ?? 0,
                lookbackCoveragePct: summary?.lookbackCoveragePct ?? 0,
                candles,
                candleSource,
                activeCandle: store?.activeCandle || null,
                lastTick: entry.instance.lastTick || null
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: "TELEMETRY_READ_FAILED", message: err.message });
    }
});

router.get('/history', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const environment = String(req.query?.environment || "PAPER").toUpperCase();
        if (!["PAPER", "LIVE"].includes(environment)) {
            return res.status(400).json({ success: false, error: "INVALID_ENVIRONMENT" });
        }
        const strategyIdRaw = String(req.query?.strategyId || "").trim() || null;
        const strategyId = strategyIdRaw ? toScopedStrategyId(req, strategyIdRaw) : null;
        const symbol = String(req.query?.symbol || "").trim() || null;
        const from = req.query?.from || null;
        const to = req.query?.to || null;
        const limit = Number(req.query?.limit || 2000);

        const brokerSettings = await pgStore.getBrokerSettingsForUser(userId, environment.toLowerCase());
        const initialCapital = Number(
            req.query?.initialCapital ??
            brokerSettings?.initialCash ??
            brokerSettings?.cash ??
            10000
        );

        const payload = await tradeHistoryService.getHistoryReport({
            userId,
            environment,
            strategyId,
            symbol,
            from,
            to,
            limit
        }, { initialCapital });

        if (payload?.meta?.strategyName) {
            const publicId = toPublicStrategyId(req, payload.meta.strategyName);
            if (publicId) payload.meta.strategyName = publicId;
        }
        if (Array.isArray(payload?.trades)) {
            payload.trades = payload.trades.map((t) => ({
                ...t,
                strategyId: toPublicStrategyId(req, t?.strategyId) || t?.strategyId
            }));
        }
        if (Array.isArray(payload?.fills)) {
            payload.fills = payload.fills.map((f) => ({
                ...f,
                strategyId: toPublicStrategyId(req, f?.strategyId) || f?.strategyId
            }));
        }

        return res.json({ success: true, payload });
    } catch (err) {
        return res.status(500).json({ success: false, error: "HISTORY_READ_FAILED", message: err.message });
    }
});

router.get('/ops/telemetry', async (req, res) => {
    const db = require("@core/services/postgres");
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const includeEvents = String(req.query?.includeEvents || "").trim().toLowerCase() === "true";
        const eventLimit = Number(req.query?.eventLimit || 20);
        const maxAgeSec = Math.max(30, Math.min(86400, Number(req.query?.staleAgeSec || 300)));
        const telemetry = engine.getExecutionTelemetry({
            includeEvents,
            eventLimit
        });

        let stale = [];
        let statusBreakdown = [];
        if (db.hasDbConfig()) {
            const staleRes = await db.query(
                `SELECT id, strategy_name, symbol, status, created_at
                 FROM orders o
                 WHERE o.user_id = $1
                   AND o.environment = 'LIVE'
                   AND o.status IN ('PENDING', 'SENT')
                   AND o.created_at < NOW() - ($2::int * interval '1 second')
                   AND NOT EXISTS (SELECT 1 FROM order_fills f WHERE f.order_id = o.id)
                 ORDER BY o.created_at ASC
                 LIMIT 200`,
                [userId, maxAgeSec]
            );
            stale = staleRes.rows || [];
            stale = stale.map((row) => ({
                ...row,
                strategy_name: toPublicStrategyId(req, row.strategy_name) || row.strategy_name
            }));

            const statusRes = await db.query(
                `SELECT status, COUNT(*)::int AS count
                 FROM orders
                 WHERE user_id = $1
                   AND environment IN ('PAPER', 'LIVE')
                   AND created_at >= NOW() - interval '7 days'
                 GROUP BY status
                 ORDER BY count DESC`
                ,
                [userId]
            );
            statusBreakdown = (statusRes.rows || []).map((row) => ({
                status: String(row.status || ""),
                count: Number(row.count || 0)
            }));
        }

        return res.json({
            success: true,
            payload: {
                ...telemetry,
                liveOrderStatus7d: statusBreakdown,
                staleOrders: {
                    thresholdSec: maxAgeSec,
                    count: stale.length,
                    sample: stale
                }
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: "EXECUTION_TELEMETRY_FAILED", message: err.message });
    }
});

router.post('/ops/reconcile', async (req, res) => {
    const db = require("@core/services/postgres");
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        if (!db.hasDbConfig()) return res.status(503).json({ success: false, error: "DB_NOT_CONFIGURED" });
        const maxAgeSec = Math.max(30, Math.min(86400, Number(req.body?.maxAgeSec || req.query?.maxAgeSec || 300)));
        const dryRun = req.body?.dryRun === true;

        const selectSql = `
            SELECT id, strategy_name, symbol, status, created_at
            FROM orders o
            WHERE o.user_id = $1
              AND o.environment = 'LIVE'
              AND o.status IN ('PENDING', 'SENT')
              AND o.created_at < NOW() - ($2::int * interval '1 second')
              AND NOT EXISTS (SELECT 1 FROM order_fills f WHERE f.order_id = o.id)
            ORDER BY o.created_at ASC
            LIMIT 2000
        `;
        const preview = await db.query(selectSql, [userId, maxAgeSec]);
        const rows = preview.rows || [];
        if (dryRun) {
            return res.json({
                success: true,
                payload: {
                    dryRun: true,
                    thresholdSec: maxAgeSec,
                    staleCount: rows.length,
                    sample: rows.slice(0, 200).map((row) => ({
                        ...row,
                        strategy_name: toPublicStrategyId(req, row.strategy_name) || row.strategy_name
                    }))
                }
            });
        }

        if (rows.length === 0) {
            return res.json({
                success: true,
                payload: {
                    dryRun: false,
                    thresholdSec: maxAgeSec,
                    staleCount: 0,
                    updatedCount: 0,
                    updated: []
                }
            });
        }

        const updated = await db.query(
            `UPDATE orders o
             SET status = 'TIMEOUT'
             WHERE o.user_id = $2
               AND o.id = ANY($1::uuid[])
             RETURNING id, strategy_name, symbol, status, created_at`,
            [rows.map((r) => r.id), userId]
        );
        const updatedRows = (updated.rows || []).map((row) => ({
            ...row,
            strategy_name: toPublicStrategyId(req, row.strategy_name) || row.strategy_name
        }));

        return res.json({
            success: true,
            payload: {
                dryRun: false,
                thresholdSec: maxAgeSec,
                staleCount: rows.length,
                updatedCount: updated.rowCount || 0,
                updated: updatedRows
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: "EXECUTION_RECONCILE_FAILED", message: err.message });
    }
});

router.get('/history/snapshots', async (req, res) => {
    const db = require("@core/services/postgres");
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        if (!db.hasDbConfig()) return res.status(503).json({ success: false, error: "DB_NOT_CONFIGURED" });
        const environment = String(req.query?.environment || "PAPER").toUpperCase();
        if (!["PAPER", "LIVE"].includes(environment)) {
            return res.status(400).json({ success: false, error: "INVALID_ENVIRONMENT" });
        }
        const strategyIdRaw = String(req.query?.strategyId || "").trim() || null;
        const strategyId = strategyIdRaw ? toScopedStrategyId(req, strategyIdRaw) : null;
        const symbol = String(req.query?.symbol || "").trim().toUpperCase() || null;
        const limitRaw = Number(req.query?.limit || 120);
        const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 120));

        const values = [userId, environment];
        const clauses = ["o.user_id = $1", "o.environment = $2", "f.id IS NOT NULL"];
        if (strategyId) {
            values.push(strategyId);
            const idx = values.length;
            clauses.push(`(
                LOWER(COALESCE(o.strategy_name, '')) = LOWER($${idx})
                OR LOWER(COALESCE(o.strategy_id::text, '')) = LOWER($${idx})
            )`);
        }
        if (symbol) {
            values.push(symbol);
            clauses.push(`UPPER(o.symbol) = $${values.length}`);
        }
        values.push(limit);
        const whereSql = `WHERE ${clauses.join(" AND ")}`;
        const limitPlaceholder = `$${values.length}`;

        const sql = `
            SELECT
                COALESCE(NULLIF(o.strategy_name, ''), o.strategy_id::text, 'UNKNOWN') AS strategy_id,
                UPPER(o.symbol) AS symbol,
                date_trunc('day', COALESCE(f.filled_at, o.created_at)) AS bucket_day,
                MIN(COALESCE(f.filled_at, o.created_at)) AS from_ts,
                MAX(COALESCE(f.filled_at, o.created_at)) AS to_ts,
                COUNT(*)::int AS fills_count
            FROM orders o
            LEFT JOIN order_fills f ON f.order_id = o.id
            ${whereSql}
            GROUP BY 1, 2, 3
            ORDER BY bucket_day DESC, to_ts DESC
            LIMIT ${limitPlaceholder}
        `;
        const { rows } = await db.query(sql, values);
        const payload = (rows || []).map((r) => {
            const scopedStrategy = String(r.strategy_id || "UNKNOWN");
            const strategy = toPublicStrategyId(req, scopedStrategy) || scopedStrategy;
            const sym = String(r.symbol || "");
            const fromTs = new Date(r.from_ts).toISOString();
            const toTs = new Date(r.to_ts).toISOString();
            const day = new Date(r.bucket_day).toISOString().slice(0, 10);
            return {
                id: `${environment}_${strategy}_${sym}_${day}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
                environment,
                strategyId: strategy,
                symbol: sym,
                day,
                from: fromTs,
                to: toTs,
                fillsCount: Number(r.fills_count || 0)
            };
        });
        return res.json({ success: true, payload });
    } catch (err) {
        return res.status(500).json({ success: false, error: "HISTORY_SNAPSHOTS_FAILED", message: err.message });
    }
});

router.delete('/history', async (req, res) => {
    const db = require("@core/services/postgres");
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        if (!db.hasDbConfig()) return res.status(503).json({ success: false, error: "DB_NOT_CONFIGURED" });

        const environment = String(req.query?.environment || "PAPER").toUpperCase();
        if (!["PAPER", "LIVE"].includes(environment)) {
            return res.status(400).json({ success: false, error: "INVALID_ENVIRONMENT" });
        }
        const strategyId = String(req.query?.strategyId || "").trim() || null;
        const symbol = String(req.query?.symbol || "").trim().toUpperCase() || null;
        const from = req.query?.from ? new Date(req.query.from) : null;
        const to = req.query?.to ? new Date(req.query.to) : null;
        const clauses = ["user_id = $1", "environment = $2"];
        const values = [userId, environment];

        if (strategyId) {
            values.push(strategyId);
            const idx = values.length;
            clauses.push(`(
                LOWER(COALESCE(strategy_name, '')) = LOWER($${idx})
                OR LOWER(COALESCE(strategy_id::text, '')) = LOWER($${idx})
            )`);
        }
        if (symbol) {
            values.push(symbol);
            clauses.push(`UPPER(symbol) = $${values.length}`);
        }
        if (from instanceof Date && Number.isFinite(from.getTime())) {
            values.push(from.toISOString());
            clauses.push(`created_at >= $${values.length}::timestamptz`);
        }
        if (to instanceof Date && Number.isFinite(to.getTime())) {
            values.push(to.toISOString());
            clauses.push(`created_at <= $${values.length}::timestamptz`);
        }

        const whereSql = `WHERE ${clauses.join(" AND ")}`;

        const result = await db.withTransaction(async (tx) => {
            const idsRes = await tx.query(
                `SELECT id FROM orders ${whereSql}`,
                values
            );
            const ids = idsRes.rows.map((r) => r.id);
            if (ids.length === 0) return { ordersDeleted: 0, fillsDeleted: 0 };

            const fills = await tx.query(
                `DELETE FROM order_fills WHERE order_id = ANY($1::uuid[])`,
                [ids]
            );
            const orders = await tx.query(
                `DELETE FROM orders WHERE id = ANY($1::uuid[])`,
                [ids]
            );
            return { ordersDeleted: orders.rowCount || 0, fillsDeleted: fills.rowCount || 0 };
        });

        return res.json({ success: true, payload: result });
    } catch (err) {
        return res.status(500).json({ success: false, error: "HISTORY_DELETE_FAILED", message: err.message });
    }
});

// 2. DEPLOY STRATEGY (OFFLINE -> ACTIVE)
router.post('/start/:id', (req, res) => {
    const { id: rawId } = req.params;
    const id = toScopedStrategyId(req, rawId);
    const { mode, params, timeframe } = req.body;

    if (id === 'undefined' || !id) {
        return res.status(400).json({ success: false, error: "Strategy ID is required" });
    }

    // 1. Call the loader method directly to trigger the Engine handover
    const normalizedMode = String(mode || MODES.PAPER).toUpperCase();
    if (![MODES.PAPER, MODES.LIVE].includes(normalizedMode)) {
        return res.status(400).json({ success: false, error: `INVALID_MODE: ${normalizedMode}` });
    }
    const normalizedTf = String(timeframe || TIME.DEFAULT_TIMEFRAMES[0]);

    const entry = loader.startStrategy(id, {
        mode: normalizedMode,
        timeframe: normalizedTf,
        strategyParams: params || {} 
    });

    if (!entry) {
        return res.status(404).json({ success: false, error: `Strategy [${rawId}] not found in registry.` });
    }

    logger.info(`Execution request processed for [${rawId}] in mode: ${normalizedMode}`, {
        timeframe: normalizedTf
    });

    res.json({ 
        success: true, 
        message: `Run initiated for ${rawId}. Engine handover in progress...` 
    });
});

// 3. TERMINATE STRATEGY (ACTIVE -> OFFLINE)
router.post('/stop/:id', (req, res) => {
    const { id: rawId } = req.params;
    const id = toScopedStrategyId(req, rawId);

    const entry = loader.stopStrategy(id);

    if (!entry) {
        return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    res.json({ 
        success: true, 
        message: `Stop signal processed for ${rawId}. Connections closing.` 
    });
});

// 3b. RESTART STRATEGY (reload code + preserve desired runtime state)
router.post('/restart/:id', async (req, res) => {
    const { id: rawId } = req.params;
    const id = toScopedStrategyId(req, rawId);
    const entry = loader.registry.get(id);
    if (!entry) {
        return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    try {
        const ok = await loader.reloadStrategy(id);
        if (!ok) {
            return res.status(500).json({ success: false, error: "RESTART_FAILED" });
        }
        return res.json({ success: true, message: `Restart sequence completed for ${rawId}.` });
    } catch (err) {
        return res.status(500).json({ success: false, error: "RESTART_FAILED", message: err.message });
    }
});

// 4. REAL-TIME PARAM TUNING
router.patch('/params/:id', (req, res) => {
    const id = toScopedStrategyId(req, req.params.id);
    const { params } = req.body;

    const entry = loader.registry.get(id);
    if (!entry) {
        return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    // If active, hot-swap and persist. If inactive, just persist (applies next start).
    const status = stateManager.getStatus(id);
    if (entry.instance.updateParams) {
        entry.instance.updateParams(params);
    }
    loader._saveParams(id, params);
    loader._updateRuntimeStateInDb(id, { params }).catch(() => {});

    if (status === 'ACTIVE') {
        return res.json({ success: true, message: "Parameters hot-swapped and persisted." });
    }
    return res.json({ success: true, message: "Parameters saved. They will apply on next start." });
});

router.get("/config", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const persisted = await pgStore.getSystemSettingsForUser(userId);
        const payload = persisted?.payload || {};
        const run = payload.run && typeof payload.run === "object" ? payload.run : {};
        const providers = Array.isArray(run.bridgeProviders) && run.bridgeProviders.length > 0
            ? run.bridgeProviders
            : [BRIDGE_INTEGRATIONS.PYTHON_RECEIVER, BRIDGE_INTEGRATIONS.MQL5_RECEIVER, BRIDGE_INTEGRATIONS.METAAPI];

        const defaultMode = String(run.defaultMode || MODES.PAPER).toUpperCase();
        const allowedModes = Array.isArray(run.allowedModes) && run.allowedModes.length > 0
            ? run.allowedModes.map((m) => String(m).toUpperCase())
            : [MODES.PAPER, MODES.LIVE];

        const timeframes = Array.isArray(run.timeframes) && run.timeframes.length > 0
            ? run.timeframes
            : TIME.DEFAULT_TIMEFRAMES;

        res.json({
            success: true,
            payload: {
                modes: allowedModes,
                defaultMode: allowedModes.includes(defaultMode) ? defaultMode : allowedModes[0],
                timeframes,
                defaultTimeframe: run.defaultTimeframe || timeframes[0],
                bridgeProviders: providers,
                activeBridgeProvider: String(run.activeBridgeProvider || providers[0] || BRIDGE_INTEGRATIONS.PYTHON_RECEIVER)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "RUN_CONFIG_READ_FAILED", message: err.message });
    }
});

// 5. RESTORE DEFAULT PARAMS
router.post('/params/:id/reset', (req, res) => {
    const { id: rawId } = req.params;
    const id = toScopedStrategyId(req, rawId);
    const entry = loader.registry.get(id);
    if (!entry) {
        return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    let defaults = null;
    try {
        const fresh = loader._instantiateStrategy(entry.source || "", entry.id);
        if (fresh && typeof fresh._applyDefaults === 'function') fresh._applyDefaults();
        defaults = fresh?.params || {};
    } catch (e) {
        defaults = null;
    }

    if (!defaults || Object.keys(defaults).length === 0) {
        if (entry.instance._applyDefaults) {
            entry.instance._applyDefaults();
        }
        defaults = entry.instance.params || {};
    }

    if (entry.instance.updateParams) {
        entry.instance.updateParams(defaults);
    } else {
        entry.instance.params = { ...(defaults || {}) };
    }

    loader._saveParams(id, entry.instance.params || {});

    logger.info(`Default parameters restored for strategy [${rawId}].`);
    return res.json({ success: true, payload: entry.instance.params || {}, message: "Defaults restored and persisted." });
});

// GET DATASET METADATA for running strategy
router.get('/dataset/:id', (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        
        const scopedId = toScopedStrategyId(req, req.params.id);
        const entry = loader.registry.get(scopedId);
        
        if (!entry || !entry.instance) {
            return res.status(404).json({ success: false, error: "STRATEGY_NOT_FOUND" });
        }

        // Extract dataset information from the running strategy
        const dm = entry.instance.dataManager;
        const dataSymbols = dm?.data && typeof dm.data.keys === "function" 
            ? Array.from(dm.data.keys()) 
            : [];

        // Get dataset metadata from dataManager if available
        const datasetMeta = entry.instance.datasetMeta || {};
        
        const payload = {
            symbols: entry.instance.symbols || dataSymbols || [],
            timeframe: entry.instance.timeframe || null,
            lookback: entry.instance.lookback || null,
            mode: entry.instance.mode || null,
            datasetName: datasetMeta.name || 'Default Dataset',
            datasetId: datasetMeta.id || 'N/A',
            uploadedAt: datasetMeta.uploadedAt || null,
            recordCount: datasetMeta.recordCount || 0,
            dateRange: datasetMeta.dateRange || { start: null, end: null },
            source: datasetMeta.source || 'auto'
        };

        return res.json({ success: true, payload });
    } catch (err) {
        logger.error(`Failed to get dataset metadata: ${err.message}`);
        res.status(500).json({ success: false, error: "DATASET_FETCH_FAILED", message: err.message });
    }
});

module.exports = router;
