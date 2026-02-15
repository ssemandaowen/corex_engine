import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
const SESSION_KEY = 'corex.auth.token';
const LEGACY_ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET;

export const getSessionToken = () => localStorage.getItem(SESSION_KEY) || '';
export const setSessionToken = (token) => {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
};

const client = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json'
    },
    timeout: 10000
});

client.interceptors.request.use((config) => {
    const token = getSessionToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    } else if (LEGACY_ADMIN_SECRET) {
        config.headers['x-admin-key'] = LEGACY_ADMIN_SECRET;
    }
    return config;
});

client.interceptors.response.use(
    (response) => response.data,
    (error) => {
        if (error.response?.status === 401) {
            setSessionToken('');
            window.dispatchEvent(new CustomEvent('corex:auth:expired'));
        }
        return Promise.reject({
            success: false,
            message: error.response?.data?.error || 'NETWORK_ERROR',
            details: error.message
        });
    }
);

export default client;
