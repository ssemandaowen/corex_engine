import React, { useState } from 'react';
import client from "../api/client";

const SettingsView = () => {
  const [adminKey] = useState(import.meta.env.VITE_ADMIN_SECRET || '');

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
    <div className="ui-page ui-page-scroll max-w-3xl">
      <section className="ui-panel">
        <div className="ui-panel-header">
          <h3 className="ui-panel-title">Security & API</h3>
          <span className="ui-chip">Read Only</span>
        </div>
        <div className="ui-form">
          <label className="ui-field">
            <span className="ui-label">CoreX Admin Key</span>
            <input
              type="password"
              value={adminKey}
              readOnly
              className="ui-input mono"
            />
            <p className="text-[11px] text-slate-500">Key is managed via .env file for security.</p>
          </label>
        </div>
      </section>

      <section className="ui-panel">
        <div className="ui-panel-header">
          <h3 className="ui-panel-title text-rose-300">Danger Zone</h3>
          <span className="ui-chip text-rose-300 border-rose-400/40">Destructive</span>
        </div>
        <div className="space-y-4">
          <div className="ui-card flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Clear Market Cache</p>
              <p className="text-xs text-slate-500">Deletes local CSV/JSON market data logs.</p>
            </div>
            <button onClick={clearCache} className="ui-button ui-button-danger">
              Purge Cache
            </button>
          </div>

          <div className="ui-card flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Emergency State Reset</p>
              <p className="text-xs text-slate-500">Force all active strategies to OFFLINE status.</p>
            </div>
            <button onClick={handleMaintenanceReset} className="ui-button ui-button-danger">
              Reset Engine
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SettingsView;
