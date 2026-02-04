import React, { useState, useEffect } from 'react';
import client from '../api/client';
import { Settings, X } from 'lucide-react';

const AccountView = () => {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const addToast = (toast) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const next = { id, type: toast?.type || 'info', message: toast?.message || 'Saved.' };
    setToasts((prev) => [...prev, next]);
    setTimeout(() => {
      setToasts((prev) => prev.filter(t => t.id !== id));
    }, 2800);
  };

  const [cash, setCash] = useState('');
  const [commissionPerShare, setCommissionPerShare] = useState('');
  const [commissionMin, setCommissionMin] = useState('');
  const [slippageBps, setSlippageBps] = useState('');
  const [fillProbability, setFillProbability] = useState('');
  const [minBalance, setMinBalance] = useState('');
  const [maxBalance, setMaxBalance] = useState('');
  const [defaults, setDefaults] = useState(null);

  const fetchAccountData = async () => {
    try {
      const res = await client.get('/system/account/balance');
      setAccount(res.payload);
      setCash(res.payload?.balance ?? '');
      setCommissionPerShare(res.payload?.config?.commissionPerShare ?? '');
      setCommissionMin(res.payload?.config?.commissionMin ?? '');
      setSlippageBps(res.payload?.config?.slippageBps ?? '');
      setFillProbability(res.payload?.config?.fillProbability ?? '');
      setMinBalance(res.payload?.config?.minBalance ?? '');
      setMaxBalance(res.payload?.config?.maxBalance ?? '');
      if (!defaults && res.payload?.config) {
        setDefaults({ cash: res.payload?.balance ?? '', ...res.payload.config });
      }
    } catch (err) {
      console.error("Broker sync failed");
      setError("Broker sync failed");
      addToast({ type: 'error', message: 'Account sync failed.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccountData();
    const timer = setInterval(fetchAccountData, 10000); // Poll balance every 10s
    return () => clearInterval(timer);
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    setError(null);
    try {
      const slippageNum = Number(slippageBps);
      if (!Number.isFinite(slippageNum) || slippageNum < 0 || slippageNum > 500) {
        setError("Slippage must be between 0 and 500 bps.");
        setSaving(false);
        return;
      }
      const fillNum = Number(fillProbability);
      if (!Number.isFinite(fillNum) || fillNum < 0 || fillNum > 1) {
        setError("Fill probability must be between 0 and 1.");
        setSaving(false);
        return;
      }

      const minNum = Number(minBalance);
      const maxNum = Number(maxBalance);
      if (!Number.isFinite(minNum) || !Number.isFinite(maxNum) || minNum < 0 || maxNum <= minNum) {
        setError("Min/Max balance invalid. Ensure max > min and both >= 0.");
        setSaving(false);
        return;
      }

      const res = await client.patch('/system/account/settings', {
        cash,
        config: {
          commissionPerShare,
          commissionMin,
          slippageBps: slippageNum,
          fillProbability: fillNum,
          minBalance: minNum,
          maxBalance: maxNum
        }
      });
      setAccount(res.payload);
      setCash(res.payload?.balance ?? '');
      setCommissionPerShare(res.payload?.config?.commissionPerShare ?? '');
      setCommissionMin(res.payload?.config?.commissionMin ?? '');
      setSlippageBps(res.payload?.config?.slippageBps ?? '');
      setFillProbability(res.payload?.config?.fillProbability ?? '');
      setMinBalance(res.payload?.config?.minBalance ?? '');
      setMaxBalance(res.payload?.config?.maxBalance ?? '');
      if (defaults) {
        setDefaults((prev) => prev ? { ...prev, ...res.payload?.config, cash: res.payload?.balance ?? prev.cash } : prev);
      }
      addToast({ type: 'success', message: 'Paper settings saved.' });
    } catch (err) {
      setError("Failed to update paper account settings");
      addToast({ type: 'error', message: 'Settings update failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await client.post('/system/account/reset', { initialCash: cash || undefined });
      setAccount(res.payload);
      setCash(res.payload?.balance ?? '');
      addToast({ type: 'success', message: 'Paper account reset.' });
    } catch (err) {
      setError("Failed to reset paper account");
      addToast({ type: 'error', message: 'Account reset failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefaults = async () => {
    if (!defaults) return;
    setSaving(true);
    setError(null);
    try {
      const res = await client.patch('/system/account/settings', {
        cash: defaults.cash,
        config: {
          commissionPerShare: defaults.commissionPerShare,
          commissionMin: defaults.commissionMin,
          slippageBps: defaults.slippageBps,
          fillProbability: defaults.fillProbability,
          minBalance: defaults.minBalance,
          maxBalance: defaults.maxBalance
        }
      });
      setAccount(res.payload);
      setCash(res.payload?.balance ?? '');
      setCommissionPerShare(res.payload?.config?.commissionPerShare ?? '');
      setCommissionMin(res.payload?.config?.commissionMin ?? '');
      setSlippageBps(res.payload?.config?.slippageBps ?? '');
      setFillProbability(res.payload?.config?.fillProbability ?? '');
      setMinBalance(res.payload?.config?.minBalance ?? '');
      setMaxBalance(res.payload?.config?.maxBalance ?? '');
      addToast({ type: 'success', message: 'Defaults restored.' });
    } catch (err) {
      setError("Failed to restore defaults");
      addToast({ type: 'error', message: 'Restore defaults failed.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-slate-500 italic">Syncing with MT5 Bridge...</div>;

  return (
    <div className="space-y-6 h-[calc(100vh-160px)] overflow-y-auto pr-1">
      {/* 1. High-Level Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Balance" value={`$${account?.balance || '0.00'}`} color="text-white" />
        <MetricCard label="Equity" value={`$${account?.equity || '0.00'}`} color="text-blue-400" />
        <MetricCard label="Used Margin" value={`$${account?.margin || '0.00'}`} color="text-orange-400" />
        <MetricCard label="Free Margin" value={`$${account?.freeMargin || '0.00'}`} color="text-green-400" />
      </div>

      {/* 2. Connection Details & Open Positions */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-8 space-y-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase text-slate-400 tracking-widest">Live Positions</h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px] bg-slate-900 px-2 py-1 rounded text-slate-500">PAPER ACCOUNT</span>
                <button
                  onClick={() => setShowSettings(true)}
                  className="p-1 text-slate-400 hover:text-white transition-colors"
                  aria-label="Open paper settings"
                >
                  <Settings size={14} />
                </button>
              </div>
            </div>
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/50 text-slate-500 text-[10px] uppercase">
                  <tr>
                    <th className="px-6 py-3">Asset</th>
                    <th className="px-6 py-3">Side</th>
                    <th className="px-6 py-3">Qty</th>
                    <th className="px-6 py-3">Entry</th>
                    <th className="px-6 py-3">Unrealized P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {account?.positions?.length > 0 ? account.positions.map((pos, i) => (
                    <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-6 py-4 font-bold">{pos.symbol}</td>
                      <td className={`px-6 py-4 ${pos.side === 'long' ? 'text-green-500' : 'text-red-500'}`}>{pos.side}</td>
                      <td className="px-6 py-4 font-mono">{pos.quantity}</td>
                      <td className="px-6 py-4 text-slate-400">{pos.avgEntryPrice}</td>
                      <td className={`px-6 py-4 font-bold ${pos.unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pos.unrealizedPnL >= 0 ? `+${pos.unrealizedPnL}` : pos.unrealizedPnL}
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="5" className="px-6 py-10 text-center text-slate-600 italic">No open positions detected.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-700">
              <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Positions (Mini)</h3>
            </div>
            <div className="p-4 max-h-[220px] overflow-auto">
              {account?.positions?.length > 0 ? (
                <div className="space-y-2 text-xs">
                  {account.positions.map((pos, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-900/60 border border-slate-700 rounded px-3 py-2">
                      <div className="flex flex-col">
                        <span className="text-slate-200 font-mono">{pos.symbol}</span>
                        <span className="text-slate-500">{pos.side} · {pos.quantity}</span>
                      </div>
                      <div className={`font-mono ${pos.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pos.unrealizedPnL >= 0 ? `+${pos.unrealizedPnL}` : pos.unrealizedPnL}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-600 italic">No open positions.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#0B0F1A] border border-slate-800 rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-100">Paper Account Settings</h3>
                <p className="text-[10px] text-slate-500">Adjust demo balance, fees, and slippage.</p>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-500 hover:text-white transition-colors"
                aria-label="Close settings"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              {error && <div className="text-[10px] text-red-300">{error}</div>}
              <label className="flex flex-col gap-1">
                <span className="text-slate-400">Cash Balance</span>
                <input
                  type="number"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400">Min Balance</span>
                  <input
                    type="number"
                    min="0"
                    value={minBalance}
                    onChange={(e) => setMinBalance(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400">Max Balance</span>
                  <input
                    type="number"
                    min="0"
                    value={maxBalance}
                    onChange={(e) => setMaxBalance(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400">Commission / Share</span>
                  <input
                    type="number"
                    value={commissionPerShare}
                    onChange={(e) => setCommissionPerShare(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400">Commission Min</span>
                  <input
                    type="number"
                    value={commissionMin}
                    onChange={(e) => setCommissionMin(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400">Slippage (bps)</span>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={slippageBps}
                    onChange={(e) => setSlippageBps(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400">Fill Probability</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={fillProbability}
                    onChange={(e) => setFillProbability(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200"
                  />
                </label>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={handleRestoreDefaults}
                disabled={saving || !defaults}
                className="px-4 py-2 text-[10px] font-bold bg-slate-900 border border-slate-700 text-slate-200 rounded hover:bg-slate-800 disabled:opacity-50"
              >
                Restore Defaults
              </button>
              <button
                onClick={handleReset}
                disabled={saving}
                className="px-4 py-2 text-[10px] font-bold bg-slate-900 border border-slate-700 text-slate-200 rounded hover:bg-slate-800 disabled:opacity-50"
              >
                Reset Account
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="px-4 py-2 text-[10px] font-bold bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

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

const MetricCard = ({ label, value, color }) => (
  <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-sm">
    <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">{label}</p>
    <p className={`text-2xl font-mono ${color}`}>{value}</p>
  </div>
);

export default AccountView;
