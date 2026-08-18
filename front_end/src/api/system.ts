import client from './client';

export const systemApi = {
  getStatus: () => client.get('/api/system/heartbeat').then(res => res.data),
  getAccount: () => client.get('/api/data/account').then(res => res.data),
  getPositions: () => client.get('/api/data/positions').then(res => res.data),
  getSystemSettings: () => client.get('/api/settings/engine').then(res => res.data),
  updateSystemSettings: (data: any) => client.patch('/api/settings/engine', data).then(res => res.data),
  getPaperSettings: () => client.get('/api/settings/account/paper').then(res => res.data),
  updatePaperSettings: (data: any) => client.patch('/api/settings/account/paper', data).then(res => res.data),
  getLiveSettings: () => client.get('/api/settings/account/live').then(res => res.data),
  updateLiveSettings: (data: any) => client.patch('/api/settings/account/live', data).then(res => res.data),
  getAccountSettings: (mode: 'paper' | 'live') => client.get(`/api/settings/account/${mode}`).then(res => res.data),
  patchAccountSettings: (mode: 'paper' | 'live', data: any) => client.patch(`/api/settings/account/${mode}`, data).then(res => res.data),
  resetAccountSettings: (mode: 'paper' | 'live') => client.post(`/api/settings/account/${mode}/reset`).then(res => res.data),
  getMt5Status: () => client.get('/api/system/mt5-status').then(res => res.data),
};
