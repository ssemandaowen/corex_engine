import client from './client';

export const authApi = {
  signin: (credentials: any) => client.post('/api/auth/signin', credentials).then(res => res.data),
  signup: (userData: any) => client.post('/api/auth/signup', userData).then(res => res.data),
  signout: () => client.post('/api/auth/signout').then(res => res.data),
  me: () => client.get('/api/auth/me').then(res => res.data),
  createApiKey: (data: { label: string }) => client.post('/api/auth/apikeys', data).then(res => res.data),
  listApiKeys: () => client.get('/api/auth/apikeys').then(res => res.data),
  revokeApiKey: (id: string) => client.delete(`/api/auth/apikeys/${id}`).then(res => res.data),
};
