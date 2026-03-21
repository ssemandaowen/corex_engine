import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity, PlayCircle, History, Radio, RefreshCw,
  CheckCircle, XCircle, BarChart3, Search, ChevronDown
} from 'lucide-react';
import client from "../api/client";
import { useStore } from "../store/useStore";

import RunCard from '../components/run/RunCard';
import Backtest from '../components/run/backtest';
import Live from '../components/run/live';
import RuntimeMonitor from '../components/run/RuntimeMonitor';

/* ── constants ── */
const TABS = [
  { id: 'Simulation', icon: Radio,       label: 'Real-time Sim'  },
  { id: 'Monitor',    icon: BarChart3,    label: 'Runtime Chart'  },
  { id: 'Backtest',   icon: History,      label: 'Historical'     },
  { id: 'Live',       icon: PlayCircle,   label: 'Live Bridge'    },
];

const STATUS_OPTIONS = [
  { id: 'all',     label: 'All'     },
  { id: 'running', label: 'Running' },
  { id: 'stopped', label: 'Stopped' },
  { id: 'error',   label: 'Error'   },
];

const SORT_OPTIONS = [
  { id: 'name',   label: 'Name'   },
  { id: 'status', label: 'Status' },
  { id: 'uptime', label: 'Uptime' },
];

/* ── tiny reusable select ── */
function SelectChip({ value, options, onChange, prefix }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-7 px-2.5 text-[10px] font-black uppercase tracking-widest border border-[var(--ui-border)] rounded bg-[var(--ui-panel)] text-[var(--ui-muted)] hover:text-[var(--ui-text)] hover:bg-[var(--ui-hover)] transition-colors"
      >
        <span className="text-[var(--ui-subtle)]">{prefix}</span>
        <span className="text-[var(--ui-text)]">{current?.label}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 right-0 z-20 min-w-[110px] bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] rounded overflow-hidden">
            {options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => { onChange(opt.id); setOpen(false); }}
                className={`block w-full text-left px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                  value === opt.id
                    ? 'text-[var(--ui-accent)] bg-[color:color-mix(in_srgb,var(--ui-accent)_10%,transparent)]'
                    : 'text-[var(--ui-muted)] hover:text-[var(--ui-text)] hover:bg-[var(--ui-hover)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── sync indicator ── */
function SyncIndicator({ status, lastSyncAt }) {
  const map = {
    syncing: { icon: <RefreshCw size={11} className="animate-spin text-[var(--ui-warning)]" />, label: 'SYNCING' },
    ok:      { icon: <CheckCircle size={11} className="text-[var(--ui-positive)]" />,            label: lastSyncAt ? `OK @ ${new Date(lastSyncAt).toLocaleTimeString([], { hour12: false })}` : 'OK' },
    error:   { icon: <XCircle size={11} className="text-[var(--ui-negative)]" />,                label: 'ERROR'   },
    idle:    { icon: <Activity size={11} className="text-[var(--ui-subtle)]" />,                 label: 'IDLE'    },
  };
  const { icon, label } = map[status] || map.idle;
  return (
    <div className="flex items-center gap-1.5 h-7 px-2.5 border border-[var(--ui-border)] rounded bg-[var(--ui-panel)]">
      {icon}
      <span className="text-[9px] font-black uppercase tracking-widest text-[var(--ui-muted)] tabular-nums">
        {label}
      </span>
    </div>
  );
}

/* ── toast ── */
function ToastLayer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-1.5 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2.5 px-3 py-2 rounded border text-[10px] font-black uppercase tracking-widest animate-in slide-in-from-right-8 pointer-events-auto ${
            t.type === 'error'
              ? 'bg-[var(--ui-panel-strong)] border-[var(--ui-border)] text-[var(--ui-negative)]'
              : t.type === 'success'
              ? 'bg-[var(--ui-panel-strong)] border-[var(--ui-border)] text-[var(--ui-positive)]'
              : 'bg-[var(--ui-panel-strong)] border-[var(--ui-border)] text-[var(--ui-text)]'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
            t.type === 'error' ? 'bg-[var(--ui-negative)]' :
            t.type === 'success' ? 'bg-[var(--ui-positive)]' : 'bg-[var(--ui-accent)]'
          }`} />
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════ */
const RunView = () => {
  const [strategies,    setStrategies]    = useState([]);
  const [activeTab,     setActiveTab]     = useState('Simulation');
  const [toasts,        setToasts]        = useState([]);
  const [syncStatus,    setSyncStatus]    = useState('idle');
  const [lastSyncAt,    setLastSyncAt]    = useState(null);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [statusFilter,  setStatusFilter]  = useState('all');
  const [sortBy,        setSortBy]        = useState('name');

  const { realtimeMode, connectWebSocket, strategiesLive, runConfig, fetchRunConfig, wsLastEvent } = useStore();

  /* ── fetch ── */
  const fetchStatuses = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      const res  = await client.get('/run/status');
      const list = Array.isArray(res.payload) ? res.payload : Object.values(res.payload || {});
      setStrategies(list);
      setSyncStatus('ok');
      setLastSyncAt(Date.now());
    } catch {
      setSyncStatus('error');
    }
  }, []);

  /* ── notify ── */
  const notify = useCallback((toast) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, type: toast?.type || 'info', message: String(toast?.message || 'Action complete.').slice(0, 140) }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  /* ── lifecycle ── */
  useEffect(() => {
    if (activeTab !== 'Simulation') return;
    fetchStatuses();
    if (realtimeMode !== 'polling') return;
    const timer = setInterval(fetchStatuses, 5000);
    return () => clearInterval(timer);
  }, [activeTab, fetchStatuses, realtimeMode]);

  useEffect(() => { if (realtimeMode === 'ws') connectWebSocket(); }, [realtimeMode, connectWebSocket]);
  useEffect(() => { fetchRunConfig(); }, [fetchRunConfig]);

  useEffect(() => {
    if (realtimeMode !== 'ws' || activeTab !== 'Simulation' || !Array.isArray(strategiesLive)) return;
    setStrategies(strategiesLive);
    setSyncStatus('ok');
    setLastSyncAt(Date.now());
  }, [realtimeMode, activeTab, strategiesLive]);

  useEffect(() => {
    if (!wsLastEvent?.type) return;
    if (!['STRATEGY_START', 'STRATEGY_STOP', 'PARAM_UPDATE', 'MT5_AUTH_FAILED', 'MT5_AUTHORIZED'].includes(wsLastEvent.type)) return;
    const payload = wsLastEvent.payload || {};
    notify({
      type: wsLastEvent.type.includes('ERROR') || wsLastEvent.type.includes('FAILED') ? 'error' : 'info',
      message: payload.message || payload.error || payload.reason || wsLastEvent.type,
    });
  }, [wsLastEvent, notify]);

  /* ── filtered + sorted ── */
  const filteredStrategies = useMemo(() => {
    let result = [...strategies];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) => String(s.id || s.name || '').toLowerCase().includes(q));
    }

    if (statusFilter !== 'all') {
      result = result.filter((s) => {
        const st = String(s?.status || s?.state || '').toUpperCase();
        if (statusFilter === 'running') return ['ACTIVE', 'WARMING_UP', 'RUNNING'].includes(st);
        if (statusFilter === 'stopped') return ['STOPPED', 'IDLE', 'OFFLINE'].includes(st);
        if (statusFilter === 'error')   return st.includes('ERROR') || st.includes('FAILED');
        return true;
      });
    }

    if (sortBy === 'status') {
      result.sort((a, b) => String(a?.status || '').localeCompare(String(b?.status || '')));
    } else if (sortBy === 'uptime') {
      result.sort((a, b) => Number(b.uptime || 0) - Number(a.uptime || 0));
    } else {
      result.sort((a, b) => String(a.id || a.name || '').localeCompare(String(b.id || b.name || '')));
    }

    return result;
  }, [strategies, searchQuery, statusFilter, sortBy]);

  /* ══ render ══ */
  return (
    <div className="h-full flex flex-col bg-transparent">

      {/* ── Header: tab nav + sync indicator ── */}
      <div className="shrink-0 px-4 h-11 border-b border-[var(--ui-border)] bg-[var(--ui-panel-strong)] flex items-center justify-between gap-3 z-10">

        {/* tabs */}
        <div className="flex items-center gap-0.5">
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 h-7 rounded text-[10px] font-black uppercase tracking-widest transition-colors ${
                activeTab === id
                  ? 'bg-[var(--ui-accent-strong)] text-white'
                  : 'text-[var(--ui-muted)] hover:text-[var(--ui-text)] hover:bg-[var(--ui-hover)]'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        <SyncIndicator status={syncStatus} lastSyncAt={lastSyncAt} />
      </div>

      {/* ── Viewport ── */}
      <div className="flex-1 overflow-hidden relative">

        {/* SIMULATION */}
        {activeTab === 'Simulation' && (
          <div className="h-full flex flex-col overflow-hidden">

            {/* toolbar */}
            <div className="shrink-0 px-4 h-9 border-b border-[var(--ui-border)] bg-[var(--ui-panel)] flex items-center gap-2">

              {/* search */}
              <div className="relative flex-1 min-w-0">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--ui-subtle)] pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search strategies…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ui-input text-[11px] w-full pl-6 h-6"
                />
              </div>

              <div className="w-px h-4 bg-[var(--ui-border)] shrink-0" />

              <SelectChip
                value={statusFilter}
                options={STATUS_OPTIONS}
                onChange={setStatusFilter}
                prefix="Status: "
              />
              <SelectChip
                value={sortBy}
                options={SORT_OPTIONS}
                onChange={setSortBy}
                prefix="Sort: "
              />

              {/* result count */}
              <span className="text-[10px] text-[var(--ui-subtle)] tabular-nums shrink-0">
                {filteredStrategies.length}/{strategies.length}
              </span>
            </div>

            {/* strategy list */}
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col gap-2 p-4">
                {filteredStrategies.map((s) => (
                  <RunCard
                    key={s.id}
                    strategy={s}
                    runConfig={runConfig}
                    onStatusChange={fetchStatuses}
                    onNotify={notify}
                  />
                ))}

                {filteredStrategies.length === 0 && syncStatus === 'ok' && (
                  <div className="mt-16 flex flex-col items-center justify-center gap-2 opacity-50 select-none">
                    <Radio size={28} className="text-[var(--ui-muted)]" />
                    <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--ui-muted)]">
                      {searchQuery || statusFilter !== 'all'
                        ? 'No strategies match your filters'
                        : 'Awaiting signal streams'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Monitor' && (
          <div className="h-full overflow-y-auto">
            <RuntimeMonitor />
          </div>
        )}

        {activeTab === 'Backtest' && (
          <div className="h-full overflow-y-auto">
            <Backtest />
          </div>
        )}

        {activeTab === 'Live' && (
          <div className="h-full overflow-y-auto p-4">
            <Live />
          </div>
        )}
      </div>

      <ToastLayer toasts={toasts} />
    </div>
  );
};

export default RunView;