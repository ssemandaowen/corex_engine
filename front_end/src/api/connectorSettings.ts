import client from './client';

export const connectorSettingsApi = {
  list: () => client.get('/api/settings/connectors').then(res => res.data),
  save: (type: string, config: any, secrets: any = {}) => client.put(`/api/settings/connectors/${type}`, { config, secrets }).then(res => res.data),
  test: (type: string) => client.post(`/api/settings/connectors/${type}/test`).then(res => res.data),
};
