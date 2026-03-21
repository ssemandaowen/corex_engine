import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
const SESSION_KEY = 'corex.auth.token';
const AUTH_KEY = 'corex.auth.key';

export const getSessionToken = () => localStorage.getItem(SESSION_KEY) || '';
export const setSessionToken = (token) => {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
};
export const getSessionAuthKey = () => localStorage.getItem(AUTH_KEY) || '';
export const setSessionAuthKey = (key) => {
    if (key) localStorage.setItem(AUTH_KEY, key);
    else localStorage.removeItem(AUTH_KEY);
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
    } else {
        const authKey = getSessionAuthKey();
        if (authKey) {
            config.headers['x-auth-key'] = authKey;
        }
    }
    return config;
});

client.interceptors.response.use(
    (response) => response.data,
    (error) => {
        if (error.response?.status === 401) {
            setSessionToken('');
            setSessionAuthKey('');
            window.dispatchEvent(new CustomEvent('corex:auth:expired'));
        }
        return Promise.reject({
            success: false,
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.response?.data?.error || 'NETWORK_ERROR',
            details: error.message
        });
    }
);

export default client;
