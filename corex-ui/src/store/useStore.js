import { create } from 'zustand';
import client from '../api/client';

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
    mt5Account: null,
    mt5Positions: [],
    mt5Status: null,
    accountSnapshots: { paper: null, live: null },

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
        if (persistedMode) {
            if (typeof window !== "undefined" && window.localStorage) {
                window.localStorage.setItem("corex.realtimeMode", persistedMode);
            }
            set({ realtimeMode: persistedMode });
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
        };
        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                set(s => ({ wsLastEvent: msg, wsEvents: [msg, ...s.wsEvents].slice(0, 100) }));
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
        get()._ws?.close();
        set({ _ws: null, wsStatus: "DISCONNECTED" });
    }
}));

export default useStore;
