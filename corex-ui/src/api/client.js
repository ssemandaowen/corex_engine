import axios from 'axios';

const API_KEY = import.meta.env.VITE_ADMIN_SECRET || 'your_dev_secret';
const BASE_URL = 'http://localhost:3000/api';

export const corexApi = axios.create({
    baseURL: BASE_URL,
    headers: {
        'x-admin-key': API_KEY,
        'Content-Type': 'application/json'
    }
});

// Helper for State Transitions
export const transitionStrategy = (id, action) => corexApi.post(`/strategies/${id}/${action}`);