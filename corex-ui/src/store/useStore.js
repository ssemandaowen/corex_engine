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

    // --- Internal Refs ---
    _ws: null,
    _timers: {},
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

    _managePolling: (key, fn, interval = 5000) => {
        const { _timers } = get();
        if (_timers[key]) clearInterval(_timers[key]);
        fn();
        set({ _timers: { ..._timers, [key]: setInterval(fn, interval) } });
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

    // --- Polling Controllers ---
    startFeedMetrics: () => get()._managePolling('feed', get().fetchFeedMetrics),
    stopFeedMetrics: () => { clearInterval(get()._timers.feed); },

    startPulse: () => get()._managePolling('pulse', get().fetchPulse),
    stopPulse: () => { clearInterval(get()._timers.pulse); },

    startLiveStrategies: () => get()._managePolling('live', get().fetchLiveStrategies),
    stopLiveStrategies: () => { clearInterval(get()._timers.live); },

    setFeedMode: (mode) => set({ feedMode: mode }),

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
        if (get()._apiCooldownActive() || (get()._ws?.readyState <= 1)) return;

        const url = new URL(import.meta.env.VITE_API_URL || 'http://localhost:3000/api');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/ws';

        const ws = new WebSocket(url.toString());
        set({ _ws: ws, wsStatus: "CONNECTING", _wsManualClose: false });

        ws.onopen = () => set({ wsStatus: "CONNECTED", _wsAttempts: 0 });
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            set(s => ({ wsLastEvent: msg, wsEvents: [msg, ...s.wsEvents].slice(0, 100) }));
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