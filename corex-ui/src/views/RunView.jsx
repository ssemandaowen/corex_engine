import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, PlayCircle, History, Radio, RefreshCw, CheckCircle, XCircle, BarChart3 } from 'lucide-react';
import client from "../api/client";
import { useStore } from "../store/useStore";

import RunCard from '../components/run/RunCard';
import Backtest from '../components/run/backtest';
import Live from '../components/run/live';
import RuntimeMonitor from '../components/run/RuntimeMonitor';

const TABS = [
  { id: 'Simulation', icon: Radio, label: 'Real-time Sim' },
  { id: 'Monitor', icon: BarChart3, label: 'Runtime Chart' },
  { id: 'Backtest', icon: History, label: 'Historical' },
  { id: 'Live', icon: PlayCircle, label: 'Live Bridge' }
];

const RunView = () => {
  const [strategies, setStrategies] = useState([]);
  const [activeTab, setActiveTab] = useState('Simulation');
  const [toasts, setToasts] = useState([]);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | ok | error
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const { realtimeMode, connectWebSocket, strategiesLive, runConfig, fetchRunConfig, wsLastEvent } = useStore();

  // --- Data Fetching ---
  const fetchStatuses = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      const res = await client.get('/run/status');
      const list = Array.isArray(res.payload) ? res.payload : Object.values(res.payload || {});
      setStrategies(list);
      setSyncStatus('ok');
      setLastSyncAt(Date.now());
    } catch (e) {
      setSyncStatus('error');
    }
  }, []);

  // --- Notification Engine ---
  const notify = useCallback((toast) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const next = { id, type: toast?.type || 'info', message: toast?.message || 'Action complete.' };
    setToasts((prev) => [...prev, next]);
    setTimeout(() => {
      setToasts((prev) => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  // --- Polling Lifecycle ---
  useEffect(() => {
    if (activeTab !== 'Simulation') return;
    fetchStatuses();
    if (realtimeMode !== 'polling') return;
    const timer = setInterval(fetchStatuses, 5000);
    return () => clearInterval(timer);
  }, [activeTab, fetchStatuses, realtimeMode]);

  useEffect(() => {
    if (realtimeMode !== 'ws') return;
    connectWebSocket();
  }, [realtimeMode, connectWebSocket]);

  useEffect(() => {
    fetchRunConfig();
  }, [fetchRunConfig]);

  useEffect(() => {
    if (realtimeMode !== 'ws') return;
    if (activeTab !== 'Simulation') return;
    if (!Array.isArray(strategiesLive)) return;
    setStrategies(strategiesLive);
    setSyncStatus('ok');
    setLastSyncAt(Date.now());
  }, [realtimeMode, activeTab, strategiesLive]);

  useEffect(() => {
    if (!wsLastEvent?.type) return;
    if (!['SYSTEM_LOG', 'SYSTEM_ERROR', 'STRATEGY_START', 'STRATEGY_STOP', 'PARAM_UPDATE', 'MT5_AUTH_FAILED', 'MT5_AUTHORIZED'].includes(wsLastEvent.type)) return;
    const payload = wsLastEvent.payload || {};
    const message = payload.message || payload.error || payload.reason || wsLastEvent.type;
    notify({
      type: wsLastEvent.type.includes('ERROR') || wsLastEvent.type.includes('FAILED') ? 'error' : 'info',
      message: String(message).slice(0, 140)
    });
  }, [wsLastEvent, notify]);

  // --- Sub-components for Clarity ---
  const SyncIndicator = useMemo(() => {
    const icons = {
      syncing: <RefreshCw size={12} className="animate-spin text-[var(--ui-warning)]" />,
      ok: <CheckCircle size={12} className="text-[var(--ui-positive)]" />,
      error: <XCircle size={12} className="text-[var(--ui-negative)]" />,
      idle: <Activity size={12} className="text-[var(--ui-subtle)]" />
    };

    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-[var(--ui-panel)] rounded-full border border-[var(--ui-border)]">
        {icons[syncStatus]}
        <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--ui-muted)]">
          {syncStatus === 'ok' && lastSyncAt 
            ? `SYS_OK @ ${new Date(lastSyncAt).toLocaleTimeString([], { hour12: false })}` 
            : syncStatus.toUpperCase()}
        </span>
      </div>
    );
  }, [syncStatus, lastSyncAt]);

  return (
    <div className="h-full flex flex-col bg-transparent">
      
      {/* HEADER: COMMAND NAVIGATION */}
      <div className="shrink-0 px-6 py-4 border-b border-[var(--ui-border)] flex items-center justify-between bg-[var(--ui-header-glass)] backdrop-blur-md z-10">
        <div className="flex gap-1 bg-[var(--ui-panel)] p-1 rounded-lg border border-[var(--ui-border)]">
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-[10px] font-black uppercase tracking-tighter transition-all
                ${activeTab === id 
                  ? 'bg-[var(--ui-accent-strong)] text-white shadow-lg' 
                  : 'text-[var(--ui-muted)] hover:text-[var(--ui-text)] hover:bg-[var(--ui-row-hover)]'}`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        {SyncIndicator}
      </div>

      {/* VIEWPORT: MOUNTED VIEWS */}
      <div className="flex-1 overflow-hidden relative">
        
        {/* SIMULATION GRID */}
        {activeTab === 'Simulation' && (
          <div className="h-full overflow-y-auto p-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {strategies.map(s => (
                <RunCard
                  key={s.id}
                  strategy={s}
                  runConfig={runConfig}
                  onStatusChange={fetchStatuses}
                  onNotify={notify}
                />
              ))}
            </div>
            {strategies.length === 0 && syncStatus === 'ok' && (
              <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-[var(--ui-border)] rounded-2xl opacity-60">
                <Radio className="mb-2 text-[var(--ui-muted)]" size={32} />
                <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-[var(--ui-muted)]">Awaiting Signal Streams</p>
              </div>
            )}
          </div>
        )}

        {/* BACKTEST VIEW */}
        {activeTab === 'Monitor' && (
          <div className="h-full animate-in slide-in-from-bottom-2 duration-300 overflow-y-auto">
            <RuntimeMonitor />
          </div>
        )}

        {/* BACKTEST VIEW */}
        {activeTab === 'Backtest' && (
          <div className="h-full animate-in slide-in-from-bottom-2 duration-300 overflow-y-auto">
            <Backtest />
          </div>
        )}

        {/* LIVE VIEW */}
        {activeTab === 'Live' && (
          <div className="h-full animate-in zoom-in-95 duration-200 overflow-y-auto p-6">
            <Live />
          </div>
        )}
      </div>

      {/* GLOBAL TOAST LAYER */}
      <div className="fixed bottom-8 right-8 z-[100] flex flex-col gap-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-2xl animate-in slide-in-from-right-10 
              ${t.type === 'error' ? 'bg-[var(--ui-panel)] border-[var(--ui-border-strong)] text-[var(--ui-negative)]' : 
                t.type === 'success' ? 'bg-[var(--ui-panel)] border-[var(--ui-border-strong)] text-[var(--ui-positive)]' : 
                'bg-[var(--ui-panel-strong)] border-[var(--ui-border)] text-[var(--ui-text)]'}`}
          >
            <div className={`h-1.5 w-1.5 rounded-full ${t.type === 'error' ? 'bg-[var(--ui-negative)]' : 'bg-[var(--ui-positive)]'}`} />
            <span className="text-[11px] font-bold uppercase tracking-tight">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RunView;
