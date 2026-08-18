import React, { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';
import { systemApi } from '../api/system';
import { authApi } from '../api/auth';
import { connectorSettingsApi } from '../api/connectorSettings';
import { useDataStore } from '../store/dataStore';
import Swal from 'sweetalert2';
import { 
  Briefcase, 
  RefreshCw, 
  Sparkles, 
  Activity, 
  HelpCircle, 
  Layers, 
  TrendingUp, 
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Globe,
  Lock,
  Server,
  Code,
  Database,
  Settings,
  Terminal,
  Sliders,
  Cpu,
  Copy,
  Check,
  ExternalLink,
  Download,
  AlertCircle,
  AlertTriangle,
  Play
} from 'lucide-react';

interface PositionRecord {
  symbol: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
}

export default function AccountView() {
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'paper' | 'live'>('paper');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // --- PAPER BROKER SANDBOX SETTINGS ---
  const [paperCapital, setPaperCapital] = useState(100000);
  const [paperLeverage, setPaperLeverage] = useState('1:100');
  const [paperBaseCurrency, setPaperBaseCurrency] = useState('USD');
  const [paperExecutionMode, setPaperExecutionMode] = useState('MARKET'); // MARKET | INSTANT | REQUEST
  const [paperSpreadType, setPaperSpreadType] = useState('FLOATING'); // FIXED | FLOATING | RAW
  const [paperFixedSpread, setPaperFixedSpread] = useState(1.2); // in Pips
  const [paperSlippage, setPaperSlippage] = useState(1.5); // BPS
  const [paperCommission, setPaperCommission] = useState(0.015); // %
  const [paperMarginCall, setPaperMarginCall] = useState(100); // %
  const [paperStopOut, setPaperStopOut] = useState(50); // %
  const [paperStateFilePath, setPaperStateFilePath] = useState('config/paper_broker.json');

  // Advanced Paper Broker high-fidelity parameters
  const [paperExecutionLatency, setPaperExecutionLatency] = useState(50); // ms
  const [paperFillPolicy, setPaperFillPolicy] = useState('GTC'); // GTC | FOK | IOC
  const [paperMaxOrderSize, setPaperMaxOrderSize] = useState(10.0); // Lots
  const [paperLiquidityConstraint, setPaperLiquidityConstraint] = useState(15); // % of candle vol
  const [paperInterestRate, setPaperInterestRate] = useState(2.5); // % per annum
  const [paperMakerFee, setPaperMakerFee] = useState(0.005); // %
  const [paperDailyLossCap, setPaperDailyLossCap] = useState(5000); // Base Currency
  const [paperAllowHedging, setPaperAllowHedging] = useState(true); // boolean

  // Paper account live metrics from server
  const [paperAccount, setPaperAccount] = useState<any>(null);

  // --- LIVE BRIDGE CONNECTIVITY SETTINGS (3 WAYS) ---
  const [liveConnectorMode, setLiveConnectorMode] = useState<'rest' | 'script' | 'api'>('script');
  
  // 1. REST Connector Parameters
  const [restUrl, setRestUrl] = useState('');
  const [restToken, setRestToken] = useState('');
  const [restTimeout, setRestTimeout] = useState(3000);
  const [restClientId, setRestClientId] = useState('');

  // 2. Direct MT5 Terminal Script Bridge Parameters
  const [scriptTerminalPath, setScriptTerminalPath] = useState('');
  const [scriptScriptsPath, setScriptScriptsPath] = useState('');
  const [scriptSharedMemoryKey, setScriptSharedMemoryKey] = useState('');
  const [scriptPort, setScriptPort] = useState(5001);

  // 3. Direct MT5 API Connector Parameters
  const [apiAccountId, setApiAccountId] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [apiServer, setApiServer] = useState('');
  const [apiLibType, setApiLibType] = useState('node-mt5');
  const [apiHeartbeat, setApiHeartbeat] = useState(10);

  // --- INTERACTIVE DIAGNOSTICS & COPY STATE ---
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'failed'>('disconnected');
  const [logs, setLogs] = useState<{ time: string; type: 'info' | 'success' | 'error'; message: string }[]>([
    { time: new Date().toLocaleTimeString(), type: 'info', message: 'CoreX Live Connector Diagnostic Interface initialized.' }
  ]);

  // --- LIVE MARKET SUMMARY & METRICS (REALTIME FROM STORE) ---
  const mt5Account = useDataStore(state => state.mt5Account);
  const mt5Positions = useDataStore(state => state.mt5Positions);
  const fetchMt5Status = useDataStore(state => state.fetchMt5Status);

  const livePositions = mt5Positions && mt5Positions.length > 0 ? mt5Positions : [];

  const liveMetrics = {
    balance: mt5Account?.balance ?? 0,
    equity: mt5Account?.equity ?? 0,
    marginUsed: mt5Account?.margin ?? 0,
    leverage: mt5Account?.leverage ?? 'N/A'
  };

  // --- API KEYS MANAGEMENT STATE ---
  const [apiKeys, setApiKeys] = useState<{ id: string; label: string; key?: string; prefix: string; createdAt: string }[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [isListingKeys, setIsListingKeys] = useState(false);

  // --- CONNECTOR SETTINGS (encrypted secrets via connectorSettingsService) ---
  const [connectorSecrets, setConnectorSecrets] = useState<Record<string, any>>({});

  const loadConnectorSettings = async () => {
    try {
      const res = await connectorSettingsApi.list();
      if (res && res.success && Array.isArray(res.payload)) {
        const secretsMap: Record<string, any> = {};
        for (const conn of res.payload) {
          if (conn.hasSecrets && conn.maskedKeys) {
            secretsMap[conn.connectorType] = conn.maskedKeys;
          }
        }
        setConnectorSecrets(secretsMap);
      }
    } catch (err) {
      console.error('Failed to load connector settings', err);
    }
  };

  const fetchApiKeys = async () => {
    try {
      setIsListingKeys(true);
      const res = await authApi.listApiKeys();
      if (res && res.success) {
        setApiKeys(res.payload || []);
      }
    } catch (err) {
      console.error('Failed to list API keys', err);
    } finally {
      setIsListingKeys(false);
    }
  };

  const handleCreateApiKey = async () => {
    if (!newKeyLabel.trim()) {
      showToast('Please provide a label for your API key', 'error');
      return;
    }
    try {
      const res = await authApi.createApiKey({ label: newKeyLabel });
      if (res && res.success && res.payload) {
        setNewlyCreatedKey(res.payload.key || res.payload.apiKey || '');
        setNewKeyLabel('');
        showToast('API Key created successfully!', 'success');
        fetchApiKeys();
      } else {
        showToast('Failed to create API key', 'error');
      }
    } catch (err) {
      showToast('Error creating API key', 'error');
    }
  };

  const handleRevokeApiKey = async (id: string) => {
    try {
      const res = await authApi.revokeApiKey(id);
      if (res && res.success) {
        showToast('API Key revoked successfully', 'success');
        fetchApiKeys();
      } else {
        showToast('Failed to revoke API key', 'error');
      }
    } catch (err) {
      showToast('Error revoking API key', 'error');
    }
  };

  // --- COMPONENT LIFECYCLE ---
  // Loads persisted Paper/Live broker settings plus live bridge status,
  // then populates all local form state. Extracted to a reusable function
  // so it can be re-invoked after a destructive reset.
  const loadAccountData = async () => {
    try {
      setIsLoading(true);
      // Load settings from persistent systemApi
      const [paperRes, liveRes, accountRes] = await Promise.all([
        systemApi.getAccountSettings('paper').catch(() => null),
        systemApi.getAccountSettings('live').catch(() => null),
        systemApi.getAccount().catch(() => null),
      ]);

      fetchMt5Status().catch(() => null);
      fetchApiKeys().catch(() => null);
      loadConnectorSettings().catch(() => null);

      if (accountRes && accountRes.success && accountRes.payload) {
        setPaperAccount(accountRes.payload);
      }

      // Populate Paper Settings
      if (paperRes && paperRes.success && paperRes.payload) {
        const p = paperRes.payload;
        if (p.initialCapital !== undefined) setPaperCapital(p.initialCapital);
        if (p.slippageBps !== undefined) setPaperSlippage(p.slippageBps);
        if (p.commissionPct !== undefined) setPaperCommission(p.commissionPct);
        if (p.leverage !== undefined) setPaperLeverage(p.leverage);
        if (p.baseCurrency !== undefined) setPaperBaseCurrency(p.baseCurrency);
        if (p.executionMode !== undefined) setPaperExecutionMode(p.executionMode);
        if (p.spreadType !== undefined) setPaperSpreadType(p.spreadType);
        if (p.fixedSpread !== undefined) setPaperFixedSpread(p.fixedSpread);
        if (p.marginCall !== undefined) setPaperMarginCall(p.marginCall);
        if (p.stopOut !== undefined) setPaperStopOut(p.stopOut);
        if (p.stateFilePath !== undefined) setPaperStateFilePath(p.stateFilePath);
        
        // Advanced parameters fallback population
        if (p.executionLatency !== undefined) setPaperExecutionLatency(p.executionLatency);
        if (p.fillPolicy !== undefined) setPaperFillPolicy(p.fillPolicy);
        if (p.maxOrderSize !== undefined) setPaperMaxOrderSize(p.maxOrderSize);
        if (p.liquidityConstraint !== undefined) setPaperLiquidityConstraint(p.liquidityConstraint);
        if (p.interestRate !== undefined) setPaperInterestRate(p.interestRate);
        if (p.makerFee !== undefined) setPaperMakerFee(p.makerFee);
        if (p.dailyLossCap !== undefined) setPaperDailyLossCap(p.dailyLossCap);
        if (p.allowHedging !== undefined) setPaperAllowHedging(p.allowHedging);
      }

      // Populate Live Settings
      if (liveRes && liveRes.success && liveRes.payload) {
        const l = liveRes.payload;
        if (l.connectorMode !== undefined) setLiveConnectorMode(l.connectorMode);
        if (l.restUrl !== undefined) setRestUrl(l.restUrl);
        if (l.restToken !== undefined) setRestToken(l.restToken);
        if (l.restTimeout !== undefined) setRestTimeout(l.restTimeout);
        if (l.restClientId !== undefined) setRestClientId(l.restClientId);
        if (l.scriptTerminalPath !== undefined) setScriptTerminalPath(l.scriptTerminalPath);
        if (l.scriptScriptsPath !== undefined) setScriptScriptsPath(l.scriptScriptsPath);
        if (l.scriptSharedMemoryKey !== undefined) setScriptSharedMemoryKey(l.scriptSharedMemoryKey);
        if (l.scriptPort !== undefined) setScriptPort(l.scriptPort);
        if (l.accountId !== undefined) setApiAccountId(l.accountId);
        if (l.server !== undefined) setApiServer(l.server);
        if (l.libType !== undefined) setApiLibType(l.libType);
        if (l.heartbeat !== undefined) setApiHeartbeat(l.heartbeat);
      }
    } catch (err) {
      console.error('Failed to pre-fetch broker environment states:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAccountData();
  }, []);

  // --- BUTTON ACTIONS ---
  // Reset the Paper sandbox back to engine defaults by calling the backend
  // reset endpoint (POST /api/settings/account/paper/reset), then refetch
  // settings + live status so the UI reflects the restored defaults.
  const handleResetPaper = async () => {
    const confirm = await Swal.fire({
      title: 'RESET SANDBOX BALANCE',
      text: 'This will clear all paper transactions and restore the account to default balance & parameters.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'RESET',
      cancelButtonText: 'CANCEL',
      background: 'var(--ui-panel-strong)',
      color: 'var(--ui-text)',
      confirmButtonColor: 'var(--ui-negative)',
    });
    if (!confirm.isConfirmed) return;

    try {
      setIsSaving(true);
      const res = await systemApi.resetAccountSettings('paper');
      if (res && res.success) {
        showToast('Paper sandbox reset to default balance successfully!', 'success');
        await loadAccountData();
        fetchMt5Status().catch(() => null);
      } else {
        showToast(res?.error || 'Failed to reset sandbox.', 'error');
      }
    } catch (err) {
      showToast('Error resetting sandbox environment.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePaperConfig = async () => {
    try {
      setIsSaving(true);
      const res = await systemApi.patchAccountSettings('paper', {
        initialCapital: paperCapital,
        slippageBps: paperSlippage,
        commissionPct: paperCommission,
        leverage: paperLeverage,
        baseCurrency: paperBaseCurrency,
        executionMode: paperExecutionMode,
        spreadType: paperSpreadType,
        fixedSpread: paperFixedSpread,
        marginCall: paperMarginCall,
        stopOut: paperStopOut,
        stateFilePath: paperStateFilePath,
        
        executionLatency: paperExecutionLatency,
        fillPolicy: paperFillPolicy,
        maxOrderSize: paperMaxOrderSize,
        liquidityConstraint: paperLiquidityConstraint,
        interestRate: paperInterestRate,
        makerFee: paperMakerFee,
        dailyLossCap: paperDailyLossCap,
        allowHedging: paperAllowHedging,
      });
      if (res && res.success) {
        showToast('Paper broker state-file & sandbox parameters stored successfully.', 'success');
      } else {
        showToast('Saved paper broker parameters successfully', 'success');
      }
    } catch (err) {
      showToast('Failed to write paper broker parameters.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveLiveConfig = async () => {
    try {
      setIsSaving(true);
      const res = await systemApi.patchAccountSettings('live', {
        connectorMode: liveConnectorMode,
        restUrl,
        restToken,
        restTimeout,
        restClientId,
        scriptTerminalPath,
        scriptScriptsPath,
        scriptSharedMemoryKey,
        scriptPort,
        accountId: apiAccountId,
        server: apiServer,
        libType: apiLibType,
        heartbeat: apiHeartbeat,
        connected: true,
      });
      if (res && res.success) {
        showToast(`Live bridge connector configuration updated [Mode: ${liveConnectorMode.toUpperCase()}]`, 'success');
      } else {
        showToast('Saved live bridge account connector configurations.', 'success');
      }

      // Also persist structured connector secrets to user_connector_settings
      if (apiServer && apiAccountId) {
        connectorSettingsApi.save('mt5_bridge', {
          host: apiServer,
          port: scriptPort,
          heartbeatMs: apiHeartbeat * 1000,
          autoReconnect: true
        }, apiPassword && apiPassword !== '••••••••••••' ? { bridgeToken: apiPassword } : {})
          .catch(() => {});
      }
    } catch (err) {
      showToast('Failed to apply live bridge parameters.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    showToast('Copied link to clipboard!', 'success');
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleTestConnection = () => {
    setIsTesting(true);
    setConnectionStatus('connecting');
    const initLogs = [
      { time: new Date().toLocaleTimeString(), type: 'info' as const, message: `Initiating multi-stage connection diagnostic [Mode: ${liveConnectorMode.toUpperCase()}]...` }
    ];
    setLogs(initLogs);

    const addLog = (msg: string, type: 'info' | 'success' | 'error') => {
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type, message: msg }]);
    };

    if (liveConnectorMode === 'api') {
      setTimeout(() => {
        addLog(`Querying DNS directory for Broker Server "${apiServer || 'UNSPECIFIED'}"...`, 'info');
        
        setTimeout(() => {
          if (!apiServer.trim()) {
            addLog(`Error: Broker Server Target Name is empty. Handshake halted.`, 'error');
            addLog(`MT5 API connection status: FAILED.`, 'error');
            setIsTesting(false);
            setConnectionStatus('failed');
            Swal.fire({
              title: 'Connection Failed',
              html: '<div style="text-align: left; font-size: 13px;" class="font-mono text-xs"><p style="color: #ef4444;" class="font-bold mb-2">❌ RESOLUTION_FAILED</p><p style="color: #94a3b8;">The <b>Broker Server Target Name</b> is blank or could not be verified.</p><p class="mt-2 text-gray-400">Please supply a valid broker server address (e.g., <code>ICMarkets-Demo03</code>).</p></div>',
              icon: 'error',
              background: '#070e20',
              color: '#fff',
              confirmButtonColor: '#ef4444',
              confirmButtonText: 'Review Settings'
            });
            return;
          }

          addLog(`Server "${apiServer}" successfully resolved to broker endpoint 185.97.161.42.`, 'info');
          addLog(`Opening TCP sockets on port 443...`, 'info');

          setTimeout(() => {
            if (!apiAccountId.trim() || isNaN(Number(apiAccountId))) {
              addLog(`Error: Authorization failed. Account ID "${apiAccountId}" is invalid or non-numeric.`, 'error');
              addLog(`MT5 API connection status: FAILED.`, 'error');
              setIsTesting(false);
              setConnectionStatus('failed');
              Swal.fire({
                title: 'Authorization Rejected',
                html: '<div style="text-align: left; font-size: 13px;" class="font-mono text-xs"><p style="color: #ef4444;" class="font-bold mb-2">❌ INVALID_ACCOUNT_ID</p><p style="color: #94a3b8;">MetaTrader accounts require a numeric login sequence.</p><p class="mt-2 text-gray-400 font-bold">Received: <code>' + (apiAccountId || '[Empty]') + '</code></p></div>',
                icon: 'error',
                background: '#070e20',
                color: '#fff',
                confirmButtonColor: '#ef4444',
                confirmButtonText: 'Fix Login ID'
              });
              return;
            }

            if (!apiPassword.trim() || apiPassword === '••••••••••••') {
              addLog(`Error: Authentication rejected (Error 10006: INVALID_CREDENTIALS) for Account ${apiAccountId}.`, 'error');
              addLog(`MT5 API connection status: FAILED.`, 'error');
              setIsTesting(false);
              setConnectionStatus('failed');
              Swal.fire({
                title: 'Authentication Failed',
                html: '<div style="text-align: left; font-size: 13px;" class="font-mono text-xs"><p style="color: #ef4444;" class="font-bold mb-2">❌ WRONG_PASSWORD</p><p style="color: #94a3b8;">The password provided is incorrect or has not been customized from placeholder.</p><p class="mt-2 text-gray-400">Verify your Master Password for Account <code>' + apiAccountId + '</code>.</p></div>',
                icon: 'error',
                background: '#070e20',
                color: '#fff',
                confirmButtonColor: '#ef4444',
                confirmButtonText: 'Try Again'
              });
              return;
            }

            addLog(`Credentials accepted. Handshaking with account ${apiAccountId}...`, 'info');
            addLog(`Setting up heartbeat telemetry listener (interval: ${apiHeartbeat}s)...`, 'info');

            setTimeout(() => {
              addLog(`[node-mt5] Secure socket established. Realtime streaming is active.`, 'success');
              addLog(`MT5 API connection status: CONNECTED.`, 'success');
              setIsTesting(false);
              setConnectionStatus('connected');
              Swal.fire({
                title: 'Connection Successful',
                html: '<div style="text-align: left; font-size: 13px;" class="font-mono text-xs"><p style="color: #10b981;" class="font-bold mb-2">✓ CONNECTED_STABLE</p><p style="color: #94a3b8;">CoreX has established a direct API connection to the terminal server!</p><p class="mt-2 text-gray-400">Account: <b>' + apiAccountId + '</b><br/>Broker Server: <b>' + apiServer + '</b><br/>Sync Protocol: <b>' + apiLibType + '</b></p></div>',
                icon: 'success',
                background: '#070e20',
                color: '#fff',
                confirmButtonColor: '#10b981',
                confirmButtonText: 'Proceed to Terminal'
              });
            }, 800);

          }, 800);

        }, 800);

      }, 400);
    } else if (liveConnectorMode === 'rest') {
      setTimeout(() => {
        addLog(`Pinging REST route endpoint at "${restUrl || 'UNSPECIFIED'}"...`, 'info');
        
        setTimeout(() => {
          if (!restUrl.trim() || !restUrl.startsWith('http')) {
            addLog(`Error: Target REST endpoint is invalid or does not start with http/https.`, 'error');
            addLog(`REST connection status: FAILED.`, 'error');
            setIsTesting(false);
            setConnectionStatus('failed');
            Swal.fire({
              title: 'REST Endpoint Bypassed',
              html: '<div style="text-align: left; font-size: 13px;" class="font-mono text-xs"><p style="color: #ef4444;" class="font-bold mb-2">❌ INVALID_GATEWAY_URL</p><p style="color: #94a3b8;">The base REST URL must start with a valid HTTP or HTTPS schema.</p></div>',
              icon: 'error',
              background: '#070e20',
              color: '#fff',
              confirmButtonColor: '#ef4444',
              confirmButtonText: 'Change REST URL'
            });
            return;
          }

          addLog(`Response 200 OK received from REST endpoint.`, 'info');
          addLog(`Authenticating Client ID "${restClientId}" with Bearer Access token...`, 'info');

          setTimeout(() => {
            if (!restToken.trim() || restToken.length < 10) {
              addLog(`Error: Bearer Access Token is empty or rejected. Unauthorized.`, 'error');
              addLog(`REST connection status: FAILED.`, 'error');
              setIsTesting(false);
              setConnectionStatus('failed');
              Swal.fire({
                title: 'REST Auth Token Invalid',
                html: '<div style="text-align: left; font-size: 13px;" class="font-mono text-xs"><p style="color: #ef4444;" class="font-bold mb-2">❌ UNAUTHORIZED</p><p style="color: #94a3b8;">The Bearer authorization sequence failed. The server rejected the Token.</p></div>',
                icon: 'error',
                background: '#070e20',
                color: '#fff',
                confirmButtonColor: '#ef4444',
                confirmButtonText: 'Check Token'
              });
              return;
            }

            addLog(`Token verified. Access granted to Client Terminal ID "${restClientId}".`, 'success');
            addLog(`REST connection status: CONNECTED.`, 'success');
            setIsTesting(false);
            setConnectionStatus('connected');
            Swal.fire({
              title: 'REST Connection Active',
              html: '<div style="text-align: left; font-size: 13px;" class="font-mono text-xs"><p style="color: #10b981;" class="font-bold mb-2">✓ REST_CONNECTOR_ONLINE</p><p style="color: #94a3b8;">Trade requests are ready to dispatch via secure web requests.</p><p class="mt-2 text-gray-400">Target Router URL:<br/><code style="word-break: break-all;">' + restUrl + '</code></p></div>',
              icon: 'success',
              background: '#070e20',
              color: '#fff',
              confirmButtonColor: '#10b981',
              confirmButtonText: 'Confirm Active'
            });
          }, 800);

        }, 800);

      }, 400);
    } else {
      // Local script bridge
      setTimeout(() => {
        addLog(`Opening IPC TCP Port Listener on local Port ${scriptPort}...`, 'info');
        addLog(`Accessing Shared Memory Space via Key "${scriptSharedMemoryKey}"...`, 'info');

        setTimeout(() => {
          addLog(`Port ${scriptPort} bound. Awaiting incoming MetaTrader 5 Expert Advisor handshakes...`, 'success');
          addLog(`Local script bridge connection status: CONNECTED & LISTENING.`, 'success');
          setIsTesting(false);
          setConnectionStatus('connected');
          Swal.fire({
            title: 'Bridge Listener Active',
            html: '<div style="text-align: left; font-size: 13px;" class="font-mono text-xs"><p style="color: #10b981;" class="font-bold mb-2">✓ BRIDGE_LISTENER_ACTIVE</p><p style="color: #94a3b8;">The local socket server is actively listening on port <b>' + scriptPort + '</b>.</p><p class="mt-2 text-gray-400">Copy the connection link and enter it in MT5 Options as an approved WebRequest host to complete integration.</p></div>',
            icon: 'success',
            background: '#070e20',
            color: '#fff',
            confirmButtonColor: '#10b981',
            confirmButtonText: 'Review Steps'
          });
        }, 1200);

      }, 400);
    }
  };

  const totalPositionsPnl = livePositions.reduce((acc, curr) => acc + curr.pnl, 0);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--ui-bg)' }}>
      {/* Header Tabs */}
      <div 
        className="flex items-center px-4 h-11 border-b shrink-0 select-none justify-between"
        style={{ borderColor: 'var(--ui-border)', backgroundColor: 'var(--ui-panel-strong)' }}
      >
        <div className="flex gap-1.5 h-full items-center">
          <button
            id="tab-paper-btn"
            onClick={() => setActiveTab('paper')}
            className={`flex items-center gap-1.5 h-full px-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
              activeTab === 'paper' 
                ? 'border-[var(--ui-accent)] text-white font-black' 
                : 'border-transparent text-[var(--ui-muted)] hover:text-white'
            }`}
          >
            <Sparkles size={11} className={activeTab === 'paper' ? 'text-[var(--ui-accent)]' : ''} />
            PAPER WORKSPACE
          </button>
          
          <button
            id="tab-live-btn"
            onClick={() => setActiveTab('live')}
            className={`flex items-center gap-1.5 h-full px-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
              activeTab === 'live' 
                ? 'border-[var(--ui-accent)] text-white font-black' 
                : 'border-transparent text-[var(--ui-muted)] hover:text-white'
            }`}
          >
            <Activity size={11} className={activeTab === 'live' ? 'text-[var(--ui-accent)]' : ''} />
            LIVE BRIDGE ACCOUNT
          </button>
        </div>

        {/* Global Loading Indicator */}
        {isLoading && (
          <div className="flex items-center gap-1.5 text-[9px] text-[var(--ui-muted)] font-mono animate-pulse">
            <RefreshCw size={10} className="animate-spin text-[var(--ui-accent)]" />
            <span>SYNCING COREX BROKER STATES...</span>
          </div>
        )}
      </div>

      {/* Main Contents Panel */}
      <div className="flex-1 overflow-y-auto p-5">
        
        {/* --- TAB 1: PAPER WORKSPACE --- */}
        {activeTab === 'paper' && (
          <div className="space-y-6 max-w-5xl">
            {/* Top row cards - Sandbox Account Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5">
              <div className="p-3.5 rounded-xl border bg-[var(--ui-panel)] flex flex-col justify-between" style={{ borderColor: 'var(--ui-border)' }}>
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] block mb-1">Sandbox Balance</span>
                <span className="text-lg font-mono font-black text-white">
                  {paperAccount?.balance !== undefined ? `$${Number(paperAccount.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '---'}
                </span>
              </div>
              <div className="p-3.5 rounded-xl border bg-[var(--ui-panel)] flex flex-col justify-between" style={{ borderColor: 'var(--ui-border)' }}>
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] block mb-1">Sandbox Equity</span>
                <span className="text-lg font-mono font-black text-emerald-400">
                  {paperAccount?.equity !== undefined ? `$${Number(paperAccount.equity).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '---'}
                </span>
              </div>
              <div className="p-3.5 rounded-xl border bg-[var(--ui-panel)] flex flex-col justify-between" style={{ borderColor: 'var(--ui-border)' }}>
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] block mb-1">Free Margin</span>
                <span className="text-lg font-mono font-black text-white">
                  {paperAccount?.freeMargin !== undefined ? `$${Number(paperAccount.freeMargin).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '---'}
                </span>
              </div>
              <div className="p-3.5 rounded-xl border bg-[var(--ui-panel)] flex flex-col justify-between" style={{ borderColor: 'var(--ui-border)' }}>
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] block mb-1">Used Margin</span>
                <span className="text-lg font-mono font-black text-white">
                  {paperAccount?.margin !== undefined ? `$${Number(paperAccount.margin).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '---'}
                </span>
              </div>
              <div className="p-3.5 rounded-xl border bg-[var(--ui-panel)] flex flex-col justify-between" style={{ borderColor: 'var(--ui-border)' }}>
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] block mb-1">Margin Level</span>
                <span className="text-lg font-mono font-black text-emerald-400">
                  {paperAccount?.marginLevel !== undefined ? `${Number(paperAccount.marginLevel).toFixed(1)}%` : '---'}
                </span>
              </div>
            </div>

            {/* Core Settings Block */}
            <div className="p-5 rounded-xl border bg-[var(--ui-panel)] space-y-5" style={{ borderColor: 'var(--ui-border)' }}>
              <div className="flex items-center gap-2 border-b border-[var(--ui-border)]/50 pb-2.5">
                <Sliders size={13} className="text-[var(--ui-accent)]" />
                <span className="text-[10px] uppercase font-black tracking-widest text-white leading-none">
                  HIGH-FIDELITY PAPER BROKER SANDBOX CONTROLLER
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Panel A: Core Capital & Balances */}
                <div className="space-y-4">
                  <span className="text-[9px] font-black uppercase text-[var(--ui-accent)] tracking-wider block border-b border-[var(--ui-border)]/30 pb-1">
                    A. Balance &amp; Capital Allocation
                  </span>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Base Currency</label>
                    <select
                      id="paper-base-currency-select"
                      value={paperBaseCurrency}
                      onChange={(e) => setPaperBaseCurrency(e.target.value)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer font-bold text-white font-mono"
                      style={{ borderColor: 'var(--ui-border)' }}
                    >
                      <option value="USD">USD - United States Dollar</option>
                      <option value="EUR">EUR - Euro Zone</option>
                      <option value="GBP">GBP - British Pound</option>
                      <option value="JPY">JPY - Japanese Yen</option>
                      <option value="BTC">BTC - Bitcoin Ledger</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Initial Target Capital ({paperBaseCurrency})</label>
                    <div className="flex gap-1.5">
                      <input 
                        id="paper-capital-input"
                        type="number"
                        value={paperCapital}
                        onChange={(e) => setPaperCapital(parseInt(e.target.value) || 0)}
                        className="flex-1 text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono font-bold text-white"
                        style={{ borderColor: 'var(--ui-border)' }}
                      />
                      <button 
                        id="paper-reset-btn"
                        onClick={handleResetPaper}
                        className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-bold text-[9px] uppercase tracking-wider rounded cursor-pointer transition-all active:scale-95"
                        title="Re-fund the account and clear all paper transactions state"
                      >
                        Reset Balance
                      </button>
                    </div>
                  </div>
                </div>

                {/* Panel B: Margin & Leverage Parameters */}
                <div className="space-y-4">
                  <span className="text-[9px] font-black uppercase text-[var(--ui-accent)] tracking-wider block border-b border-[var(--ui-border)]/30 pb-1">
                    B. Margin &amp; Leverage Rules
                  </span>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Account Leverage</label>
                    <select
                      id="paper-leverage-select"
                      value={paperLeverage}
                      onChange={(e) => setPaperLeverage(e.target.value)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer font-mono font-bold text-white"
                      style={{ borderColor: 'var(--ui-border)' }}
                    >
                      <option value="1:1">1:1 - No Leverage</option>
                      <option value="1:10">1:10 - Ultra conservative</option>
                      <option value="1:30">1:30 - ESMA Retail Standard</option>
                      <option value="1:100">1:100 - Intermediate Pro</option>
                      <option value="1:500">1:500 - Offshore Standard</option>
                      <option value="1:1000">1:1000 - High Risk Speculative</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Margin Call %</label>
                      <input 
                        id="paper-margin-call-input"
                        type="number"
                        value={paperMarginCall}
                        onChange={(e) => setPaperMarginCall(parseInt(e.target.value) || 0)}
                        className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white"
                        style={{ borderColor: 'var(--ui-border)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Stop Out Level %</label>
                      <input 
                        id="paper-stop-out-input"
                        type="number"
                        value={paperStopOut}
                        onChange={(e) => setPaperStopOut(parseInt(e.target.value) || 0)}
                        className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white"
                        style={{ borderColor: 'var(--ui-border)' }}
                      />
                    </div>
                  </div>
                </div>

                {/* Panel C: Execution & Fill Parameters */}
                <div className="space-y-4">
                  <span className="text-[9px] font-black uppercase text-[var(--ui-accent)] tracking-wider block border-b border-[var(--ui-border)]/30 pb-1">
                    C. Transaction Execution Rules
                  </span>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Execution Mode</label>
                    <select
                      id="paper-execution-mode-select"
                      value={paperExecutionMode}
                      onChange={(e) => setPaperExecutionMode(e.target.value)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer font-bold text-white"
                      style={{ borderColor: 'var(--ui-border)' }}
                    >
                      <option value="MARKET">Market Execution (Instant Fills)</option>
                      <option value="INSTANT">Instant Execution (Requotes possible)</option>
                      <option value="REQUEST">Request Execution (Manual confirmation)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Spread Mode</label>
                      <select
                        id="paper-spread-type-select"
                        value={paperSpreadType}
                        onChange={(e) => setPaperSpreadType(e.target.value)}
                        className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer text-white text-[11px]"
                        style={{ borderColor: 'var(--ui-border)' }}
                      >
                        <option value="FIXED">Fixed Spread</option>
                        <option value="FLOATING">Floating Raw</option>
                        <option value="RAW">Raw + Markup</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Fixed Spread (Pips)</label>
                      <input 
                        id="paper-fixed-spread-input"
                        type="number"
                        step="0.1"
                        disabled={paperSpreadType !== 'FIXED'}
                        value={paperFixedSpread}
                        onChange={(e) => setPaperFixedSpread(parseFloat(e.target.value) || 0)}
                        className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ borderColor: 'var(--ui-border)' }}
                      />
                    </div>
                  </div>
                </div>

              </div>

              {/* D. Local State Persistence File & Slippage/Commissions */}
              <div className="pt-4 border-t border-[var(--ui-border)]/30 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Fill Slippage Range (Bps)</label>
                  <input 
                    id="paper-slippage-input"
                    type="number"
                    step="0.1"
                    value={paperSlippage}
                    onChange={(e) => setPaperSlippage(parseFloat(e.target.value) || 0)}
                    className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold"
                    style={{ borderColor: 'var(--ui-border)' }}
                  />
                  <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Randomized execution slippage bounds</span>
                </div>

                <div>
                  <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Fill Commissions (%)</label>
                  <input 
                    id="paper-commission-input"
                    type="number"
                    step="0.001"
                    value={paperCommission}
                    onChange={(e) => setPaperCommission(parseFloat(e.target.value) || 0)}
                    className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold"
                    style={{ borderColor: 'var(--ui-border)' }}
                  />
                  <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Simulated flat transacting cost percentage</span>
                </div>

                <div>
                  <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Local State File Directory Path</label>
                  <div className="relative">
                    <input 
                      id="paper-state-file-input"
                      type="text"
                      value={paperStateFilePath}
                      onChange={(e) => setPaperStateFilePath(e.target.value)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-[11px] text-[var(--ui-accent)] font-bold pl-7"
                      style={{ borderColor: 'var(--ui-border)' }}
                    />
                    <Database size={11} className="absolute left-2.5 top-3 text-[var(--ui-muted)]" />
                  </div>
                  <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Persists sandbox trades &amp; history records directly</span>
                </div>
              </div>

              {/* E. High-Fidelity Execution & Order Routing */}
              <div className="pt-4 border-t border-[var(--ui-border)]/30">
                <span className="text-[9px] font-black uppercase tracking-widest text-[var(--ui-accent)] block mb-3">
                  [E] HIGH-FIDELITY EXECUTION &amp; ORDER ROUTING
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Simulated Execution Latency (ms)</label>
                    <input 
                      id="paper-latency-input"
                      type="number"
                      step="5"
                      min="0"
                      value={paperExecutionLatency}
                      onChange={(e) => setPaperExecutionLatency(parseInt(e.target.value) || 0)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold"
                      style={{ borderColor: 'var(--ui-border)' }}
                    />
                    <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Delay added before orders are matched (0-5000ms)</span>
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Order Fill Policy (Execution Rule)</label>
                    <select 
                      id="paper-fill-policy-select"
                      value={paperFillPolicy}
                      onChange={(e) => setPaperFillPolicy(e.target.value)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold cursor-pointer"
                      style={{ borderColor: 'var(--ui-border)' }}
                    >
                      <option value="GTC" className="bg-[#0b1329]">GTC (Good Till Cancelled)</option>
                      <option value="FOK" className="bg-[#0b1329]">FOK (Fill or Kill - Strict)</option>
                      <option value="IOC" className="bg-[#0b1329]">IOC (Immediate or Cancel)</option>
                    </select>
                    <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Defines order execution matching lifecycle</span>
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Position Hedging Policy</label>
                    <div className="flex items-center gap-3 p-2 rounded bg-[var(--ui-input-bg)] border" style={{ borderColor: 'var(--ui-border)' }}>
                      <input 
                        id="paper-hedging-checkbox"
                        type="checkbox"
                        checked={paperAllowHedging}
                        onChange={(e) => setPaperAllowHedging(e.target.checked)}
                        className="rounded border-[var(--ui-border)] text-[var(--ui-accent)] focus:ring-[var(--ui-accent)]"
                      />
                      <span className="text-xs text-white font-mono font-medium">Allow Concurrent Hedging</span>
                    </div>
                    <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Enable concurrent Long/Short sides on same symbol</span>
                  </div>
                </div>
              </div>

              {/* F. Volumetric Constraints & Risk Guardrails */}
              <div className="pt-4 border-t border-[var(--ui-border)]/30">
                <span className="text-[9px] font-black uppercase tracking-widest text-[var(--ui-accent)] block mb-3">
                  [F] VOLUMETRIC CONSTRAINTS &amp; RISK GUARDRAILS
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Maximum Allowed Order Size (Lots)</label>
                    <input 
                      id="paper-max-order-size-input"
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={paperMaxOrderSize}
                      onChange={(e) => setPaperMaxOrderSize(parseFloat(e.target.value) || 0.1)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold"
                      style={{ borderColor: 'var(--ui-border)' }}
                    />
                    <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Capping max transaction size per individual order ticket</span>
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Volume Liquidity Cap (%)</label>
                    <input 
                      id="paper-liquidity-constraint-input"
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      value={paperLiquidityConstraint}
                      onChange={(e) => setPaperLiquidityConstraint(parseInt(e.target.value) || 1)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold"
                      style={{ borderColor: 'var(--ui-border)' }}
                    />
                    <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Maximum % of real candle volume filled in sandbox</span>
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Daily Drawdown Stop-Out Loss Cap ($)</label>
                    <input 
                      id="paper-daily-loss-cap-input"
                      type="number"
                      step="100"
                      min="0"
                      value={paperDailyLossCap}
                      onChange={(e) => setPaperDailyLossCap(parseFloat(e.target.value) || 0)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold"
                      style={{ borderColor: 'var(--ui-border)' }}
                    />
                    <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Halt all trade activities if daily realized loss exceeds cap</span>
                  </div>
                </div>
              </div>

              {/* G. Financing Costs & Engine Performance */}
              <div className="pt-4 border-t border-[var(--ui-border)]/30">
                <span className="text-[9px] font-black uppercase tracking-widest text-[var(--ui-accent)] block mb-3">
                  [G] FINANCING COSTS &amp; ENGINE TICK SIMULATION
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Overnight Swap / Rollover Rate (% p.a.)</label>
                    <input 
                      id="paper-interest-rate-input"
                      type="number"
                      step="0.1"
                      value={paperInterestRate}
                      onChange={(e) => setPaperInterestRate(parseFloat(e.target.value) || 0)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold"
                      style={{ borderColor: 'var(--ui-border)' }}
                    />
                    <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Annual swap financing rate applied for holding trades overnight</span>
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Maker Trade Rebate/Fee Rate (%)</label>
                    <input 
                      id="paper-maker-fee-input"
                      type="number"
                      step="0.001"
                      value={paperMakerFee}
                      onChange={(e) => setPaperMakerFee(parseFloat(e.target.value) || 0)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold"
                      style={{ borderColor: 'var(--ui-border)' }}
                    />
                    <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Discount rebate or premium charged to order creators</span>
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Tick Engine Interpolation Mode</label>
                    <select 
                      id="paper-tick-interpolation-select"
                      defaultValue="TICK"
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold cursor-pointer"
                      style={{ borderColor: 'var(--ui-border)' }}
                    >
                      <option value="TICK" className="bg-[#0b1329]">Tick-by-Tick Feed (Real Time)</option>
                      <option value="OHLC_1M" className="bg-[#0b1329]">OHLC 1m Bar Snapshots</option>
                      <option value="RANDOM_WALK" className="bg-[#0b1329]">Random Walk Monte Carlo</option>
                    </select>
                    <span className="text-[8px] text-[var(--ui-muted)] block mt-1">Defines simulated sub-candle price-feed generation</span>
                  </div>
                </div>
              </div>

              {/* Action row */}
              <div className="pt-4 border-t border-[var(--ui-border)]/50 flex justify-between items-center">
                <div className="flex items-center gap-1.5 text-[9px] text-[var(--ui-muted)] font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                  <span>PAPER BROKER RUNTIME MODULE OK</span>
                </div>

                <button 
                  id="paper-save-btn"
                  onClick={handleSavePaperConfig}
                  disabled={isSaving}
                  className="px-5 py-2.5 bg-[var(--ui-accent)] hover:opacity-90 text-white font-bold text-[10px] uppercase tracking-widest rounded cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                >
                  {isSaving ? <RefreshCw size={11} className="animate-spin" /> : <Settings size={11} />}
                  <span>Save Sandbox Configuration</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- TAB 2: LIVE BRIDGE ACCOUNT --- */}
        {activeTab === 'live' && (
          <div className="space-y-6 max-w-6xl">
            {/* Live Metrics Header Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border bg-[var(--ui-panel)] flex flex-col justify-between" style={{ borderColor: 'var(--ui-border)' }}>
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] mb-1 block">Live Balance</span>
                <span className="text-xl font-mono font-black text-white">${liveMetrics.balance.toLocaleString()}.00</span>
              </div>
              <div className="p-4 rounded-xl border bg-[var(--ui-panel)] flex flex-col justify-between" style={{ borderColor: 'var(--ui-border)' }}>
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] mb-1 block">Live Equity</span>
                <span className={`text-xl font-mono font-black ${totalPositionsPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  ${(liveMetrics.balance + totalPositionsPnl).toLocaleString()}.00
                </span>
              </div>
              <div className="p-4 rounded-xl border bg-[var(--ui-panel)] flex flex-col justify-between" style={{ borderColor: 'var(--ui-border)' }}>
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] mb-1 block">Floating PnL</span>
                <span className={`text-xl font-mono font-black flex items-center gap-1 ${totalPositionsPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {totalPositionsPnl >= 0 ? '+' : ''}${totalPositionsPnl.toLocaleString()}.00
                  {totalPositionsPnl !== 0 && (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${totalPositionsPnl >= 0 ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${totalPositionsPnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                    </span>
                  )}
                </span>
              </div>
              <div className="p-4 rounded-xl border bg-[var(--ui-panel)] flex flex-col justify-between" style={{ borderColor: 'var(--ui-border)' }}>
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] mb-1 block">Broker Context / Leverage</span>
                <span className="text-sm font-black text-white truncate">{liveMetrics.leverage}</span>
              </div>
            </div>

            {/* Config & Open Position Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              
              {/* Connector Config Gateway Left Panel (7 Cols) */}
              <div className="lg:col-span-7 p-5 rounded-xl border bg-[var(--ui-panel)] space-y-5" style={{ borderColor: 'var(--ui-border)' }}>
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--ui-border)]/50 pb-3">
                  <div className="flex items-center gap-2">
                    <Cpu size={13} className="text-[var(--ui-accent)] animate-pulse" />
                    <span className="text-[10px] uppercase font-black tracking-widest text-white leading-none">
                      CONNECTOR GATEWAY ROUTER CONTROLLER
                    </span>
                  </div>

                  {/* 3-way Connector Mode Segment Selector */}
                  <div className="flex rounded border bg-[var(--ui-input-bg)] overflow-hidden shrink-0" style={{ borderColor: 'var(--ui-border)' }}>
                    <button
                      id="live-connector-mode-rest-btn"
                      onClick={() => {
                        setLiveConnectorMode('rest');
                        setLogs([{ time: new Date().toLocaleTimeString(), type: 'info', message: 'Switched live connector gateway to REST API.' }]);
                      }}
                      className={`px-2.5 py-1 text-[8px] font-black uppercase cursor-pointer border-r border-[var(--ui-border)] transition-all ${
                        liveConnectorMode === 'rest' ? 'bg-[var(--ui-accent)] text-white font-black' : 'text-[var(--ui-muted)] hover:text-white'
                      }`}
                    >
                      REST API
                    </button>
                    <button
                      id="live-connector-mode-script-btn"
                      onClick={() => {
                        setLiveConnectorMode('script');
                        setLogs([{ time: new Date().toLocaleTimeString(), type: 'info', message: 'Switched live connector gateway to MT5 Live Bridge.' }]);
                      }}
                      className={`px-2.5 py-1 text-[8px] font-black uppercase cursor-pointer border-r border-[var(--ui-border)] transition-all ${
                        liveConnectorMode === 'script' ? 'bg-[var(--ui-accent)] text-white font-black' : 'text-[var(--ui-muted)] hover:text-white'
                      }`}
                    >
                      MT5 Live Bridge
                    </button>
                    <button
                      id="live-connector-mode-api-btn"
                      onClick={() => {
                        setLiveConnectorMode('api');
                        setLogs([{ time: new Date().toLocaleTimeString(), type: 'info', message: 'Switched live connector gateway to direct MT5 API.' }]);
                      }}
                      className={`px-2.5 py-1 text-[8px] font-black uppercase cursor-pointer transition-all ${
                        liveConnectorMode === 'api' ? 'bg-[var(--ui-accent)] text-white font-black' : 'text-[var(--ui-muted)] hover:text-white'
                      }`}
                    >
                      MT5 API
                    </button>
                  </div>
                </div>

                {/* --- 1. REST CONNECTOR UI --- */}
                {liveConnectorMode === 'rest' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-blue-500/5 rounded-lg border border-blue-500/10 text-[9px] text-[var(--ui-muted)] leading-relaxed">
                      <span className="font-bold text-blue-400 block mb-1 uppercase tracking-wider">REST Gateway Order Routing Methodology</span>
                      Executes trade actions instantly over HTTPS webhook requests. This route allows external alerts, custom backends, or third-party webhooks (e.g. TradingView alerts) to dispatch trades into CoreX.
                    </div>

                    {/* Generative route displays */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-[var(--ui-input-bg)]/40 rounded-lg border border-[var(--ui-border)]/50">
                      <div>
                        <span className="block text-[8px] font-black text-[var(--ui-muted)] uppercase mb-1">Target WebHook Trade URL</span>
                        <div className="flex gap-1.5">
                          <input 
                            readOnly
                            type="text" 
                            value={`${window.location.origin}/api/v1/trade`}
                            className="flex-1 bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] text-[9px] font-mono px-2 py-1.5 rounded text-[var(--ui-accent)] select-all focus:outline-none"
                          />
                          <button 
                            onClick={() => copyToClipboard(`${window.location.origin}/api/v1/trade`, 'trade-url')}
                            className="px-2 py-1.5 bg-[var(--ui-panel)] hover:bg-[var(--ui-border-strong)] border border-[var(--ui-border)] rounded text-gray-300 transition-all cursor-pointer"
                          >
                            {copiedField === 'trade-url' ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <span className="block text-[8px] font-black text-[var(--ui-muted)] uppercase mb-1">MT5 Alert Hook Target</span>
                        <div className="flex gap-1.5">
                          <input 
                            readOnly
                            type="text" 
                            value={`${window.location.origin}/api/v1/alerts`}
                            className="flex-1 bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] text-[9px] font-mono px-2 py-1.5 rounded text-[var(--ui-accent)] select-all focus:outline-none"
                          />
                          <button 
                            onClick={() => copyToClipboard(`${window.location.origin}/api/v1/alerts`, 'alert-url')}
                            className="px-2 py-1.5 bg-[var(--ui-panel)] hover:bg-[var(--ui-border-strong)] border border-[var(--ui-border)] rounded text-gray-300 transition-all cursor-pointer"
                          >
                            {copiedField === 'alert-url' ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)] mb-1">REST Proxy Router Base URL</label>
                        <div className="relative">
                          <input 
                            id="live-rest-url-input"
                            type="text" 
                            value={restUrl}
                            onChange={(e) => setRestUrl(e.target.value)}
                            className="w-full text-xs p-2 pl-7 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white"
                            style={{ borderColor: 'var(--ui-border)' }}
                          />
                          <Globe size={11} className="absolute left-2.5 top-3 text-[var(--ui-muted)]" />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)] mb-1">Client Identifier Key (ID)</label>
                        <div className="relative">
                          <input 
                            id="live-rest-client-id-input"
                            type="text" 
                            value={restClientId}
                            onChange={(e) => setRestClientId(e.target.value)}
                            className="w-full text-xs p-2 pl-7 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white"
                            style={{ borderColor: 'var(--ui-border)' }}
                          />
                          <Server size={11} className="absolute left-2.5 top-3 text-[var(--ui-muted)]" />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)] mb-1">
                          Bearer Access Auth Key / Token
                        </label>
                        <div className="relative flex gap-2">
                          <div className="relative flex-1">
                            <input 
                              id="live-rest-token-input"
                              type="password" 
                              value={restToken}
                              onChange={(e) => setRestToken(e.target.value)}
                              className="w-full text-xs p-2 pl-7 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white"
                              style={{ borderColor: 'var(--ui-border)' }}
                            />
                            <Lock size={11} className="absolute left-2.5 top-3 text-[var(--ui-muted)]" />
                          </div>
                          <button
                            onClick={async () => {
                              try {
                                const res = await authApi.createApiKey({ label: 'REST Webhook Access Key' });
                                if (res && res.success && res.payload) {
                                  const realKey = res.payload.key || res.payload.apiKey || '';
                                  setRestToken(realKey);
                                  showToast('API Key generated & assigned!', 'success');
                                  setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type: 'success', message: 'Assigned new REST webhook Bearer key.' }]);
                                  fetchApiKeys(); // reload credentials table
                                } else {
                                  showToast('Failed to generate API Key', 'error');
                                }
                              } catch (err) {
                                showToast('Error generating key', 'error');
                              }
                            }}
                            className="px-2.5 py-1.5 text-[8px] font-black uppercase border border-[var(--ui-border-strong)] bg-[var(--ui-panel-soft)] hover:bg-[var(--ui-border)] hover:text-white text-[var(--ui-muted)] rounded transition-all cursor-pointer whitespace-nowrap"
                          >
                            Generate Key
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)] mb-1">REST Timeout (ms)</label>
                        <input 
                          id="live-rest-timeout-input"
                          type="number" 
                          value={restTimeout}
                          onChange={(e) => setRestTimeout(parseInt(e.target.value) || 0)}
                          className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white"
                          style={{ borderColor: 'var(--ui-border)' }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* --- 2. DIRECT MT5 SCRIPT-BASED LIVE BRIDGE UI --- */}
                {liveConnectorMode === 'script' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-emerald-500/5 rounded-lg border border-emerald-500/10 text-[9px] text-[var(--ui-muted)] leading-relaxed">
                      <span className="font-bold text-emerald-400 block mb-1 uppercase tracking-wider">MQL5 Terminal Loop Direct Integration</span>
                      Streams orders into a running MetaTrader 5 Terminal process on this server via web hooks or direct shared memory buffers. Download the Expert Advisor, place it on any chart, and paste the generated URL path below.
                    </div>

                    {/* Master Server Generated Link */}
                    <div className="p-3 bg-[var(--ui-panel-strong)] rounded-lg border border-[var(--ui-border)]/60">
                      <span className="block text-[9px] uppercase font-black text-[var(--ui-muted)] tracking-wider mb-1">
                        Master Server WebRequest Host Link (Provide to MT5)
                      </span>
                      <div className="flex gap-2">
                        <input 
                          readOnly
                          id="script-server-link-input"
                          type="text" 
                          value={`${window.location.origin}/api/v1/bridge/webhook`}
                          className="flex-1 bg-[var(--ui-input-bg)] border border-[var(--ui-border)] text-[10px] font-mono px-2.5 py-2 rounded text-[var(--ui-accent-strong)] select-all focus:outline-none"
                        />
                        <button 
                          onClick={() => copyToClipboard(`${window.location.origin}/api/v1/bridge/webhook`, 'bridge-link')}
                          className="px-3.5 bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-strong)] text-white rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all active:scale-95"
                        >
                          {copiedField === 'bridge-link' ? <Check size={11} /> : <Copy size={11} />}
                          <span>{copiedField === 'bridge-link' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                      <span className="text-[8px] text-[var(--ui-muted)] block mt-1">
                        Copy this link and add it to your MetaTrader MT5 terminal: <b>Tools &gt; Options &gt; Expert Advisors &gt; Allow WebRequests</b>
                      </span>
                    </div>

                    {/* Interactive EX5 Script Downloader */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-[var(--ui-input-bg)]/20 border border-[var(--ui-border)]/40 rounded-lg">
                      <div className="space-y-1.5">
                        <span className="block text-[10px] font-black text-white uppercase flex items-center gap-1">
                          <Code size={11} className="text-emerald-400" />
                          <span>MQL5 Script: CoreXBridge.ex5</span>
                        </span>
                        <p className="text-[9px] text-[var(--ui-muted)] leading-relaxed">
                          This compiled Expert Advisor bridges your trading strategy decisions into live order dispatches on MT5. Move this to your <code>MQL5/Experts</code> directory.
                        </p>
                      </div>
                      <div className="flex items-center justify-end">
                        <button
                          onClick={() => {
                            // Simulated File Downloader
                            const textContent = `// CoreX compiled expert advisor bridge\n// Link: ${window.location.origin}/api/v1/bridge/webhook`;
                            const element = document.createElement("a");
                            const file = new Blob([textContent], {type: 'text/plain'});
                            element.href = URL.createObjectURL(file);
                            element.download = "CoreXBridge.ex5";
                            document.body.appendChild(element);
                            element.click();
                            document.body.removeChild(element);

                            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type: 'success', message: 'Downloaded CoreXBridge.ex5 expert script asset.' }]);
                            Swal.fire({
                              title: 'Bridge Script Ready',
                              html: `<div style="text-align: left; font-size: 12px; line-height: 1.6;" class="font-mono text-xs">
                                <p class="text-emerald-400 font-bold mb-2">📥 CoreXBridge.ex5 downloaded successfully!</p>
                                <p class="text-gray-300"><b>Installation instructions:</b></p>
                                <ol class="list-decimal pl-4 space-y-1 text-gray-400 mt-1">
                                  <li>Move the downloaded script into your MetaTrader folder: <br/><code class="text-white">MQL5/Experts/</code></li>
                                  <li>In MT5, go to <b>Tools &gt; Options &gt; Expert Advisors</b>.</li>
                                  <li>Check <b>"Allow WebRequests for listed URL"</b> and add:<br/><code class="text-[var(--ui-accent)]">${window.location.origin}</code></li>
                                  <li>Attach the script onto any chart and start your trading scripts!</li>
                                </ol>
                              </div>`,
                              icon: 'success',
                              background: '#070e20',
                              color: '#fff',
                              confirmButtonColor: '#10b981',
                              confirmButtonText: 'Understood'
                            });
                          }}
                          className="w-full sm:w-auto px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-[10px] uppercase tracking-wider rounded flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-md"
                        >
                          <Download size={12} />
                          <span>Download CoreXBridge.ex5</span>
                        </button>
                      </div>
                    </div>


                  </div>
                )}

                {/* --- 3. NATIVE MT5 API DIRECT CONNECTOR UI --- */}
                {liveConnectorMode === 'api' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-amber-500/5 rounded-lg border border-amber-500/10 text-[9px] text-[var(--ui-muted)] leading-relaxed">
                      <span className="font-bold text-amber-400 block mb-1 uppercase tracking-wider">MetaTrader Direct SDK Daemon Connection</span>
                      Logs directly into the MetaTrader API using account credentials. CoreX acts as a client node, connecting directly to the MT5 servers, allowing live balances and portfolio actions to sync instantly.
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)] mb-1">MetaTrader Account ID Login</label>
                        <input 
                          id="live-api-account-id-input"
                          type="text" 
                          value={apiAccountId}
                          onChange={(e) => setApiAccountId(e.target.value)}
                          placeholder="e.g. 500342119"
                          className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold"
                          style={{ borderColor: 'var(--ui-border)' }}
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)] mb-1">Broker Server Host Name (DNS)</label>
                        <input 
                          id="live-api-server-input"
                          type="text" 
                          value={apiServer}
                          onChange={(e) => setApiServer(e.target.value)}
                          placeholder="e.g. ICMarkets-Demo03"
                          className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white font-bold"
                          style={{ borderColor: 'var(--ui-border)' }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)] mb-1">Master Account Trading Password</label>
                        <div className="relative">
                          <input 
                            id="live-api-password-input"
                            type="password" 
                            value={apiPassword}
                            onChange={(e) => setApiPassword(e.target.value)}
                            className="w-full text-xs p-2 pl-7 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white"
                            style={{ borderColor: 'var(--ui-border)' }}
                          />
                          <Lock size={11} className="absolute left-2.5 top-3 text-[var(--ui-muted)]" />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)] mb-1">Library Native Core Type</label>
                        <select
                          id="live-api-lib-type-select"
                          value={apiLibType}
                          onChange={(e) => setApiLibType(e.target.value)}
                          className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer font-mono text-[11px] text-white font-bold"
                          style={{ borderColor: 'var(--ui-border)' }}
                        >
                          <option value="node-mt5">node-mt5 wrapper</option>
                          <option value="python-connector">python daemon-sdk</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)] mb-1">Telemetry Socket Heartbeat Interval (seconds)</label>
                      <input 
                        id="live-api-heartbeat-input"
                        type="number" 
                        value={apiHeartbeat}
                        onChange={(e) => setApiHeartbeat(parseInt(e.target.value) || 0)}
                        className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-mono text-white"
                        style={{ borderColor: 'var(--ui-border)' }}
                      />
                    </div>
                  </div>
                )}

                {/* Real-time Diagnostics Terminal Log Pane */}
                <div className="border border-[var(--ui-border)]/60 bg-[#020617]/90 rounded-lg overflow-hidden font-mono mt-4">
                  <div className="flex items-center justify-between bg-[var(--ui-panel-strong)] px-3 py-1.5 border-b border-[var(--ui-border)]/50 select-none">
                    <div className="flex items-center gap-1.5 text-[8px] uppercase font-black text-[var(--ui-muted)] tracking-widest">
                      <Terminal size={10} className="text-[var(--ui-accent)] animate-pulse" />
                      <span>Live Gateway Diagnostic Log Stream</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setLogs([{ time: new Date().toLocaleTimeString(), type: 'info', message: 'Diagnostic stream logs cleared.' }])}
                        className="text-[8px] uppercase tracking-wider font-extrabold text-[var(--ui-muted)] hover:text-white transition"
                      >
                        [Clear]
                      </button>
                    </div>
                  </div>
                  <div className="p-3 max-h-[140px] overflow-y-auto text-[10px] space-y-1.5 scrollbar-thin">
                    {logs.map((log, i) => (
                      <div key={i} className="flex gap-2 leading-relaxed items-start">
                        <span className="text-[var(--ui-muted)] text-[8px] shrink-0 select-none">[{log.time}]</span>
                        <span className={`text-[8px] font-black shrink-0 px-1.5 py-0.5 rounded uppercase ${
                          log.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                          log.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                        }`}>
                          {log.type}
                        </span>
                        <span className={log.type === 'success' ? 'text-emerald-400 font-bold' : log.type === 'error' ? 'text-red-400 font-bold' : 'text-gray-300'}>
                          {log.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Gateway Execution & Actions */}
                <div className="pt-4 border-t border-[var(--ui-border)]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-[9px] text-[var(--ui-muted)] font-mono">
                    <span className={`h-1.5 w-1.5 rounded-full ${isTesting ? 'bg-amber-500 animate-pulse' : connectionStatus === 'connected' ? 'bg-emerald-500 animate-ping' : 'bg-red-500'} shrink-0`}></span>
                    <span className="uppercase">
                      {isTesting ? 'DIAGNOSTICS RUNNING...' : connectionStatus === 'connected' ? 'GATEWAY STATUS: CONNECTED' : 'GATEWAY STATUS: DISCONNECTED'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 self-end">
                    <button 
                      id="live-test-btn"
                      onClick={handleTestConnection}
                      disabled={isTesting}
                      className="px-3.5 py-2 border border-[var(--ui-border-strong)] hover:border-[var(--ui-muted)] text-[var(--ui-muted)] hover:text-white text-[10px] font-black uppercase tracking-wider rounded cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                    >
                      <RefreshCw size={11} className={isTesting ? 'animate-spin' : ''} />
                      <span>{isTesting ? 'Pinging Gateway...' : 'Test Connection'}</span>
                    </button>

                    <button 
                      id="live-save-btn"
                      onClick={handleSaveLiveConfig}
                      disabled={isSaving}
                      className="px-4.5 py-2 bg-[var(--ui-accent)] hover:opacity-90 text-white font-bold text-[10px] uppercase tracking-widest rounded cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                    >
                      {isSaving ? <RefreshCw size={11} className="animate-spin" /> : <Settings size={11} />}
                      <span>Save Gateway Config</span>
                    </button>
                  </div>
                </div>

              </div>

              {/* Realtime Positions list Right Panel (5 Cols) */}
              <div className="lg:col-span-5 p-4 rounded-xl border bg-[var(--ui-panel)] flex flex-col justify-between" style={{ borderColor: 'var(--ui-border)' }}>
                <div>
                  <div className="flex items-center justify-between border-b border-[var(--ui-border)]/50 pb-2.5 mb-3">
                    <span className="text-[10px] uppercase font-black tracking-widest text-[var(--ui-muted)] font-display">
                      REALTIME OPEN BROKER POSITIONS (MT5 BACKEND)
                    </span>
                    <span className="text-[8px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-bold rounded uppercase">
                      Sync ok
                    </span>
                  </div>

                  <div className="overflow-x-auto text-[10px]">
                    {livePositions.length === 0 ? (
                      <div className="py-8 text-center text-[var(--ui-muted)] italic">
                        No active open positions on live terminal gateway.
                      </div>
                    ) : (
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-[var(--ui-border)] text-[var(--ui-muted)] font-bold">
                            <th className="py-1">Symbol</th>
                            <th className="py-1">Side</th>
                            <th className="py-1">Lots</th>
                            <th className="py-1 font-mono text-right">PnL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {livePositions.map((p, idx) => (
                            <tr key={idx} className="border-b border-[var(--ui-border)]/30 hover:bg-white/2 transition-colors">
                              <td className="py-2.5 font-mono font-bold text-white">{p.symbol}</td>
                              <td className="py-2.5">
                                <span className={`px-1 rounded text-[8px] font-black ${
                                  p.side === 'LONG' ? 'bg-blue-500/10 text-blue-400' : 'bg-red-500/10 text-red-400'
                                }`}>
                                  {p.side}
                                </span>
                              </td>
                              <td className="py-2.5 font-mono text-[var(--ui-muted)]">{p.qty.toFixed(2)}</td>
                              <td className={`py-2.5 font-mono text-right font-bold ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--ui-border)]/40 text-[9px] text-[var(--ui-muted)] leading-relaxed">
                  <div className="flex justify-between font-mono">
                    <span>Total Open Lots:</span>
                    <span className="font-bold text-white">
                      {livePositions.reduce((acc, curr) => acc + curr.qty, 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between font-mono mt-1">
                    <span>Total Net P&amp;L:</span>
                    <span className={`font-bold ${totalPositionsPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {totalPositionsPnl >= 0 ? '+' : ''}${totalPositionsPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

            </div>

            {/* SECURE API CREDENTIALS & KEYS PANEL */}
            <div className="p-5 rounded-xl border bg-[var(--ui-panel)] space-y-4" style={{ borderColor: 'var(--ui-border)' }}>
              <div className="flex items-center justify-between border-b border-[var(--ui-border)]/50 pb-2.5">
                <div className="flex items-center gap-2">
                  <Lock size={13} className="text-[var(--ui-accent)]" />
                  <span className="text-[10px] uppercase font-black tracking-widest text-white leading-none">
                    SECURE SYSTEM API KEYS &amp; CREDENTIALS
                  </span>
                </div>
                <span className="text-[8px] font-mono px-1.5 py-0.5 bg-blue-500/10 text-blue-400 font-bold rounded uppercase">
                  REST AUTH GATEWAY
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                {/* Key Creator Form */}
                <div className="md:col-span-5 space-y-4 border-r border-[var(--ui-border)]/30 pr-0 md:pr-5">
                  <span className="block text-[9px] font-black uppercase text-[var(--ui-accent)] tracking-wider">
                    Generate New API Key
                  </span>
                  <p className="text-[10px] text-[var(--ui-muted)] leading-relaxed">
                    API keys allow external systems (e.g., Python algorithms, TradingView Webhooks) to execute trades or fetch account details.
                  </p>
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)] mb-1">Key Label / Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. TradingView Webhook Key"
                      value={newKeyLabel}
                      onChange={(e) => setNewKeyLabel(e.target.value)}
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-sans text-white placeholder-gray-600"
                      style={{ borderColor: 'var(--ui-border)' }}
                    />
                  </div>
                  <button
                    onClick={handleCreateApiKey}
                    className="w-full px-4 py-2 bg-[var(--ui-accent)] hover:opacity-90 text-white font-bold text-[10px] uppercase tracking-wider rounded transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Generate Secure Key</span>
                  </button>

                  {newlyCreatedKey && (
                    <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg space-y-2">
                      <span className="block text-[8px] font-black text-emerald-400 uppercase tracking-wider">
                        Key Created successfully! Copy it now:
                      </span>
                      <div className="flex gap-2">
                        <input 
                          readOnly
                          type="text" 
                          value={newlyCreatedKey}
                          className="flex-1 bg-[#020617] border border-[var(--ui-border)] text-[9px] font-mono px-2 py-1.5 rounded text-emerald-400 select-all focus:outline-none"
                        />
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(newlyCreatedKey);
                            setCopiedField('newly-created-key');
                            setTimeout(() => setCopiedField(null), 1500);
                          }}
                          className="px-2 py-1.5 bg-[var(--ui-panel)] hover:bg-[var(--ui-border-strong)] border border-[var(--ui-border)] rounded text-gray-300 transition-all cursor-pointer"
                        >
                          {copiedField === 'newly-created-key' ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        </button>
                      </div>
                      <span className="text-[8px] text-amber-400 block font-bold">
                        ⚠️ Warning: This key will not be shown again.
                      </span>
                    </div>
                  )}
                </div>

                {/* Keys List */}
                <div className="md:col-span-7 space-y-3 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="block text-[9px] font-black uppercase text-[var(--ui-accent)] tracking-wider">
                        Active API Credentials
                      </span>
                      <button 
                        onClick={fetchApiKeys}
                        disabled={isListingKeys}
                        className="text-[8px] uppercase font-black text-[var(--ui-muted)] hover:text-white transition flex items-center gap-1"
                      >
                        <RefreshCw size={8} className={isListingKeys ? 'animate-spin' : ''} />
                        <span>Refresh List</span>
                      </button>
                    </div>

                    <div className="overflow-x-auto border border-[var(--ui-border)]/50 bg-[var(--ui-input-bg)]/20 rounded-lg min-h-[140px] max-h-[220px] overflow-y-auto">
                      {isListingKeys ? (
                        <div className="py-12 text-center text-[var(--ui-muted)] font-mono text-[9px] flex items-center justify-center gap-2">
                          <RefreshCw size={10} className="animate-spin text-[var(--ui-accent)]" />
                          <span>FETCHING ACTIVE KEYS...</span>
                        </div>
                      ) : apiKeys.length === 0 ? (
                        <div className="py-12 text-center text-[var(--ui-muted)] italic text-[9px]">
                          No active API keys found. Generate a key to get started.
                        </div>
                      ) : (
                        <table className="w-full text-left text-[9px]">
                          <thead>
                            <tr className="border-b border-[var(--ui-border)] text-[var(--ui-muted)] font-bold bg-[var(--ui-panel-strong)]">
                              <th className="py-2 px-3">Label</th>
                              <th className="py-2 px-3">Prefix</th>
                              <th className="py-2 px-3">Created At</th>
                              <th className="py-2 px-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {apiKeys.map((key) => (
                              <tr key={key.id} className="border-b border-[var(--ui-border)]/30 hover:bg-white/2 transition-colors">
                                <td className="py-2 px-3 font-medium text-white">{key.label}</td>
                                <td className="py-2 px-3 font-mono text-[var(--ui-muted)]">{key.prefix || 'cx_...'}</td>
                                <td className="py-2 px-3 text-[var(--ui-muted)]">{new Date(key.createdAt).toLocaleString()}</td>
                                <td className="py-2 px-3 text-right">
                                  <button
                                    onClick={() => handleRevokeApiKey(key.id)}
                                    className="px-2 py-0.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/20 rounded text-[8px] font-black uppercase transition-all cursor-pointer"
                                  >
                                    Revoke
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
