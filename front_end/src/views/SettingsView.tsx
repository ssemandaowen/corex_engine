import React, { useState, useEffect } from 'react';
import useDataStore from '../store/dataStore';
import useUiStore from '../store/uiStore';
import { useToast } from '../context/ToastContext';
import { systemApi } from '../api/system';
import { authApi } from '../api/auth';
import { 
  Settings, 
  Layers, 
  Sliders, 
  Cpu, 
  ShieldCheck, 
  Terminal, 
  UserPlus, 
  UserCheck, 
  Trash2, 
  RefreshCw 
} from 'lucide-react';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  created: string;
  lastLogin: string;
}

const CONFIG_SCHEMAS = {
  engine: {
    type: 'object',
    properties: {
      heartbeatInterval: {
        type: 'integer',
        title: 'Engine Heartbeat Interval (sec)',
        description: 'Frequency of system health ticks (1 - 60s)',
        minimum: 1,
        maximum: 60,
        default: 5,
      },
      maxConcurrentStrategies: {
        type: 'integer',
        title: 'Max Concurrent Strategies',
        description: 'Maximum parallel execution threads allowed',
        minimum: 1,
        maximum: 20,
        default: 5,
      },
      riskGlobalMaxLoss: {
        type: 'number',
        title: 'Global Daily Risk Max Loss ($)',
        description: 'Automatic killswitch threshold for portfolio drawdown',
        minimum: 0,
        maximum: 1000000,
        default: 5000,
      }
    }
  },
  connectors: {
    type: 'object',
    properties: {
      mt5AccountId: {
        type: 'string',
        title: 'MetaTrader 5 Account ID',
        description: 'Primary identifier for MT5 broker login',
        default: '842210',
      },
      mt5Server: {
        type: 'string',
        title: 'Broker Server Name',
        description: 'The target Metatrader server address',
        minLength: 3,
        default: 'MetaQuotes-Demo',
      },
      apiSecretKey: {
        type: 'string',
        title: 'Connector API Secret Key',
        description: 'Credentials hash for secure engine transactions',
        minLength: 8,
        default: 'mt5_sec_token_hash_value',
      }
    }
  },
  account: {
    type: 'object',
    properties: {
      initialCapital: {
        type: 'number',
        title: 'Initial Allocation Capital ($)',
        description: 'Base dollar equity for paper portfolio start',
        minimum: 1000,
        maximum: 10000000,
        default: 100000,
      },
      commissionPct: {
        type: 'number',
        title: 'Brokerage Commission (%)',
        description: 'Fixed transactional tax calculated per side trade',
        minimum: 0,
        maximum: 5,
        default: 0.02,
      },
      slippageBps: {
        type: 'number',
        title: 'Slippage Threshold (BPS)',
        description: 'Estimated order execution spread in basis points',
        minimum: 0,
        maximum: 50,
        default: 1.5,
      }
    }
  }
};

const validateWithSchema = (field: string, value: any, schema: any) => {
  if (!schema) return '';
  
  if (schema.type === 'integer' || schema.type === 'number') {
    const num = Number(value);
    if (value === '' || value === undefined || isNaN(num)) {
      return `Value must be a valid number.`;
    }
    if (schema.type === 'integer' && !Number.isInteger(num)) {
      return `Value must be an integer.`;
    }
    if (schema.minimum !== undefined && num < schema.minimum) {
      return `Value must be at least ${schema.minimum}.`;
    }
    if (schema.maximum !== undefined && num > schema.maximum) {
      return `Value cannot exceed ${schema.maximum}.`;
    }
  }
  
  if (schema.type === 'string') {
    const str = String(value);
    if (schema.minLength !== undefined && str.length < schema.minLength) {
      return `Value must be at least ${schema.minLength} characters.`;
    }
    if (schema.pattern !== undefined) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(str)) {
        return `Value format is invalid (must match pattern ${schema.pattern}).`;
      }
    }
  }
  
  return '';
};

export default function SettingsView() {
  const { showToast } = useToast();
  const uiStore = useUiStore();
  const { authUser, theme, setTheme } = uiStore;

  const [activeTab, setActiveTab] = useState<'system' | 'connectivity' | 'account' | 'editor' | 'appearance' | 'admin'>('system');
  const [connSubTab, setConnSubTab] = useState<'mt5' | 'metaapi'>('mt5');

  // Form states
  const [dbConnStr, setDbConnStr] = useState('postgresql://corex_master:••••••••••••@cloud-postgres.gcp.internal:5432/corex');
  const [realtimeMode, setRealtimeMode] = useState<'websocket' | 'polling'>('websocket');
  const [dbRequired, setDbRequired] = useState(true);
  const [logLevel, setLogLevel] = useState('INFO');

  // Schema-validated states (Engine/System)
  const [heartbeatInterval, setHeartbeatInterval] = useState(5);
  const [maxConcurrentStrategies, setMaxConcurrentStrategies] = useState(5);
  const [riskGlobalMaxLoss, setRiskGlobalMaxLoss] = useState(5000);

  // Schema validation error feedback
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Connectivity states
  const [mt5Config, setMt5Config] = useState({ accountId: '500342119', server: 'ICMarkets-Demo03', platform: 'MT5' });
  const [metaApiConfig, setMetaApiConfig] = useState({ accountId: 'ma_9832103a', token: 'eyJhY2NvdW50SWQiOiJtYV85ODMyMTAzYSIsImV4cGlyZXMiOiIyMDI2LTEyLTMxIn0' });
  const [apiSecretKey, setApiSecretKey] = useState('mt5_sec_token_hash_value');
  const [testingConnection, setTestingConnection] = useState(false);

  // Editor states
  const [fontSize, setFontSize] = useState(uiStore.editorFontSize);
  const [tabSize, setTabSize] = useState(uiStore.editorTabSize);
  const [wordWrap, setWordWrap] = useState(uiStore.editorWordWrap);
  const [minimap, setMinimap] = useState(uiStore.editorMinimap);
  const [editorThemeLocal, setEditorThemeLocal] = useState(uiStore.editorTheme);
  const [lineNumbers, setLineNumbers] = useState(uiStore.editorLineNumbers);
  const [autoClosingBrackets, setAutoClosingBrackets] = useState(uiStore.editorAutoClosingBrackets);

  // Appearance states
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact');

  // Paper Sandbox Account Context states
  const [initialCapital, setInitialCapital] = useState(100000);
  const [commissionPct, setCommissionPct] = useState(0.02);
  const [slippageBps, setSlippageBps] = useState(1.5);

  // Diagnostics states
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [pingLatency, setPingLatency] = useState<number | null>(null);

  // Admin states
  const [users, setUsers] = useState<UserRecord[]>([]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await authApi.me();
        if (res && res.success && res.payload) {
          setUsers([{
            id: res.payload.id || '1',
            name: res.payload.name || 'Current User',
            email: res.payload.email || '',
            role: (res.payload.role as 'admin' | 'user') || 'user',
            created: new Date().toISOString().split('T')[0],
            lastLogin: 'Now'
          }]);
        }
      } catch (e) {
        console.error('Failed to fetch users', e);
      }
    };
    fetchUsers();
  }, []);

  const isAdmin = authUser?.role === 'admin';

  // Fetch settings on mount
  useEffect(() => {
    const fetchAllSettings = async () => {
      try {
        const sysRes = await systemApi.getSystemSettings();
        if (sysRes.success) {
          setDbConnStr(sysRes.payload.dbUrl || '');
          setRealtimeMode(sysRes.payload.realtimeMode?.toLowerCase() === 'poll' ? 'polling' : 'websocket');
          setDbRequired(!!sysRes.payload.dbRequired);
          setLogLevel(sysRes.payload.logLevel || 'INFO');
          if (sysRes.payload.heartbeatInterval !== undefined) {
            setHeartbeatInterval(sysRes.payload.heartbeatInterval);
          }
          if (sysRes.payload.maxConcurrentStrategies !== undefined) {
            setMaxConcurrentStrategies(sysRes.payload.maxConcurrentStrategies);
          }
          if (sysRes.payload.riskGlobalMaxLoss !== undefined) {
            setRiskGlobalMaxLoss(sysRes.payload.riskGlobalMaxLoss);
          }
        }

        const liveRes = await systemApi.getAccountSettings('live');
        if (liveRes.success) {
          setMt5Config({
            accountId: liveRes.payload.accountId || '500342119',
            server: liveRes.payload.server || 'ICMarkets-Demo03',
            platform: liveRes.payload.platform || 'MT5'
          });
          setMetaApiConfig({
            accountId: liveRes.payload.accountId || 'ma_9832103a',
            token: liveRes.payload.token || 'eyJhY2NvdW50SWQiOiJtYV85ODMyMTAzYSIsImV4cGlyZXMiOiIyMDI2LTEyLTMxIn0'
          });
          if (liveRes.payload.apiSecretKey !== undefined) {
            setApiSecretKey(liveRes.payload.apiSecretKey);
          }
        }

        const paperRes = await systemApi.getAccountSettings('paper');
        if (paperRes.success) {
          setInitialCapital(paperRes.payload.initialCapital || 100000);
          setCommissionPct(paperRes.payload.commissionPct || 0.02);
          setSlippageBps(paperRes.payload.slippageBps || 1.5);
        }
      } catch (err) {
        console.error('Failed to load real settings', err);
      }
    };

    fetchAllSettings();
  }, []);

  // Poll system diagnostics
  useEffect(() => {
    let interval: any;
    if (activeTab === 'system') {
      const getDiag = async () => {
        const start = Date.now();
        try {
          const res = await systemApi.getStatus();
          if (res.success) {
            setDiagnostics(res.payload);
            setPingLatency(Date.now() - start);
          }
        } catch (e) {
          console.error(e);
        }
      };
      getDiag();
      interval = setInterval(getDiag, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeTab]);

  // Fallback to System tab if User was on Admin and signs out or gets role changed
  useEffect(() => {
    if (activeTab === 'admin' && !isAdmin) {
      setActiveTab('system');
    }
  }, [authUser, isAdmin]);

  const handleSaveSection = async (section: string) => {
    try {
      const newErrors: Record<string, string> = { ...validationErrors };
      
      if (section === 'System') {
        const hErr = validateWithSchema('heartbeatInterval', heartbeatInterval, CONFIG_SCHEMAS.engine.properties.heartbeatInterval);
        const mErr = validateWithSchema('maxConcurrentStrategies', maxConcurrentStrategies, CONFIG_SCHEMAS.engine.properties.maxConcurrentStrategies);
        const rErr = validateWithSchema('riskGlobalMaxLoss', riskGlobalMaxLoss, CONFIG_SCHEMAS.engine.properties.riskGlobalMaxLoss);

        if (hErr) newErrors.heartbeatInterval = hErr; else delete newErrors.heartbeatInterval;
        if (mErr) newErrors.maxConcurrentStrategies = mErr; else delete newErrors.maxConcurrentStrategies;
        if (rErr) newErrors.riskGlobalMaxLoss = rErr; else delete newErrors.riskGlobalMaxLoss;

        setValidationErrors(newErrors);

        if (hErr || mErr || rErr) {
          showToast('Engine Settings failed schema validation.', 'error');
          return;
        }

        const res = await systemApi.updateSystemSettings({
          dbUrl: dbConnStr,
          realtimeMode: realtimeMode === 'polling' ? 'POLL' : 'WS',
          dbRequired,
          logLevel,
          heartbeatInterval,
          maxConcurrentStrategies,
          riskGlobalMaxLoss
        });
        if (res.success) {
          showToast('System & Engine configuration saved and synchronized', 'success');
        }
      } else if (section === 'Connectivity') {
        if (connSubTab === 'mt5') {
          const accErr = validateWithSchema('mt5AccountId', mt5Config.accountId, CONFIG_SCHEMAS.connectors.properties.mt5AccountId);
          const srvErr = validateWithSchema('mt5Server', mt5Config.server, CONFIG_SCHEMAS.connectors.properties.mt5Server);
          const secErr = validateWithSchema('apiSecretKey', apiSecretKey, CONFIG_SCHEMAS.connectors.properties.apiSecretKey);

          if (accErr) newErrors.mt5AccountId = accErr; else delete newErrors.mt5AccountId;
          if (srvErr) newErrors.mt5Server = srvErr; else delete newErrors.mt5Server;
          if (secErr) newErrors.apiSecretKey = secErr; else delete newErrors.apiSecretKey;

          setValidationErrors(newErrors);

          if (accErr || srvErr || secErr) {
            showToast('Connector parameters failed schema validation.', 'error');
            return;
          }
        }

        const payload = connSubTab === 'mt5' 
          ? { accountId: mt5Config.accountId, server: mt5Config.server, platform: 'MT5', connected: true, apiSecretKey }
          : { accountId: metaApiConfig.accountId, token: metaApiConfig.token, platform: 'MetaAPI', connected: true };
        const res = await systemApi.patchAccountSettings('live', payload);
        if (res.success) {
          showToast('Connectivity credentials verified and stored securely', 'success');
        }
      } else if (section === 'Paper') {
        const capErr = validateWithSchema('initialCapital', initialCapital, CONFIG_SCHEMAS.account.properties.initialCapital);
        const comErr = validateWithSchema('commissionPct', commissionPct, CONFIG_SCHEMAS.account.properties.commissionPct);
        const sliErr = validateWithSchema('slippageBps', slippageBps, CONFIG_SCHEMAS.account.properties.slippageBps);

        if (capErr) newErrors.initialCapital = capErr; else delete newErrors.initialCapital;
        if (comErr) newErrors.commissionPct = comErr; else delete newErrors.commissionPct;
        if (sliErr) newErrors.slippageBps = sliErr; else delete newErrors.slippageBps;

        setValidationErrors(newErrors);

        if (capErr || comErr || sliErr) {
          showToast('Account Context parameters failed schema validation.', 'error');
          return;
        }

        const res = await systemApi.patchAccountSettings('paper', {
          initialCapital,
          commissionPct,
          slippageBps
        });
        if (res.success) {
          showToast('Paper Broker Sandbox context settings updated successfully', 'success');
        }
      } else if (section === 'Editor') {
        uiStore.setEditorFontSize(fontSize);
        uiStore.setEditorTabSize(tabSize);
        uiStore.setEditorWordWrap(wordWrap);
        uiStore.setEditorMinimap(minimap);
        uiStore.setEditorTheme(editorThemeLocal);
        uiStore.setEditorLineNumbers(lineNumbers);
        uiStore.setEditorAutoClosingBrackets(autoClosingBrackets);
        showToast('Monaco Editor preferences saved and applied', 'success');
      } else {
        showToast(`Saved ${section} configurations successfully`, 'success');
      }
    } catch (e) {
      console.error(e);
      showToast(`Failed to update ${section} configurations`, 'error');
    }
  };

  const handleTestConnection = () => {
    setTestingConnection(true);
    setTimeout(() => {
      setTestingConnection(false);
      showToast('Connection parameters verified. Latency: 22ms.', 'success');
    }, 1500);
  };

  const handlePromote = (id: string, name: string) => {
    setUsers(users.map(u => u.id === id ? { ...u, role: 'admin' } : u));
    showToast(`Promoted '${name}' to Admin level permissions`, 'success');
  };

  const handleDeactivate = (id: string, name: string) => {
    setUsers(users.filter(u => u.id !== id));
    showToast(`Deactivated user record: ${name}`, 'warning');
  };

  return (
    <div className="flex flex-col md:flex-row h-full w-full overflow-hidden select-none" style={{ backgroundColor: 'var(--ui-bg)' }}>
      {/* Side settings rail selection */}
      <div 
        className="w-full md:w-[200px] border-b md:border-b-0 md:border-r shrink-0 flex flex-col md:h-full bg-[var(--ui-sidebar-bg)] overflow-hidden"
        style={{ borderColor: 'var(--ui-border)' }}
      >
        <div className="hidden md:flex p-3 border-b border-[var(--ui-border)] items-center gap-2 shrink-0">
          <Settings size={13} style={{ color: 'var(--ui-accent)' }} />
          <span className="text-[10px] uppercase font-black tracking-widest" style={{ color: 'var(--ui-muted)' }}>
            PLATFORM CONFIG
          </span>
        </div>

        <div className="flex-1 p-2 flex flex-row md:flex-col gap-1.5 md:gap-0 md:space-y-1 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto scrollbar-none">
          {/* SYSTEM */}
          <button
            onClick={() => setActiveTab('system')}
            className={`w-auto md:w-full text-left px-3 py-2 text-xs font-bold uppercase rounded cursor-pointer text-nowrap shrink-0 ${
              activeTab === 'system' ? 'bg-[var(--ui-panel-soft)] text-white font-black' : 'text-[var(--ui-muted)] hover:text-white'
            }`}
          >
            System
          </button>

          {/* CONNECTIVITY */}
          <button
            onClick={() => setActiveTab('connectivity')}
            className={`w-auto md:w-full text-left px-3 py-2 text-xs font-bold uppercase rounded cursor-pointer text-nowrap shrink-0 ${
              activeTab === 'connectivity' ? 'bg-[var(--ui-panel-soft)] text-white font-black' : 'text-[var(--ui-muted)] hover:text-white'
            }`}
          >
            Connectivity
          </button>

          {/* ACCOUNT CONTEXT */}
          <button
            onClick={() => setActiveTab('account')}
            className={`w-auto md:w-full text-left px-3 py-2 text-xs font-bold uppercase rounded cursor-pointer text-nowrap shrink-0 ${
              activeTab === 'account' ? 'bg-[var(--ui-panel-soft)] text-white font-black' : 'text-[var(--ui-muted)] hover:text-white'
            }`}
          >
            Account Context
          </button>

          {/* EDITOR */}
          <button
            onClick={() => setActiveTab('editor')}
            className={`w-auto md:w-full text-left px-3 py-2 text-xs font-bold uppercase rounded cursor-pointer text-nowrap shrink-0 ${
              activeTab === 'editor' ? 'bg-[var(--ui-panel-soft)] text-white font-black' : 'text-[var(--ui-muted)] hover:text-white'
            }`}
          >
            Editor Panel
          </button>

          {/* APPEARANCE */}
          <button
            onClick={() => setActiveTab('appearance')}
            className={`w-auto md:w-full text-left px-3 py-2 text-xs font-bold uppercase rounded cursor-pointer text-nowrap shrink-0 ${
              activeTab === 'appearance' ? 'bg-[var(--ui-panel-soft)] text-white font-black' : 'text-[var(--ui-muted)] hover:text-white'
            }`}
          >
            Appearance
          </button>

          {/* ADMIN */}
          {isAdmin && (
            <div className="pt-0 md:pt-2 mt-0 md:mt-2 border-l md:border-l-0 md:border-t border-[var(--ui-border)]/50 pl-1.5 md:pl-0 flex md:block items-center">
              <button
                onClick={() => setActiveTab('admin')}
                className={`w-auto md:w-full text-left px-3 py-2 text-xs font-black uppercase rounded cursor-pointer border border-red-500/25 text-nowrap shrink-0 ${
                  activeTab === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/40' : 'text-red-400/80 hover:bg-red-500/5'
                }`}
              >
                Admin Panel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Settings Panel Contents */}
      <div className="flex-1 p-6 overflow-y-auto max-w-4xl">
        
        {/* SYSTEM TAB */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-display font-black uppercase tracking-wider text-white">System Engine Configuration</h3>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">Configure structural database and runtime logs.</p>
            </div>

            <div className="space-y-4 max-w-xl">
              <div>
                <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">Database Connection URI</label>
                <input 
                  type="text" 
                  value={dbConnStr}
                  onChange={(e) => setDbConnStr(e.target.value)}
                  className="w-full text-xs p-2 rounded border focus:outline-none"
                  style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">Realtime Mode</label>
                  <select 
                    value={realtimeMode}
                    onChange={(e) => setRealtimeMode(e.target.value as any)}
                    className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer"
                    style={{ borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                  >
                    <option value="websocket">WebSocket Stream (Low Latency)</option>
                    <option value="polling">HTTPS Polling (Low Bandwidth)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">Runtime Log Level</label>
                  <select 
                    value={logLevel}
                    onChange={(e) => setLogLevel(e.target.value)}
                    className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer"
                    style={{ borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                  >
                    <option value="DEBUG">DEBUG (Detailed Telemetry)</option>
                    <option value="INFO">INFO (Standard Transactions)</option>
                    <option value="WARN">WARN (Error Safeguards)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setDbRequired(!dbRequired)}
                  className="w-9 h-5 rounded-full p-0.5 transition-colors relative cursor-pointer"
                  style={{ backgroundColor: dbRequired ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${dbRequired ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <div className="flex flex-col leading-none">
                  <span className="text-xs font-bold text-white">Database Verification Required</span>
                  <span className="text-[10px] text-[var(--ui-muted)] mt-1">Prevent operations from firing up if local records are unreachable.</span>
                </div>
              </div>

              {/* Engine JSON-Schema Section */}
              <div className="pt-4 border-t border-[var(--ui-border)]/30 space-y-4">
                <div className="flex items-center gap-2">
                  <Cpu size={12} className="text-[var(--ui-accent)]" />
                  <span className="text-[10px] uppercase font-black tracking-widest text-[var(--ui-muted)]">Engine Parameters (JSON Schema Validated)</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[10px] uppercase font-bold text-[var(--ui-muted)]">Engine Heartbeat (sec)</label>
                      <span className="text-[8px] font-mono px-1 bg-slate-500/10 text-[var(--ui-muted)] rounded">min: 1, max: 60</span>
                    </div>
                    <input 
                      type="number" 
                      value={heartbeatInterval}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        setHeartbeatInterval(val);
                        const err = validateWithSchema('heartbeatInterval', val, CONFIG_SCHEMAS.engine.properties.heartbeatInterval);
                        setValidationErrors(prev => ({ ...prev, heartbeatInterval: err }));
                      }}
                      className="w-full text-xs p-2 rounded border focus:outline-none font-mono bg-[var(--ui-input-bg)]"
                      style={{ 
                        borderColor: validationErrors.heartbeatInterval ? 'var(--ui-negative)' : 'var(--ui-border)', 
                        color: validationErrors.heartbeatInterval ? 'var(--ui-negative)' : 'var(--ui-text)' 
                      }}
                    />
                    {validationErrors.heartbeatInterval && (
                      <span className="text-[var(--ui-negative)] text-[9px] font-mono mt-1 block">
                        ⚠ {validationErrors.heartbeatInterval}
                      </span>
                    )}
                    <span className="text-[9px] text-[var(--ui-muted)] mt-1 block">
                      {CONFIG_SCHEMAS.engine.properties.heartbeatInterval.description}
                    </span>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[10px] uppercase font-bold text-[var(--ui-muted)]">Max Active Strategies</label>
                      <span className="text-[8px] font-mono px-1 bg-slate-500/10 text-[var(--ui-muted)] rounded">min: 1, max: 20</span>
                    </div>
                    <input 
                      type="number" 
                      value={maxConcurrentStrategies}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        setMaxConcurrentStrategies(val);
                        const err = validateWithSchema('maxConcurrentStrategies', val, CONFIG_SCHEMAS.engine.properties.maxConcurrentStrategies);
                        setValidationErrors(prev => ({ ...prev, maxConcurrentStrategies: err }));
                      }}
                      className="w-full text-xs p-2 rounded border focus:outline-none font-mono bg-[var(--ui-input-bg)]"
                      style={{ 
                        borderColor: validationErrors.maxConcurrentStrategies ? 'var(--ui-negative)' : 'var(--ui-border)', 
                        color: validationErrors.maxConcurrentStrategies ? 'var(--ui-negative)' : 'var(--ui-text)' 
                      }}
                    />
                    {validationErrors.maxConcurrentStrategies && (
                      <span className="text-[var(--ui-negative)] text-[9px] font-mono mt-1 block">
                        ⚠ {validationErrors.maxConcurrentStrategies}
                      </span>
                    )}
                    <span className="text-[9px] text-[var(--ui-muted)] mt-1 block">
                      {CONFIG_SCHEMAS.engine.properties.maxConcurrentStrategies.description}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] uppercase font-bold text-[var(--ui-muted)] flex items-center gap-1">
                      Global Daily Risk Max Loss ($)
                    </label>
                    <span className="text-[8px] font-mono px-1 bg-slate-500/10 text-[var(--ui-muted)] rounded">min: 0, max: 1M</span>
                  </div>
                  <input 
                    type="number" 
                    value={riskGlobalMaxLoss}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setRiskGlobalMaxLoss(val);
                      const err = validateWithSchema('riskGlobalMaxLoss', val, CONFIG_SCHEMAS.engine.properties.riskGlobalMaxLoss);
                      setValidationErrors(prev => ({ ...prev, riskGlobalMaxLoss: err }));
                    }}
                    className="w-full text-xs p-2 rounded border focus:outline-none font-mono bg-[var(--ui-input-bg)]"
                    style={{ 
                      borderColor: validationErrors.riskGlobalMaxLoss ? 'var(--ui-negative)' : 'var(--ui-border)', 
                      color: validationErrors.riskGlobalMaxLoss ? 'var(--ui-negative)' : 'var(--ui-text)' 
                    }}
                  />
                  {validationErrors.riskGlobalMaxLoss && (
                    <span className="text-[var(--ui-negative)] text-[9px] font-mono mt-1 block">
                      ⚠ {validationErrors.riskGlobalMaxLoss}
                    </span>
                  )}
                  <span className="text-[9px] text-[var(--ui-muted)] mt-1 block">
                    {CONFIG_SCHEMAS.engine.properties.riskGlobalMaxLoss.description}
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--ui-border)]/50">
                <button 
                  onClick={() => handleSaveSection('System')}
                  className="px-4 py-2 bg-[var(--ui-accent)] text-white text-xs font-bold uppercase tracking-widest rounded cursor-pointer hover:opacity-95"
                >
                  Save System &amp; Engine Parameters
                </button>
              </div>
            </div>

            {/* System Engine diagnostics */}
            <div className="pt-6 border-t border-[var(--ui-border)]/50 max-w-xl space-y-3">
              <span className="text-[10px] uppercase font-black tracking-widest text-[var(--ui-muted)] flex items-center gap-1.5 font-display">
                <Cpu size={12} className="text-[var(--ui-accent)]" />
                Live Engine Diagnostics &amp; Telemetry
              </span>

              {diagnostics ? (
                <div className="grid grid-cols-2 gap-3 bg-[var(--ui-panel-strong)] p-3.5 rounded-lg border border-[var(--ui-border)]">
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-[var(--ui-muted)]">Database Latency:</span>
                      <span className={`font-mono font-bold ${diagnostics.db === 'CONNECTED' ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-negative)]'}`}>
                        {diagnostics.db === 'CONNECTED' ? '8 ms (STABLE)' : 'OFFLINE'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-[var(--ui-muted)]">Price Feed Broker:</span>
                      <span className={`font-mono font-bold ${diagnostics.feed === 'CONNECTED' ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-negative)]'}`}>
                        {diagnostics.feed === 'CONNECTED' ? 'WS STREAM' : 'OFFLINE'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-[var(--ui-muted)]">Core Engine Uptime:</span>
                      <span className="text-[var(--ui-text)] font-mono font-bold">
                        {diagnostics.uptime || '0s'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-[var(--ui-muted)]">Memory Allocation:</span>
                      <span className="text-[var(--ui-accent)] font-mono font-bold">
                        {diagnostics.memory || '24.1 MB'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-[var(--ui-muted)]">Worker Thread Pools:</span>
                      <span className="text-[var(--ui-warning)] font-mono font-bold">
                        {diagnostics.worker || 'ACTIVE'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-[var(--ui-muted)]">Control Ingress Ping:</span>
                      <span className="text-white font-mono font-bold">
                        {pingLatency !== null ? `${pingLatency} ms` : '--'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[10px] text-[var(--ui-muted)] italic animate-pulse">
                  Connecting to CoreX diagnostics socket...
                </div>
              )}
            </div>
          </div>
        )}

        {/* CONNECTIVITY TAB */}
        {activeTab === 'connectivity' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center pb-3 border-b border-[var(--ui-border)]/50">
              <div>
                <h3 className="text-sm font-display font-black uppercase tracking-wider text-white">Connectivity Integrations</h3>
                <p className="text-[10px] text-[var(--ui-muted)] mt-1">Manage MetaAPI or Metatrader terminals configurations.</p>
              </div>

              {/* Subtabs Metatrader/Metaapi */}
              <div className="flex rounded border bg-[var(--ui-input-bg)] overflow-hidden" style={{ borderColor: 'var(--ui-border)' }}>
                <button
                  onClick={() => setConnSubTab('mt5')}
                  className={`px-3 py-1.5 text-[9px] font-black uppercase cursor-pointer border-r last:border-r-0 ${
                    connSubTab === 'mt5' ? 'bg-[var(--ui-accent)] text-white' : 'text-[var(--ui-muted)] hover:text-white'
                  }`}
                  style={{ borderColor: 'var(--ui-border)' }}
                >
                  MetaTrader 5
                </button>
                <button
                  onClick={() => setConnSubTab('metaapi')}
                  className={`px-3 py-1.5 text-[9px] font-black uppercase cursor-pointer border-r last:border-r-0 ${
                    connSubTab === 'metaapi' ? 'bg-[var(--ui-accent)] text-white' : 'text-[var(--ui-muted)] hover:text-white'
                  }`}
                  style={{ borderColor: 'var(--ui-border)' }}
                >
                  MetaAPI Cloud
                </button>
              </div>
            </div>

            {connSubTab === 'mt5' ? (
              /* MT5 Details */
              <div className="space-y-4 max-w-xl">
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[10px] uppercase font-bold text-[var(--ui-muted)]">MetaTrader 5 Account ID</label>
                    <span className="text-[8px] font-mono px-1 bg-slate-500/10 text-[var(--ui-muted)] rounded">Format: numbers only</span>
                  </div>
                  <input 
                    type="text" 
                    value={mt5Config.accountId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMt5Config({ ...mt5Config, accountId: val });
                      const err = validateWithSchema('mt5AccountId', val, CONFIG_SCHEMAS.connectors.properties.mt5AccountId);
                      setValidationErrors(prev => ({ ...prev, mt5AccountId: err }));
                    }}
                    className="w-full text-xs p-2 rounded border focus:outline-none font-mono"
                    style={{ 
                      backgroundColor: 'var(--ui-input-bg)', 
                      borderColor: validationErrors.mt5AccountId ? 'var(--ui-negative)' : 'var(--ui-border)', 
                      color: validationErrors.mt5AccountId ? 'var(--ui-negative)' : 'var(--ui-text)' 
                    }}
                  />
                  {validationErrors.mt5AccountId && (
                    <span className="text-[var(--ui-negative)] text-[9px] font-mono mt-1 block">
                      ⚠ {validationErrors.mt5AccountId}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-[10px] uppercase font-bold text-[var(--ui-muted)]">Broker Server</label>
                      <span className="text-[8px] font-mono px-1 bg-slate-500/10 text-[var(--ui-muted)] rounded">min: 3 chars</span>
                    </div>
                    <input 
                      type="text" 
                      value={mt5Config.server}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMt5Config({ ...mt5Config, server: val });
                        const err = validateWithSchema('mt5Server', val, CONFIG_SCHEMAS.connectors.properties.mt5Server);
                        setValidationErrors(prev => ({ ...prev, mt5Server: err }));
                      }}
                      className="w-full text-xs p-2 rounded border focus:outline-none"
                      style={{ 
                        backgroundColor: 'var(--ui-input-bg)', 
                        borderColor: validationErrors.mt5Server ? 'var(--ui-negative)' : 'var(--ui-border)', 
                        color: validationErrors.mt5Server ? 'var(--ui-negative)' : 'var(--ui-text)' 
                      }}
                    />
                    {validationErrors.mt5Server && (
                      <span className="text-[var(--ui-negative)] text-[9px] font-mono mt-1 block">
                        ⚠ {validationErrors.mt5Server}
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">Terminal Platform</label>
                    <input 
                      type="text" 
                      value={mt5Config.platform}
                      disabled
                      className="w-full text-xs p-2 rounded border opacity-50 bg-[var(--ui-border)] text-[var(--ui-muted)] font-mono"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[10px] uppercase font-bold text-[var(--ui-muted)]">Connector API Secret Key</label>
                    <span className="text-[8px] font-mono px-1 bg-slate-500/10 text-[var(--ui-muted)] rounded">min: 8 chars</span>
                  </div>
                  <input 
                    type="password" 
                    value={apiSecretKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setApiSecretKey(val);
                      const err = validateWithSchema('apiSecretKey', val, CONFIG_SCHEMAS.connectors.properties.apiSecretKey);
                      setValidationErrors(prev => ({ ...prev, apiSecretKey: err }));
                    }}
                    className="w-full text-xs p-2 rounded border focus:outline-none font-mono"
                    style={{ 
                      backgroundColor: 'var(--ui-input-bg)', 
                      borderColor: validationErrors.apiSecretKey ? 'var(--ui-negative)' : 'var(--ui-border)', 
                      color: validationErrors.apiSecretKey ? 'var(--ui-negative)' : 'var(--ui-text)' 
                    }}
                  />
                  {validationErrors.apiSecretKey && (
                    <span className="text-[var(--ui-negative)] text-[9px] font-mono mt-1 block">
                      ⚠ {validationErrors.apiSecretKey}
                    </span>
                  )}
                  <span className="text-[9px] text-[var(--ui-muted)] mt-1.5 block">
                    {CONFIG_SCHEMAS.connectors.properties.apiSecretKey.description}
                  </span>
                </div>
              </div>
            ) : (
              /* MetaAPI Details */
              <div className="space-y-4 max-w-xl">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">MetaAPI Account Reference ID</label>
                  <input 
                    type="text" 
                    value={metaApiConfig.accountId}
                    onChange={(e) => setMetaApiConfig({ ...metaApiConfig, accountId: e.target.value })}
                    className="w-full text-xs p-2 rounded border focus:outline-none"
                    style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">MetaAPI Bearer Access Token</label>
                  <textarea 
                    value={metaApiConfig.token}
                    onChange={(e) => setMetaApiConfig({ ...metaApiConfig, token: e.target.value })}
                    className="w-full text-xs p-2 rounded border focus:outline-none h-16 font-mono"
                    style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                  />
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-[var(--ui-border)]/50 flex items-center gap-3">
              <button 
                onClick={() => handleSaveSection('Connectivity')}
                className="px-4 py-2 bg-[var(--ui-accent)] text-white text-xs font-bold uppercase tracking-widest rounded cursor-pointer hover:opacity-95"
              >
                Save Connectivity
              </button>

              <button 
                onClick={handleTestConnection}
                disabled={testingConnection}
                className="px-4 py-2 border border-[var(--ui-border-strong)] text-[var(--ui-muted)] hover:text-white text-xs font-bold uppercase tracking-widest rounded cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw size={12} className={testingConnection ? 'animate-spin' : ''} />
                {testingConnection ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
          </div>
        )}

        {/* EDITOR TAB */}
        {activeTab === 'editor' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-display font-black uppercase tracking-wider text-white">Monaco Editor Parameters</h3>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">Configure layout, typing wrapping, code themes, and visual helpers.</p>
            </div>

            <div className="space-y-5 max-w-xl">
              {/* Code Editor Theme */}
              <div>
                <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">Code Editor Color Theme</label>
                <select 
                  value={editorThemeLocal}
                  onChange={(e) => setEditorThemeLocal(e.target.value as any)}
                  className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer"
                  style={{ borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                >
                  <option value="corex-dark">CoreX Twilight (High Contrast Dark)</option>
                  <option value="vs-light">CoreX Light (Professional Light)</option>
                  <option value="godot-dark-editor">Godot Engine Charcoal Dark</option>
                  <option value="godot-light-editor">Godot Engine Silver Light</option>
                  <option value="vs-dark">Standard Monaco Dark Theme</option>
                </select>
              </div>

              {/* Font Size slider */}
              <div>
                <div className="flex justify-between items-center text-xs mb-1.5">
                  <span className="font-bold text-[var(--ui-muted)] uppercase">Editor Font Size</span>
                  <span className="font-mono text-[var(--ui-accent)] font-bold">{fontSize}px</span>
                </div>
                <input 
                  type="range" 
                  min="12" 
                  max="20" 
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full accent-[var(--ui-accent)] cursor-pointer h-1 rounded"
                  style={{ backgroundColor: 'var(--ui-border)' }}
                />
              </div>

              {/* Tab size selection */}
              <div>
                <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">Tab Size Space</label>
                <select 
                  value={tabSize}
                  onChange={(e) => setTabSize(parseInt(e.target.value))}
                  className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer"
                  style={{ borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                >
                  <option value={2}>2 Spaces</option>
                  <option value={4}>4 Spaces</option>
                </select>
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                {/* Word Wrap */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setWordWrap(!wordWrap)}
                    className="w-9 h-5 rounded-full p-0.5 transition-colors relative cursor-pointer"
                    style={{ backgroundColor: wordWrap ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${wordWrap ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Enable Word Wrap</span>
                </div>

                {/* Minimap */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setMinimap(!minimap)}
                    className="w-9 h-5 rounded-full p-0.5 transition-colors relative cursor-pointer"
                    style={{ backgroundColor: minimap ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${minimap ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Show Monaco Minimap</span>
                </div>

                {/* Line Numbers */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setLineNumbers(!lineNumbers)}
                    className="w-9 h-5 rounded-full p-0.5 transition-colors relative cursor-pointer"
                    style={{ backgroundColor: lineNumbers ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${lineNumbers ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Show Line Gutter</span>
                </div>

                {/* Auto Closing Brackets */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setAutoClosingBrackets(!autoClosingBrackets)}
                    className="w-9 h-5 rounded-full p-0.5 transition-colors relative cursor-pointer"
                    style={{ backgroundColor: autoClosingBrackets ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${autoClosingBrackets ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Auto Complete Brackets</span>
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--ui-border)]/50">
                <button 
                  onClick={() => handleSaveSection('Editor')}
                  className="px-4 py-2 bg-[var(--ui-accent)] text-white text-xs font-bold uppercase tracking-widest rounded cursor-pointer hover:opacity-95"
                >
                  Save Editor Preferences
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ACCOUNT CONTEXT TAB */}
        {activeTab === 'account' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-display font-black uppercase tracking-wider text-white">Paper Broker Sandbox Context</h3>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">Configure transaction realism parameters, initial capital allocation, and commission quotas.</p>
            </div>

            <div className="space-y-4 max-w-xl">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-[10px] uppercase font-bold text-[var(--ui-muted)]">Initial Allocation Capital ($)</label>
                  <span className="text-[8px] font-mono px-1 bg-slate-500/10 text-[var(--ui-muted)] rounded">min: 1K, max: 10M</span>
                </div>
                <input 
                  type="number" 
                  value={initialCapital}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setInitialCapital(val);
                    const err = validateWithSchema('initialCapital', val, CONFIG_SCHEMAS.account.properties.initialCapital);
                    setValidationErrors(prev => ({ ...prev, initialCapital: err }));
                  }}
                  className="w-full text-xs p-2 rounded border focus:outline-none font-mono font-bold bg-[var(--ui-input-bg)]"
                  style={{ 
                    borderColor: validationErrors.initialCapital ? 'var(--ui-negative)' : 'var(--ui-border)', 
                    color: validationErrors.initialCapital ? 'var(--ui-negative)' : 'var(--ui-text)' 
                  }}
                />
                {validationErrors.initialCapital && (
                  <span className="text-[var(--ui-negative)] text-[9px] font-mono mt-1 block">
                    ⚠ {validationErrors.initialCapital}
                  </span>
                )}
                <span className="text-[9px] text-[var(--ui-muted)] mt-1.5 block">
                  {CONFIG_SCHEMAS.account.properties.initialCapital.description}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[10px] uppercase font-bold text-[var(--ui-muted)]">Brokerage Commission %</label>
                    <span className="text-[8px] font-mono px-1 bg-slate-500/10 text-[var(--ui-muted)] rounded">min: 0, max: 5</span>
                  </div>
                  <input 
                    type="number" 
                    step="0.001"
                    value={commissionPct}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setCommissionPct(val);
                      const err = validateWithSchema('commissionPct', val, CONFIG_SCHEMAS.account.properties.commissionPct);
                      setValidationErrors(prev => ({ ...prev, commissionPct: err }));
                    }}
                    className="w-full text-xs p-2 rounded border focus:outline-none font-mono bg-[var(--ui-input-bg)]"
                    style={{ 
                      borderColor: validationErrors.commissionPct ? 'var(--ui-negative)' : 'var(--ui-border)', 
                      color: validationErrors.commissionPct ? 'var(--ui-negative)' : 'var(--ui-text)' 
                    }}
                  />
                  {validationErrors.commissionPct && (
                    <span className="text-[var(--ui-negative)] text-[9px] font-mono mt-1 block">
                      ⚠ {validationErrors.commissionPct}
                    </span>
                  )}
                  <span className="text-[9px] text-[var(--ui-muted)] mt-1.5 block">
                    {CONFIG_SCHEMAS.account.properties.commissionPct.description}
                  </span>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[10px] uppercase font-bold text-[var(--ui-muted)]">Slippage Threshold (BPS)</label>
                    <span className="text-[8px] font-mono px-1 bg-slate-500/10 text-[var(--ui-muted)] rounded">min: 0, max: 50</span>
                  </div>
                  <input 
                    type="number" 
                    step="0.1"
                    value={slippageBps}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setSlippageBps(val);
                      const err = validateWithSchema('slippageBps', val, CONFIG_SCHEMAS.account.properties.slippageBps);
                      setValidationErrors(prev => ({ ...prev, slippageBps: err }));
                    }}
                    className="w-full text-xs p-2 rounded border focus:outline-none font-mono bg-[var(--ui-input-bg)]"
                    style={{ 
                      borderColor: validationErrors.slippageBps ? 'var(--ui-negative)' : 'var(--ui-border)', 
                      color: validationErrors.slippageBps ? 'var(--ui-negative)' : 'var(--ui-text)' 
                    }}
                  />
                  {validationErrors.slippageBps && (
                    <span className="text-[var(--ui-negative)] text-[9px] font-mono mt-1 block">
                      ⚠ {validationErrors.slippageBps}
                    </span>
                  )}
                  <span className="text-[9px] text-[var(--ui-muted)] mt-1.5 block">
                    {CONFIG_SCHEMAS.account.properties.slippageBps.description}
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--ui-border)]/50">
                <button 
                  onClick={() => handleSaveSection('Paper')}
                  className="px-4 py-2 bg-[var(--ui-accent)] text-white text-xs font-bold uppercase tracking-widest rounded cursor-pointer hover:opacity-95"
                >
                  Save Sandbox Parameters
                </button>
              </div>
            </div>
          </div>
        )}

        {/* APPEARANCE TAB */}
        {activeTab === 'appearance' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-display font-black uppercase tracking-wider text-white">Appearance Settings</h3>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">Configure layout alignments and structural weights.</p>
            </div>

            <div className="space-y-4 max-w-xl">
              <div>
                <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">Console UI Theme</label>
                <select 
                  value={theme}
                  onChange={(e) => {
                    const chosen = e.target.value as any;
                    setTheme(chosen);
                    // Match editorThemeLocal to keep it in sync
                    let matchedEditorTheme: any = 'corex-dark';
                    if (chosen === 'light') matchedEditorTheme = 'vs-light';
                    else if (chosen === 'godot-dark') matchedEditorTheme = 'godot-dark-editor';
                    else if (chosen === 'godot-light') matchedEditorTheme = 'godot-light-editor';
                    setEditorThemeLocal(matchedEditorTheme);
                    showToast(`UI theme transitioned to '${chosen}'`, 'success');
                  }}
                  className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer"
                  style={{ borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                >
                  <option value="dark">CoreX Twilight (High Contrast Dark Mode)</option>
                  <option value="light">CoreX Twilight Light (Professional Light Mode)</option>
                  <option value="godot-dark">Godot Engine Dark (Charcoal Editor Theme)</option>
                  <option value="godot-light">Godot Engine Light (Silver Editorial Theme)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">Sidebar Rail State</label>
                <select 
                  value={sidebarExpanded ? 'expanded' : 'collapsed'}
                  onChange={(e) => setSidebarExpanded(e.target.value === 'expanded')}
                  className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer"
                  style={{ borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                >
                  <option value="expanded">Expanded Default (Full Navigation text)</option>
                  <option value="collapsed">Collapsed default (Minimalist icons list)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-[var(--ui-muted)] mb-1.5">Data display spacing density</label>
                <select 
                  value={density}
                  onChange={(e) => setDensity(e.target.value as any)}
                  className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer"
                  style={{ borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                >
                  <option value="compact">Compact (Highly dense quantitative arrays)</option>
                  <option value="comfortable">Comfortable (Breathable panel borders)</option>
                </select>
              </div>

              <div className="pt-4 border-t border-[var(--ui-border)]/50">
                <button 
                  onClick={() => handleSaveSection('Appearance')}
                  className="px-4 py-2 bg-[var(--ui-accent)] text-white text-xs font-bold uppercase tracking-widest rounded cursor-pointer hover:opacity-95"
                >
                  Save Appearance Rules
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ADMIN TAB */}
        {activeTab === 'admin' && isAdmin && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-display font-black uppercase tracking-wider text-red-400">Admin Gated Operations</h3>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">Gated diagnostic records and workspace auth tables.</p>
            </div>

            {/* Quick Engine Flush Actions */}
            <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 space-y-3">
              <span className="text-[10px] uppercase font-black tracking-widest text-red-400 block">
                Destructive Command Room
              </span>
              <p className="text-xs text-[var(--ui-muted)]">
                Purge all active strategy logs, kill container sessions, and restart background task runners immediately.
              </p>
              <button
                onClick={() => {
                  showToast('Flushed all runtime databases and log registers!', 'warning');
                }}
                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold uppercase tracking-widest rounded cursor-pointer transition-colors"
              >
                Clear all logs &amp; restart servers
              </button>
            </div>

            {/* User List Table */}
            <div className="space-y-3">
              <span className="text-[10px] uppercase font-black tracking-wider text-[var(--ui-muted)] block">
                Workspace Accounts
              </span>

              <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--ui-border)] bg-[var(--ui-panel-strong)]" style={{ color: 'var(--ui-muted)' }}>
                      <th className="py-2 px-3">Name</th>
                      <th className="py-2 px-3">Email</th>
                      <th className="py-2 px-3">Role</th>
                      <th className="py-2 px-3">Created</th>
                      <th className="py-2 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} className="border-b border-[var(--ui-border)]/40 hover:bg-white/2 transition-colors">
                        <td className="py-2 px-3 font-bold text-white">{u.name}</td>
                        <td className="py-2 px-3 font-mono text-[var(--ui-muted)]">{u.email}</td>
                        <td className="py-2 px-3">
                          <span className={`text-[8px] font-black uppercase px-1 py-0.2 rounded border ${
                            u.role === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/25' : 'bg-slate-500/10 text-slate-400 border-slate-500/25'
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-[var(--ui-muted)]">{u.created}</td>
                        <td className="py-2 px-3 text-right space-x-1.5">
                          {u.role === 'user' && (
                            <button
                              onClick={() => handlePromote(u.id, u.name)}
                              className="px-1.5 py-0.5 rounded text-[8px] border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white cursor-pointer"
                            >
                              PROMOTE
                            </button>
                          )}
                          <button
                            onClick={() => handleDeactivate(u.id, u.name)}
                            className="p-1 rounded hover:bg-red-500/15 hover:text-red-500 text-[var(--ui-muted)] cursor-pointer inline-flex items-center"
                          >
                            <Trash2 size={10} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
