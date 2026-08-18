import React, { useState, useEffect } from 'react';
import BacktestSubTab from '../components/run/BacktestSubTab';
import MonitorSubTab from '../components/run/MonitorSubTab';
import RuntimesSubTab from '../components/run/RuntimesSubTab';
import LiveBridgeSubTab from '../components/run/LiveBridgeSubTab';
import WorkspaceView from './WorkspaceView';
import { useToast } from '../context/ToastContext';
import { useDataStore } from '../store/dataStore';
import { useUiStore } from '../store/uiStore';
import { runApi } from '../api/run';
import { strategiesApi } from '../api/strategies';
import { systemApi } from '../api/system';
import { 
  Play, 
  Square,
  Activity,
  Cpu,
  Sparkles,
  RefreshCw,
  Eye,
  Layers,
  Search,
  CheckCircle2,
  AlertCircle,
  Settings2,
  Check,
  History,
  Compass,
  ChevronDown
} from 'lucide-react';

interface RuntimeInstance {
  id: string;
  name: string;
  symbol: string;
  mode: 'PAPER' | 'LIVE';
  status: 'running' | 'stopped' | 'error';
  position: 'LONG' | 'SHORT' | 'FLAT';
  unrealizedPnl: number;
  uptime: string;
}

export default function RunView() {
  const { showToast } = useToast();
  const { strategies, setStrategies, updateStrategyStatus } = useDataStore();
  const { engineStatus } = useUiStore();

  const [activeTab, setActiveTab] = useState<'workspace' | 'backtest' | 'monitor'>('workspace');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [monitoredId, setMonitoredId] = useState<string | null>(null);

  // Workspace states
  const [selectedStratId, setSelectedStratId] = useState<string>('');
  const [launchSymbol, setLaunchSymbol] = useState('EURUSD');
  const [launchMode, setLaunchMode] = useState<'PAPER' | 'LIVE'>('PAPER');
  const [launchParams, setLaunchParams] = useState<Record<string, any>>({});
  const [timeframe, setTimeframe] = useState('15m');
  const [isDeploying, setIsDeploying] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Active runtimes tracked via backend telemetry
  const [activeRuntimes, setActiveRuntimes] = useState<RuntimeInstance[]>([]);
  const [loadingRuntimes, setLoadingRuntimes] = useState(false);

  // Live Connector Credentials Settings (Inline Live mode settings)
  const [connectorType, setConnectorType] = useState<'mt5' | 'metaapi'>('mt5');
  const [liveAccountId, setLiveAccountId] = useState('');
  const [liveServer, setLiveServer] = useState('');
  const [livePlatform, setLivePlatform] = useState('MT5');
  const [liveToken, setLiveToken] = useState('');
  const [isSavingConnector, setIsSavingConnector] = useState(false);
  const [connectorSaved, setConnectorSaved] = useState(false);

  // Sync strategies from database
  const syncStrategies = async () => {
    try {
      const res = await strategiesApi.list();
      if (res.success) {
        setStrategies(res.payload);
        if (res.payload.length > 0 && !selectedStratId) {
          setSelectedStratId(res.payload[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to sync strategies in RunView workspace', err);
    }
  };

  // Sync live runtime instances telemetry
  const fetchActiveRuntimes = async () => {
    try {
      const res = await runApi.getOpsTelemetry();
      if (res.success) {
        const rawList = res.payload.runtimes || [];
        const mapped = rawList.map((r: any) => ({
          id: r.id,
          name: r.name || r.strategyName || 'Unnamed Strategy',
          symbol: r.symbol || 'EURUSD',
          mode: r.mode || 'PAPER',
          status: (r.status || 'running').toLowerCase() as any,
          position: r.position?.side || 'FLAT',
          unrealizedPnl: r.pnl !== undefined ? r.pnl : (r.position?.unrealizedPnl || 0),
          uptime: typeof r.uptime === 'number' ? `${r.uptime}s` : (r.uptime || '4h 12m')
        }));
        setActiveRuntimes(mapped);
      }
    } catch (e) {
      console.error('Failed to fetch runtime telemetry', e);
    }
  };

  // Sync Live Connection Settings
  const fetchLiveConnectorSettings = async () => {
    try {
      const res = await systemApi.getAccountSettings('live');
      if (res.success && res.payload) {
        setLiveAccountId(res.payload.accountId || '');
        setLiveServer(res.payload.server || '');
        setLivePlatform(res.payload.platform || 'MT5');
        setLiveToken(res.payload.token || '');
        if (res.payload.token) {
          setConnectorType('metaapi');
        } else {
          setConnectorType('mt5');
        }
        setConnectorSaved(true);
      }
    } catch (e) {
      console.error('Failed to load connector credentials settings', e);
    }
  };

  useEffect(() => {
    setLoadingRuntimes(true);
    Promise.all([
      syncStrategies(),
      fetchActiveRuntimes(),
      fetchLiveConnectorSettings()
    ]).finally(() => setLoadingRuntimes(false));

    // Dynamic telemetry updates
    const timer = setInterval(() => {
      if (!document.hidden) {
        fetchActiveRuntimes();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  // Update selected strategy parameter controls on load
  useEffect(() => {
    if (strategies.length > 0 && selectedStratId) {
      const strat = strategies.find(s => s.id === selectedStratId);
      if (strat && strat.schema) {
        const initialParams: Record<string, any> = {};
        Object.entries(strat.schema).forEach(([key, config]: [string, any]) => {
          initialParams[key] = config.default !== undefined ? config.default : '';
        });
        setLaunchParams(initialParams);
      } else {
        setLaunchParams({});
      }
    }
  }, [selectedStratId, strategies]);

  // Handle saving live connector config
  const handleSaveConnector = async () => {
    setIsSavingConnector(true);
    try {
      const payload: Record<string, any> = {
        accountId: liveAccountId,
        platform: livePlatform
      };
      if (connectorType === 'mt5') {
        payload.server = liveServer;
      } else {
        payload.token = liveToken;
      }

      const res = await systemApi.patchAccountSettings('live', payload);
      if (res.success) {
        showToast('Successfully verified and updated live exchange connector configuration', 'success');
        setConnectorSaved(true);
        fetchLiveConnectorSettings();
      } else {
        showToast(res.error || 'Failed to update live credentials', 'error');
      }
    } catch (e: any) {
      console.error(e);
      showToast(e.response?.data?.error || 'Failed to update live credentials', 'error');
    } finally {
      setIsSavingConnector(false);
    }
  };

  // Launch Active Runtime Thread (Paper or Live)
  const handleStartRuntime = async () => {
    if (!selectedStratId) {
      showToast('Select a strategy from the directory to start', 'warning');
      return;
    }
    const currentStrat = strategies.find(s => s.id === selectedStratId);
    if (!currentStrat) return;

    if (launchMode === 'LIVE' && !connectorSaved) {
      showToast('Please save and verify live exchange connector credentials first', 'warning');
      return;
    }

    setIsDeploying(true);
    try {
      const payload = {
        mode: launchMode,
        symbol: launchSymbol,
        timeframe: timeframe,
        params: launchParams
      };
      const res = await runApi.start(selectedStratId, payload);
      if (res.success) {
        showToast(`Successfully booted active runtime engine thread for '${currentStrat.name}'`, 'success');
        updateStrategyStatus(selectedStratId, 'running');
        fetchActiveRuntimes();
      } else {
        showToast(res.error || 'Failed to boot sandbox engine thread', 'error');
      }
    } catch (e: any) {
      console.error(e);
      showToast(e.response?.data?.error || 'Failed to start execution instance', 'error');
    } finally {
      setIsDeploying(false);
    }
  };

  // Halt Active Runtime Connection
  const handleStopRuntime = async (id: string, name: string) => {
    try {
      const res = await runApi.stop(id);
      if (res.success) {
        showToast(`Halted sandbox container thread for '${name}'`, 'warning');
        updateStrategyStatus(id, 'stopped');
        fetchActiveRuntimes();
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to dispatch stop command signal', 'error');
    }
  };

  const handleMonitorRedirect = (id: string) => {
    setMonitoredId(id);
    setActiveTab('monitor');
  };

  const selectedStrat = strategies.find(s => s.id === selectedStratId);
  const activeRuntime = activeRuntimes.find(r => r.id === selectedStratId);

  // Filter strategies list based on query
  const filteredStrategies = strategies.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[var(--ui-bg)] select-none">
      {/* Top navigation tabs bar */}
      <div 
        className="flex items-center px-3 sm:px-4 h-11 border-b shrink-0 justify-between"
        style={{ borderColor: 'var(--ui-border)', backgroundColor: 'var(--ui-panel-strong)' }}
      >
        {/* Responsive Mobile Tab Selector (Popup Menu) */}
        <div className="relative md:hidden shrink-0 z-30">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-2 px-2.5 py-1 rounded border border-[var(--ui-border)] bg-[var(--ui-panel-soft)] text-white text-[10px] font-black uppercase tracking-wider cursor-pointer select-none active:scale-95"
          >
            {activeTab === 'workspace' && <><Layers size={11} className="text-[var(--ui-accent)]" /> WORKSPACE CONTROL</>}
            {activeTab === 'backtest' && <><History size={11} className="text-[var(--ui-accent)]" /> BACKTEST LAB</>}
            {activeTab === 'monitor' && <><Activity size={11} className="text-[var(--ui-accent)]" /> WORKSTATION MONITOR</>}
            <ChevronDown size={13} className={`text-[var(--ui-muted)] transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          
          {isDropdownOpen && (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 z-40" onClick={() => setIsDropdownOpen(false)} />
              <div 
                className="absolute left-0 mt-1 w-56 rounded-lg border border-[var(--ui-border)] bg-[#070e20] shadow-2xl z-50 py-1"
              >
                {[
                  { id: 'workspace', label: 'Workspace Control', icon: Layers },
                  { id: 'backtest', label: 'Backtest Lab', icon: History },
                  { id: 'monitor', label: 'Workstation Monitor', icon: Activity },
                ].map((item) => {
                  const IconComp = item.icon;
                  const isSelected = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id as any);
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[10px] uppercase tracking-wider font-bold transition-all cursor-pointer ${
                        isSelected 
                          ? 'bg-[var(--ui-accent)]/10 text-white border-l-2 border-[var(--ui-accent)]' 
                          : 'text-[var(--ui-muted)] hover:text-white hover:bg-white/5 border-l-2 border-transparent'
                      }`}
                    >
                      <IconComp size={11} className={isSelected ? 'text-[var(--ui-accent)]' : ''} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Desktop Navigation Tabs */}
        <div className="hidden md:flex gap-1.5 h-full items-center shrink-0">
          {[
            { id: 'workspace', label: 'WORKSPACE CONTROL', icon: Layers },
            { id: 'backtest', label: 'BACKTEST LAB', icon: History },
            { id: 'monitor', label: 'WORKSTATION MONITOR', icon: Activity },
          ].map((item) => {
            const IconComp = item.icon;
            const isSelected = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`flex items-center gap-1.5 h-full px-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
                  isSelected 
                    ? 'border-[var(--ui-accent)] text-white' 
                    : 'border-transparent text-[var(--ui-muted)] hover:text-white'
                }`}
              >
                <IconComp size={11} className={isSelected ? 'text-[var(--ui-accent)]' : ''} />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Global connection status dot */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] font-mono text-[var(--ui-muted)] uppercase tracking-wider hidden sm:inline">
            Engine State:
          </span>
          <div 
            className="flex items-center gap-1.5 border px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: engineStatus === 'STABLE' ? 'rgba(16,185,129,0.1)' : engineStatus === 'DEGRADED' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
              borderColor: engineStatus === 'STABLE' ? 'rgba(16,185,129,0.2)' : engineStatus === 'DEGRADED' ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)'
            }}
          >
            <span 
              className="h-1.5 w-1.5 rounded-full animate-pulse"
              style={{ 
                backgroundColor: engineStatus === 'STABLE' ? 'var(--ui-positive)' : engineStatus === 'DEGRADED' ? 'var(--ui-warning)' : 'var(--ui-negative)'
              }}
            />
            <span 
              className="text-[9px] font-black font-mono"
              style={{ 
                color: engineStatus === 'STABLE' ? 'var(--ui-positive)' : engineStatus === 'DEGRADED' ? 'var(--ui-warning)' : 'var(--ui-negative)'
              }}
            >
              {engineStatus}
            </span>
          </div>
        </div>
      </div>

      {/* Main Tab View Contents */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        
        {/* 1. WORKSPACE TAB */}
        {activeTab === 'workspace' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
            <WorkspaceView 
              onMonitor={handleMonitorRedirect} 
              onBacktestStart={(strategyId, symbol, params) => {
                localStorage.setItem('corex_backtest_pending', JSON.stringify({ strategyId, symbol, params }));
                setActiveTab('backtest');
              }}
            />
          </div>
        )}

        {/* 2. BACKTEST LAB TAB */}
        {activeTab === 'backtest' && (
          <BacktestSubTab />
        )}

        {/* 3. WORKSTATION MONITOR TAB */}
        {activeTab === 'monitor' && (
          <MonitorSubTab initialRuntimeId={monitoredId} />
        )}

      </div>
    </div>
  );
}
