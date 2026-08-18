import client from './client';

export const strategiesApi = {
  list: () => client.get('/api/strategies').then(res => res.data),
  create: (strategy: { name: string; script_body: string }) => client.post('/api/strategies', strategy).then(res => res.data),
  get: (id: string) => client.get(`/api/strategies/${id}`).then(res => res.data),
  update: (id: string, data: { code?: string; runtime_params?: any }) => client.put(`/api/strategies/${id}`, data).then(res => res.data),
  delete: (id: string) => client.delete(`/api/strategies/${id}`).then(res => res.data),
  getManifest: (id: string) => client.get(`/api/strategies/${id}/manifest`).then(res => res.data),
};
