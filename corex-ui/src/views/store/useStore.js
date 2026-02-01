import { create } from 'zustand';
import client from '../../api/client';

export const useStore = create((set, get) => ({
    strategies: [],
    selectedStrategy: null,
    currentCode: "",
    logs: [],
    isLoading: false,

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
}));


export default useStore;