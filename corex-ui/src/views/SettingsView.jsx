import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Code2,
  Cpu,
  Database,
  KeyRound,
  Link2,
  Monitor,
  Radio,
  RefreshCcw,
  Save,
  Settings as SettingsIcon,
  Shield
} from 'lucide-react';
import client from '../api/client';
import { useStore } from '../store/useStore';
import { corexSwal } from '../utils/swal';

const DEFAULT_FORM = {
  tickQueueMax: 5000,
  tickFlushMax: 10000,
  stratQueueMax: 1000,
  stratSliceMs: 5,
  logLevel: 'info',
  storage: {
    backtests: { keepN: 20, halfLifeDays: 14, maxAgeDays: 90 },
    cache: { maxSizeMb: 500, maxAgeDays: 30 },
    uploads: { maxSizeMb: 500, maxAgeDays: 30 }
  }
};

const toInt = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
};

const SettingsView = () => {
  const [adminKey] = useState(import.meta.env.VITE_ADMIN_SECRET || '***************');
  const {
    systemSettings,
    settingsLoading,
    fetchSystemSettings,
    updateSystemSettings,
    realtimeMode,
    setRealtimeMode,
    uiTheme,
    setUiTheme,
    editorPrefs,
    setEditorPrefs,
    persistedSettings
  } = useStore();

  const [form, setForm] = useState(DEFAULT_FORM);
  const [activeTab, setActiveTab] = useState('runtime');
  const [connectivityTab, setConnectivityTab] = useState('market');
  const [connectivitySaving, setConnectivitySaving] = useState(false);
  const [mt5Status, setMt5Status] = useState(null);
  const [integrationConfig, setIntegrationConfig] = useState({
    marketData: { twelveDataApiKey: '', websocketEnabled: true },
    metaApi: { accountId: '', token: '', server: '' },
    mt5Bridge: {
      mode: 'local',
      host: '127.0.0.1',
      port: '3000',
      heartbeatMs: 3000,
      activeBridgeProvider: 'python_receiver',
      bridgeToken: '',
      httpToken: ''
    }
  });

  useEffect(() => {
    fetchSystemSettings();
  }, [fetchSystemSettings]);

  useEffect(() => {
    if (!systemSettings) return;
    setForm({
      ...DEFAULT_FORM,
      ...systemSettings,
      storage: {
        ...DEFAULT_FORM.storage,
        ...(systemSettings.storage || {}),
        backtests: {
          ...DEFAULT_FORM.storage.backtests,
          ...(systemSettings.storage?.backtests || {})
        },
        cache: {
          ...DEFAULT_FORM.storage.cache,
          ...(systemSettings.storage?.cache || {})
        },
        uploads: {
          ...DEFAULT_FORM.storage.uploads,
          ...(systemSettings.storage?.uploads || {})
        }
      }
    });
  }, [systemSettings]);

  useEffect(() => {
    const source = persistedSettings?.payload?.ui?.integrations;
    if (!source || typeof source !== 'object') return;
    setIntegrationConfig((prev) => ({
      marketData: { ...prev.marketData, ...(source.marketData || {}) },
      metaApi: { ...prev.metaApi, ...(source.metaApi || {}) },
      mt5Bridge: { ...prev.mt5Bridge, ...(source.mt5Bridge || {}) }
    }));
  }, [persistedSettings]);

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
      } catch {
        if (!canceled) setMt5Status(null);
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => { canceled = true; clearInterval(t); };
  }, [activeTab]);

  const sections = useMemo(() => ([
    {
      title: 'Engine Runtime',
      icon: Cpu,
      fields: [
        { key: 'tickQueueMax', label: 'Tick Queue Max' },
        { key: 'tickFlushMax', label: 'Tick Flush Max' },
        { key: 'stratQueueMax', label: 'Strategy Queue Max' },
        { key: 'stratSliceMs', label: 'Strategy Slice (ms)' }
      ]
    }
  ]), []);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setStorageField = (section, key, value) => {
    setForm((prev) => ({
      ...prev,
      storage: {
        ...prev.storage,
        [section]: {
          ...(prev.storage?.[section] || {}),
          [key]: value
        }
      }
    }));
  };

  const handleSave = async () => {
    const payload = {
      ...form,
      tickQueueMax: toInt(form.tickQueueMax),
      tickFlushMax: toInt(form.tickFlushMax),
      stratQueueMax: toInt(form.stratQueueMax),
      stratSliceMs: toInt(form.stratSliceMs),
      storage: {
        backtests: {
          keepN: toInt(form.storage.backtests.keepN),
          maxAgeDays: toInt(form.storage.backtests.maxAgeDays),
          halfLifeDays: toInt(form.storage.backtests.halfLifeDays)
        },
        cache: {
          maxSizeMb: toInt(form.storage.cache.maxSizeMb),
          maxAgeDays: toInt(form.storage.cache.maxAgeDays)
        },
        uploads: {
          maxSizeMb: toInt(form.storage.uploads.maxSizeMb),
          maxAgeDays: toInt(form.storage.uploads.maxAgeDays)
        }
      }
    };

    const res = await updateSystemSettings(payload, true);
    if (res) {
      await corexSwal({
        icon: 'success',
        title: 'Saved',
        text: 'System settings saved.',
        confirmButtonText: 'OK'
      });
    }
  };

  const handleMaintenanceReset = async () => {
    const confirm = await corexSwal({
      icon: 'warning',
      title: 'Confirm Reset',
      text: 'Force reset all strategy lifecycles?',
      showCancelButton: true,
      confirmButtonText: 'Yes, reset',
      cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;
    try {
      const res = await client.post('/system/maintenance/reset-states');
      await corexSwal({
        icon: 'success',
        title: 'Reset Complete',
        text: res.payload?.message || 'Reset complete.',
        confirmButtonText: 'OK'
      });
    } catch {
      await corexSwal({
        icon: 'error',
        title: 'Reset Failed',
        text: 'Reset failed.',
        confirmButtonText: 'OK'
      });
    }
  };

  const saveConnectivity = async () => {
    setConnectivitySaving(true);
    try {
      await updateSystemSettings({ ui: { integrations: integrationConfig } }, true);
      await client.patch('/system/run/settings', {
        settings: {
          activeBridgeProvider: integrationConfig.mt5Bridge.activeBridgeProvider
        },
        persist: true
      });
      await corexSwal({
        icon: 'success',
        title: 'Saved',
        text: 'Connectivity settings saved.',
        confirmButtonText: 'OK'
      });
    } catch {
      await corexSwal({
        icon: 'error',
        title: 'Save Failed',
        text: 'Failed to save connectivity settings.',
        confirmButtonText: 'OK'
      });
    } finally {
      setConnectivitySaving(false);
    }
  };

  const tabs = [
    { id: 'runtime', label: 'Runtime', icon: Cpu },
    { id: 'storage', label: 'Storage', icon: Database },
    { id: 'connectivity', label: 'Connectivity', icon: Link2 },
    { id: 'ui', label: 'UI', icon: Monitor },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'danger', label: 'Danger', icon: AlertTriangle }
  ];

  return (
    <div className="ui-page ui-page-scroll p-6">
      <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-4">
        <div className="flex items-center gap-3">
          <SettingsIcon size={18} className="text-[var(--ui-accent)]" />
          <div>
            <h2 className="ui-title text-base">System Configuration</h2>
            <p className="ui-subtitle">Runtime params, UI preferences, and retention policies</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={settingsLoading}
          className="ui-button ui-button-primary disabled:opacity-50"
        >
          <Save size={14} /> {settingsLoading ? 'Saving' : 'Save Changes'}
        </button>
      </div>

      <div className="ui-tabs w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`ui-tab ${activeTab === tab.id ? 'ui-tab-active' : ''}`}
          >
            <tab.icon size={12} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'runtime' && (
        <section className="ui-panel">
          <div className="ui-panel-header">
            <div className="flex items-center gap-2">
              <Cpu size={16} className="text-[var(--ui-accent)]" />
              <h3 className="ui-panel-title">Engine Runtime</h3>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sections[0].fields.map((field) => (
              <InputGroup
                key={field.key}
                label={field.label}
                value={form[field.key]}
                onChange={(value) => setField(field.key, value)}
              />
            ))}
            <div className="ui-field md:col-span-2">
              <label className="ui-label">Log Level</label>
              <select
                className="ui-select"
                value={form.logLevel}
                onChange={(e) => setField('logLevel', e.target.value)}
              >
                <option value="error">ERROR</option>
                <option value="warn">WARN</option>
                <option value="info">INFO</option>
                <option value="debug">DEBUG</option>
              </select>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'storage' && (
        <section className="ui-panel">
          <div className="ui-panel-header">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-[var(--ui-accent)]" />
              <h3 className="ui-panel-title">Storage Policies</h3>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StorageSubSection
              title="Backtests"
              fields={[
                { label: 'Keep Count', val: form.storage.backtests.keepN, fn: (v) => setStorageField('backtests', 'keepN', v) },
                { label: 'Half-Life (days)', val: form.storage.backtests.halfLifeDays, fn: (v) => setStorageField('backtests', 'halfLifeDays', v) },
                { label: 'Max Age (days)', val: form.storage.backtests.maxAgeDays, fn: (v) => setStorageField('backtests', 'maxAgeDays', v) }
              ]}
            />
            <StorageSubSection
              title="Cache"
              fields={[
                { label: 'Size (MB)', val: form.storage.cache.maxSizeMb, fn: (v) => setStorageField('cache', 'maxSizeMb', v) },
                { label: 'Max Age (days)', val: form.storage.cache.maxAgeDays, fn: (v) => setStorageField('cache', 'maxAgeDays', v) }
              ]}
            />
            <StorageSubSection
              title="Uploads"
              fields={[
                { label: 'Size (MB)', val: form.storage.uploads.maxSizeMb, fn: (v) => setStorageField('uploads', 'maxSizeMb', v) },
                { label: 'Max Age (days)', val: form.storage.uploads.maxAgeDays, fn: (v) => setStorageField('uploads', 'maxAgeDays', v) }
              ]}
            />
          </div>
        </section>
      )}

      {activeTab === 'connectivity' && (
        <section className="ui-panel">
          <div className="ui-panel-header">
            <div className="flex items-center gap-2">
              <Link2 size={16} className="text-[var(--ui-accent)]" />
              <h3 className="ui-panel-title">API & Connectivity</h3>
            </div>
            <button onClick={saveConnectivity} disabled={connectivitySaving} className="ui-button ui-button-primary disabled:opacity-50">
              <Save size={12} /> {connectivitySaving ? 'Saving' : 'Save Connectivity'}
            </button>
          </div>

          <div className="ui-tabs w-fit mb-4">
            <button onClick={() => setConnectivityTab('market')} className={`ui-tab ${connectivityTab === 'market' ? 'ui-tab-active' : ''}`}><Radio size={12} /> Market Data</button>
            <button onClick={() => setConnectivityTab('metaapi')} className={`ui-tab ${connectivityTab === 'metaapi' ? 'ui-tab-active' : ''}`}><KeyRound size={12} /> MetaApi</button>
            <button onClick={() => setConnectivityTab('mt5')} className={`ui-tab ${connectivityTab === 'mt5' ? 'ui-tab-active' : ''}`}><Link2 size={12} /> MT5 Bridge</button>
          </div>

          {connectivityTab === 'market' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="ui-field md:col-span-2">
                <label className="ui-label">Twelve Data API Key</label>
                <input
                  type="password"
                  className="ui-input mono"
                  value={integrationConfig.marketData.twelveDataApiKey}
                  onChange={(e) => setIntegrationConfig((p) => ({
                    ...p,
                    marketData: { ...p.marketData, twelveDataApiKey: e.target.value }
                  }))}
                />
              </div>
              <div className="ui-field">
                <label className="ui-label">Websocket Feed</label>
                <div className="flex items-center justify-between border border-[var(--ui-border)] rounded px-3 py-2 bg-[var(--ui-panel)]">
                  <span className="text-sm text-[var(--ui-text)]">Enable realtime market websocket</span>
                  <button
                    className={`ui-switch ${integrationConfig.marketData.websocketEnabled ? 'ui-switch-on' : ''}`}
                    onClick={() => setIntegrationConfig((p) => ({
                      ...p,
                      marketData: { ...p.marketData, websocketEnabled: !p.marketData.websocketEnabled }
                    }))}
                  />
                </div>
              </div>
            </div>
          )}

          {connectivityTab === 'metaapi' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="ui-field">
                <label className="ui-label">Account ID</label>
                <input className="ui-input mono" value={integrationConfig.metaApi.accountId} onChange={(e) => setIntegrationConfig((p) => ({ ...p, metaApi: { ...p.metaApi, accountId: e.target.value } }))} />
              </div>
              <div className="ui-field">
                <label className="ui-label">Token</label>
                <input type="password" className="ui-input mono" value={integrationConfig.metaApi.token} onChange={(e) => setIntegrationConfig((p) => ({ ...p, metaApi: { ...p.metaApi, token: e.target.value } }))} />
              </div>
              <div className="ui-field md:col-span-2">
                <label className="ui-label">Server</label>
                <input className="ui-input mono" placeholder="e.g. MetaQuotes-Demo" value={integrationConfig.metaApi.server} onChange={(e) => setIntegrationConfig((p) => ({ ...p, metaApi: { ...p.metaApi, server: e.target.value } }))} />
              </div>
            </div>
          )}

          {connectivityTab === 'mt5' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="ui-field">
                <label className="ui-label">Bridge Mode</label>
                <select className="ui-select" value={integrationConfig.mt5Bridge.mode} onChange={(e) => setIntegrationConfig((p) => ({ ...p, mt5Bridge: { ...p.mt5Bridge, mode: e.target.value } }))}>
                  <option value="local">Local</option>
                  <option value="remote">Remote</option>
                </select>
              </div>
              <div className="ui-field">
                <label className="ui-label">Bridge Provider</label>
                <select className="ui-select" value={integrationConfig.mt5Bridge.activeBridgeProvider} onChange={(e) => setIntegrationConfig((p) => ({ ...p, mt5Bridge: { ...p.mt5Bridge, activeBridgeProvider: e.target.value } }))}>
                  <option value="python_receiver">PYTHON RECEIVER</option>
                  <option value="mql5_receiver">MQL5 RECEIVER</option>
                  <option value="metaapi">METAAPI</option>
                </select>
              </div>
              <div className="ui-field">
                <label className="ui-label">Host</label>
                <input className="ui-input mono" value={integrationConfig.mt5Bridge.host} onChange={(e) => setIntegrationConfig((p) => ({ ...p, mt5Bridge: { ...p.mt5Bridge, host: e.target.value } }))} />
              </div>
              <div className="ui-field">
                <label className="ui-label">Port</label>
                <input className="ui-input mono" value={integrationConfig.mt5Bridge.port} onChange={(e) => setIntegrationConfig((p) => ({ ...p, mt5Bridge: { ...p.mt5Bridge, port: e.target.value } }))} />
              </div>
              <div className="ui-field">
                <label className="ui-label">Heartbeat (ms)</label>
                <input type="number" className="ui-input mono" value={integrationConfig.mt5Bridge.heartbeatMs} onChange={(e) => setIntegrationConfig((p) => ({ ...p, mt5Bridge: { ...p.mt5Bridge, heartbeatMs: Number(e.target.value || 3000) } }))} />
              </div>
              <div className="ui-field">
                <label className="ui-label">Bridge WS Token</label>
                <input type="password" className="ui-input mono" value={integrationConfig.mt5Bridge.bridgeToken || ''} onChange={(e) => setIntegrationConfig((p) => ({ ...p, mt5Bridge: { ...p.mt5Bridge, bridgeToken: e.target.value } }))} />
              </div>
              <div className="ui-field">
                <label className="ui-label">Bridge HTTP Token</label>
                <input type="password" className="ui-input mono" value={integrationConfig.mt5Bridge.httpToken || ''} onChange={(e) => setIntegrationConfig((p) => ({ ...p, mt5Bridge: { ...p.mt5Bridge, httpToken: e.target.value } }))} />
              </div>
              <div className="ui-card">
                <div className="ui-label mb-2">Current Status</div>
                <div className="text-[12px] text-[var(--ui-text)]">
                  <div>Bridge: <span className="mono">{mt5Status?.bridgeStatus || '--'}</span></div>
                  <div>Heartbeat: <span className="mono">{mt5Status?.heartbeat?.last_seen ? new Date(mt5Status.heartbeat.last_seen).toLocaleTimeString() : '--'}</span></div>
                  <div>Pending: <span className="mono">{Array.isArray(mt5Status?.pending) ? mt5Status.pending.length : 0}</span></div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'ui' && (
        <section className="ui-panel">
          <div className="ui-panel-header">
            <div className="flex items-center gap-2">
              <Monitor size={16} className="text-[var(--ui-accent)]" />
              <h3 className="ui-panel-title">UI Preferences</h3>
            </div>
          </div>
          <div className="ui-form">
            <div className="ui-field">
              <label className="ui-label">Theme</label>
              <div className="ui-tabs">
                {['dark', 'light', 'system'].map((theme) => (
                  <button key={theme} onClick={() => setUiTheme(theme)} className={`ui-tab ${uiTheme === theme ? 'ui-tab-active' : ''}`}>{theme}</button>
                ))}
              </div>
            </div>
            <div className="ui-field">
              <label className="ui-label">Realtime Transport</label>
              <div className="ui-tabs">
                <button onClick={() => setRealtimeMode('ws')} className={`ui-tab ${realtimeMode === 'ws' ? 'ui-tab-active' : ''}`}>WebSocket</button>
                <button onClick={() => setRealtimeMode('polling')} className={`ui-tab ${realtimeMode === 'polling' ? 'ui-tab-active' : ''}`}>Polling</button>
              </div>
            </div>
            <div className="ui-card">
              <div className="flex items-center gap-2 mb-3">
                <Code2 size={14} className="text-[var(--ui-accent)]" />
                <p className="ui-label m-0">Editor Setup</p>
              </div>
              <p className="ui-subtitle mb-3">Adjust Monaco theme, font, and behavior. Changes apply immediately in Strategy Editor.</p>
              <div className="grid grid-cols-1 gap-3">
                <div className="ui-field">
                  <label className="ui-label">Editor Theme</label>
                  <div className="ui-tabs">
                    {['corex-dark', 'corex-light', 'vs-dark', 'vs-light'].map((theme) => (
                      <button key={theme} onClick={() => setEditorPrefs({ theme })} className={`ui-tab ${editorPrefs?.theme === theme ? 'ui-tab-active' : ''}`}>{theme}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="ui-field">
                    <label className="ui-label">Font Size</label>
                    <input type="number" className="ui-input mono" value={editorPrefs?.fontSize ?? 13} onChange={(e) => setEditorPrefs({ fontSize: Number(e.target.value || 13) })} />
                  </div>
                  <div className="ui-field">
                    <label className="ui-label">Line Height</label>
                    <input type="number" className="ui-input mono" value={editorPrefs?.lineHeight ?? 20} onChange={(e) => setEditorPrefs({ lineHeight: Number(e.target.value || 20) })} />
                  </div>
                </div>
                <div className="ui-field">
                  <label className="ui-label">Font Family</label>
                  <select className="ui-select" value={editorPrefs?.fontFamily || 'JetBrains Mono, Menlo, Monaco, Courier New, monospace'} onChange={(e) => setEditorPrefs({ fontFamily: e.target.value })}>
                    <option value="JetBrains Mono, Menlo, Monaco, Courier New, monospace">JetBrains Mono</option>
                    <option value="Fira Code, Menlo, Monaco, Courier New, monospace">Fira Code</option>
                    <option value="Source Code Pro, Menlo, Monaco, Courier New, monospace">Source Code Pro</option>
                  </select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setEditorPrefs({ minimap: true })} className={`ui-tab ${editorPrefs?.minimap ? 'ui-tab-active' : ''}`}>Minimap On</button>
                  <button onClick={() => setEditorPrefs({ minimap: false })} className={`ui-tab ${editorPrefs?.minimap === false ? 'ui-tab-active' : ''}`}>Minimap Off</button>
                  <button onClick={() => setEditorPrefs({ wordWrap: 'on' })} className={`ui-tab ${editorPrefs?.wordWrap === 'on' ? 'ui-tab-active' : ''}`}>Wrap On</button>
                  <button onClick={() => setEditorPrefs({ wordWrap: 'off' })} className={`ui-tab ${editorPrefs?.wordWrap === 'off' ? 'ui-tab-active' : ''}`}>Wrap Off</button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'security' && (
        <section className="ui-panel">
          <div className="ui-panel-header">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-[var(--ui-accent)]" />
              <h3 className="ui-panel-title">Security</h3>
            </div>
          </div>
          <div className="ui-field">
            <label className="ui-label">Admin Secret Key</label>
            <input type="text" readOnly value={adminKey} className="ui-input mono" />
            <p className="ui-subtitle">Handled via server-side environment variables.</p>
          </div>
        </section>
      )}

      {activeTab === 'danger' && (
        <section className="ui-panel border-[color:color-mix(in_srgb,var(--ui-negative)_40%,transparent)]">
          <div className="ui-panel-header">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-[var(--ui-negative)]" />
              <h3 className="ui-panel-title text-[var(--ui-negative)]">Danger Zone</h3>
            </div>
          </div>
          <p className="text-xs text-[var(--ui-muted)] leading-relaxed mb-4">
            Emergency reset stops all strategy threads and resets internal state. Use only for deadlock recovery.
          </p>
          <button onClick={handleMaintenanceReset} className="ui-button ui-button-danger w-full">
            <RefreshCcw size={12} /> Initialize Hard Reset
          </button>
        </section>
      )}
    </div>
  );
};

const InputGroup = ({ label, value, onChange }) => (
  <div className="ui-field">
    <label className="ui-label">{label}</label>
    <input
      type="number"
      className="ui-input mono"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

const StorageSubSection = ({ title, fields }) => (
  <div className="ui-card">
    <p className="ui-label mb-3">{title}</p>
    <div className="space-y-3">
      {fields.map((field, index) => (
        <div key={`${title}-${index}`} className="ui-field">
          <label className="text-[11px] text-[var(--ui-muted)]">{field.label}</label>
          <input
            type="number"
            className="ui-input mono"
            value={field.val ?? ''}
            onChange={(e) => field.fn(e.target.value)}
          />
        </div>
      ))}
    </div>
  </div>
);

export default SettingsView;
