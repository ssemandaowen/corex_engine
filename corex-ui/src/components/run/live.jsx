import React, { useCallback, useEffect, useMemo, useState } from 'react';
import client from '../../api/client';

const Live = () => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await client.get('/system/mt5/status');
      setStatus(res?.payload || null);
      setError('');
    } catch (err) {
      setError('Unable to load MT5 bridge status');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 3000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const bridgeState = useMemo(() => {
    if (!status?.connected) return 'DISCONNECTED';
    if (status?.authorized) return 'CONNECTED';
    return 'PENDING_AUTH';
  }, [status]);

  const rows = Array.isArray(status?.positions) ? status.positions : [];
  const account = status?.account || {};
  const receivers = Array.isArray(status?.receivers) ? status.receivers : [];

  return (
    <div className="ui-panel border border-slate-800 rounded-xl p-5 space-y-5 bg-slate-900/20">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-sm font-black tracking-widest uppercase text-slate-100">MT5/MT4 Live Bridge</h2>
          <p className="text-[10px] font-mono text-slate-500">Receiver authorization + signal transport</p>
        </div>
        <span className={`text-[10px] px-2 py-1 rounded border font-bold tracking-wider ${
          bridgeState === 'CONNECTED'
            ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
            : bridgeState === 'PENDING_AUTH'
              ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
              : 'text-rose-400 border-rose-500/30 bg-rose-500/10'
        }`}>
          {bridgeState}
        </span>
      </div>

      {error && (
        <div className="text-[10px] font-bold text-rose-400 bg-rose-950/20 border border-rose-500/20 px-3 py-2 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Metric label="Socket Clients" value={status?.clients || 0} />
        <Metric label="Authorized Receivers" value={status?.authorizedClients || 0} />
        <Metric label="Pending Orders" value={status?.pending || 0} />
        <Metric label="Last Heartbeat" value={status?.lastHeartbeat ? new Date(status.lastHeartbeat).toLocaleTimeString() : '--'} />
      </div>

      <section className="space-y-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Authorized Receivers</p>
        <div className="border border-slate-800 rounded overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/70 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Receiver</th>
                <th className="px-3 py-2">Terminal</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {receivers.length ? receivers.map((r) => (
                <tr key={`${r.receiverId}_${r.ip}`} className="border-t border-slate-800/60">
                  <td className="px-3 py-2 font-mono text-slate-200">{r.receiverId || '--'}</td>
                  <td className="px-3 py-2 text-slate-300">{r.terminal || '--'}</td>
                  <td className="px-3 py-2 text-slate-300">{r.accountId || '--'}</td>
                  <td className="px-3 py-2 text-slate-500 font-mono">{r.ip || '--'}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-slate-600">No authorized receivers</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="border border-slate-800 rounded p-3 bg-black/20">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Live Account Snapshot</p>
          <div className="space-y-1 text-xs">
            <Row label="Mode" value={account.mode || 'LIVE'} />
            <Row label="Balance" value={fmtMoney(account.balance)} />
            <Row label="Equity" value={fmtMoney(account.equity)} />
          </div>
        </section>
        <section className="border border-slate-800 rounded p-3 bg-black/20">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Open Positions</p>
          <p className="text-2xl text-blue-400 font-mono">{rows.length}</p>
        </section>
      </div>
    </div>
  );
};

const fmtMoney = (n) => (typeof n === 'number' ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--');
const Metric = ({ label, value }) => (
  <div className="border border-slate-800 rounded p-3 bg-black/20">
    <p className="text-[10px] uppercase text-slate-500 font-bold tracking-widest">{label}</p>
    <p className="text-lg font-mono text-slate-100">{value}</p>
  </div>
);
const Row = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-slate-500">{label}</span>
    <span className="text-slate-200 font-mono">{value}</span>
  </div>
);

export default Live;
