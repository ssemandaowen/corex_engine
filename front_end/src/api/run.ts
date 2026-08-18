import client from './client';

export const runApi = {
  start: (id: string, data: { mode: 'PAPER' | 'LIVE'; symbol: string; params: any }) => client.post(`/api/run/start/${id}`, data).then(res => res.data),
  stop: (id: string) => client.post(`/api/run/stop/${id}`).then(res => res.data),
  restart: (id: string) => client.post(`/api/run/restart/${id}`).then(res => res.data),
  getStatus: (id: string) => client.get(`/api/run/status/${id}`).then(res => res.data),
  getTelemetry: (id: string) => client.get(`/api/run/telemetry/${id}`).then(res => res.data),
  getOpsTelemetry: () => client.get('/api/run/ops/telemetry').then(res => res.data),
};
