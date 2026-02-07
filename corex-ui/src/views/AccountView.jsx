import React, { useState, useEffect, useCallback } from 'react';
import client from '../api/client';
import { Settings, RotateCcw, DollarSign, Activity, PieChart, ShieldCheck, Save, X } from 'lucide-react';

const AccountView = () => {
  const [account, setAccount] = useState(null);
  const [mode, setMode] = useState('paper');
  const [modes, setModes] = useState(['paper']);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [commissionPerShare, setCommissionPerShare] = useState('');
  const [commissionMin, setCommissionMin] = useState('');
  const [slippageBps, setSlippageBps] = useState('');
  const [fillProbability, setFillProbability] = useState('');
  const [minBalance, setMinBalance] = useState('');
  const [maxBalance, setMaxBalance] = useState('');

  const fetchModes = useCallback(async () => {
    try {
      const res = await client.get('/system/account/modes');
      const available = res?.payload?.available || ['paper'];
      setModes(available);
      if (res?.payload?.active) setMode(res.payload.active);
    } catch {
      setModes(['paper']);
      setMode('paper');
    }
  }, []);

  const syncFromPayload = useCallback((payload) => {
    setAccount(payload);
    const cfg = payload?.config || {};
    setCommissionPerShare(cfg.commissionPerShare ?? '');
    setCommissionMin(cfg.commissionMin ?? '');
    setSlippageBps(cfg.slippageBps ?? '');
    setFillProbability(cfg.fillProbability ?? '');
    setMinBalance(cfg.minBalance ?? '');
    setMaxBalance(cfg.maxBalance ?? '');
  }, []);

  const fetchAccount = useCallback(async () => {
    setError(null);
    try {
      const res = await client.get(`/system/account/${mode}/balance`);
      if (res?.payload) syncFromPayload(res.payload);
    } catch (err) {
      setError('Broker sync failed');
    } finally {
      setLoading(false);
    }
  }, [mode, syncFromPayload]);

  useEffect(() => {
    fetchModes();
  }, [fetchModes]);

  useEffect(() => {
    fetchAccount();
    const interval = setInterval(fetchAccount, 5000);
    return () => clearInterval(interval);
  }, [fetchAccount]);

  const handleUpdateConfig = async () => {
    setError(null);
    try {
      await client.patch(`/system/account/${mode}/settings`, {
        config: {
          commissionPerShare,
          commissionMin,
          slippageBps: Number(slippageBps),
          fillProbability: Number(fillProbability),
          minBalance: Number(minBalance),
          maxBalance: Number(maxBalance)
        }
      });
      setShowSettings(false);
      fetchAccount();
    } catch (err) {
      setError('Failed to update broker settings');
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset account? All positions will be liquidated.')) return;
    try {
      await client.post(`/system/account/${mode}/reset`);
      fetchAccount();
    } catch (err) {
      setError('Failed to reset broker account');
    }
  };

  if (loading && !account) {
    return <div className="p-10 text-slate-500 font-mono animate-pulse text-center">LINKING ENGINE...</div>;
  }

  return (
    <div className="ui-page ui-page-scroll">
      <div className="flex flex-col gap-6">
        <div className="ui-panel">
          <div className="ui-panel-header">
            <div>
              <h2 className="ui-panel-title">Broker Intelligence</h2>
              <p className="text-[11px] text-slate-500">Status: Connected to {mode.toUpperCase()} broker</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                {modes.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`ui-button ui-button-secondary !px-3 !py-1 !text-[10px] ${mode === m ? 'ring-1 ring-blue-400/60' : ''}`}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
              <button onClick={handleReset} className="ui-button ui-button-secondary !px-3 !py-2 !text-[10px]">
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="ui-button ui-button-primary !px-3 !py-2 !text-[10px]"
              >
                <Settings size={14} /> {showSettings ? 'Close' : 'Settings'}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard label="Net Balance" value={account?.balance} icon={<DollarSign size={14} />} color="text-white" />
          <MetricCard label="Total Equity" value={account?.equity} icon={<Activity size={14} />} color="text-blue-400" />
          <MetricCard label="Used Margin" value={account?.margin} icon={<PieChart size={14} />} color="text-amber-400" subtitle="Locked Capital" />
          <MetricCard label="Free Margin" value={account?.freeMargin} icon={<ShieldCheck size={14} />} color="text-emerald-400" subtitle="Available" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-12 ui-panel">
            <div className="ui-panel-header">
              <h3 className="ui-panel-title">Position Ledger</h3>
              <span className="ui-chip">{mode.toUpperCase()} ACTIVE</span>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Side</th>
                    <th>Size</th>
                    <th className="text-right">Entry</th>
                    <th className="text-right">Unrealized P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {account?.positions?.length > 0 ? account.positions.map((pos, i) => (
                    <tr key={i}>
                      <td className="font-semibold">{pos.symbol}</td>
                      <td className={pos.side === 'long' ? 'text-emerald-300' : 'text-rose-300'}>{pos.side}</td>
                      <td className="mono">{pos.quantity}</td>
                      <td className="text-right text-slate-400">{pos.avgEntryPrice ?? '--'}</td>
                      <td className={`text-right font-semibold ${pos.unrealizedPnL >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {pos.unrealizedPnL >= 0 ? `+${pos.unrealizedPnL.toFixed(2)}` : pos.unrealizedPnL.toFixed(2)}
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="5" className="px-6 py-10 text-center text-slate-600 italic">No active exposure</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="ui-modal">
          <div className="ui-modal-card">
            <div className="ui-modal-header">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Broker Settings</h3>
                <p className="text-[11px] text-slate-500">Applies to {mode.toUpperCase()} only</p>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="ui-button ui-button-secondary !px-3 !py-2 !text-[10px]"
                aria-label="Close settings"
              >
                <X size={16} />
              </button>
            </div>
            <div className="ui-modal-body">
              <div className="ui-form text-xs">
                <ConfigInput label="Commission / Share" value={commissionPerShare} onChange={setCommissionPerShare} />
                <ConfigInput label="Commission Min" value={commissionMin} onChange={setCommissionMin} />
                <ConfigInput label="Slippage (BPS)" value={slippageBps} onChange={setSlippageBps} />
                <ConfigInput label="Fill Probability" value={fillProbability} onChange={setFillProbability} />
                <ConfigInput label="Min Balance" value={minBalance} onChange={setMinBalance} />
                <ConfigInput label="Max Balance" value={maxBalance} onChange={setMaxBalance} />
              </div>
            </div>
            <div className="ui-modal-footer">
              <button onClick={handleUpdateConfig} className="ui-button ui-button-primary w-full">
                <Save size={14} /> Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricCard = ({ label, value, color, icon, subtitle }) => (
  <div className="ui-card">
    <div className="flex items-center gap-2 mb-3">
      <div className="p-1.5 bg-slate-800 rounded-lg text-slate-400">{icon}</div>
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">{label}</span>
    </div>
    <div className={`text-2xl font-mono font-bold ${color}`}>
      ${typeof value === 'number' ? value.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
    </div>
    {subtitle && <div className="text-[9px] text-slate-600 mt-1 uppercase font-medium">{subtitle}</div>}
  </div>
);

const ConfigInput = ({ label, value, onChange }) => (
  <label className="ui-field">
    <span className="ui-label">{label}</span>
    <input
      type="number"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="ui-input"
    />
  </label>
);

export default AccountView;
