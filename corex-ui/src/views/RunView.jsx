import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, PlayCircle, History, Radio, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import client from "../api/client";

import RunCard from '../components/run/RunCard';
import Backtest from '../components/run/backtest';
import Simulation from '../components/run/simulation';
import Live from '../components/run/live';

const TABS = [
  { id: 'Simulation', icon: Radio, label: 'Real-time Sim' },
  { id: 'Backtest', icon: History, label: 'Historical' },
  { id: 'Live', icon: PlayCircle, label: 'Live Bridge' }
];

const RunView = () => {
  const [strategies, setStrategies] = useState([]);
  const [activeTab, setActiveTab] = useState('Simulation');
  const [toasts, setToasts] = useState([]);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | ok | error
  const [lastSyncAt, setLastSyncAt] = useState(null);

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
    const timer = setInterval(fetchStatuses, 5000);
    return () => clearInterval(timer);
  }, [activeTab, fetchStatuses]);

  // --- Sub-components for Clarity ---
  const SyncIndicator = useMemo(() => {
    const icons = {
      syncing: <RefreshCw size={12} className="animate-spin text-amber-500" />,
      ok: <CheckCircle size={12} className="text-emerald-500" />,
      error: <XCircle size={12} className="text-rose-500" />,
      idle: <Activity size={12} className="text-slate-500" />
    };

    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-slate-900/50 rounded-full border border-slate-800">
        {icons[syncStatus]}
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
          {syncStatus === 'ok' && lastSyncAt 
            ? `SYS_OK @ ${new Date(lastSyncAt).toLocaleTimeString([], { hour12: false })}` 
            : syncStatus.toUpperCase()}
        </span>
      </div>
    );
  }, [syncStatus, lastSyncAt]);

  return (
    <div className="h-full flex flex-col bg-[#0b0e14]">
      
      {/* HEADER: COMMAND NAVIGATION */}
      <div className="shrink-0 px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#0d1117]/80 backdrop-blur-md z-10">
        <div className="flex gap-1 bg-black/20 p-1 rounded-lg border border-slate-800">
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-[10px] font-black uppercase tracking-tighter transition-all
                ${activeTab === id 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
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
                  onStatusChange={fetchStatuses}
                  onNotify={notify}
                />
              ))}
            </div>
            {strategies.length === 0 && syncStatus === 'ok' && (
              <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-2xl opacity-40">
                <Radio className="mb-2 text-slate-600" size={32} />
                <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-slate-500">Awaiting Signal Streams</p>
              </div>
            )}
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
              ${t.type === 'error' ? 'bg-rose-950/90 border-rose-500/50 text-rose-100' : 
                t.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100' : 
                'bg-slate-900/90 border-slate-700 text-slate-100'}`}
          >
            <div className={`h-1.5 w-1.5 rounded-full ${t.type === 'error' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
            <span className="text-[11px] font-bold uppercase tracking-tight">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RunView;