import { create } from 'zustand';
import client from '../api/client';

const normalizeTheme = (value) => {
    const theme = String(value || "").trim().toLowerCase();
    if (theme === "light") return "light";
    if (theme === "system") return "system";
    return "dark";
};

const applyUiTheme = (theme) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute("data-theme", normalizeTheme(theme));
};

const DEFAULT_EDITOR_PREFS = {
    theme: "corex-dark",
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "JetBrains Mono, Menlo, Monaco, Courier New, monospace",
    minimap: false,
    wordWrap: "on"
};

const loadEditorPrefs = () => {
    if (typeof window === "undefined" || !window.localStorage) return { ...DEFAULT_EDITOR_PREFS };
    try {
        const raw = window.localStorage.getItem("corex.editorPrefs");
        if (!raw) return { ...DEFAULT_EDITOR_PREFS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_EDITOR_PREFS, ...(parsed || {}) };
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

const INITIAL_SYSTEM_STATUS = {
    status: "DISCONNECTED",
    uptime: "0h 0m",
    resources: { cpu: "0.00", ram: "0.00 MB" },
    connectivity: { marketData: "DISCONNECTED", bridge: "DISCONNECTED" }
};

export const useStore = create((set, get) => ({
    // --- State ---
    systemStatus: { ...INITIAL_SYSTEM_STATUS },
    pulse: null,
    strategiesLive: [],
    feedMode: 'all',
    feedMetrics: null,
    wsStatus: "DISCONNECTED",
    wsEvents: [],
    wsLastEvent: null,
    latestTicks: {},
    tickCount: 0,
    apiStatus: "UNKNOWN",
    strategies: [],
    selectedStrategy: null,
    currentCode: "",
    logs: [],
    isLoading: false,
    systemSettings: null,
    persistedSettings: null,
    settingsLoading: false,
    realtimeMode: (typeof window !== "undefined" && window.localStorage?.getItem("corex.realtimeMode")) || "ws",
    uiTheme: normalizeTheme((typeof window !== "undefined" && window.localStorage?.getItem("corex.uiTheme")) || "dark"),
    activeAccountMode: (typeof window !== "undefined" && window.localStorage?.getItem("corex.accountMode")) || "paper",
    editorPrefs: loadEditorPrefs(),
    mt5Account: null,
    mt5Positions: [],
    mt5Status: null,
    accountSnapshots: { paper: null, live: null },
    runConfig: null,
    liveCandles: {},
    tradeTape: [],

    // --- Internal Refs ---
    _ws: null,
    _apiDownUntil: 0,
    _wsAttempts: 0,
    _wsManualClose: false,

    // --- Helpers ---
    _apiCooldownActive: () => Date.now() < (get()._apiDownUntil || 0),

    _request: async (path, method = 'get', body = null) => {
        if (get()._apiCooldownActive()) return null;
        try {
            const res = await client[method](path, body);
            set({ apiStatus: "OK", _apiDownUntil: 0 });
            return res.payload || res.data || res;
        } catch (err) {
            set({ apiStatus: "DOWN", _apiDownUntil: Date.now() + 5000 });
            if (path === '/system/heartbeat') set({ systemStatus: { ...INITIAL_SYSTEM_STATUS } });
            return null;
        }
    },

    _ingestWsEvent: (msg) => {
        if (!msg || !msg.type) return;
        switch (msg.type) {
            case "STATUS_UPDATE":
                if (msg.payload?.systemStatus) set({ systemStatus: msg.payload.systemStatus });
                if (msg.payload?.pulse) set({ pulse: msg.payload.pulse });
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
            case "STRATEGY_SIGNAL": {
                set((s) => ({
                    tradeTape: [{
                        type: msg.type,
                        ts: msg.meta?.ts || Date.now(),
                        payload: msg.payload || {}
                    }, ...s.tradeTape].slice(0, 200)
                }));
                break;
            }
            case "STRATEGY_STATE":
            case "STRATEGY_START":
            case "STRATEGY_STOP":
            case "STRATEGY_LOADED":
            case "STRATEGY_UNLOADED":
                get().fetchLiveStrategies();
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
        set({ pulse: payload });
    },

    fetchLiveStrategies: async () => {
        const payload = await get()._request('/run/status');
        if (payload) set({ strategiesLive: Array.isArray(payload) ? payload : Object.values(payload) });
    },

    fetchSystemSettings: async () => {
        set({ settingsLoading: true });
        const payload = await get()._request('/system/settings');
        set({ systemSettings: payload?.runtime, persistedSettings: payload?.persisted, settingsLoading: false });
        const persistedMode = payload?.persisted?.payload?.ui?.realtimeMode;
        const persistedTheme = payload?.persisted?.payload?.ui?.theme;
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
        if (persistedEditorPrefs && typeof persistedEditorPrefs === "object") {
            const nextPrefs = { ...DEFAULT_EDITOR_PREFS, ...persistedEditorPrefs };
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

    // --- Reactive Controllers (One-shot on demand) ---
    startFeedMetrics: () => get().fetchFeedMetrics(),
    stopFeedMetrics: () => {},

    startPulse: () => get().fetchPulse(),
    stopPulse: () => {},

    startLiveStrategies: () => get().fetchLiveStrategies(),
    stopLiveStrategies: () => {},

    setFeedMode: (mode) => set({ feedMode: mode }),
    setRealtimeMode: (mode) => {
        const next = mode === "polling" ? "polling" : "ws";
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("corex.realtimeMode", next);
        }
        set({ realtimeMode: next });
        if (next === "polling") get().disconnectWebSocket();
        if (next === "ws") get().connectWebSocket();
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
    },
    setEditorPrefs: (patch, persist = true) => {
        const next = {
            ...DEFAULT_EDITOR_PREFS,
            ...(get().editorPrefs || {}),
            ...(patch || {})
        };
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
        if (get()._ws?.readyState <= 1) return;

        const url = new URL(import.meta.env.VITE_API_URL || 'http://localhost:3000/api');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/ws';

        const ws = new WebSocket(url.toString());
        set({ _ws: ws, wsStatus: "CONNECTING", _wsManualClose: false });

        ws.onopen = () => {
            set({ wsStatus: "CONNECTED", _wsAttempts: 0 });
            get().fetchSystemStatus();
            get().fetchFeedMetrics();
            get().fetchLiveStrategies();
            get().fetchMt5Status();
            get().fetchRunConfig();
        };
        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg?.type === "DATA_TICK") {
                    set({ wsLastEvent: msg });
                } else {
                    set(s => ({ wsLastEvent: msg, wsEvents: [msg, ...s.wsEvents].slice(0, 100) }));
                }
                get()._ingestWsEvent(msg);
            } catch {
                // ignore malformed ws payload
            }
        };
        ws.onerror = () => {
            set({ wsStatus: "ERROR" });
        };
        ws.onclose = () => {
            set({ wsStatus: "DISCONNECTED", _ws: null });
            if (get()._wsManualClose) return;
            const delay = Math.min(10000, 1000 * (get()._wsAttempts + 1));
            setTimeout(() => get().connectWebSocket(), delay);
            set(s => ({ _wsAttempts: s._wsAttempts + 1 }));
        };
    },

    disconnectWebSocket: () => {
        set({ _wsManualClose: true });
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
        set({ _ws: null, wsStatus: "DISCONNECTED" });
    }
}));

export default useStore;
