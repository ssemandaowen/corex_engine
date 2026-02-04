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

  const fetchStatuses = async () => {
    const res = await client.get('/run/status');
    const list = Array.isArray(res.payload) ? res.payload : Object.values(res.payload || {});
    setStrategies(list);
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
    if (activeTab === 'Simulation') {
      fetchStatuses();
    }
  }, [activeTab]);

  const renderContent = () => {
    switch (activeTab) {
      case 'Simulation':
        return (
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
        );
      case 'Backtest':
        return <Backtest />;
      case 'Live':
        return <Live />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Run</h1>
          <p className="text-xs text-slate-500">Deploy, simulate, and audit strategy behavior with clean controls.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-800 rounded-full p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-semibold rounded-full transition-all ${
              activeTab === tab
                ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.45)]'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="transition-all duration-300 ease-out">
        {renderContent()}
      </div>

      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 space-y-2">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`px-4 py-3 rounded-lg border text-xs font-semibold shadow-lg backdrop-blur ${
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
