import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Code2, Cpu, Database, KeyRound,
  Link2, Monitor, Radio, RefreshCcw, Save,
  Settings as SettingsIcon, Shield, ChevronRight,
  Check, Wifi, WifiOff
} from 'lucide-react';
import client from '../api/client';
import { useStore } from '../store/useStore';
import { corexSwal } from '../utils/swal';

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const DEFAULT_FORM = {
  tickQueueMax: 5000,
  tickFlushMax: 10000,
  stratQueueMax: 1000,
  stratSliceMs: 5,
  signalExecConcurrency: 8,
  signalExecMaxQueue: 20000,
  logLevel: 'info',
  storage: {
    backtests: { keepN: 20, halfLifeDays: 14, maxAgeDays: 90 },
    cache:     { maxSizeMb: 500, maxAgeDays: 30 },
    uploads:   { maxSizeMb: 500, maxAgeDays: 30 },
  },
};

const toInt = (v) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

const TABS = [
  { id: 'runtime',      label: 'Runtime',      icon: Cpu           },
  { id: 'storage',      label: 'Storage',       icon: Database      },
  { id: 'connectivity', label: 'Connectivity',  icon: Link2         },
  { id: 'ui',           label: 'UI',            icon: Monitor       },
  { id: 'security',     label: 'Security',      icon: Shield        },
  { id: 'danger',       label: 'Danger Zone',   icon: AlertTriangle },
];

const CONN_TABS = [
  { id: 'market',  label: 'Market Data', icon: Radio    },
  { id: 'metaapi', label: 'MetaAPI',     icon: KeyRound },
  { id: 'mt5',     label: 'MT5 Bridge',  icon: Link2    },
];

/* ─────────────────────────────────────────────────────────────
   INLINE KEYFRAMES
───────────────────────────────────────────────────────────── */
const Keyframes = () => (
  <style>{`
    @keyframes sv-fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
    @keyframes sv-pulse  { 0%,100%{opacity:1} 50%{opacity:.35} }
    .sv-fadein { animation: sv-fadein .22s cubic-bezier(.4,0,.2,1) both }
    .sv-pulse  { animation: sv-pulse 2s ease-in-out infinite }

    .sv-tab {
      display: flex; align-items: center; gap: 9px;
      width: 100%; padding: 10px 14px;
      background: transparent; border: none;
      border-radius: 10px;
      font-size: 12px; font-weight: 600;
      letter-spacing: .04em;
      color: var(--ui-muted);
      cursor: pointer;
      transition: background .14s ease, color .14s ease;
      text-align: left; white-space: nowrap;
    }
    .sv-tab:hover { background: var(--ui-row-hover); color: var(--ui-text); }
    .sv-tab.active {
      background: rgba(79,140,255,.12);
      color: var(--ui-text);
      box-shadow: inset 3px 0 0 var(--ui-accent);
    }
    .sv-tab.danger { color: var(--ui-negative); }
    .sv-tab.danger:hover { background: rgba(251,113,133,.08); }
    .sv-tab.danger.active { background: rgba(251,113,133,.1); box-shadow: inset 3px 0 0 var(--ui-negative); }

    .sv-ctab {
      display: flex; align-items: center; gap: 7px;
      padding: 6px 13px;
      background: transparent; border: none;
      border-radius: 999px;
      font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
      color: var(--ui-muted); cursor: pointer;
      transition: background .12s, color .12s, box-shadow .12s;
    }
    .sv-ctab:hover { color: var(--ui-text); background: var(--ui-row-hover); }
    .sv-ctab.active {
      background: rgba(79,140,255,.18);
      color: var(--ui-text);
      box-shadow: 0 0 0 1px rgba(79,140,255,.4);
    }

    .sv-input, .sv-select {
      width: 100%;
      padding: 9px 12px;
      border-radius: var(--ui-radius-xs);
      border: 1px solid var(--ui-border);
      background: var(--ui-input-bg);
      color: var(--ui-text);
      font-size: 13px;
      transition: border-color .15s, box-shadow .15s;
    }
    .sv-input.mono, .sv-select.mono {
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
    }
    .sv-input:focus, .sv-select:focus {
      outline: none;
      border-color: var(--ui-accent);
      box-shadow: 0 0 0 3px var(--ui-accent-ring);
    }
    .sv-input:read-only { color: var(--ui-subtle); cursor: default; }

    .sv-select {
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2364748b'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding-right: 30px;
      cursor: pointer;
    }

    .sv-toggle-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-xs);
      background: var(--ui-panel);
    }

    .sv-switch {
      position: relative; width: 42px; height: 24px;
      border-radius: 999px; border: 1px solid var(--ui-border);
      background: var(--ui-panel-strong);
      cursor: pointer; transition: background .2s, border-color .2s;
      flex-shrink: 0;
    }
    .sv-switch::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--ui-muted);
      transition: left .2s, background .2s;
    }
    .sv-switch.on { background: rgba(79,140,255,.22); border-color: var(--ui-border-strong); }
    .sv-switch.on::after { left: 20px; background: var(--ui-accent); }

    .sv-segmented {
      display: inline-flex; gap: 3px; padding: 4px;
      background: var(--ui-tab-strip-bg);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-xs);
    }
    .sv-seg-btn {
      padding: 6px 14px; border-radius: 7px; border: none;
      background: transparent; color: var(--ui-muted);
      font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      cursor: pointer; transition: background .12s, color .12s, box-shadow .12s;
      white-space: nowrap;
    }
    .sv-seg-btn:hover { color: var(--ui-text); background: var(--ui-row-hover); }
    .sv-seg-btn.active {
      background: rgba(79,140,255,.2); color: var(--ui-text);
      box-shadow: 0 0 0 1px rgba(79,140,255,.45);
    }

    .sv-save-btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 8px 18px; border-radius: 999px; border: none;
      background: linear-gradient(140deg, var(--ui-accent-strong), var(--ui-accent));
      color: #f8fafc; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
      cursor: pointer; box-shadow: var(--ui-glow);
      transition: filter .15s, opacity .15s;
    }
    .sv-save-btn:hover:not(:disabled) { filter: brightness(1.08); }
    .sv-save-btn:disabled { opacity: .45; cursor: default; }
    .sv-save-btn.saved {
      background: rgba(52,211,153,.15);
      border: 1px solid rgba(52,211,153,.35);
      color: var(--ui-positive); box-shadow: none;
    }

    .sv-field-grid-2 { display: grid; grid-template-columns: repeat(2,1fr); gap: 14px; }
    .sv-field-grid-3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }
    @media(max-width:720px) {
      .sv-field-grid-2 { grid-template-columns: 1fr; }
      .sv-field-grid-3 { grid-template-columns: 1fr; }
    }

    .sv-section-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; font-weight: 700; letter-spacing: .22em;
      text-transform: uppercase; color: var(--ui-subtle);
      padding: 0 0 8px; margin: 0;
    }

    .sv-status-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--ui-panel-strong);
      border: 1px solid var(--ui-border);
      font-size: 11px;
    }
    .sv-status-key { color: var(--ui-subtle); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
    .sv-status-val { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ui-text); }

    .sv-unsaved-banner {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 14px; border-radius: var(--ui-radius-xs);
      background: rgba(245,158,11,.08);
      border: 1px solid rgba(245,158,11,.28);
      color: #fbbf24; font-size: 11px; font-weight: 600; letter-spacing: .04em;
      margin-bottom: 14px;
    }
  `}</style>
);

/* ─────────────────────────────────────────────────────────────
   SMALL COMPONENTS
───────────────────────────────────────────────────────────── */
const Field = ({ label, children, span }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: span ? `span ${span}` : undefined }}>
    <label style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 9, fontWeight: 700, letterSpacing: '.2em',
      textTransform: 'uppercase', color: 'var(--ui-subtle)',
    }}>
      {label}
    </label>
    {children}
  </div>
);

const NumInput = ({ value, onChange, ...props }) => (
  <input
    type="number"
    className="sv-input mono"
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value)}
    {...props}
  />
);

const SectionCard = ({ icon: Icon, title, accent, children }) => (
  <div style={{
    background: 'var(--ui-panel)',
    border: `1px solid ${accent ? 'rgba(251,113,133,.3)' : 'var(--ui-border)'}`,
    borderRadius: 'var(--ui-radius)',
    overflow: 'hidden',
    boxShadow: 'var(--ui-shadow)',
  }}>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 18px',
      borderBottom: '1px solid var(--ui-border)',
      background: 'var(--ui-panel-soft)',
    }}>
      <Icon size={14} style={{ color: accent ? 'var(--ui-negative)' : 'var(--ui-accent)', flexShrink: 0 }} />
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9, fontWeight: 700, letterSpacing: '.22em',
        textTransform: 'uppercase',
        color: accent ? 'var(--ui-negative)' : 'var(--ui-muted)',
      }}>
        {title}
      </span>
    </div>
    <div style={{ padding: '18px 18px 20px' }}>
      {children}
    </div>
  </div>
);

const SegBtn = ({ active, onClick, children }) => (
  <button className={`sv-seg-btn${active ? ' active' : ''}`} onClick={onClick}>{children}</button>
);

const Segmented = ({ options, value, onChange }) => (
  <div className="sv-segmented">
    {options.map((o) => (
      <SegBtn key={o.value ?? o} active={(o.value ?? o) === value} onClick={() => onChange(o.value ?? o)}>
        {o.label ?? o}
      </SegBtn>
    ))}
  </div>
);

/* ─────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────── */
const SettingsView = () => {
  const [adminKey] = useState(import.meta.env.VITE_ADMIN_SECRET || '***************');
  const {
    systemSettings, settingsLoading,
    fetchSystemSettings, updateSystemSettings,
    realtimeMode, setRealtimeMode,
    uiTheme, setUiTheme,
    editorPrefs, setEditorPrefs,
    persistedSettings,
  } = useStore();

  const [form,               setForm]               = useState(DEFAULT_FORM);
  const [formDirty,          setFormDirty]          = useState(false);
  const [activeTab,          setActiveTab]          = useState('runtime');
  const [connectivityTab,    setConnectivityTab]    = useState('market');
  const [connectivitySaving, setConnectivitySaving] = useState(false);
  const [connectivityDirty,  setConnectivityDirty]  = useState(false);
  const [mt5Status,          setMt5Status]          = useState(null);
  const [integrationConfig,  setIntegrationConfig]  = useState({
    marketData: { twelveDataApiKey: '', websocketEnabled: true },
    metaApi:    { accountId: '', token: '', server: '' },
    mt5Bridge:  {
      mode: 'local', host: '127.0.0.1', port: '3000',
      heartbeatMs: 3000, activeBridgeProvider: 'python_receiver',
      bridgeToken: '', httpToken: '',
    },
  });

  const isRuntimeTab     = activeTab === 'runtime' || activeTab === 'storage';
  const isConnectivityTab= activeTab === 'connectivity';
  const hasUnsaved       = isRuntimeTab ? formDirty : (isConnectivityTab ? connectivityDirty : false);
  const isSaving         = settingsLoading || connectivitySaving;

  /* ── Effects ── */
  useEffect(() => { fetchSystemSettings(); }, [fetchSystemSettings]);

  useEffect(() => {
    if (!systemSettings || formDirty) return;
    setForm({
      ...DEFAULT_FORM, ...systemSettings,
      storage: {
        ...DEFAULT_FORM.storage, ...(systemSettings.storage || {}),
        backtests: { ...DEFAULT_FORM.storage.backtests, ...(systemSettings.storage?.backtests || {}) },
        cache:     { ...DEFAULT_FORM.storage.cache,     ...(systemSettings.storage?.cache     || {}) },
        uploads:   { ...DEFAULT_FORM.storage.uploads,   ...(systemSettings.storage?.uploads   || {}) },
      },
    });
  }, [systemSettings, formDirty]);

  useEffect(() => {
    const source = persistedSettings?.payload?.ui?.integrations;
    if (!source || typeof source !== 'object' || connectivityDirty) return;
    setIntegrationConfig((prev) => ({
      marketData: { ...prev.marketData, ...(source.marketData || {}) },
      metaApi:    { ...prev.metaApi,    ...(source.metaApi    || {}) },
      mt5Bridge:  { ...prev.mt5Bridge,  ...(source.mt5Bridge  || {}) },
    }));
  }, [persistedSettings, connectivityDirty]);

  useEffect(() => {
    const onFocus = (ev) => {
      setActiveTab(ev?.detail?.tab || 'connectivity');
      if (ev?.detail?.subTab) setConnectivityTab(ev.detail.subTab);
    };
    window.addEventListener('corex:settings:focus', onFocus);
    return () => window.removeEventListener('corex:settings:focus', onFocus);
  }, []);

  useEffect(() => {
    if (activeTab !== 'connectivity') return;
    let canceled = false;
    const load = async () => {
      try {
        const res = await client.get('/system/mt5/status');
        if (!canceled) setMt5Status(res?.payload || null);
      } catch { if (!canceled) setMt5Status(null); }
    };
    load();
    const t = setInterval(load, 3000);
    return () => { canceled = true; clearInterval(t); };
  }, [activeTab]);

  /* ── Field setters ── */
  const setField        = (key, val)           => { setFormDirty(true); setForm((p) => ({ ...p, [key]: val })); };
  const setStorageField = (sec, key, val)      => {
    setFormDirty(true);
    setForm((p) => ({ ...p, storage: { ...p.storage, [sec]: { ...(p.storage?.[sec] || {}), [key]: val } } }));
  };
  const setConnField    = (updater)            => { setConnectivityDirty(true); setIntegrationConfig(updater); };
  const setMt5          = (key, val)           => setConnField((p) => ({ ...p, mt5Bridge: { ...p.mt5Bridge, [key]: val } }));
  const setMetaApi      = (key, val)           => setConnField((p) => ({ ...p, metaApi:   { ...p.metaApi,   [key]: val } }));
  const setMarket       = (key, val)           => setConnField((p) => ({ ...p, marketData: { ...p.marketData, [key]: val } }));

  /* ── Save handlers ── */
  const handleSave = async () => {
    const payload = {
      ...form,
      tickQueueMax: toInt(form.tickQueueMax), tickFlushMax: toInt(form.tickFlushMax),
      stratQueueMax: toInt(form.stratQueueMax), stratSliceMs: toInt(form.stratSliceMs),
      signalExecConcurrency: toInt(form.signalExecConcurrency),
      signalExecMaxQueue: toInt(form.signalExecMaxQueue),
      storage: {
        backtests: { keepN: toInt(form.storage.backtests.keepN), maxAgeDays: toInt(form.storage.backtests.maxAgeDays), halfLifeDays: toInt(form.storage.backtests.halfLifeDays) },
        cache:     { maxSizeMb: toInt(form.storage.cache.maxSizeMb),    maxAgeDays: toInt(form.storage.cache.maxAgeDays)    },
        uploads:   { maxSizeMb: toInt(form.storage.uploads.maxSizeMb),  maxAgeDays: toInt(form.storage.uploads.maxAgeDays)  },
      },
    };
    const res = await updateSystemSettings(payload, true);
    if (res) {
      setFormDirty(false);
      await fetchSystemSettings();
      await corexSwal({ icon: 'success', title: 'Saved', text: 'System settings saved.', confirmButtonText: 'OK' });
    }
  };

  const saveConnectivity = async () => {
    setConnectivitySaving(true);
    try {
      await updateSystemSettings({ ui: { integrations: integrationConfig } }, true);
      await client.patch('/system/run/settings', {
        settings: { activeBridgeProvider: integrationConfig.mt5Bridge.activeBridgeProvider },
        persist: true,
      });
      setConnectivityDirty(false);
      await fetchSystemSettings();
      await corexSwal({ icon: 'success', title: 'Saved', text: 'Connectivity settings saved.', confirmButtonText: 'OK' });
    } catch {
      await corexSwal({ icon: 'error', title: 'Save Failed', text: 'Failed to save connectivity settings.', confirmButtonText: 'OK' });
    } finally { setConnectivitySaving(false); }
  };

  const handlePrimarySave = async () => {
    if (isRuntimeTab)      return handleSave();
    if (isConnectivityTab) return saveConnectivity();
    return corexSwal({ icon: 'info', title: 'Auto Saved', text: 'This tab saves changes immediately.', confirmButtonText: 'OK' });
  };

  const handleMaintenanceReset = async () => {
    const confirm = await corexSwal({
      icon: 'warning', title: 'Confirm Reset',
      text: 'Force reset all strategy lifecycles?',
      showCancelButton: true, confirmButtonText: 'Yes, reset', cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;
    try {
      const res = await client.post('/system/maintenance/reset-states');
      await corexSwal({ icon: 'success', title: 'Reset Complete', text: res.payload?.message || 'Reset complete.', confirmButtonText: 'OK' });
    } catch {
      await corexSwal({ icon: 'error', title: 'Reset Failed', text: 'Reset failed.', confirmButtonText: 'OK' });
    }
  };

  /* ── Save button label ── */
  const saveBtnLabel = isSaving
    ? 'Saving…'
    : isRuntimeTab
      ? (formDirty ? 'Save Changes' : 'Saved')
      : isConnectivityTab
        ? (connectivityDirty ? 'Save Connectivity' : 'Saved')
        : 'Auto Saved';

  const saveBtnSaved = !isSaving && !hasUnsaved && (isRuntimeTab || isConnectivityTab);

  /* ── MT5 online status ── */
  const mt5Online = mt5Status?.bridgeStatus === 'connected';

  /* ─── RENDER ─── */
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
      <Keyframes />

      {/* Top bar */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, padding: '11px 22px',
        borderBottom: '1px solid var(--ui-border)',
        background: 'var(--ui-header-glass)', backdropFilter: 'blur(12px)', zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(79,140,255,.12)', border: '1px solid rgba(79,140,255,.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <SettingsIcon size={16} style={{ color: 'var(--ui-accent)' }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ui-text)', letterSpacing: '-.01em' }}>
              System Configuration
            </div>
            <div style={{ fontSize: 11, color: 'var(--ui-subtle)', marginTop: 1 }}>
              Runtime · Storage · Connectivity · UI preferences
            </div>
          </div>
        </div>

        <button
          className={`sv-save-btn${saveBtnSaved ? ' saved' : ''}`}
          onClick={handlePrimarySave}
          disabled={isSaving || (!hasUnsaved && (isRuntimeTab || isConnectivityTab))}
        >
          {saveBtnSaved
            ? <><Check size={12} /> Saved</>
            : <><Save size={12} /> {saveBtnLabel}</>
          }
        </button>
      </div>

      {/* Body: sidebar + content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Sidebar nav */}
        <div style={{
          width: 188, flexShrink: 0,
          borderRight: '1px solid var(--ui-border)',
          background: 'var(--ui-sidebar-bg)',
          display: 'flex', flexDirection: 'column',
          padding: '14px 8px',
          gap: 2, overflowY: 'auto',
        }}>
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 8, fontWeight: 700, letterSpacing: '.22em',
            textTransform: 'uppercase', color: 'var(--ui-subtle)',
            padding: '2px 6px 8px',
          }}>
            Config Sections
          </p>
          {TABS.map((tab) => {
            const Icon   = tab.icon;
            const active = activeTab === tab.id;
            const danger = tab.id === 'danger';
            return (
              <button
                key={tab.id}
                className={`sv-tab${active ? ' active' : ''}${danger ? ' danger' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={13} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{tab.label}</span>
                {active && <ChevronRight size={11} style={{ opacity: .5 }} />}
                {(tab.id === 'runtime' || tab.id === 'storage') && formDirty && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--ui-warning)', flexShrink: 0,
                  }} />
                )}
                {tab.id === 'connectivity' && connectivityDirty && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--ui-warning)', flexShrink: 0,
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Content pane */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 32px' }}>

          {/* Unsaved banner */}
          {(formDirty || connectivityDirty) && (
            <div className="sv-unsaved-banner">
              <AlertTriangle size={13} />
              Unsaved configuration changes — remember to save.
            </div>
          )}

          {/* ── RUNTIME ── */}
          {activeTab === 'runtime' && (
            <div className="sv-fadein" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionCard icon={Cpu} title="Engine Runtime Parameters">
                <div className="sv-field-grid-2">
                  {[
                    { key: 'tickQueueMax',           label: 'Tick Queue Max'          },
                    { key: 'tickFlushMax',            label: 'Tick Flush Max'          },
                    { key: 'stratQueueMax',           label: 'Strategy Queue Max'      },
                    { key: 'stratSliceMs',            label: 'Strategy Slice (ms)'     },
                    { key: 'signalExecConcurrency',   label: 'Signal Exec Concurrency' },
                    { key: 'signalExecMaxQueue',      label: 'Signal Exec Max Queue'   },
                  ].map((f) => (
                    <Field key={f.key} label={f.label}>
                      <NumInput value={form[f.key]} onChange={(v) => setField(f.key, v)} />
                    </Field>
                  ))}
                  <Field label="Log Level" span={2}>
                    <select className="sv-select" value={form.logLevel} onChange={(e) => setField('logLevel', e.target.value)}>
                      {['error','warn','info','debug'].map((l) => (
                        <option key={l} value={l}>{l.toUpperCase()}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── STORAGE ── */}
          {activeTab === 'storage' && (
            <div className="sv-fadein" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionCard icon={Database} title="Storage & Retention Policies">
                <div className="sv-field-grid-3">
                  {/* Backtests */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <p className="sv-section-label">Backtests</p>
                    <Field label="Keep Count">
                      <NumInput value={form.storage.backtests.keepN}        onChange={(v) => setStorageField('backtests','keepN',v)} />
                    </Field>
                    <Field label="Half-Life (days)">
                      <NumInput value={form.storage.backtests.halfLifeDays} onChange={(v) => setStorageField('backtests','halfLifeDays',v)} />
                    </Field>
                    <Field label="Max Age (days)">
                      <NumInput value={form.storage.backtests.maxAgeDays}   onChange={(v) => setStorageField('backtests','maxAgeDays',v)} />
                    </Field>
                  </div>
                  {/* Cache */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <p className="sv-section-label">Cache</p>
                    <Field label="Max Size (MB)">
                      <NumInput value={form.storage.cache.maxSizeMb}  onChange={(v) => setStorageField('cache','maxSizeMb',v)} />
                    </Field>
                    <Field label="Max Age (days)">
                      <NumInput value={form.storage.cache.maxAgeDays} onChange={(v) => setStorageField('cache','maxAgeDays',v)} />
                    </Field>
                  </div>
                  {/* Uploads */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <p className="sv-section-label">Uploads</p>
                    <Field label="Max Size (MB)">
                      <NumInput value={form.storage.uploads.maxSizeMb}  onChange={(v) => setStorageField('uploads','maxSizeMb',v)} />
                    </Field>
                    <Field label="Max Age (days)">
                      <NumInput value={form.storage.uploads.maxAgeDays} onChange={(v) => setStorageField('uploads','maxAgeDays',v)} />
                    </Field>
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── CONNECTIVITY ── */}
          {activeTab === 'connectivity' && (
            <div className="sv-fadein" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Sub-tab strip */}
              <div style={{
                display: 'flex', gap: 3, padding: 4,
                background: 'var(--ui-tab-strip-bg)',
                border: '1px solid var(--ui-border)',
                borderRadius: 'var(--ui-radius-xs)',
                width: 'fit-content',
              }}>
                {CONN_TABS.map((ct) => {
                  const Icon = ct.icon;
                  return (
                    <button
                      key={ct.id}
                      className={`sv-ctab${connectivityTab === ct.id ? ' active' : ''}`}
                      onClick={() => setConnectivityTab(ct.id)}
                    >
                      <Icon size={11} />
                      {ct.label}
                    </button>
                  );
                })}
              </div>

              {/* Market Data */}
              {connectivityTab === 'market' && (
                <SectionCard icon={Radio} title="Market Data Provider">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <Field label="Twelve Data API Key">
                      <input type="password" className="sv-input mono"
                        value={integrationConfig.marketData.twelveDataApiKey}
                        onChange={(e) => setMarket('twelveDataApiKey', e.target.value)}
                        placeholder="••••••••••••••••"
                      />
                    </Field>
                    <div className="sv-toggle-row">
                      <div>
                        <div style={{ fontSize: 13, color: 'var(--ui-text)', fontWeight: 600 }}>Realtime Websocket Feed</div>
                        <div style={{ fontSize: 11, color: 'var(--ui-subtle)', marginTop: 2 }}>Stream live tick data over WebSocket</div>
                      </div>
                      <button
                        className={`sv-switch${integrationConfig.marketData.websocketEnabled ? ' on' : ''}`}
                        onClick={() => setMarket('websocketEnabled', !integrationConfig.marketData.websocketEnabled)}
                      />
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* MetaAPI */}
              {connectivityTab === 'metaapi' && (
                <SectionCard icon={KeyRound} title="MetaAPI Integration">
                  <div className="sv-field-grid-2">
                    <Field label="Account ID">
                      <input className="sv-input mono" value={integrationConfig.metaApi.accountId}
                        onChange={(e) => setMetaApi('accountId', e.target.value)} />
                    </Field>
                    <Field label="Token">
                      <input type="password" className="sv-input mono" value={integrationConfig.metaApi.token}
                        onChange={(e) => setMetaApi('token', e.target.value)} placeholder="••••••••••••••••" />
                    </Field>
                    <Field label="Server" span={2}>
                      <input className="sv-input mono" value={integrationConfig.metaApi.server}
                        onChange={(e) => setMetaApi('server', e.target.value)}
                        placeholder="e.g. MetaQuotes-Demo" />
                    </Field>
                  </div>
                </SectionCard>
              )}

              {/* MT5 Bridge */}
              {connectivityTab === 'mt5' && (
                <SectionCard icon={Link2} title="MT5 Bridge Configuration">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Status strip */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px',
                      borderRadius: 'var(--ui-radius-xs)',
                      background: mt5Online ? 'rgba(52,211,153,.07)' : 'rgba(100,116,139,.06)',
                      border: `1px solid ${mt5Online ? 'rgba(52,211,153,.25)' : 'var(--ui-border)'}`,
                    }}>
                      {mt5Online
                        ? <Wifi size={14} style={{ color: 'var(--ui-positive)' }} />
                        : <WifiOff size={14} style={{ color: 'var(--ui-subtle)' }} />
                      }
                      <div style={{ flex: 1 }}>
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10, fontWeight: 700, letterSpacing: '.1em',
                          color: mt5Online ? 'var(--ui-positive)' : 'var(--ui-subtle)',
                        }}>
                          {mt5Status?.bridgeStatus?.toUpperCase() || 'DISCONNECTED'}
                        </span>
                      </div>
                      {mt5Status?.heartbeat?.last_seen && (
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--ui-subtle)' }}>
                          {new Date(mt5Status.heartbeat.last_seen).toLocaleTimeString()}
                        </span>
                      )}
                      {Array.isArray(mt5Status?.pending) && mt5Status.pending.length > 0 && (
                        <span style={{
                          padding: '2px 8px', borderRadius: 999, fontSize: 9, fontWeight: 700,
                          background: 'rgba(245,158,11,.12)', color: 'var(--ui-warning)',
                          border: '1px solid rgba(245,158,11,.25)',
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          {mt5Status.pending.length} PENDING
                        </span>
                      )}
                    </div>

                    <div className="sv-field-grid-2">
                      <Field label="Bridge Mode">
                        <select className="sv-select" value={integrationConfig.mt5Bridge.mode}
                          onChange={(e) => setMt5('mode', e.target.value)}>
                          <option value="local">Local</option>
                          <option value="remote">Remote</option>
                        </select>
                      </Field>
                      <Field label="Bridge Provider">
                        <select className="sv-select" value={integrationConfig.mt5Bridge.activeBridgeProvider}
                          onChange={(e) => setMt5('activeBridgeProvider', e.target.value)}>
                          <option value="python_receiver">Python Receiver</option>
                          <option value="mql5_receiver">MQL5 Receiver</option>
                          <option value="metaapi">MetaAPI</option>
                        </select>
                      </Field>
                      <Field label="Host">
                        <input className="sv-input mono" value={integrationConfig.mt5Bridge.host}
                          onChange={(e) => setMt5('host', e.target.value)} />
                      </Field>
                      <Field label="Port">
                        <input className="sv-input mono" value={integrationConfig.mt5Bridge.port}
                          onChange={(e) => setMt5('port', e.target.value)} />
                      </Field>
                      <Field label="Heartbeat Interval (ms)" span={2}>
                        <input type="number" className="sv-input mono" value={integrationConfig.mt5Bridge.heartbeatMs}
                          onChange={(e) => setMt5('heartbeatMs', Number(e.target.value || 3000))} />
                      </Field>
                      <Field label="WS Token">
                        <input type="password" className="sv-input mono" value={integrationConfig.mt5Bridge.bridgeToken || ''}
                          onChange={(e) => setMt5('bridgeToken', e.target.value)} placeholder="••••••••" />
                      </Field>
                      <Field label="HTTP Token">
                        <input type="password" className="sv-input mono" value={integrationConfig.mt5Bridge.httpToken || ''}
                          onChange={(e) => setMt5('httpToken', e.target.value)} placeholder="••••••••" />
                      </Field>
                    </div>
                  </div>
                </SectionCard>
              )}
            </div>
          )}

          {/* ── UI PREFERENCES ── */}
          {activeTab === 'ui' && (
            <div className="sv-fadein" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionCard icon={Monitor} title="Interface Preferences">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <Field label="Color Theme">
                    <Segmented
                      options={['dark','light','system']}
                      value={uiTheme}
                      onChange={setUiTheme}
                    />
                  </Field>
                  <Field label="Realtime Transport">
                    <Segmented
                      options={[{value:'ws',label:'WebSocket'},{value:'polling',label:'Polling'}]}
                      value={realtimeMode}
                      onChange={setRealtimeMode}
                    />
                  </Field>
                </div>
              </SectionCard>

              <SectionCard icon={Code2} title="Code Editor">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Field label="Editor Theme">
                    <Segmented
                      options={['auto','corex-dark','corex-light','vs-dark','vs-light']}
                      value={editorPrefs?.theme ?? 'auto'}
                      onChange={(v) => setEditorPrefs({ theme: v })}
                    />
                  </Field>
                  <div className="sv-field-grid-2">
                    <Field label="Font Size">
                      <input type="number" className="sv-input mono" value={editorPrefs?.fontSize ?? 13}
                        onChange={(e) => setEditorPrefs({ fontSize: Number(e.target.value || 13) })} />
                    </Field>
                    <Field label="Line Height">
                      <input type="number" className="sv-input mono" value={editorPrefs?.lineHeight ?? 20}
                        onChange={(e) => setEditorPrefs({ lineHeight: Number(e.target.value || 20) })} />
                    </Field>
                  </div>
                  <Field label="Font Family">
                    <select className="sv-select" value={editorPrefs?.fontFamily || 'JetBrains Mono, Menlo, Monaco, Courier New, monospace'}
                      onChange={(e) => setEditorPrefs({ fontFamily: e.target.value })}>
                      <option value="JetBrains Mono, Menlo, Monaco, Courier New, monospace">JetBrains Mono</option>
                      <option value="Fira Code, Menlo, Monaco, Courier New, monospace">Fira Code</option>
                      <option value="Source Code Pro, Menlo, Monaco, Courier New, monospace">Source Code Pro</option>
                    </select>
                  </Field>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <Field label="Minimap">
                      <Segmented
                        options={[{value:true,label:'On'},{value:false,label:'Off'}]}
                        value={editorPrefs?.minimap ?? true}
                        onChange={(v) => setEditorPrefs({ minimap: v })}
                      />
                    </Field>
                    <Field label="Word Wrap">
                      <Segmented
                        options={[{value:'on',label:'On'},{value:'off',label:'Off'}]}
                        value={editorPrefs?.wordWrap ?? 'on'}
                        onChange={(v) => setEditorPrefs({ wordWrap: v })}
                      />
                    </Field>
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── SECURITY ── */}
          {activeTab === 'security' && (
            <div className="sv-fadein">
              <SectionCard icon={Shield} title="Security">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Field label="Admin Secret Key">
                    <input type="text" readOnly className="sv-input mono" value={adminKey} />
                  </Field>
                  <p style={{ fontSize: 11, color: 'var(--ui-subtle)', margin: 0 }}>
                    Managed via server-side environment variables. Not editable from the UI.
                  </p>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── DANGER ZONE ── */}
          {activeTab === 'danger' && (
            <div className="sv-fadein">
              <SectionCard icon={AlertTriangle} title="Danger Zone" accent>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <p style={{ fontSize: 12, color: 'var(--ui-muted)', lineHeight: 1.6, margin: 0 }}>
                    Emergency hard reset terminates all active strategy threads and resets internal runtime state.
                    Only use this for deadlock recovery — it will interrupt any running strategies.
                  </p>
                  <button
                    onClick={handleMaintenanceReset}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      width: '100%', padding: '10px 16px',
                      borderRadius: 'var(--ui-radius-xs)',
                      border: '1px solid rgba(251,113,133,.4)',
                      background: 'rgba(251,113,133,.08)',
                      color: '#fda4af',
                      fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                      cursor: 'pointer',
                      transition: 'background .15s, filter .15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,113,133,.14)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(251,113,133,.08)'}
                  >
                    <RefreshCcw size={13} />
                    Initialize Hard Reset
                  </button>
                </div>
              </SectionCard>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SettingsView;