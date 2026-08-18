import axios from 'axios';

// Single source of truth for the backend origin. Falls back to localhost:3000
// (the default CoreX server.js port) when VITE_API_URL isn't set.
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('corex_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle unauthorized responses
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('corex_token');
      // Dispatch custom event to redirect to signin
      window.dispatchEvent(new CustomEvent('corex:unauthorized'));
    }
    return Promise.reject(error);
  }
);

export default client;
