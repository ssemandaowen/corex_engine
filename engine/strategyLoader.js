"use strict";

/**
 * CoreX Strategy Bootloader
 *
 * PHASE RESPONSIBILITIES
 * ──────────────────────
 * boot / init   → DISCOVER + VALIDATE + COMPILE (class only) + extract schema
 *                 Registry entry has: { id, source, StrategyClass, schema, metadata }
 *                 NO instance. NO broker. NO runtime state.
 *
 * startStrategy → called by runtimeService when a user presses START
 *                 Instantiates the class, hands the instance to RuntimeLifecycle.boot()
 *
 * stopStrategy  → called by runtimeService when a user presses STOP
 *                 Delegates teardown to RuntimeLifecycle.terminate()
 *                 Removes instance from RuntimeRegistry — bootloader registry keeps metadata
 *
 * reloadStrategy → re-runs VALIDATE + COMPILE on updated code, replaces StrategyClass
 *                  Does NOT restart running instances automatically
 */

const logger          = require('@utils/logger');
const crypto          = require('crypto');
const { bus, EVENTS } = require('@events/bus');
const { validateStrategyCode } = require('@utils/security');
const stateManager    = require('@utils/stateController');
const { verifyStrategyFile } = require('@core/services/hashVerifier');
const db              = require('@core/services/postgres');
const { StrategyCompiler } = require('@core/services/strategyCompiler');
const { ComponentLifecycle, STATES } = require('@core/core/lifecycle/ComponentLifecycle');
const { StrategyContract }           = require('@core/core/strategy/StrategyContract');
const RuntimeLifecycle               = require('@core/core/runtime/RuntimeLifecycle');
const runtimeRegistry                = require('@core/core/runtime/RuntimeRegistry');
const { parseScopedId }              = require('@core/services/userScope');

const log = logger.createModuleLogger('STRATEGY_BOOTLOADER', {
    category: 'strategy',
    ui: true,
    uiLevels: ['info', 'warn', 'error']
});

const _metaRegistry = new Map();
const _startInFlight = new Set();

let _engine    = null;
let _compiler  = null;
let _lifecycle = null;

function _hashSource(code) {
    return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function _envFalse(value) {
    return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function _makeLifecycle() {
    return new ComponentLifecycle('STRATEGY_BOOTLOADER', { category: 'strategy' });
}

function _makeCompiler() {
    return new StrategyCompiler();
}

async function _compileToClass(id, code) {
    const compiler = _compiler || (_compiler = _makeCompiler());
    const securityOk = validateStrategyCode(code);
    if (!securityOk) {
        return { ok: false, error: 'Security validation failed: code contains forbidden patterns' };
    }

    const hashCheck = await verifyStrategyFile({ strategyName: id, filePath: null, code });
    if (!hashCheck.ok) {
        return { ok: false, error: `Hash verification failed: ${hashCheck.reason}` };
    }

    const result = await compiler.compile(code, id);
    if (!result.success) {
        return { ok: false, error: result.error };
    }

    const StrategyClass = result.instance?.constructor;
    if (typeof StrategyClass !== 'function') {
        return { ok: false, error: 'Compiler did not produce a valid constructor' };
    }

    // compiler.compile() already extracted schema/symbols/timeframe/className
    // during its own contract-validation pass — reuse it rather than
    // re-deriving the same fields from result.instance a second time.
    const schema = result.metadata?.schema || {};
    const metadata = {
        symbols:          result.metadata?.symbols || (Array.isArray(result.instance.symbols) ? result.instance.symbols : []),
        timeframe:        result.metadata?.timeframe || result.instance.timeframe || '1m',
        lookback:         Number(result.instance.lookback || 0),
        max_data_history: Number(result.instance.max_data_history || 500),
        className:        result.metadata?.className || StrategyClass.name || id,
        compiledAt:       Date.now(),
        codeLength:       code.length,
    };

    if (typeof result.instance.destroy === 'function') {
        try { result.instance.destroy(); } catch (_) {}
    }

    return { ok: true, StrategyClass, schema, metadata };
}

async function init(engine) {
    if (!engine) throw new Error('StrategyBootloader requires an engine instance');
    _engine   = engine;
    _lifecycle = _lifecycle || _makeLifecycle();
    _lifecycle.transition(STATES.INITIALIZING, { reason: 'init' });

    log.info('StrategyBootloader init — engine starting empty');

    bus.on(EVENTS.SYSTEM.SETTINGS_UPDATED, ({ id, params } = {}) => {
        _handleRuntimeParamUpdate(id, params).catch(err =>
            log.warn(`[PARAMS] runtime update failed for ${id}: ${err.message}`)
        );
    });

    await _restoreDesiredRuntimeStates();

    _lifecycle.transition(STATES.RUNNING, {
        registered: _metaRegistry.size
    });

    log.info(`StrategyBootloader ready — ${_metaRegistry.size} strategies in registry`);
}

async function _compileAndRegisterMeta(id, code, dbRow = {}) {
    const updatedAt = dbRow.updated_at ? new Date(dbRow.updated_at).getTime() : Date.now();
    const compiledHash = _hashSource(code);

    const existing = _metaRegistry.get(id);
    if (existing && existing.compiledHash === compiledHash && existing.status === 'COMPILED') {
        return existing;
    }

    if (
        dbRow.compiled_hash === compiledHash &&
        dbRow.schema &&
        typeof dbRow.schema === 'object'
    ) {
        const cached = {
            id,
            StrategyClass: null,
            source: code,
            schema: dbRow.schema || {},
            metadata: dbRow.compiled_metadata || {},
            status: 'CACHED',
            error: null,
            updatedAt,
            compiledAt: null,
            compiledHash,
            runtimeMode:   dbRow.runtime_mode  || 'PAPER',
            runtimeParams: dbRow.runtime_params || {},
            runtimeState:  dbRow.runtime_state  || 'STOPPED',
        };
        _metaRegistry.set(id, cached);
        stateManager.commit(id, 'STAGED', { reason: 'compile_cache' });
        return cached;
    }

    const result = await _compileToClass(id, code);

    if (!result.ok) {
        _metaRegistry.set(id, {
            id,
            StrategyClass: null,
            source: code,
            schema: {},
            metadata: {},
            status: 'ERROR',
            error: result.error,
            updatedAt,
            compiledAt: null,
            compiledHash,
            runtimeMode:   dbRow.runtime_mode  || 'PAPER',
            runtimeParams: dbRow.runtime_params || {},
            runtimeState:  dbRow.runtime_state  || 'STOPPED',
        });
        stateManager.commit(id, 'ERROR', { reason: result.error });
        return null;
    }

    const entry = {
        id,
        StrategyClass: result.StrategyClass,
        source: code,
        schema: result.schema,
        metadata: result.metadata,
        status: 'COMPILED',
        error: null,
        updatedAt,
        compiledAt: Date.now(),
        compiledHash,
        runtimeMode:   dbRow.runtime_mode  || 'PAPER',
        runtimeParams: dbRow.runtime_params || {},
        runtimeState:  dbRow.runtime_state  || 'STOPPED',
    };

    _metaRegistry.set(id, entry);
    stateManager.commit(id, 'STAGED', { reason: 'compiled' });
    _updateRuntimeStateInDb(id, {
        schema: result.schema,
        compiledHash,
        compiledMetadata: result.metadata,
    }).catch(err => log.warn(`[COMPILE] Failed to persist cache for ${id}: ${err.message}`));

    return entry;
}

async function _ensureCompiled(id, meta) {
    if (meta?.StrategyClass) return meta;
    if (!meta?.source) throw new Error(`Strategy '${id}' has no source code to compile`);

    const existing = _metaRegistry.get(id);
    if (existing) {
        existing.compiledHash = null;
        existing.updatedAt = 0;
    }
    const compiled = await _compileAndRegisterMeta(id, meta.source, {
        runtime_mode: meta.runtimeMode,
        runtime_params: meta.runtimeParams,
        runtime_state: meta.runtimeState,
    });
    if (!compiled?.StrategyClass) {
        throw new Error(`Strategy '${id}' failed on-demand compile`);
    }
    return compiled;
}

async function _restoreDesiredRuntimeStates() {
    if (!db.hasDbConfig()) return;
    if (_envFalse(process.env.COREX_RESTORE_ON_BOOT)) return;
    try {
        // strategy_runtimes holds one row per runtime that was actually
        // ACTIVE (strategy + symbol + mode + params) — restore exactly
        // that set. No guessing a symbol, no loading every strategy.
        const { rows } = await db.query(
            `SELECT runtime_id, strategy_name, user_id, symbol, runtime_mode, params
             FROM strategy_runtimes
             WHERE actual_state = 'ACTIVE'
             ORDER BY strategy_name ASC`
        );
        for (const row of rows || []) {
            const id = String(row?.strategy_name || '').trim();
            const symbol = String(row?.symbol || '').trim();
            if (!id || !symbol) continue;
            startStrategy(id, {
                userId: row.user_id,
                symbol,
                mode: row.runtime_mode,
                params: row.params || {}
            }).catch(err => log.warn(`[RESTORE] Failed to start ${row.runtime_id}: ${err.message}`));
        }
    } catch (err) {
        log.warn(`[RESTORE] Failed: ${err.message}`);
    }
}

/**
 * Upsert a runtime's desired state into strategy_runtimes so a future
 * restart restores exactly this (strategy, symbol, mode) combo — not a
 * guess at the strategy's first declared symbol.
 */
async function _saveRuntimeDesiredState({ runtimeId, strategyName, userId, symbol, mode, params }) {
    if (!db.hasDbConfig()) return;
    await db.query(
        `INSERT INTO strategy_runtimes (runtime_id, user_id, strategy_name, symbol, runtime_mode, actual_state, params, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, NOW())
         ON CONFLICT (runtime_id) DO UPDATE
         SET actual_state = 'ACTIVE', params = EXCLUDED.params, updated_at = NOW()`,
        [runtimeId, userId, strategyName, symbol, mode, JSON.stringify(params || {})]
    );
}

/**
 * Mark a runtime stopped (or remove it) in strategy_runtimes so it's
 * excluded from the next boot's restore set.
 */
async function _clearRuntimeDesiredState(runtimeId) {
    if (!db.hasDbConfig()) return;
    await db.query(
        `UPDATE strategy_runtimes SET actual_state = 'STOPPED', updated_at = NOW() WHERE runtime_id = $1`,
        [runtimeId]
    );
}

async function _updateRuntimeStateInDb(id, data) {
    if (!db.hasDbConfig()) return;
    const sets = [];
    const vals = [];
    let i = 1;

    if (data.schema !== undefined) { sets.push(`schema = $${i++}`); vals.push(JSON.stringify(data.schema || {})); }
    if (data.compiledHash !== undefined) { sets.push(`compiled_hash = $${i++}`); vals.push(data.compiledHash); }
    if (data.compiledMetadata !== undefined) { sets.push(`compiled_metadata = $${i++}`); vals.push(JSON.stringify(data.compiledMetadata || {})); }
    if (data.runtimeParams !== undefined) { sets.push(`runtime_params = $${i++}`); vals.push(JSON.stringify(data.runtimeParams || {})); }
    if (data.runtimeMode !== undefined) { sets.push(`runtime_mode = $${i++}`); vals.push(data.runtimeMode); }
    if (data.runtimeState !== undefined) { sets.push(`runtime_state = $${i++}`); vals.push(data.runtimeState); }
    sets.push(`schema_updated_at = NOW()`);

    if (!sets.length) return;
    vals.push(id);

    try {
        await db.query(
            `UPDATE strategies SET ${sets.join(', ')} WHERE name = $${i}`,
            vals
        );
    } catch (err) {
        log.warn(`[PERSIST:${id}] update failed: ${err.message}`);
    }
}

async function _handleRuntimeParamUpdate(id, params) {
    if (!params || typeof params !== 'object') return;
    const meta = _metaRegistry.get(id);
    if (!meta) return;

    meta.runtimeParams = { ...(meta.runtimeParams || {}), ...params };

    for (const entry of runtimeRegistry.forStrategy(id)) {
        if (entry.instance) {
            if (typeof entry.instance.updateParams === 'function') {
                entry.instance.updateParams(params);
            } else if (entry.instance.params) {
                entry.instance.params = { ...(entry.instance.params || {}), ...params };
            }
        }
        entry.params = { ...(entry.params || {}), ...params };
    }
}

function getActiveSymbols() {
    return Array.from(new Set(runtimeRegistry.list().map(r => r.symbol)));
}

function getBootStats() {
    return { total: _metaRegistry.size };
}

async function bootStrategy(record) {
    const id = String(record?.name || '').trim();
    if (!id || !record.script_body) return null;
    return _compileAndRegisterMeta(id, record.script_body, record);
}

async function reloadStrategy(id) {
    if (!db.hasDbConfig()) return null;
    const { rows } = await db.query(
        `SELECT name, script_body, updated_at, runtime_mode, runtime_params, runtime_state
         FROM strategies WHERE name = $1 LIMIT 1`,
        [id]
    );
    const row = rows?.[0];
    if (!row) return null;
    const existing = _metaRegistry.get(id);
    if (existing) existing.updatedAt = 0;
    return _compileAndRegisterMeta(id, row.script_body, row);
}

async function startStrategy(id, options = {}) {
    const userId = options.userId || parseScopedId(id).userId || 'system';

    if (_startInFlight.has(id)) return { ok: false, reason: 'START_IN_PROGRESS' };
    _startInFlight.add(id);

    try {
        let meta = _metaRegistry.get(id);
        if (!meta) {
            const { rows } = await db.query(
                `SELECT name, script_body, updated_at, runtime_mode, runtime_params, runtime_state,
                        schema, compiled_hash, compiled_metadata
                 FROM strategies
                 WHERE name = $1 LIMIT 1`,
                [id]
            );
            const dbRow = rows?.[0];
            if (!dbRow) throw new Error(`Strategy '${id}' not found in DB`);
            meta = await _compileAndRegisterMeta(id, dbRow.script_body, dbRow);
        }

        if (!meta || meta.status === 'ERROR') throw new Error(`Strategy '${id}' not compiled`);
        meta = await _ensureCompiled(id, meta);

        const mode = String(options.mode || meta.runtimeMode || 'PAPER').toUpperCase();

        // ── Symbol selection (TradingView model) ───────────────────────────
        // A strategy declares the *universe* of symbols it knows how to trade
        // (its `symbols` array). Starting a runtime is choosing which one
        // chart it runs on for this instance — same script, one symbol,
        // exactly like applying an indicator/strategy to a specific chart.
        const declaredSymbols = (meta.metadata?.symbols || []).map(s => String(s).toUpperCase());
        if (declaredSymbols.length === 0) {
            throw new Error(`Strategy '${id}' declares no symbols — nothing to select`);
        }
        let symbol = options.symbol ? String(options.symbol).toUpperCase() : declaredSymbols[0];
        if (!declaredSymbols.includes(symbol)) {
            // Don't hard-fail on a symbol the client sent that isn't in the
            // universe (e.g. a stale 'EURUSD' default) — fall back to the first
            // declared symbol so the runtime still boots on a valid chart
            // instead of erroring out. Surfaced as a warning for observability.
            logger.warn(
                `[STRATEGY_BOOTLOADER] Symbol '${symbol}' not in ${id} universe ` +
                `(available: ${declaredSymbols.join(', ')}). Falling back to '${declaredSymbols[0]}'.`
            );
            symbol = declaredSymbols[0];
        }
        const runtimeId = `${id}::${symbol}::${mode}`;

        if (runtimeRegistry.has(runtimeId)) {
            return { ok: true, runtimeId, alreadyRunning: true };
        }

        const instance = new meta.StrategyClass();
        StrategyContract.adapt(instance);

        // Re-scope the instance to exactly the selected symbol. The class
        // may declare several symbols in its own constructor (its supported
        // universe), but each *runtime* trades only the one chosen above —
        // this.symbols[0] and the dataManager must agree with that, not with
        // whatever the source code's super({symbols:[...]}) listed.
        if (typeof instance.resetState === 'function' && instance.dataManager) {
            instance.symbols = [symbol];
            instance.dataManager = new (instance.dataManager.constructor)({
                symbols: [symbol],
                maxHistory: instance.max_data_history || meta.metadata?.max_data_history || 500
            });
        } else {
            instance.symbols = [symbol];
        }

        const mergedParams = { ...(meta.schema ? Object.fromEntries(Object.entries(meta.schema).map(([k, v]) => [k, v.default])) : {}), ...(meta.runtimeParams || {}), ...(options.params || {}) };
        instance.params = mergedParams;

        // ── Restore persistent state from DB ──────────────────────────────────
        // Load the strategy's saved state JSON and populate this.state before
        // the first tick arrives, so state survives restarts transparently.
        if (instance.state && typeof instance.state.restore === "function" && db.hasDbConfig()) {
            try {
                const { rows: stateRows } = await db.query(
                    `SELECT runtime_state_data FROM strategies WHERE name = $1 LIMIT 1`, [id]
                );
                const stored = stateRows?.[0]?.runtime_state_data;
                if (stored && typeof stored === "object") {
                    instance.state.restore(stored);
                }
            } catch (_) { /* non-fatal — start with empty state */ }
        }

        const lifecycle = new RuntimeLifecycle();
        await lifecycle.boot({
            runtimeId,
            strategyInstance: instance,
            profile: { runtimeId, strategyName: id, mode, symbol, userId, initialCash: options.initialCash || 100000, connectorType: options.connectorType || 'metaapi', params: mergedParams }
        });

        stateManager.commit(id, 'ACTIVE', { runtimeId, reason: 'started' });
        await _saveRuntimeDesiredState({ runtimeId, strategyName: id, userId, symbol, mode, params: mergedParams }).catch(() => {});

        await _updateRuntimeStateInDb(id, { runtimeMode: mode, runtimeState: 'RUNNING' }).catch(() => {});

        return { ok: true, runtimeId, mode, symbol, params: mergedParams };
    } catch (err) {
        log.error(`[START] Failed to start ${id}: ${err.message}`);
        return { ok: false, reason: err.message };
    } finally {
        _startInFlight.delete(id);
    }
}

async function stopStrategy(id, options = {}) {
    const userId = options.userId || parseScopedId(id).userId || 'system';
    // The frontend may send either the scoped id (userId::strategyName) or the
    // public/unscoped id (strategyName). Match both so Stop works regardless.
    const unscoped = id.includes('::') ? id.split('::').slice(1).join('::') : id;

    let targets = [];
    if (options.runtimeId) {
        targets = [options.runtimeId];
    } else {
        targets = runtimeRegistry.all()
            .filter(r =>
                (r.strategyName === id || r.strategyName === unscoped) &&
                (!r.userId || r.userId === userId || userId === 'system'))
            .map(r => r.runtimeId);
    }

    if (!targets.length) return false;

    const lc = new RuntimeLifecycle();
    let anyOk = false;
    for (const runtimeId of targets) {
        const ok = await lc.terminate(runtimeId);
        if (ok) {
            anyOk = true;
            await _clearRuntimeDesiredState(runtimeId).catch(() => {});
        }
    }

    if (anyOk) {
        const stillActive = runtimeRegistry.all().some(r =>
            (r.strategyName === id || r.strategyName === unscoped) &&
            (!r.userId || r.userId === userId || userId === 'system'));
        if (!stillActive) {
            await _updateRuntimeStateInDb(id, { runtimeState: 'STOPPED' }).catch(() => {});
            setTimeout(() => {
                if (!runtimeRegistry.all().some(r =>
                    (r.strategyName === id || r.strategyName === unscoped) &&
                    (!r.userId || r.userId === userId || userId === 'system'))) {
                    _metaRegistry.delete(id);
                }
            }, 5 * 60 * 1000);
        }
        stateManager.commit(id, 'STOPPED', { reason: 'stopped' });
    }
    return anyOk;
}

function getActiveInstance(id, runtimeIdInput = null) {
    if (runtimeIdInput) {
        const entry = runtimeRegistry.get(runtimeIdInput);
        return entry ? entry.instance : null;
    }
    const entries = runtimeRegistry.forStrategy(id);
    return entries.length ? entries[0].instance : null;
}

async function saveParams(id, patch) {
    if (!patch || typeof patch !== 'object') return;
    const meta = _metaRegistry.get(id);
    if (meta) {
        meta.runtimeParams = { ...(meta.runtimeParams || {}), ...patch };
    }
    await _updateRuntimeStateInDb(id, {
        runtimeParams: meta?.runtimeParams || patch,
    });
}

function getMeta(id) {
    return _metaRegistry.get(id);
}

/**
 * Drop a strategy's metadata entry (e.g. after a rename or delete, where
 * the DB row under the old id no longer exists and the cached compile
 * result would otherwise go stale).
 * @param {string} id
 */
function invalidateMeta(id) {
    return _metaRegistry.delete(id);
}

/**
 * Alias of getMeta() — kept distinct so callers that conceptually want
 * "the strategy" (vs. explicitly "the metadata") have a stable name.
 * @param {string} id
 */
function getStrategy(id) {
    return _metaRegistry.get(id);
}

/**
 * All strategies currently known to the metadata registry (compiled or cached).
 * Does NOT filter by user — callers (broadcaster, runtimeService) scope by
 * userId themselves using the `userId::strategyName` prefix on `.id`.
 */
function listStrategies() {
    return Array.from(_metaRegistry.values());
}

/**
 * All live runtimes (across modes/symbols) for a strategy, scoped to a user.
 */
function getRuntimesForStrategy(id, userId = null) {
    return runtimeRegistry.all().filter(r =>
        r.strategyName === id && (!userId || r.userId === userId)
    );
}

async function instantiateFromSource(code, id) {
    const securityOk = validateStrategyCode(code);
    if (!securityOk) {
        throw new Error('Security validation failed: code contains forbidden patterns');
    }

    const hashCheck = await verifyStrategyFile({ strategyName: id, filePath: null, code });
    if (!hashCheck.ok) {
        throw new Error(`Hash verification failed: ${hashCheck.reason}`);
    }

    const compiler = _compiler || (_compiler = _makeCompiler());
    const result = await compiler.compile(code, id);
    if (!result.success) {
        throw new Error(`Compile failed: ${result.error}`);
    }

    return result.instance;
}

module.exports = {
    init,
    bootStrategy,
    reloadStrategy,
    startStrategy,
    stopStrategy,
    getStrategy,
    getMeta,
    invalidateMeta,
    listStrategies,
    getActiveSymbols,
    getBootStats,
    getActiveInstance,
    getRuntimesForStrategy,
    saveParams,
    instantiateFromSource,
};