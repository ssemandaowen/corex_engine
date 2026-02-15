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

  const [config, setConfig] = useState({
    commissionPerShare: '',
    commissionMin: '',
    slippageBps: '',
    fillProbability: '',
    minBalance: '',
    maxBalance: ''
  });

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
    setConfig({
      commissionPerShare: cfg.commissionPerShare ?? '',
      commissionMin: cfg.commissionMin ?? '',
      slippageBps: cfg.slippageBps ?? '',
      fillProbability: cfg.fillProbability ?? '',
      minBalance: cfg.minBalance ?? '',
      maxBalance: cfg.maxBalance ?? ''
    });
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

  useEffect(() => { fetchModes(); }, [fetchModes]);
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
          ...config,
          slippageBps: Number(config.slippageBps),
          fillProbability: Number(config.fillProbability),
          minBalance: Number(config.minBalance),
          maxBalance: Number(config.maxBalance)
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
    return <div className="p-10 text-slate-500 font-mono animate-pulse text-center text-xs tracking-widest">LINKING ENGINE...</div>;
  }

  return (
    <div className="ui-page ui-page-scroll p-6">
      <div className="flex flex-col gap-6">
        {/* Header Section */}
        <div className="flex justify-between items-end border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-black text-slate-100 uppercase tracking-tight">Broker Intelligence</h2>
            <p className="text-[10px] text-slate-500 font-mono">STATUS: CONNECTED TO {mode.toUpperCase()} GATEWAY</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-black/40 p-1 rounded-md border border-slate-800">
              {modes.map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${mode === m ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            <button onClick={handleReset} className="p-2 text-slate-500 hover:text-rose-400 transition-colors">
              <RotateCcw size={16} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase transition-all"
            >
              <Settings size={14} /> Settings
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-[10px] text-rose-400 font-mono">
            CRITICAL: {error}
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard label="Net Balance" value={account?.balance} icon={<DollarSign size={14} />} color="text-slate-100" />
          <MetricCard label="Total Equity" value={account?.equity} icon={<Activity size={14} />} color="text-blue-400" />
          <MetricCard label="Used Margin" value={account?.margin} icon={<PieChart size={14} />} color="text-amber-500" subtitle="LOCKED" />
          <MetricCard label="Free Margin" value={account?.freeMargin} icon={<ShieldCheck size={14} />} color="text-emerald-500" subtitle="AVAILABLE" />
        </div>

        {/* Position Ledger */}
        <div className="bg-[#0B0F16] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/30">
            <h3 className="text-[11px] font-black text-slate-300 uppercase tracking-widest">Position Ledger</h3>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-bold uppercase">{mode} ACTIVE</span>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-[#0B0F16] shadow-sm">
                <tr className="text-[10px] text-slate-500 uppercase font-bold border-b border-slate-800">
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Side</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3 text-right">Entry</th>
                  <th className="px-4 py-3 text-right">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {account?.positions?.length > 0 ? account.positions.map((pos, i) => (
                  <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-xs font-mono font-bold text-slate-200">{pos.symbol}</td>
                    <td className={`px-4 py-3 text-[10px] font-bold uppercase ${pos.side === 'long' ? 'text-emerald-500' : 'text-rose-500'}`}>{pos.side}</td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-300">{pos.quantity ?? pos.volume ?? '--'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-right text-slate-400">${(pos.avgEntryPrice ?? pos.price ?? 0)?.toFixed?.(2) ?? '--'}</td>
                    <td className={`px-4 py-3 text-xs font-mono text-right font-bold ${(Number(pos.unrealizedPnL) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {typeof pos.unrealizedPnL === 'number'
                        ? (pos.unrealizedPnL >= 0 ? `+${pos.unrealizedPnL.toFixed(2)}` : pos.unrealizedPnL.toFixed(2))
                        : '--'}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="5" className="px-4 py-12 text-center text-[10px] text-slate-600 uppercase font-bold tracking-widest italic">No active exposure in {mode}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Account Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-xs bg-[#0B0F16] border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-900/50">
              <div className="flex flex-col">
                <span className="text-[10px] text-blue-400 font-black uppercase tracking-widest">Brokerage Config</span>
                <h3 className="text-xs font-bold text-slate-100 font-mono truncate">{mode.toUpperCase()} ENVIRONMENT</h3>
              </div>
              <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
              {Object.keys(config).map((key) => (
                <ConfigInput 
                  key={key} 
                  label={key.replace(/([A-Z])/g, ' $1')} 
                  value={config[key]} 
                  onChange={(val) => setConfig({ ...config, [key]: val })} 
                />
              ))}
            </div>

            <div className="p-3 bg-black/20 border-t border-slate-800">
              <button 
                onClick={handleUpdateConfig} 
                className="w-full h-9 flex items-center justify-center gap-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black uppercase transition-all shadow-[0_0_15px_rgba(37,99,235,0.2)]"
              >
                <Save size={14} /> Commit Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricCard = ({ label, value, color, icon, subtitle }) => (
  <div className="bg-[#0B0F16] border border-slate-800 p-4 rounded-xl relative overflow-hidden group">
    <div className="flex items-center gap-2 mb-2 relative z-10">
      <div className="text-slate-500 group-hover:text-blue-400 transition-colors">{icon}</div>
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">{label}</span>
    </div>
    <div className={`text-xl font-mono font-bold relative z-10 ${color}`}>
      ${typeof value === 'number' ? value.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
    </div>
    {subtitle && <div className="text-[8px] font-black text-slate-600 mt-1 tracking-widest uppercase">{subtitle}</div>}
    <div className="absolute top-0 right-0 p-8 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity">
        {icon}
    </div>
  </div>
);

const ConfigInput = ({ label, value, onChange }) => (
  <div className="space-y-1.5">
    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{label}</label>
    <input
      type="number"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-black/40 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:border-blue-500 outline-none transition-colors font-mono"
    />
  </div>
);

export default AccountView;
