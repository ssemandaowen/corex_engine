import { create } from 'zustand';
import client, { getSessionAuthKey, getSessionToken } from '../api/client';

const normalizeTheme = (value) => {
    const theme = String(value || "").trim().toLowerCase();
    if (theme === "light") return "light";
    if (theme === "system") return "system";
    if (theme === "dim") return "dim";
    return "dark";
};

const applyUiTheme = (theme) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute("data-theme", normalizeTheme(theme));
};

const DEFAULT_EDITOR_PREFS = {
    theme: "auto",
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "JetBrains Mono, Menlo, Monaco, Courier New, monospace",
    minimap: false,
    wordWrap: "on"
};

const normalizeEditorTheme = (value) => {
    const t = String(value || "").trim().toLowerCase();
    if (["auto", "corex-dark", "corex-light", "vs-dark", "vs-light"].includes(t)) return t;
    return "auto";
};

const normalizeEditorPrefs = (value = {}) => {
    const next = { ...DEFAULT_EDITOR_PREFS, ...(value || {}) };
    next.theme = normalizeEditorTheme(next.theme);
    next.fontSize = Number.isFinite(Number(next.fontSize)) ? Number(next.fontSize) : DEFAULT_EDITOR_PREFS.fontSize;
    next.lineHeight = Number.isFinite(Number(next.lineHeight)) ? Number(next.lineHeight) : DEFAULT_EDITOR_PREFS.lineHeight;
    next.wordWrap = next.wordWrap === "off" ? "off" : "on";
    next.minimap = next.minimap === true;
    return next;
};

const loadEditorPrefs = () => {
    if (typeof window === "undefined" || !window.localStorage) return { ...DEFAULT_EDITOR_PREFS };
    try {
        const raw = window.localStorage.getItem("corex.editorPrefs");
        if (!raw) return { ...DEFAULT_EDITOR_PREFS };
        const parsed = JSON.parse(raw);
        return normalizeEditorPrefs(parsed || {});
    } catch {
        return { ...DEFAULT_EDITOR_PREFS };
    }
};

const timeframeToMs = (tf = "1m") => {
    const match = String(tf || "").trim().toLowerCase().match(/^(\d+)\s*(s|m|h|d|min|mins|hour|hours|day|days)$/);
    if (!match) return 60000;
    const n = Number(match[1]);
    if (!Number.isFinite(n) || n <= 0) return 60000;
    const unit = match[2];
    const unitMs = unit.startsWith("s")
        ? 1000
        : unit.startsWith("h")
            ? 3600000
            : unit.startsWith("d")
                ? 86400000
                : 60000;
    return n * unitMs;
};

const formatExecNumber = (value, preferredDecimals = null) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    const abs = Math.abs(n);
    let decimals = Number.isFinite(Number(preferredDecimals)) ? Number(preferredDecimals) : null;
    if (decimals == null) {
        if (abs >= 1000) decimals = 2;
        else if (abs >= 1) decimals = 4;
        else decimals = 6;
    }
    return n.toFixed(Math.max(0, Math.min(10, decimals))).replace(/\.?0+$/, "");
};

const INITIAL_SYSTEM_STATUS = {
    status: "DISCONNECTED",
    uptime: "0h 0m",
    resources: { cpu: "0.00", ram: "0.00 MB" },
    connectivity: { marketData: "DISCONNECTED", bridge: "DISCONNECTED" }
};

const WS_EVENT_BUFFER_LIMIT = 60;
const WS_NOISY_EVENT_TYPES = new Set([
    "DATA_TICK",
    "DATA_CANDLE",
    "STATUS_UPDATE",
    "FEED_METRICS",
    "MT5_BRIDGE_STATUS",
    "MT5_HEARTBEAT"
]);

const WS_BASE_CHANNELS = ["status", "system"];
const WS_PROFILES = {
    home: ["status", "system", "feed", "market", "execution", "strategy"],
    strategies: ["status", "system", "strategy", "execution"],
    run: ["status", "system", "feed", "market", "execution", "strategy", "mt5"],
    data: ["status", "system", "execution", "market"],
    account: ["status", "system", "execution", "mt5"],
    settings: ["status", "system"]
};

const normalizeWsEvent = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const type = String(raw.type || raw.eventType || raw.event || "").trim().toUpperCase();
    if (!type) return null;

    const payload = raw.payload && typeof raw.payload === "object" ? raw.payload : {};
    const metaIn = raw.meta && typeof raw.meta === "object" ? raw.meta : {};
    const strategyId =
        String(metaIn.strategyId || payload.strategyId || payload.strategy_id || payload.id || "").trim();

    return {
        type,
        payload,
        meta: {
            ts: Number(metaIn.ts || raw.ts || Date.now()),
            eventId: String(metaIn.eventId || raw.eventId || ""),
            category: String(metaIn.category || raw.category || ""),
            channel: String(metaIn.channel || ""),
            userId: String(metaIn.userId || ""),
            strategyId
        }
    };
};

export const useStore = create((set, get) => {
    const TERMINAL_LIMIT = 600;
    const STRATEGY_TERMINAL_LIMIT = 400;

    // Tracks what we believe we have subscribed to on the current WS connection.
    // This is intentionally not part of reactive state (avoid re-renders).
    const wsSubState = {
        channels: new Set(),
        symbols: new Set()
    };

    const normalizeStrategyKey = (strategyId) => {
        const raw = String(strategyId || "").trim();
        if (!raw) return "";
        const parts = raw.split("::");
        return parts.length >= 2 ? parts[parts.length - 1] : raw;
    };

    const pushTerminal = (kind, entry) => {
        if (!entry) return;
        if (kind === "app") {
            set((s) => ({ appTerminal: [entry, ...(s.appTerminal || [])].slice(0, TERMINAL_LIMIT) }));
            return;
        }
        if (kind === "exec") {
            set((s) => ({ execTerminal: [entry, ...(s.execTerminal || [])].slice(0, TERMINAL_LIMIT) }));
            return;
        }
    };

    const pushStrategyTerminal = (strategyKey, entry) => {
        const key = normalizeStrategyKey(strategyKey);
        if (!key || !entry) return;
        set((s) => {
            const prev = s.stratTerminalById && typeof s.stratTerminalById === "object" ? s.stratTerminalById : {};
            const arr = Array.isArray(prev[key]) ? prev[key] : [];
            return {
                stratTerminalById: {
                    ...prev,
                    [key]: [entry, ...arr].slice(0, STRATEGY_TERMINAL_LIMIT)
                }
            };
        });
    };

    const wsSend = (message) => {
        const ws = get()._ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        try {
            ws.send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    };

    const wsSubscribe = ({ channels = null, symbols = null } = {}) => {
        const chList = Array.isArray(channels) ? channels.map((c) => String(c || "").trim().toLowerCase()).filter(Boolean) : [];
        const symList = Array.isArray(symbols) ? symbols.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean) : [];

        if (chList.length === 0 && symList.length === 0) return;
        chList.forEach((c) => wsSubState.channels.add(c));
        symList.forEach((s) => wsSubState.symbols.add(s));
        wsSend({ type: "SUBSCRIBE", payload: { channels: chList, symbols: symList } });
    };

    const wsUnsubscribe = ({ channels = null, symbols = null } = {}) => {
        const chList = Array.isArray(channels) ? channels.map((c) => String(c || "").trim().toLowerCase()).filter(Boolean) : [];
        const symList = Array.isArray(symbols) ? symbols.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean) : [];

        if (chList.length === 0 && symList.length === 0) return;
        chList.forEach((c) => wsSubState.channels.delete(c));
        symList.forEach((s) => wsSubState.symbols.delete(s));
        wsSend({ type: "UNSUBSCRIBE", payload: { channels: chList, symbols: symList } });
    };

    const applyDesiredChannels = (desiredChannels = []) => {
        const next = Array.isArray(desiredChannels)
            ? desiredChannels.map((c) => String(c || "").trim().toLowerCase()).filter(Boolean)
            : [];

        const channelsToAdd = next.filter((c) => !wsSubState.channels.has(c));
        const channelsToRemove = Array.from(wsSubState.channels).filter((c) => !next.includes(c));

        // If market is being removed, drop all symbol subscriptions too (ticks/candles are hot path).
        const removingMarket = channelsToRemove.includes("market") && !next.includes("market");
        if (removingMarket) {
            const symbolsToRemove = Array.from(wsSubState.symbols);
            if (symbolsToRemove.length) wsUnsubscribe({ symbols: symbolsToRemove });
            wsSubState.symbols.clear();
        }

        if (channelsToRemove.length) wsUnsubscribe({ channels: channelsToRemove });
        if (channelsToAdd.length) wsSubscribe({ channels: channelsToAdd });
    };

    const syncWsSubscriptions = () => {
        // Symbol subscriptions only matter when market channel is active.
        if (!wsSubState.channels.has("market") && !wsSubState.channels.has("all")) return;

        const desiredSymbols = new Set();
        const live = get().strategiesLive;
        if (Array.isArray(live)) {
            for (const s of live) {
                const syms = Array.isArray(s?.symbols) ? s.symbols : [];
                for (const symRaw of syms) {
                    const sym = String(symRaw || "").trim().toUpperCase();
                    if (sym) desiredSymbols.add(sym);
                }
            }
        }

        const symbolsToAdd = Array.from(desiredSymbols).filter((s) => !wsSubState.symbols.has(s));
        const symbolsToRemove = Array.from(wsSubState.symbols).filter((s) => !desiredSymbols.has(s));

        if (symbolsToRemove.length) wsUnsubscribe({ symbols: symbolsToRemove });
        if (symbolsToAdd.length) wsSubscribe({ channels: ['market'], symbols: symbolsToAdd });
    };

    return ({
    // --- State ---
    systemStatus: { ...INITIAL_SYSTEM_STATUS },
    pulse: null,
    resourceTrend: { cpu: [], ram: [] },
    strategiesLive: [],
    feedMode: 'all',
    feedMetrics: null,
    wsStatus: "DISCONNECTED",
    browserOnline: (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    lastOfflineAt: 0,
    wsEvents: [],
    wsLastEvent: null,
    latestTicks: {},
    tickCount: 0,
    apiStatus: "UNKNOWN",
    strategies: [],
    selectedStrategy: null,
    currentCode: "",
    logs: [],
    // Terminal buffers
    appTerminal: [],
    execTerminal: [],
    stratTerminalById: {}, // strategyKey -> []
    activityLoggerOpen: (typeof window !== "undefined" && window.localStorage?.getItem("corex.activityLogger.open") !== "0"),
    strategyTerminalOpenById: {},
    isLoading: false,
    systemSettings: null,
    persistedSettings: null,
    settingsLoading: false,
    realtimeMode: (typeof window !== "undefined" && window.localStorage?.getItem("corex.realtimeMode")) || "ws",
    wsProfile: (typeof window !== "undefined" && window.localStorage?.getItem("corex.wsProfile")) || "home",
    uiTheme: normalizeTheme((typeof window !== "undefined" && window.localStorage?.getItem("corex.uiTheme")) || "dark"),
    activeAccountMode: (typeof window !== "undefined" && window.localStorage?.getItem("corex.accountMode")) || "paper",
    editorPrefs: loadEditorPrefs(),
    mt5Account: null,
    mt5Positions: [],
    mt5Status: null,
    accountSnapshots: { paper: null, live: null },
    runConfig: null,
    executionOps: null,
    liveCandles: {},
    tradeTape: [],
    workerStates: {},
    backtestProgressByJob: {},

    // --- Internal Refs ---
    _ws: null,
    _apiDownUntil: 0,
    _wsAttempts: 0,
    _wsManualClose: false,
    _wsReconnectTimer: null,
    _liveRefreshTimer: null,
    _wsSend: wsSend,
    wsSubscribe,
    wsUnsubscribe,
    syncWsSubscriptions,
    toggleActivityLogger: () => {
        const next = !get().activityLoggerOpen;
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("corex.activityLogger.open", next ? "1" : "0");
        }
        set({ activityLoggerOpen: next });
    },
    setActivityLoggerOpen: (open) => {
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("corex.activityLogger.open", open ? "1" : "0");
        }
        set({ activityLoggerOpen: open !== false });
    },
    setStrategyTerminalOpen: (strategyId, open) => {
        const key = normalizeStrategyKey(strategyId);
        if (!key) return;
        set((s) => ({
            strategyTerminalOpenById: {
                ...(s.strategyTerminalOpenById || {}),
                [key]: open !== false
            }
        }));
    },
    getStrategyTerminalOpen: (strategyId) => {
        const key = normalizeStrategyKey(strategyId);
        if (!key) return false;
        const map = get().strategyTerminalOpenById || {};
        if (Object.prototype.hasOwnProperty.call(map, key)) return !!map[key];
        return false;
    },
    setWsProfile: (profile) => {
        const next = String(profile || "home");
        const normalized = Object.prototype.hasOwnProperty.call(WS_PROFILES, next) ? next : "home";
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("corex.wsProfile", normalized);
        }
        set({ wsProfile: normalized });
        applyDesiredChannels(WS_PROFILES[normalized] || WS_PROFILES.home);
        // Ensure symbol subscriptions are right for the current profile.
        syncWsSubscriptions();
    },
    clearTerminal: ({ tab = "app", strategyId = "" } = {}) => {
        const t = String(tab || "app").toLowerCase();
        if (t === "execution") return set({ execTerminal: [] });
        if (t === "strategy") {
            const key = normalizeStrategyKey(strategyId);
            if (!key) return set({ stratTerminalById: {} });
            return set((s) => ({
                stratTerminalById: {
                    ...(s.stratTerminalById || {}),
                    [key]: []
                }
            }));
        }
        return set({ appTerminal: [] });
    },

    // --- Helpers ---
    _apiCooldownActive: () => Date.now() < (get()._apiDownUntil || 0),
    _scheduleLiveStrategiesRefresh: () => {
        if (get()._liveRefreshTimer) return;
        const timer = setTimeout(() => {
            set({ _liveRefreshTimer: null });
            get().fetchLiveStrategies();
        }, 800);
        set({ _liveRefreshTimer: timer });
    },

    _request: async (path, method = 'get', body = null) => {
        if (!get().browserOnline) {
            set({ apiStatus: "OFFLINE" });
            return null;
        }
        if (get()._apiCooldownActive()) return null;
        try {
            const res = await client[method](path, body);
            set({ apiStatus: "OK", _apiDownUntil: 0 });
            return res.payload || res.data || res;
        } catch {
            set({ apiStatus: "DOWN", _apiDownUntil: Date.now() + 5000 });
            if (path === '/system/heartbeat') set({ systemStatus: { ...INITIAL_SYSTEM_STATUS } });
            return null;
        }
    },

    _ingestWsEvent: (rawMsg) => {
        const msg = normalizeWsEvent(rawMsg);
        if (!msg || !msg.type) return;
        switch (msg.type) {
            case "SYSTEM_LOG":
            case "SYSTEM_ERROR": {
                const payload = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
                const meta = msg.meta && typeof msg.meta === "object" ? msg.meta : {};
                const level = String(payload.level || (msg.type === "SYSTEM_ERROR" ? "error" : "info")).toLowerCase();
                const moduleName = String(payload.module || payload.source || meta.module || meta.category || "APP");
                const message = String(payload.message || payload.error || payload.reason || payload.msg || payload.text || "").trim();
                if (!message) break;

                const entry = {
                    ts: Number(meta.ts || Date.now()),
                    level,
                    module: moduleName,
                    message,
                    category: String(meta.category || payload.meta?.category || "system"),
                    strategyId: String(meta.strategyId || payload.strategyId || payload.meta?.strategyId || "")
                };

                const stratKey = entry.strategyId || (moduleName.startsWith("STRATEGY:") ? moduleName.slice("STRATEGY:".length) : "");
                if (stratKey) pushStrategyTerminal(stratKey, entry);
                else pushTerminal("app", entry);
                break;
            }
            case "STATUS_UPDATE":
                if (msg.payload?.systemStatus) set({ systemStatus: msg.payload.systemStatus });
                if (msg.payload?.pulse) {
                    const pulse = msg.payload.pulse;
                    const cpu = Number(pulse?.resources?.cpuPct || 0);
                    const ram = Number(pulse?.resources?.ramPct || 0);
                    set((s) => ({
                        pulse,
                        resourceTrend: {
                            cpu: [...(s.resourceTrend?.cpu || []), cpu].slice(-32),
                            ram: [...(s.resourceTrend?.ram || []), ram].slice(-32)
                        }
                    }));
                }
                if (Array.isArray(msg.payload?.strategies)) set({ strategiesLive: msg.payload.strategies });
                if (msg.payload?.accounts) set({ accountSnapshots: msg.payload.accounts });
                break;
            case "FEED_METRICS":
                if (msg.payload) set({ feedMetrics: msg.payload });
                break;
            case "DATA_TICK": {
                const symbol = msg.payload?.symbol || msg.payload?.instrument;
                const price = Number(msg.payload?.price ?? msg.payload?.close ?? 0);
                if (!symbol || !Number.isFinite(price)) break;
                set((s) => {
                    const prev = s.latestTicks[symbol];
                    const ts = Number(msg.payload?.time ?? msg.payload?.timestamp ?? Date.now());
                    const tf = msg.payload?.timeframe || msg.payload?.interval || s.runConfig?.defaultTimeframe || "1m";
                    const tfMs = timeframeToMs(tf);
                    const bucket = Math.floor(ts / tfMs) * tfMs;
                    const existingSeries = Array.isArray(s.liveCandles[symbol]) ? s.liveCandles[symbol] : [];
                    const tail = existingSeries[existingSeries.length - 1];
                    let nextSeries = existingSeries;
                    if (!tail || Number(tail.time) !== bucket) {
                        nextSeries = [...existingSeries, {
                            time: bucket,
                            open: price,
                            high: price,
                            low: price,
                            close: price,
                            volume: Number(msg.payload?.volume ?? 0)
                        }].slice(-300);
                    } else {
                        nextSeries = [...existingSeries.slice(0, -1), {
                            ...tail,
                            high: Math.max(Number(tail.high || price), price),
                            low: Math.min(Number(tail.low || price), price),
                            close: price,
                            volume: Number(tail.volume || 0) + Number(msg.payload?.volume ?? 0)
                        }];
                    }
                    return {
                        latestTicks: {
                            ...s.latestTicks,
                            [symbol]: {
                                price,
                                change: prev ? price - Number(prev.price || 0) : 0,
                                at: Date.now()
                            }
                        },
                        liveCandles: {
                            ...s.liveCandles,
                            [symbol]: nextSeries
                        },
                        tickCount: (s.tickCount || 0) + 1
                    };
                });
                break;
            }
            case "DATA_CANDLE": {
                const symbol = msg.payload?.symbol || msg.payload?.instrument;
                const time = Number(msg.payload?.time ?? msg.payload?.timestamp ?? Date.now());
                const open = Number(msg.payload?.open ?? msg.payload?.price ?? 0);
                const high = Number(msg.payload?.high ?? open);
                const low = Number(msg.payload?.low ?? open);
                const close = Number(msg.payload?.close ?? msg.payload?.price ?? open);
                const volume = Number(msg.payload?.volume ?? 0);
                if (!symbol || !Number.isFinite(time) || ![open, high, low, close].every(Number.isFinite)) break;
                set((s) => {
                    const prev = Array.isArray(s.liveCandles[symbol]) ? s.liveCandles[symbol] : [];
                    const nextCandle = { time, open, high, low, close, volume };
                    const merged = [...prev, nextCandle]
                        .sort((a, b) => a.time - b.time)
                        .filter((v, i, arr) => i === 0 || v.time !== arr[i - 1].time)
                        .slice(-300);
                    return { liveCandles: { ...s.liveCandles, [symbol]: merged } };
                });
                break;
            }
            case "ORDER_FILLED":
            case "ORDER_CREATED":
            case "ORDER_CANCELLED":
            case "ORDER_UPDATED":
            case "POSITION_UPDATED":
            case "PORTFOLIO_UPDATED":
            case "STRATEGY_SIGNAL": {
                // Also mirror execution-related events into the execution terminal for quick operator debugging.
                const meta = msg.meta && typeof msg.meta === "object" ? msg.meta : {};
                const p = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
                const strategyId = String(
                    meta.strategyId ||
                    p.strategyId ||
                    p.strategy_id ||
                    p.strategyName ||
                    p.strategy_name ||
                    ""
                ).trim();
                const symbol = String(p.symbol || p.instrument || "").trim().toUpperCase();
                const side = String(p.side || "").trim().toUpperCase();
                const intent = String(p.intent || "").trim().toUpperCase();
                const qtyRaw = p.quantity ?? p.qty;
                const qty = formatExecNumber(qtyRaw, 6);
                const priceRaw = p.fill_price ?? p.fillPrice ?? p.price ?? p.close;
                const price = formatExecNumber(priceRaw);
                const orderId = String(p.order_id || p.orderId || p.id || "").trim();
                const parts = [
                    msg.type,
                    symbol,
                    side,
                    intent,
                    qty ? `qty=${qty}` : "",
                    price ? `${p.fill_price != null || p.fillPrice != null ? "fill" : "price"}=${price}` : "",
                    orderId ? `id=${orderId}` : ""
                ].filter(Boolean);

                const normalizedPayload = {
                    ...p,
                    strategyId,
                    symbol,
                    side,
                    intent,
                    quantity: Number(qtyRaw ?? 0),
                    price: Number(priceRaw ?? NaN),
                    orderId
                };

                pushTerminal("exec", {
                    ts: Number(meta.ts || Date.now()),
                    level: "info",
                    module: "EXEC",
                    message: parts.join(" "),
                    category: String(meta.category || "execution"),
                    strategyId
                });
                if (strategyId) {
                    pushStrategyTerminal(strategyId, {
                        ts: Number(meta.ts || Date.now()),
                        level: "info",
                        module: "EXEC",
                        message: parts.join(" "),
                        category: String(meta.category || "execution"),
                        strategyId
                    });
                }

                set((s) => ({
                    tradeTape: [{
                        type: msg.type,
                        ts: msg.meta?.ts || Date.now(),
                        payload: normalizedPayload
                    }, ...s.tradeTape].slice(0, 200)
                }));
                break;
            }
            case "WORKER_STATE": {
                const payload = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
                const meta = msg.meta && typeof msg.meta === "object" ? msg.meta : {};
                const strategyId = String(payload.strategyId || meta.strategyId || "").trim();
                const strategyKey = normalizeStrategyKey(strategyId) || strategyId;
                const state = String(payload.state || "").toUpperCase();
                const detail = String(payload.error || payload.reason || payload.message || "").trim();

                set((s) => ({
                    workerStates: {
                        ...(s.workerStates || {}),
                        [strategyKey || "global"]: {
                            strategyId,
                            state,
                            ts: Number(meta.ts || Date.now()),
                            detail,
                            payload
                        }
                    }
                }));

                const entry = {
                    ts: Number(meta.ts || Date.now()),
                    level: ["ERROR", "INIT_ERROR", "EXITED"].includes(state) ? "warn" : "info",
                    module: "WORKER",
                    message: [strategyId || "worker", state, detail].filter(Boolean).join(" "),
                    category: String(meta.category || "system"),
                    strategyId
                };
                if (strategyId) pushStrategyTerminal(strategyId, entry);
                else pushTerminal("app", entry);

                if (["READY", "EXITED", "ERROR", "INIT_ERROR", "STOPPED"].includes(state)) {
                    get()._scheduleLiveStrategiesRefresh();
                }
                break;
            }
            case "BACKTEST_PROGRESS": {
                const payload = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
                const meta = msg.meta && typeof msg.meta === "object" ? msg.meta : {};
                const jobId = String(payload.jobId || "").trim();
                const progress = payload.progress && typeof payload.progress === "object" ? payload.progress : {};
                if (!jobId) break;

                set((s) => ({
                    backtestProgressByJob: {
                        ...(s.backtestProgressByJob || {}),
                        [jobId]: {
                            jobId,
                            status: String(payload.status || ""),
                            progress,
                            resultMeta: payload.resultMeta && typeof payload.resultMeta === "object" ? payload.resultMeta : null,
                            error: String(payload.error || ""),
                            ts: Number(meta.ts || Date.now())
                        }
                    }
                }));

                const message = String(progress.message || payload.error || payload.status || "Backtest update");
                pushTerminal("app", {
                    ts: Number(meta.ts || Date.now()),
                    level: String(payload.status || "").toLowerCase() === "failed" ? "error" : "info",
                    module: "BACKTEST",
                    message: `[${jobId}] ${message}`,
                    category: String(meta.category || "execution"),
                    strategyId: ""
                });
                break;
            }
            case "STRATEGY_STATE":
            case "STRATEGY_START":
            case "STRATEGY_STOP":
            case "STRATEGY_LOADED":
            case "STRATEGY_UNLOADED":
                get()._scheduleLiveStrategiesRefresh();
                break;
            case "PARAM_UPDATE":
                get().fetchSystemSettings();
                break;
            case "MT5_ACCOUNT_SYNC":
                if (msg.payload?.payload) set({ mt5Account: msg.payload.payload });
                else if (msg.payload) set({ mt5Account: msg.payload });
                break;
            case "MT5_POSITIONS_SYNC":
                if (Array.isArray(msg.payload?.payload)) set({ mt5Positions: msg.payload.payload });
                break;
            case "MT5_BRIDGE_STATUS":
                if (msg.payload?.account) set({ mt5Account: msg.payload.account });
                if (Array.isArray(msg.payload?.positions)) set({ mt5Positions: msg.payload.positions });
                set({ mt5Status: msg.payload || null });
                break;
            case "MT5_CONNECTED":
            case "MT5_DISCONNECTED":
            case "MT5_AUTHORIZED":
            case "MT5_AUTH_FAILED":
            case "MT5_HEARTBEAT":
                get().fetchSystemStatus();
                break;
            default:
                break;
        }
    },

    // --- Actions ---
    fetchSystemStatus: async () => {
        const payload = await get()._request('/system/heartbeat');
        if (payload) set({ systemStatus: payload });
    },

    fetchPulse: async () => {
        const payload = await get()._request('/system/heartbeat');
        const cpu = Number(payload?.resources?.cpuPct || 0);
        const ram = Number(payload?.resources?.ramPct || 0);
        set((s) => ({
            pulse: payload,
            resourceTrend: {
                cpu: [...(s.resourceTrend?.cpu || []), cpu].slice(-32),
                ram: [...(s.resourceTrend?.ram || []), ram].slice(-32)
            }
        }));
    },

    fetchLiveStrategies: async () => {
        const payload = await get()._request('/run/status');
        if (payload) {
            set({ strategiesLive: Array.isArray(payload) ? payload : Object.values(payload) });
            syncWsSubscriptions();
        }
    },

    fetchSystemSettings: async () => {
        set({ settingsLoading: true });
        const payload = await get()._request('/system/settings');
        set({ systemSettings: payload?.runtime, persistedSettings: payload?.persisted, settingsLoading: false });
        const persistedMode = payload?.persisted?.payload?.ui?.realtimeMode;
        const persistedTheme = payload?.persisted?.payload?.ui?.theme;
        const persistedAccountMode = payload?.persisted?.payload?.ui?.activeAccountMode;
        const persistedEditorPrefs = payload?.persisted?.payload?.ui?.editor;
        if (persistedMode) {
            if (typeof window !== "undefined" && window.localStorage) {
                window.localStorage.setItem("corex.realtimeMode", persistedMode);
            }
            set({ realtimeMode: persistedMode });
        }
        if (persistedTheme) {
            const nextTheme = normalizeTheme(persistedTheme);
            if (typeof window !== "undefined" && window.localStorage) {
                window.localStorage.setItem("corex.uiTheme", nextTheme);
            }
            applyUiTheme(nextTheme);
            set({ uiTheme: nextTheme });
        }
        if (persistedAccountMode) {
            const nextMode = String(persistedAccountMode).toLowerCase() === "live" ? "live" : "paper";
            if (typeof window !== "undefined" && window.localStorage) {
                window.localStorage.setItem("corex.accountMode", nextMode);
            }
            set({ activeAccountMode: nextMode });
        }
        if (persistedEditorPrefs && typeof persistedEditorPrefs === "object") {
            const nextPrefs = normalizeEditorPrefs(persistedEditorPrefs);
            if (typeof window !== "undefined" && window.localStorage) {
                window.localStorage.setItem("corex.editorPrefs", JSON.stringify(nextPrefs));
            }
            set({ editorPrefs: nextPrefs });
        }
    },

    updateSystemSettings: async (settings, persist = true) => {
        set({ settingsLoading: true });
        const payload = await get()._request('/system/settings', 'patch', { settings, persist });
        set({ systemSettings: payload, settingsLoading: false });
        return payload;
    },

    fetchFeedMetrics: async () => {
        const payload = await get()._request('/system/feed/metrics');
        set({ feedMetrics: payload });
    },

    fetchMt5Status: async () => {
        const payload = await get()._request('/system/mt5/status');
        if (!payload) return;
        set({
            mt5Status: payload,
            mt5Account: payload.account || null,
            mt5Positions: Array.isArray(payload.positions) ? payload.positions : []
        });
    },

    fetchRunConfig: async () => {
        const payload = await get()._request('/system/run/settings');
        if (payload) set({ runConfig: payload });
        return payload;
    },

    fetchExecutionOps: async (params = {}) => {
        const staleAgeSec = Number(params?.staleAgeSec || 300);
        const includeEvents = params?.includeEvents === true;
        const eventLimit = Number(params?.eventLimit || 20);
        const query = new URLSearchParams({
            staleAgeSec: String(Number.isFinite(staleAgeSec) ? staleAgeSec : 300),
            includeEvents: includeEvents ? "true" : "false",
            eventLimit: String(Number.isFinite(eventLimit) ? eventLimit : 20)
        }).toString();
        const payload = await get()._request(`/run/ops/telemetry?${query}`);
        if (payload) set({ executionOps: payload });
        return payload;
    },

    // --- Reactive Controllers (One-shot on demand) ---
    startFeedMetrics: () => get().fetchFeedMetrics(),
    stopFeedMetrics: () => {},

    startPulse: () => get().fetchPulse(),
    stopPulse: () => {},

    startLiveStrategies: () => get().fetchLiveStrategies(),
    stopLiveStrategies: () => {},

    setFeedMode: (mode) => set({ feedMode: mode }),
    setBrowserOnline: (online) => {
        const next = online !== false;
        const prev = get().browserOnline;
        if (prev === next) return;

        set({
            browserOnline: next,
            apiStatus: next ? get().apiStatus : "OFFLINE",
            lastOfflineAt: next ? get().lastOfflineAt : Date.now()
        });

        if (!next) {
            get().disconnectWebSocket();
            set({ wsStatus: "OFFLINE" });
            return;
        }

        if (get().realtimeMode === "ws") get().connectWebSocket();
        get().fetchSystemStatus();
        get().fetchFeedMetrics();
        get().fetchLiveStrategies();
        get().fetchMt5Status();
    },
    setRealtimeMode: (mode) => {
        const next = mode === "polling" ? "polling" : "ws";
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("corex.realtimeMode", next);
        }
        set({ realtimeMode: next });
        if (next === "polling") get().disconnectWebSocket();
        if (next === "ws" && get().browserOnline) get().connectWebSocket();
        get().updateSystemSettings({ ui: { realtimeMode: next } }, true);
    },
    setUiTheme: (theme) => {
        const next = normalizeTheme(theme);
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("corex.uiTheme", next);
        }
        applyUiTheme(next);
        set({ uiTheme: next });
        get().updateSystemSettings({ ui: { theme: next } }, true);
    },
    setActiveAccountMode: (mode) => {
        const next = String(mode || "paper").toLowerCase() === "live" ? "live" : "paper";
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("corex.accountMode", next);
        }
        set({ activeAccountMode: next });
        get().updateSystemSettings({ ui: { activeAccountMode: next } }, true);
        get()._request('/system/account/mode', 'patch', { mode: next });
    },
    setEditorPrefs: (patch, persist = true) => {
        const next = normalizeEditorPrefs({
            ...DEFAULT_EDITOR_PREFS,
            ...(get().editorPrefs || {}),
            ...(patch || {})
        });
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("corex.editorPrefs", JSON.stringify(next));
        }
        set({ editorPrefs: next });
        if (persist) get().updateSystemSettings({ ui: { editor: next } }, true);
    },

    // --- Strategy Management ---
    fetchStrategies: async () => {
        const res = await get()._request('/strategies');
        set({ strategies: Array.isArray(res) ? res : [] });
    },

    fetchCode: async (id) => {
        set({ isLoading: true });
        const res = await get()._request(`/strategies/${id}/code`);
        set({ currentCode: res?.code || "", isLoading: false });
    },

    saveStrategy: async (name, code) => {
        const res = await get()._request('/strategies/create', 'post', { name, code });
        if (res) await get().fetchStrategies();
        return !!res;
    },

    deleteStrategy: async (id) => {
        if (!window.confirm("Delete strategy?")) return;
        const res = await get()._request(`/strategies/${id}`, 'delete');
        if (res) {
            set({ selectedStrategy: null, currentCode: "" });
            await get().fetchStrategies();
        }
    },

    transitionState: async (id, action) => {
        const data = await get()._request(`/strategies/${id}/${action}`, 'post');
        if (data) {
            set((s) => ({
                logs: [{ state: data.status, timestamp: Date.now(), reason: `Action: ${action.toUpperCase()}` }, ...s.logs].slice(0, 50)
            }));
            await get().fetchStrategies();
        }
    },

    setSelectedStrategy: (strat) => set({ selectedStrategy: strat }),

    // --- WebSocket ---
    connectWebSocket: () => {
        if (get().realtimeMode !== "ws") return;
        if (!get().browserOnline) {
            set({ wsStatus: "OFFLINE" });
            return;
        }
        if (get()._ws?.readyState <= 1) return;
        if (get()._wsReconnectTimer) {
            clearTimeout(get()._wsReconnectTimer);
            set({ _wsReconnectTimer: null });
        }

        const url = new URL(import.meta.env.VITE_API_URL || 'http://localhost:3000/api');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/ws';
        const token = getSessionToken();
        const authKey = getSessionAuthKey();
        if (token) url.searchParams.set("token", token);
        else if (authKey) url.searchParams.set("authKey", authKey);

        const ws = new WebSocket(url.toString());
        set({ _ws: ws, wsStatus: "CONNECTING", _wsManualClose: false });

        ws.onopen = () => {
            set({ wsStatus: "CONNECTED", _wsAttempts: 0 });
            // New server default is status-only; explicitly subscribe for UI features.
            // Resubscribe on every (re)connect.
            wsSubState.channels.clear();
            wsSubState.symbols.clear();
            wsSubscribe({ channels: WS_BASE_CHANNELS });
            // Apply the last selected WS profile (per-view subscription policy).
            const prof = get().wsProfile || "home";
            applyDesiredChannels(WS_PROFILES[prof] || WS_PROFILES.home);
            get().fetchSystemStatus();
            get().fetchFeedMetrics();
            get().fetchLiveStrategies();
            get().fetchMt5Status();
            get().fetchRunConfig();
            get().fetchExecutionOps();
        };
        ws.onmessage = (e) => {
            try {
                const raw = JSON.parse(e.data);
                const msg = normalizeWsEvent(raw);
                if (!msg) return;
                const type = String(msg?.type || "");
                if (!WS_NOISY_EVENT_TYPES.has(type)) {
                    set((s) => ({
                        wsLastEvent: msg,
                        wsEvents: [msg, ...s.wsEvents].slice(0, WS_EVENT_BUFFER_LIMIT)
                    }));
                }
                get()._ingestWsEvent(msg);
            } catch {
                // ignore malformed ws payload
            }
        };
        ws.onerror = () => {
            set({ wsStatus: get().browserOnline ? "ERROR" : "OFFLINE" });
        };
        ws.onclose = () => {
            set({ wsStatus: get().browserOnline ? "DISCONNECTED" : "OFFLINE", _ws: null });
            if (get()._wsManualClose) return;
            if (!get().browserOnline) return;
            if (get().realtimeMode !== "ws") return;
            const delay = Math.min(10000, 1000 * (get()._wsAttempts + 1));
            const timer = setTimeout(() => {
                set({ _wsReconnectTimer: null });
                get().connectWebSocket();
            }, delay);
            set(s => ({ _wsAttempts: s._wsAttempts + 1, _wsReconnectTimer: timer }));
        };
    },

    disconnectWebSocket: () => {
        set({ _wsManualClose: true });
        if (get()._wsReconnectTimer) {
            clearTimeout(get()._wsReconnectTimer);
            set({ _wsReconnectTimer: null });
        }
        if (get()._liveRefreshTimer) {
            clearTimeout(get()._liveRefreshTimer);
            set({ _liveRefreshTimer: null });
        }
        const ws = get()._ws;
        if (ws) {
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close(1000, "manual-close");
                } else if (ws.readyState === WebSocket.CONNECTING) {
                    ws.onopen = () => {
                        try { ws.close(1000, "manual-close"); } catch { /* noop */ }
                    };
                }
            } catch {
                // noop
            }
        }
        set({ _ws: null, wsStatus: get().browserOnline ? "DISCONNECTED" : "OFFLINE" });
    }
    });
});

export default useStore;
