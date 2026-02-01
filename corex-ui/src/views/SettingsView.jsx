import React, { useState } from 'react';
import client from "../api/client";


const SettingsView = () => {
  const [adminKey, setAdminKey] = useState(import.meta.env.VITE_ADMIN_SECRET || '');

  const handleMaintenanceReset = async () => {
    if (!window.confirm("CRITICAL: Reset all strategy states to OFFLINE?")) return;
    const res = await client.post('/system/maintenance/reset-states');
    alert(res.message);
  };

  const clearCache = async () => {
    const res = await client.delete('/backtest/cache');
    alert(res.message);
  };

  return (
    <div className="max-w-2xl space-y-8">
      <section className="bg-slate-800 p-6 rounded-xl border border-slate-700">
        <h3 className="text-sm font-bold text-slate-400 uppercase mb-6 tracking-widest">Security & API</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-2 uppercase">CoreX Admin Key</label>
            <input 
              type="password" 
              value={adminKey} 
              readOnly
              className="w-full bg-slate-900 border border-slate-700 p-3 rounded font-mono text-sm text-slate-400"
            />
            <p className="text-[10px] text-slate-600 mt-2">Key is managed via .env file for security.</p>
          </div>
        </div>
      </section>

      <section className="bg-slate-800 p-6 rounded-xl border border-slate-700">
        <h3 className="text-sm font-bold text-red-400 uppercase mb-6 tracking-widest">Danger Zone</h3>
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center p-4 bg-slate-900 rounded-lg border border-red-900/20">
            <div>
              <p className="text-sm font-bold">Clear Market Cache</p>
              <p className="text-xs text-slate-500">Deletes local CSV/JSON market data logs.</p>
            </div>
            <button onClick={clearCache} className="bg-red-900/20 hover:bg-red-900/40 text-red-500 px-4 py-2 rounded text-xs font-bold transition-colors">
              PURGE CACHE
            </button>
          </div>

          <div className="flex justify-between items-center p-4 bg-slate-900 rounded-lg border border-red-900/20">
            <div>
              <p className="text-sm font-bold">Emergency State Reset</p>
              <p className="text-xs text-slate-500">Force all active strategies to OFFLINE status.</p>
            </div>
            <button onClick={handleMaintenanceReset} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-xs font-bold transition-colors">
              RESET ENGINE
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SettingsView;