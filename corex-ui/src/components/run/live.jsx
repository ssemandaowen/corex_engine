import React, { useCallback, useEffect, useMemo, useState } from 'react';
import client from '../../api/client';
import useStore from '../../store/useStore';
import OhlcChart from './OhlcChart';

const Live = () => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState('');
  const connectWebSocket = useStore((s) => s.connectWebSocket);
  const realtimeMode = useStore((s) => s.realtimeMode);
  const mt5Status = useStore((s) => s.mt5Status);
  const fetchMt5Status = useStore((s) => s.fetchMt5Status);
  const liveCandles = useStore((s) => s.liveCandles);
  const tradeTape = useStore((s) => s.tradeTape);
  const latestTicks = useStore((s) => s.latestTicks);
  const runConfig = useStore((s) => s.runConfig);
  const [execEnabled, setExecEnabled] = useState(false);
  const [activeSymbol, setActiveSymbol] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await client.get('/system/mt5/status');
      const next = res?.payload || null;
      setStatus(next);
      setExecEnabled(!!next?.executionEnabled);
      setError('');
    } catch {
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

  const symbols = useMemo(() => {
    const fromCandles = Object.keys(liveCandles || {});
    const fromTicks = Object.keys(latestTicks || {});
    return Array.from(new Set([...fromCandles, ...fromTicks])).slice(0, 20);
  }, [liveCandles, latestTicks]);

  useEffect(() => {
    if (!activeSymbol && symbols.length > 0) setActiveSymbol(symbols[0]);
    if (activeSymbol && symbols.length > 0 && !symbols.includes(activeSymbol)) setActiveSymbol(symbols[0]);
  }, [symbols, activeSymbol]);

  const rows = Array.isArray(status?.positions) ? status.positions : [];
  const account = status?.account || {};
  const pending = Array.isArray(status?.pending) ? status.pending : [];
  const provider = status?.activeBridgeProvider || runConfig?.activeBridgeProvider || 'python_receiver';
  const providerOptions = Array.isArray(runConfig?.bridgeProviders) && runConfig.bridgeProviders.length > 0
    ? runConfig.bridgeProviders
    : ['python_receiver', 'mql5_receiver', 'metaapi'];
  const candles = useMemo(() => {
    const base = activeSymbol ? (liveCandles?.[activeSymbol] || []) : [];
    return base.slice(-120).map((c) => ({
      time: Number(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 0)
    })).filter((c) => Number.isFinite(c.time) && [c.open, c.high, c.low, c.close].every(Number.isFinite));
  }, [activeSymbol, liveCandles]);
  const tradeMarkers = useMemo(() => {
    const windowStart = candles[0]?.time || 0;
    const sym = String(activeSymbol || "").trim().toUpperCase();
    return (tradeTape || [])
      .filter((t) => Number(t.ts) >= windowStart)
      .filter((t) => {
        if (!sym) return true;
        const tsym = String(t?.payload?.symbol || "").trim().toUpperCase();
        return !tsym || tsym === sym;
      })
      .slice(0, 80)
      .map((t) => {
        const type = String(t?.type || "").toUpperCase();
        const side = String(t?.payload?.side || "").toUpperCase();
        const direction = side === "BUY" || side === "LONG" ? "buy" : (side === "SELL" || side === "SHORT" ? "sell" : "signal");
        const value = Number(
          t?.payload?.fill_price ??
          t?.payload?.fillPrice ??
          t?.payload?.price ??
          t?.payload?.close ??
          latestTicks?.[activeSymbol]?.price ??
          0
        );
        return {
          time: Number(t.ts),
          label: type === "STRATEGY_SIGNAL" ? `SIG ${side || ""}`.trim() : `${type} ${side || ""}`.trim(),
          kind: type === "ORDER_FILLED" ? direction : (type === "STRATEGY_SIGNAL" ? "signal" : direction),
          value: Number.isFinite(value) ? value : 0
        };
      });
  }, [tradeTape, candles, latestTicks, activeSymbol]);

  const recentTape = useMemo(() => {
    const sym = String(activeSymbol || "").trim().toUpperCase();
    return (tradeTape || [])
      .filter((t) => {
        if (!sym) return true;
        const tsym = String(t?.payload?.symbol || "").trim().toUpperCase();
        return !tsym || tsym === sym;
      })
      .slice(0, 8);
  }, [tradeTape, activeSymbol]);

  const approve = async (terminalId) => {
    if (!terminalId || approving) return;
    setApproving(terminalId);
    try {
      await client.post('/bridge/authorize', { terminal_id: terminalId });
      await fetchStatus();
    } catch {
      setError('Approval failed');
    } finally {
      setApproving('');
    }
  };

  return (
    <div className="ui-panel border border-[var(--ui-border)] rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-3">
        <div>
          <h2 className="text-sm font-black tracking-widest uppercase text-[var(--ui-text)]">MT5/MT4 Live Bridge</h2>
          <p className="text-[10px] font-mono text-[var(--ui-muted)]">Receiver authorization + signal transport</p>
        </div>
        <span className={`text-[10px] px-2 py-1 rounded border font-bold tracking-wider ${
          bridgeState === 'CONNECTED'
            ? 'text-[var(--ui-positive)] border-[var(--ui-border-strong)] bg-[var(--ui-row-hover)]'
            : bridgeState === 'PENDING_AUTH'
              ? 'text-[var(--ui-warning)] border-[var(--ui-border-strong)] bg-[var(--ui-row-hover)]'
              : 'text-[var(--ui-negative)] border-[var(--ui-border-strong)] bg-[var(--ui-row-hover)]'
        }`}>
          {bridgeState}
        </span>
      </div>

      {error && (
        <div className="text-[10px] font-bold text-[var(--ui-negative)] border px-3 py-2 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--ui-negative) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--ui-negative) 35%, transparent)' }}>
          {error}
        </div>
      )}

      {pending.length > 0 && (
        <div className="text-[10px] font-bold text-[var(--ui-warning)] border px-3 py-2 rounded flex items-center justify-between" style={{ backgroundColor: 'color-mix(in srgb, var(--ui-warning) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--ui-warning) 35%, transparent)' }}>
          <span>New Connection Request from MT5 #{pending[0]?.account_id || pending[0]?.terminal_id || 'UNKNOWN'}</span>
          <button
            className="px-2 py-1 text-[10px] rounded border ui-button ui-button-secondary"
            onClick={() => approve(pending[0]?.terminal_id)}
            disabled={approving === pending[0]?.terminal_id}
          >
            {approving === pending[0]?.terminal_id ? 'APPROVING' : 'APPROVE'}
          </button>
        </div>
      )}
      {pending.length > 1 && (
        <div className="text-[10px] text-[var(--ui-muted)] border border-[var(--ui-border)] rounded px-3 py-2 bg-[var(--ui-panel)]">
          <div className="uppercase tracking-widest text-[var(--ui-muted)] font-bold mb-1">Pending Terminals</div>
          <div className="flex flex-wrap gap-2">
            {pending.slice(0, 5).map((p) => (
              <span key={p.terminal_id} className="px-2 py-1 rounded border border-[var(--ui-border)] text-[var(--ui-text)] font-mono">
                {p.account_id || p.terminal_id}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] font-bold text-[var(--ui-muted)] border border-[var(--ui-border)] rounded px-3 py-2 bg-[var(--ui-panel)]">
        <span>Enable MT5 Execution</span>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] mono ${execEnabled ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-negative)]'}`}>{execEnabled ? 'ON' : 'OFF'}</span>
          <button
            className={`ui-switch ${execEnabled ? 'ui-switch-on' : ''}`}
            onClick={async () => {
              const next = !execEnabled;
              setExecEnabled(next);
              try {
                await client.post('/system/mt5/execution', { enabled: next });
              } catch {
                setExecEnabled(!next);
                setError('Failed to update execution flag');
              }
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Metric label="Authorized Terminals" value={status?.heartbeat?.status === 'AUTHORIZED' ? 1 : 0} />
        <Metric label="Pending Orders" value={pending.length} />
        <Metric label="Last Heartbeat" value={status?.heartbeat?.last_seen ? new Date(status.heartbeat.last_seen).toLocaleTimeString() : '--'} />
        <Metric label="Bridge Provider" value={String(provider).toUpperCase()} />
      </div>

      <div className="flex items-center justify-between text-[10px] font-bold text-[var(--ui-muted)] border border-[var(--ui-border)] rounded px-3 py-2 bg-[var(--ui-panel)]">
        <span>Bridge Integration</span>
        <select
          className="px-2 py-1 rounded border border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-text)]"
          value={provider}
          onChange={async (e) => {
            const next = e.target.value;
            try {
              await client.patch('/system/run/settings', {
                settings: { activeBridgeProvider: next, bridgeProviders: providerOptions },
                persist: true
              });
              await fetchStatus();
            } catch {
              setError('Failed to persist bridge provider');
            }
          }}
        >
          {providerOptions.map((p) => <option key={p} value={p}>{String(p).toUpperCase()}</option>)}
        </select>
      </div>

      <section className="space-y-2">
        <p className="text-[10px] font-bold text-[var(--ui-muted)] uppercase tracking-widest">Authorized Terminal</p>
        <div className="border border-[var(--ui-border)] rounded px-3 py-2 bg-[var(--ui-panel)] text-xs text-[var(--ui-text)]">
          {status?.heartbeat?.status === 'AUTHORIZED'
            ? (status?.heartbeat?.account_id || status?.heartbeat?.terminal_id || '--')
            : 'None'}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="border border-[var(--ui-border)] rounded p-3 bg-[var(--ui-panel)]">
          <p className="text-[10px] font-bold text-[var(--ui-muted)] uppercase tracking-widest mb-2">Live Account Snapshot</p>
          <div className="space-y-1 text-xs">
            <Row label="Mode" value={account.mode || 'LIVE'} />
            <Row label="Balance" value={fmtMoney(account.balance)} />
            <Row label="Equity" value={fmtMoney(account.equity)} />
          </div>
        </section>
        <section className="border border-[var(--ui-border)] rounded p-3 bg-[var(--ui-panel)]">
          <p className="text-[10px] font-bold text-[var(--ui-muted)] uppercase tracking-widest mb-2">Open Positions</p>
          <p className="text-2xl text-[var(--ui-accent)] font-mono">{rows.length}</p>
        </section>
      </div>

      <section className="border border-[var(--ui-border)] rounded p-3 bg-[var(--ui-panel)] space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold text-[var(--ui-muted)] uppercase tracking-widest">Live Market Candles + Trade Actions</p>
          <div className="flex items-center gap-2">
            <select
              className="px-2 py-1 text-[10px] border border-[var(--ui-border)] rounded bg-[var(--ui-panel)] text-[var(--ui-text)]"
              value={activeSymbol}
              onChange={(e) => setActiveSymbol(e.target.value)}
            >
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="h-[320px] w-full">
          <OhlcChart candles={candles} markers={tradeMarkers} />
        </div>
        <div className="max-h-24 overflow-y-auto space-y-1">
          {recentTape.map((t, i) => (
            <div key={`${t.ts}_${i}`} className="text-[10px] font-mono text-[var(--ui-muted)] flex items-center justify-between border-b border-[var(--ui-border)] pb-1">
              <span>{new Date(t.ts).toLocaleTimeString()} [{t.type}]</span>
              <span>{t.payload?.symbol || t.payload?.strategyId || '--'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

const fmtMoney = (n) => (typeof n === 'number' ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--');
const Metric = ({ label, value }) => (
  <div className="border border-[var(--ui-border)] rounded p-3 bg-[var(--ui-panel)]">
    <p className="text-[10px] uppercase text-[var(--ui-muted)] font-bold tracking-widest">{label}</p>
    <p className="text-lg font-mono text-[var(--ui-text)]">{value}</p>
  </div>
);
const Row = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-[var(--ui-muted)]">{label}</span>
    <span className="text-[var(--ui-text)] font-mono">{value}</span>
  </div>
);

export default Live;
