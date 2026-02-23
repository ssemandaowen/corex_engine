import React, { useState, useEffect, useCallback, useMemo } from 'react';
import client, { getSessionToken } from '../api/client';
import {
  Settings,
  RotateCcw,
  DollarSign,
  Activity,
  PieChart,
  ShieldCheck,
  Save,
  X,
  Wallet,
  Shield,
  SlidersHorizontal,
  KeyRound,
  RefreshCw
} from 'lucide-react';
import { useStore } from '../store/useStore';

const SETTINGS_SECTIONS = [
  {
    id: 'funds',
    label: 'Fund Management',
    icon: Wallet,
    fields: [
      { key: 'cash', label: 'Current Cash', type: 'number', step: '0.01', scope: 'root' },
      { key: 'initialCash', label: 'Initial Cash', type: 'number', step: '0.01', scope: 'root' },
      { key: 'maxDailyDeposit', label: 'Max Daily Deposit', type: 'number', step: '0.01' },
      { key: 'maxDailyWithdrawal', label: 'Max Daily Withdrawal', type: 'number', step: '0.01' },
      { key: 'maxOpenNotional', label: 'Max Open Notional', type: 'number', step: '0.01' }
    ]
  },
  {
    id: 'trading',
    label: 'Trading Control',
    icon: SlidersHorizontal,
    fields: [
      { key: 'commissionPerShare', label: 'Commission Per Share', type: 'number', step: '0.0001' },
      { key: 'commissionMin', label: 'Minimum Commission', type: 'number', step: '0.01' },
      { key: 'slippageBps', label: 'Slippage (bps)', type: 'number', step: '0.1' },
      { key: 'fillProbability', label: 'Fill Probability', type: 'number', step: '0.01' },
      { key: 'maxSlippageBps', label: 'Max Slippage (live)', type: 'number', step: '0.1' },
      { key: 'marginRequirement', label: 'Margin Requirement', type: 'number', step: '0.01' },
      { key: 'maxConcurrentPositions', label: 'Max Concurrent Positions', type: 'number', step: '1' },
      { key: 'maxOrderSize', label: 'Max Order Size', type: 'number', step: '0.01' },
      { key: 'allowShorting', label: 'Allow Shorting', type: 'boolean' }
    ]
  },
  {
    id: 'risk',
    label: 'Risk Guardrails',
    icon: Shield,
    fields: [
      { key: 'minBalance', label: 'Min Balance Guard', type: 'number', step: '0.01' },
      { key: 'riskFloor', label: 'Risk Floor (live)', type: 'number', step: '0.01' },
      { key: 'maxDrawdownPct', label: 'Max Drawdown %', type: 'number', step: '0.1' },
      { key: 'maxDailyLossPct', label: 'Max Daily Loss %', type: 'number', step: '0.1' },
      { key: 'maxPositionRiskPct', label: 'Max Position Risk %', type: 'number', step: '0.1' },
      { key: 'circuitBreaker', label: 'Circuit Breaker', type: 'boolean' }
    ]
  },
  {
    id: 'permissions',
    label: 'Permissions',
    icon: KeyRound,
    fields: [
      { key: 'executionEnabled', label: 'Execution Enabled', type: 'boolean' },
      { key: 'allowLiveOrders', label: 'Allow Live Orders', type: 'boolean' },
      { key: 'allowAutoClose', label: 'Allow Auto Close', type: 'boolean' },
      { key: 'allowLeverage', label: 'Allow Leverage', type: 'boolean' },
      { key: 'allowNightTrading', label: 'Allow Night Trading', type: 'boolean' }
    ]
  }
];

const toNumberIfFinite = (value) => {
  if (value === '' || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const toBoolean = (value) => value === true || value === 'true';

const normalizeConfig = (cfg = {}) => {
  const out = { ...(cfg || {}) };
  SETTINGS_SECTIONS.forEach((section) => {
    section.fields.forEach((field) => {
      if (!(field.key in out)) {
        out[field.key] = field.type === 'boolean' ? false : '';
      }
    });
  });
  return out;
};

const AccountView = () => {
  const [account, setAccount] = useState(null);
  const [settingsPayload, setSettingsPayload] = useState(null);
  const [mode, setMode] = useState('paper');
  const [modes, setModes] = useState(['paper']);
  const [showSettings, setShowSettings] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState('funds');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const {
    realtimeMode,
    mt5Account,
    mt5Positions,
    wsStatus,
    accountSnapshots,
    activeAccountMode,
    setActiveAccountMode
  } = useStore();

  const [config, setConfig] = useState({});
  const [cash, setCash] = useState('');
  const [initialCash, setInitialCash] = useState('');

  useEffect(() => {
    setMode(String(activeAccountMode || 'paper').toLowerCase() === 'live' ? 'live' : 'paper');
  }, [activeAccountMode]);

  const fetchModes = useCallback(async () => {
    try {
      const res = await client.get('/system/account/modes');
      const available = res?.payload?.available || ['paper'];
      setModes(available);
      if (res?.payload?.active && !activeAccountMode) {
        const next = String(res.payload.active).toLowerCase();
        setMode(next);
        setActiveAccountMode(next);
      }
    } catch {
      setModes(['paper']);
    }
  }, [activeAccountMode, setActiveAccountMode]);

  const syncFromBalancePayload = useCallback((payload) => {
    setAccount(payload);
  }, []);

  const syncFromSettingsPayload = useCallback((payload) => {
    setSettingsPayload(payload || null);
    setCash(payload?.cash ?? '');
    setInitialCash(payload?.initialCash ?? '');
    setConfig(normalizeConfig(payload?.config || {}));
  }, []);

  const fetchAccount = useCallback(async () => {
    if (authExpired || !getSessionToken()) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [balanceRes, settingsRes] = await Promise.all([
        client.get(`/system/account/${mode}/balance`),
        client.get(`/system/account/${mode}/settings`)
      ]);
      if (balanceRes?.payload) syncFromBalancePayload(balanceRes.payload);
      if (settingsRes?.payload) syncFromSettingsPayload(settingsRes.payload);
    } catch (err) {
      if (err?.status === 401) {
        setAuthExpired(true);
        setError('Session expired. Sign in again to refresh account data.');
        return;
      }
      setError('Broker sync failed');
    } finally {
      setLoading(false);
    }
  }, [authExpired, mode, syncFromBalancePayload, syncFromSettingsPayload]);

  useEffect(() => {
    fetchModes();
  }, [fetchModes]);

  useEffect(() => {
    const handleExpired = () => {
      setAuthExpired(true);
      setError('Session expired. Sign in again to refresh account data.');
    };
    window.addEventListener('corex:auth:expired', handleExpired);
    return () => window.removeEventListener('corex:auth:expired', handleExpired);
  }, []);

  useEffect(() => {
    if (realtimeMode === 'ws' && wsStatus === 'CONNECTED') {
      if (mode === 'live') {
        if (mt5Account) {
          const payload = { ...(mt5Account || {}) };
          payload.positions = Array.isArray(mt5Positions) ? mt5Positions : [];
          syncFromBalancePayload(payload);
          setLoading(false);
        }
      } else {
        const paper = accountSnapshots?.paper;
        if (paper) {
          syncFromBalancePayload(paper);
          setLoading(false);
        }
      }
    }

    if (!authExpired) {
      fetchAccount();
      const interval = setInterval(fetchAccount, 5000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [authExpired, fetchAccount, mode, realtimeMode, wsStatus, mt5Account, mt5Positions, accountSnapshots, syncFromBalancePayload]);

  const handleModeChange = (nextMode) => {
    const normalized = String(nextMode || 'paper').toLowerCase() === 'live' ? 'live' : 'paper';
    setMode(normalized);
    setActiveAccountMode(normalized);
  };

  const handleUpdateConfig = async () => {
    setError(null);
    setSavingConfig(true);
    try {
      const payloadConfig = {};
      Object.entries(config || {}).forEach(([key, value]) => {
        const field = SETTINGS_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === key);
        if (!field) return;
        if (field.type === 'boolean') {
          payloadConfig[key] = toBoolean(value);
          return;
        }
        const n = toNumberIfFinite(value);
        if (n != null) payloadConfig[key] = n;
      });

      await client.patch(`/system/account/${mode}/settings`, {
        cash: toNumberIfFinite(cash),
        initialCash: toNumberIfFinite(initialCash),
        config: payloadConfig
      });

      setShowSettings(false);
      fetchAccount();
    } catch {
      setError('Failed to update account settings');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset account? All positions will be liquidated.')) return;
    try {
      await client.post(`/system/account/${mode}/reset`, {
        initialCash: toNumberIfFinite(initialCash)
      });
      fetchAccount();
    } catch {
      setError('Failed to reset broker account');
    }
  };

  const bridgeStatus = account?.bridge?.authorized
    ? 'CONNECTED'
    : account?.bridge?.connected
      ? 'PENDING_AUTH'
      : mode === 'live' ? 'DISCONNECTED' : 'N/A';

  const positions = useMemo(() => Array.isArray(account?.positions) ? account.positions : [], [account]);

  if (loading && !account) {
    return <div className="p-10 text-[var(--ui-muted)] mono animate-pulse text-center text-xs tracking-widest">LINKING ENGINE...</div>;
  }

  return (
    <div className="ui-page ui-page-scroll p-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--ui-border)] pb-4">
          <div>
            <h2 className="ui-title">Account Center</h2>
            <p className="ui-subtitle mono">{mode.toUpperCase()} account runtime and controls</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="ui-tabs">
              {modes.map((m) => (
                <button
                  key={m}
                  onClick={() => handleModeChange(m)}
                  className={`ui-tab ${mode === m ? 'ui-tab-active' : ''}`}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="ui-chip"><RefreshCw size={11} /> {realtimeMode === 'ws' ? 'Live stream' : 'Polling'}</span>
            <span className="ui-chip"><ShieldCheck size={11} /> Bridge: {bridgeStatus}</span>
            <button onClick={handleReset} className="ui-button ui-button-secondary" title="Reset account">
              <RotateCcw size={14} /> Reset
            </button>
            <button onClick={() => setShowSettings(true)} className="ui-button ui-button-primary">
              <Settings size={14} /> Account Settings
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-[11px] text-rose-300 mono">
            Critical: {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard label="Net Balance" value={account?.balance ?? account?.cash} icon={<DollarSign size={14} />} color="text-[var(--ui-text)]" />
          <MetricCard label="Total Equity" value={account?.equity} icon={<Activity size={14} />} color="text-blue-400" />
          <MetricCard label="Used Margin" value={account?.usedMargin ?? account?.margin} icon={<PieChart size={14} />} color="text-amber-400" subtitle="Locked" />
          <MetricCard label="Free Margin" value={account?.freeMargin} icon={<ShieldCheck size={14} />} color="text-emerald-400" subtitle="Available" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="ui-card">
            <p className="ui-label">Mode</p>
            <p className="mono text-sm text-[var(--ui-text)] mt-1">{String(settingsPayload?.mode || mode).toUpperCase()}</p>
          </div>
          <div className="ui-card">
            <p className="ui-label">Cash</p>
            <p className="mono text-sm text-[var(--ui-text)] mt-1">${Number(settingsPayload?.cash ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          </div>
          <div className="ui-card">
            <p className="ui-label">Initial Cash</p>
            <p className="mono text-sm text-[var(--ui-text)] mt-1">${Number(settingsPayload?.initialCash ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          </div>
        </div>

        <div className="ui-panel-soft overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--ui-border)] flex justify-between items-center">
            <h3 className="ui-panel-title">Position Ledger</h3>
            <span className="ui-chip">{mode} active</span>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="ui-table">
              <thead className="sticky top-0">
                <tr>
                  <th>Asset</th>
                  <th>Side</th>
                  <th>Size</th>
                  <th className="text-right">Entry</th>
                  <th className="text-right">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody>
                {positions.length > 0 ? positions.map((pos, i) => (
                  <tr key={i}>
                    <td className="mono font-bold">{pos.symbol}</td>
                    <td className={`text-[10px] font-bold uppercase ${String(pos.side || '').toLowerCase() === 'long' ? 'text-emerald-400' : 'text-rose-400'}`}>{pos.side || '--'}</td>
                    <td className="mono">{pos.quantity ?? pos.volume ?? '--'}</td>
                    <td className="mono text-right">${(pos.avgEntryPrice ?? pos.price ?? 0)?.toFixed?.(2) ?? '--'}</td>
                    <td className={`mono text-right font-bold ${(Number(pos.unrealizedPnL ?? pos.unrealized) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {typeof (pos.unrealizedPnL ?? pos.unrealized) === 'number'
                        ? (Number(pos.unrealizedPnL ?? pos.unrealized) >= 0
                          ? `+${Number(pos.unrealizedPnL ?? pos.unrealized).toFixed(2)}`
                          : Number(pos.unrealizedPnL ?? pos.unrealized).toFixed(2))
                        : '--'}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="5" className="px-4 py-12 text-center text-[11px] text-[var(--ui-muted)] uppercase font-bold tracking-widest italic">
                      No active exposure in {mode}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="ui-modal p-4">
          <div className="ui-modal-card w-full max-w-5xl">
            <div className="ui-modal-header">
              <div>
                <p className="ui-panel-title">Account Management Settings</p>
                <h3 className="text-sm font-semibold text-[var(--ui-text)] mono">{mode.toUpperCase()} environment</h3>
              </div>
              <button onClick={() => setShowSettings(false)} className="ui-button ui-button-secondary p-2">
                <X size={16} />
              </button>
            </div>

            <div className="ui-modal-body max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-4">
                <aside className="ui-card p-2 h-fit">
                  {SETTINGS_SECTIONS.map((section) => (
                    <button
                      key={section.id}
                      onClick={() => setActiveSettingsSection(section.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors ${
                        activeSettingsSection === section.id
                          ? 'bg-blue-500/15 text-blue-200 border border-blue-500/30'
                          : 'text-[var(--ui-muted)] hover:bg-white/5'
                      }`}
                    >
                      <section.icon size={14} /> {section.label}
                    </button>
                  ))}
                </aside>

                <section className="ui-card">
                  {SETTINGS_SECTIONS.filter((s) => s.id === activeSettingsSection).map((section) => (
                    <div key={section.id} className="space-y-4">
                      <h4 className="ui-panel-title">{section.label}</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {section.fields.map((field) => (
                          <ConfigField
                            key={field.key}
                            field={field}
                            config={config}
                            setConfig={setConfig}
                            cash={cash}
                            setCash={setCash}
                            initialCash={initialCash}
                            setInitialCash={setInitialCash}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              </div>
            </div>

            <div className="ui-modal-footer">
              <button onClick={() => setShowSettings(false)} className="ui-button ui-button-secondary">Cancel</button>
              <button onClick={handleUpdateConfig} disabled={savingConfig} className="ui-button ui-button-primary disabled:opacity-50">
                <Save size={14} /> {savingConfig ? 'Saving...' : 'Save Account Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricCard = ({ label, value, color, icon, subtitle }) => (
  <div className="ui-card relative overflow-hidden">
    <div className="flex items-center gap-2 mb-2 relative z-10">
      <div className="text-[var(--ui-muted)]">{icon}</div>
      <span className="text-[10px] font-bold text-[var(--ui-muted)] uppercase tracking-tighter">{label}</span>
    </div>
    <div className={`text-xl mono font-bold relative z-10 ${color}`}>
      ${typeof value === 'number' ? value.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
    </div>
    {subtitle && <div className="text-[9px] font-bold text-[var(--ui-subtle)] mt-1 uppercase tracking-widest">{subtitle}</div>}
  </div>
);

const ConfigField = ({ field, config, setConfig, cash, setCash, initialCash, setInitialCash }) => {
  const current = field.scope === 'root'
    ? (field.key === 'cash' ? cash : initialCash)
    : config[field.key];

  const update = (next) => {
    if (field.scope === 'root') {
      if (field.key === 'cash') setCash(next);
      else setInitialCash(next);
      return;
    }
    setConfig((prev) => ({ ...prev, [field.key]: next }));
  };

  if (field.type === 'boolean') {
    return (
      <div className="ui-field">
        <label className="ui-label">{field.label}</label>
        <div className="ui-tabs">
          <button onClick={() => update(true)} className={`ui-tab ${toBoolean(current) ? 'ui-tab-active' : ''}`}>Enabled</button>
          <button onClick={() => update(false)} className={`ui-tab ${!toBoolean(current) ? 'ui-tab-active' : ''}`}>Disabled</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-field">
      <label className="ui-label">{field.label}</label>
      <input
        type="number"
        step={field.step || '0.01'}
        value={current ?? ''}
        onChange={(e) => update(e.target.value)}
        className="ui-input mono"
      />
    </div>
  );
};

export default AccountView;
