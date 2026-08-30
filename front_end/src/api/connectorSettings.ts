import client from './client';

export const connectorSettingsApi = {
  list: () => client.get('/api/settings/connectors').then(res => res.data),
  get: (accountId: string, type: string) => client.get(`/api/accounts/${accountId}/connectors/${type}`).then(res => res.data),
  save: (accountId: string, type: string, config: any, secrets: any = {}) => client.put(`/api/accounts/${accountId}/connectors/${type}`, { config, secrets }).then(res => res.data),
  test: (accountId: string, type: string) => client.post(`/api/accounts/${accountId}/connectors/${type}/test`).then(res => res.data),
};
