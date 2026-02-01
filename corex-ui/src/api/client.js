import axios from 'axios';

// 1. Resolve the URL dynamically (Useful if you move to a VPS later)
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET;

console.log(`📡 API Bridge: ${BASE_URL} | Auth: ${ADMIN_SECRET ? "READY" : "MISSING"}`);

const client = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_SECRET
    },
    timeout: 10000 // 10s timeout prevents the UI from hanging if the server is dead
});

/**
 * Global Response Interceptor
 * This ensures all Tab Views receive a standard { success, payload } structure
 * and handles 401 Unauthorized errors globally.
 */
client.interceptors.response.use(
    (response) => response.data, // Strip the Axios wrapper, return our {success, payload}
    (error) => {
        if (error.response?.status === 401) {
            console.error("🚫 Access Denied: Invalid ADMIN_SECRET");
        }
        // Return a standardized error object so the UI can show a Toast/Alert
        return Promise.reject({
            success: false,
            message: error.response?.data?.error || "NETWORK_ERROR",
            details: error.message
        });
    }
);

export default client;