import client from './client';

export const backtestApi = {
  run: (strategyId: string, params: any) => client.post(`/api/backtest/${strategyId}`, params).then(res => res.data),
  getProgress: (jobId: string) => client.get(`/api/backtest/progress/${jobId}`).then(res => res.data),
  getReport: (jobId: string) => client.get(`/api/backtest/${jobId}`).then(res => res.data),
  list: () => client.get('/api/backtest').then(res => res.data),
  delete: (jobId: string) => client.delete(`/api/backtest/${jobId}`).then(res => res.data),
  getUploads: () => client.get('/api/backtest/uploads').then(res => res.data),
  deleteUpload: (id: string) => client.delete(`/api/backtest/uploads/${id}`).then(res => res.data),
  upload: (file: File, symbol: string) => {
    const form = new FormData();
    form.append('dataset', file);
    form.append('symbol', symbol);
    return client.post('/api/backtest/uploads', form).then(res => res.data);
  },
};
