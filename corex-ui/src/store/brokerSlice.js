export const createBrokerSlice = (set, get) => ({
    brokers: [],
    fetchBrokers: async () => {
        const brokers = await get()._request('/brokers');
        set({ brokers: brokers || [] });
    },
});