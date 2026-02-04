import { create } from 'zustand';
import client from '../api/client';

export const useStore = create((set, get) => ({
    systemStatus: {
        status: "DISCONNECTED",
        uptime: "0h 0m",
        resources: { cpu: "0.00", ram: "0.00 MB" },
        connectivity: { marketData: "DISCONNECTED", bridge: "DISCONNECTED" }
    },
    wsStatus: "DISCONNECTED",
    wsEvents: [],
    wsLastEvent: null,
    _ws: null,
    _wsReconnectTimer: null,
    _wsAttempts: 0,
    strategies: [],
    selectedStrategy: null,
    currentCode: "",
    logs: [],
    isLoading: false,

    // SYNC: System Heartbeat
    fetchSystemStatus: async () => {
        try {
            const res = await client.get('/system/heartbeat');
            set({ systemStatus: res.payload });
        } catch (err) {
            set({
                systemStatus: {
                    status: "DISCONNECTED",
                    uptime: "0h 0m",
                    resources: { cpu: "0.00", ram: "0.00 MB" },
                    connectivity: { marketData: "DISCONNECTED", bridge: "DISCONNECTED" }
                }
            });
            console.error("Heartbeat lost");
        }
    },

    // SYNC: Get all strategies for the sidebar
    fetchStrategies: async () => {
        try {
            const { data } = await client.get('/strategies');
            set({ strategies: data.data });
        } catch (err) {
            console.error("Sync Error:", err);
        }
    },

    // READ: Get raw code for the Monaco Editor
    fetchCode: async (id) => {
        set({ isLoading: true });
        try {
            const { data } = await client.get(`/strategies/${id}/code`);
            set({ currentCode: data.code, isLoading: false });
        } catch (err) {
            set({ isLoading: false });
            console.error("Code Fetch Error:", err);
        }
    },

    // CREATE / UPDATE: Save code to disk
    saveStrategy: async (name, code) => {
        try {
            await client.post('/strategies/create', { name, code });
            await get().fetchStrategies();
            return true;
        } catch (err) {
            alert("Save failed: " + err.response?.data?.error);
            return false;
        }
    },

    // DELETE: Purge from disk and memory
    deleteStrategy: async (id) => {
        if (!window.confirm("Permanently delete this strategy from server?")) return;
        try {
            await client.delete(`/strategies/${id}`);
            set({ selectedStrategy: null, currentCode: "" });
            await get().fetchStrategies();
        } catch (err) {
            console.error("Delete Error:", err);
        }
    },

    // CONTROL: Start/Stop/Reload transitions
    transitionState: async (id, action) => {
        try {
            const { data } = await client.post(`/strategies/${id}/${action}`);
            set((state) => ({
                logs: [{ 
                    state: data.status, 
                    timestamp: Date.now(), 
                    reason: `System Action: ${action.toUpperCase()}` 
                }, ...state.logs].slice(0, 50)
            }));
            await get().fetchStrategies();
        } catch (err) {
            console.error(`Action ${action} failed:`, err);
        }
    },

    setSelectedStrategy: (strat) => set({ selectedStrategy: strat })
    ,

    // LIVE: WebSocket bridge (global)
    connectWebSocket: () => {
        const existing = get()._ws;
        if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const wsUrl = apiUrl.replace(/\/api\/?$/, '/ws');

        const ws = new WebSocket(wsUrl);
        set({ _ws: ws, wsStatus: "CONNECTING" });

        ws.onopen = () => {
            set({ wsStatus: "CONNECTED", _wsAttempts: 0 });
        };

        ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                set((state) => ({
                    wsLastEvent: msg,
                    wsEvents: [msg, ...state.wsEvents].slice(0, 100)
                }));
            } catch (e) {
                // ignore parse errors
            }
        };

        ws.onerror = () => {
            set({ wsStatus: "ERROR" });
        };

        ws.onclose = () => {
            set({ wsStatus: "DISCONNECTED", _ws: null });
            const attempts = get()._wsAttempts + 1;
            set({ _wsAttempts: attempts });
            const delay = Math.min(10000, 1000 * attempts);
            clearTimeout(get()._wsReconnectTimer);
            const timer = setTimeout(() => get().connectWebSocket(), delay);
            set({ _wsReconnectTimer: timer });
        };
    },

    disconnectWebSocket: () => {
        clearTimeout(get()._wsReconnectTimer);
        const ws = get()._ws;
        if (ws) {
            ws.close();
        }
        set({ _ws: null, wsStatus: "DISCONNECTED" });
    }
}));


export default useStore;
