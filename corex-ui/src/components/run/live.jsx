import React, { useCallback, useEffect, useMemo, useState } from 'react';
import client from '../../api/client';
import useStore from '../../store/useStore';

const Live = () => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState('');
  const { connectWebSocket, realtimeMode, mt5Status, fetchMt5Status } = useStore();
  const [execEnabled, setExecEnabled] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await client.get('/system/mt5/status');
      const next = res?.payload || null;
      setStatus(next);
      setExecEnabled(!!next?.executionEnabled);
      setError('');
    } catch (err) {
      setError('Unable to load MT5 bridge status');
    }
  }, []);

  useEffect(() => {
    if (realtimeMode === 'ws') {
      connectWebSocket();
      fetchMt5Status();
      return () => {};
    }
    fetchStatus();
    const t = setInterval(fetchStatus, 3000);
    return () => clearInterval(t);
  }, [fetchStatus, realtimeMode, connectWebSocket, fetchMt5Status]);

  useEffect(() => {
    if (realtimeMode !== 'ws') return;
    if (!mt5Status) return;
    setStatus(mt5Status);
    if (typeof mt5Status?.executionEnabled === 'boolean') {
      setExecEnabled(mt5Status.executionEnabled);
    }
  }, [realtimeMode, mt5Status]);

  const bridgeState = useMemo(() => {
    return status?.bridgeStatus || 'DISCONNECTED';
  }, [status]);

  const rows = Array.isArray(status?.positions) ? status.positions : [];
  const account = status?.account || {};
  const pending = Array.isArray(status?.pending) ? status.pending : [];

  const approve = async (terminalId) => {
    if (!terminalId || approving) return;
    setApproving(terminalId);
    try {
      await client.post('/bridge/authorize', { terminal_id: terminalId });
      await fetchStatus();
    } catch (err) {
      setError('Approval failed');
    } finally {
      setApproving('');
    }
  };

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

      {pending.length > 0 && (
        <div className="text-[10px] font-bold text-amber-300 bg-amber-950/20 border border-amber-500/20 px-3 py-2 rounded flex items-center justify-between">
          <span>New Connection Request from MT5 #{pending[0]?.account_id || pending[0]?.terminal_id || 'UNKNOWN'}</span>
          <button
            className="px-2 py-1 text-[10px] bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded"
            onClick={() => approve(pending[0]?.terminal_id)}
            disabled={approving === pending[0]?.terminal_id}
          >
            {approving === pending[0]?.terminal_id ? 'APPROVING' : 'APPROVE'}
          </button>
        </div>
      )}
      {pending.length > 1 && (
        <div className="text-[10px] text-slate-400 border border-slate-800 rounded px-3 py-2 bg-black/20">
          <div className="uppercase tracking-widest text-slate-500 font-bold mb-1">Pending Terminals</div>
          <div className="flex flex-wrap gap-2">
            {pending.slice(0, 5).map((p) => (
              <span key={p.terminal_id} className="px-2 py-1 rounded border border-slate-700 text-slate-300 font-mono">
                {p.account_id || p.terminal_id}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 border border-slate-800 rounded px-3 py-2 bg-black/20">
        <span>Enable MT5 Execution</span>
        <button
          className={`px-2 py-1 rounded border ${execEnabled
            ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
            : 'text-rose-300 border-rose-500/40 bg-rose-500/10'}`}
          onClick={async () => {
            const next = !execEnabled;
            setExecEnabled(next);
            try {
              await client.post('/system/mt5/execution', { enabled: next });
            } catch (err) {
              setExecEnabled(!next);
              setError('Failed to update execution flag');
            }
          }}
        >
          {execEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Metric label="Authorized Terminals" value={status?.heartbeat?.status === 'AUTHORIZED' ? 1 : 0} />
        <Metric label="Pending Orders" value={pending.length} />
        <Metric label="Last Heartbeat" value={status?.heartbeat?.last_seen ? new Date(status.heartbeat.last_seen).toLocaleTimeString() : '--'} />
      </div>

      <section className="space-y-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Authorized Terminal</p>
        <div className="border border-slate-800 rounded px-3 py-2 bg-black/20 text-xs text-slate-300">
          {status?.heartbeat?.status === 'AUTHORIZED'
            ? (status?.heartbeat?.account_id || status?.heartbeat?.terminal_id || '--')
            : 'None'}
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
