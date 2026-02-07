import React, { useState, useEffect, useCallback } from 'react';
import client from "../api/client";

import RunCard from '../components/run/RunCard';
import Backtest from '../components/run/backtest';
import Simulation from '../components/run/simulation';
import Live from '../components/run/live';

const TABS = ['Simulation', 'Backtest', 'Live'];

const RunView = () => {
  const [strategies, setStrategies] = useState([]);
  const [activeTab, setActiveTab] = useState(TABS[0]);
  const [toasts, setToasts] = useState([]);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | ok | error
  const [lastSyncAt, setLastSyncAt] = useState(null);

  const fetchStatuses = async () => {
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
  };

  const notify = useCallback((toast) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const next = { id, type: toast?.type || 'info', message: toast?.message || 'Action complete.' };
    setToasts((prev) => [...prev, next]);
    setTimeout(() => {
      setToasts((prev) => prev.filter(t => t.id !== id));
    }, 2800);
  }, []);

  useEffect(() => {
    if (activeTab !== 'Simulation') return;
    fetchStatuses();
    const timer = setInterval(fetchStatuses, 5000);
    return () => clearInterval(timer);
  }, [activeTab]);

  const syncLabel = syncStatus === 'syncing'
    ? 'Syncing...'
    : syncStatus === 'ok'
      ? `Synced ${lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString() : ''}`
      : syncStatus === 'error'
        ? 'Sync error'
        : 'Idle';

  return (
    <div className="ui-page ui-page-scroll">

      <div className="ui-tabs items-center gap-3">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`ui-tab ${activeTab === tab ? 'ui-tab-active' : ''}`}
          >
            {tab}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-slate-500">
          <span className={`h-2 w-2 rounded-full ${
            syncStatus === 'ok'
              ? 'bg-emerald-400'
              : syncStatus === 'syncing'
                ? 'bg-amber-400 animate-pulse'
                : syncStatus === 'error'
                  ? 'bg-rose-400'
                  : 'bg-slate-600'
          }`} />
          <span>{syncLabel}</span>
        </div>
      </div>

      <div className="transition-all duration-300 ease-out ui-view-frame">
        <div className={activeTab === 'Simulation' ? 'block' : 'hidden'}>
          <div className="h-full ui-panel-scroll">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {strategies.map(s => (
                <RunCard
                  key={s.id}
                  strategy={s}
                  onStatusChange={fetchStatuses}
                  onNotify={notify}
                />
              ))}
            </div>
          </div>
        </div>
        <div className={activeTab === 'Backtest' ? 'block h-full' : 'hidden'}>
          <Backtest />
        </div>
        <div className={activeTab === 'Live' ? 'block' : 'hidden'}>
          <Live />
        </div>
      </div>

      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 space-y-2">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`ui-toast ${
                t.type === 'error'
                  ? 'bg-red-950/80 border-red-500/50 text-red-200'
                  : t.type === 'success'
                    ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200'
                    : 'bg-slate-900/80 border-slate-700 text-slate-200'
              }`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RunView;
