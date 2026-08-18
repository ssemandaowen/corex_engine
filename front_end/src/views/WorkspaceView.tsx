import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Square, 
  Settings, 
  HelpCircle, 
  Loader2, 
  Search, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  BarChart, 
  Activity, 
  Sliders, 
  Cpu, 
  TrendingUp, 
  Database,
  Calendar,
  DollarSign,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Clock,
  Terminal,
  ExternalLink
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useDataStore, Strategy } from '../store/dataStore';
import { strategiesApi } from '../api/strategies';
import { runApi } from '../api/run';
import { systemApi } from '../api/system';

export default function WorkspaceView({ 
  onMonitor,
  onBacktestStart
}: { 
  onMonitor?: (id: string) => void;
  onBacktestStart?: (strategyId: string, symbol: string, params: any) => void;
}) {
  const { showToast } = useToast();
  const { strategies, setStrategies, updateStrategyStatus } = useDataStore();

  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Execution modes per strategy ID (defaults to 'PAPER')
  const [rowModes, setRowModes] = useState<Record<string, 'PAPER' | 'LIVE'>>({});
  // Custom symbols per strategy ID (defaults to 'EURUSD')
  const [rowSymbols, setRowSymbols] = useState<Record<string, string>>({});
  // Expanded parameters panel per strategy ID
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  // Edited parameters per strategy ID
  const [rowParams, setRowParams] = useState<Record<string, Record<string, any>>>({});

  // Active runtime instances mapped by strategy ID
  const [activeRuntimes, setActiveRuntimes] = useState<Record<string, any>>({});
  const [allRuntimes, setAllRuntimes] = useState<any[]>([]);

  // LIVE CONNECTOR MODAL
  const [isLiveModalOpen, setIsLiveModalOpen] = useState(false);
  const [selectedLiveStrategyId, setSelectedLiveStrategyId] = useState<string | null>(null);
  const [connectorType, setConnectorType] = useState<'mt5' | 'metaapi'>('mt5');
  const [liveAccountId, setLiveAccountId] = useState('');
  const [liveServer, setLiveServer] = useState('');
  const [liveToken, setLiveToken] = useState('');
  const [livePlatform, setLivePlatform] = useState('MT5');
  const [isSavingConnector, setIsSavingConnector] = useState(false);
  const [connectorSaved, setConnectorSaved] = useState(false);

  // Initial loads and background sync
  const fetchData = async () => {
    try {
      const res = await strategiesApi.list();
      if (res.success) {
        setStrategies(res.payload);
        
        // Populate default values
        const modes: Record<string, 'PAPER' | 'LIVE'> = {};
        const symbols: Record<string, string> = {};
        const params: Record<string, Record<string, any>> = {};
        
        res.payload.forEach((strat: Strategy) => {
          modes[strat.id] = (strat.runtime_params?.mode === 'LIVE' ? 'LIVE' : 'PAPER');
          // Prefer the strategy's own declared symbol universe (from compiled
          // metadata) over the hardcoded 'EURUSD' default — otherwise launching
          // a strategy that only supports e.g. BTC/USD fails with
          // "Symbol 'EURUSD' is not supported".
          symbols[strat.id] = strat.runtime_params?.symbol || strat.symbols?.[0] || 'EURUSD';
          
          // Schema defaults
          const initParams: Record<string, any> = {};
          if (strat.schema) {
            Object.entries(strat.schema).forEach(([key, config]: [string, any]) => {
              initParams[key] = config.default !== undefined ? config.default : '';
            });
          }
          params[strat.id] = { ...initParams, ...strat.runtime_params };
        });

        setRowModes(prev => ({ ...modes, ...prev }));
        setRowSymbols(prev => ({ ...symbols, ...prev }));
        setRowParams(prev => ({ ...params, ...prev }));
      }
    } catch (e) {
      console.error('Failed to load strategies', e);
      showToast('Failed to fetch strategies library', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchActiveRuntimes = async () => {
    try {
      const res = await runApi.getOpsTelemetry();
      if (res && res.success && res.payload && res.payload.runtimes) {
        const runtimesList = res.payload.runtimes || [];
        setAllRuntimes(runtimesList);
        const runtimesMap: Record<string, any> = {};
        runtimesList.forEach((run: any) => {
          // Identify strategy ID
          if (run.strategyId) {
            runtimesMap[run.strategyId] = run;
          } else {
            // fallback search in list
            const matched = strategies.find(s => s.name === run.name || s.name === run.strategyName);
            if (matched) {
              runtimesMap[matched.id] = run;
            }
          }
        });
        setActiveRuntimes(runtimesMap);
      }
    } catch (e) {
      console.error('Failed to sync active runtimes telemetry', e);
    }
  };

  const fetchLiveConnectorSettings = async () => {
    try {
      const res = await systemApi.getAccountSettings('live');
      if (res.success && res.payload) {
        setLiveAccountId(res.payload.accountId || '');
        setLiveServer(res.payload.server || '');
        setLivePlatform(res.payload.platform || 'MT5');
        setLiveToken(res.payload.token || '');
        setConnectorType(res.payload.token ? 'metaapi' : 'mt5');
        setConnectorSaved(true);
      }
    } catch (e) {
      console.error('Failed to load live settings', e);
    }
  };

  useEffect(() => {
    fetchData();
    fetchLiveConnectorSettings();
  }, []);

  useEffect(() => {
    if (strategies.length > 0) {
      fetchActiveRuntimes();
    }
    const timer = setInterval(() => {
      if (!document.hidden && strategies.length > 0) {
        fetchActiveRuntimes();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [strategies]);

  // Open modal for live setup
  const openLiveSettings = (strategyId: string) => {
    setSelectedLiveStrategyId(strategyId);
    setIsLiveModalOpen(true);
  };

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
        showToast('Live connector settings saved and verified', 'success');
        setConnectorSaved(true);
        setIsLiveModalOpen(false);
        
        // If we were about to start a strategy, start it now
        if (selectedLiveStrategyId) {
          triggerStart(selectedLiveStrategyId, 'LIVE');
        }
      } else {
        showToast(res.error || 'Failed to save credentials', 'error');
      }
    } catch (e: any) {
      console.error(e);
      showToast(e.response?.data?.error || 'Failed to sync connector configurations', 'error');
    } finally {
      setIsSavingConnector(false);
    }
  };

  // Dispatch parameters and navigate to backtest lab
  const handleTransportBacktest = (strategyId: string) => {
    const symbol = rowSymbols[strategyId] || 'EURUSD';
    const params = rowParams[strategyId] || {};
    
    showToast('Transporting parameters to Backtest Lab simulation...', 'success');
    if (onBacktestStart) {
      onBacktestStart(strategyId, symbol, params);
    } else {
      localStorage.setItem('corex_backtest_pending', JSON.stringify({ strategyId, symbol, params }));
      window.dispatchEvent(new CustomEvent('corex:navigate', { detail: { tab: 'run' } }));
    }
  };

  // Trigger strategy stop signal
  const handleStop = async (id: string, name: string) => {
    try {
      const res = await runApi.stop(id);
      if (res.success) {
        showToast(`Dispatched halt signal. Thread stopped for '${name}'`, 'warning');
        updateStrategyStatus(id, 'stopped');
        fetchActiveRuntimes();
      } else {
        showToast(res.error || 'Failed to stop execution runtime', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error sending stop signal to container', 'error');
    }
  };

  // Trigger start for Paper or Live modes
  const triggerStart = async (id: string, mode: 'PAPER' | 'LIVE') => {
    const strat = strategies.find(s => s.id === id);
    if (!strat) return;

    // Confinement check: maximum active strategies limit (e.g. max 5 active threads)
    const runningCount = Object.values(activeRuntimes).filter((r: any) => r.status === 'running').length;
    if (runningCount >= 5) {
      showToast('Workspace limit reached. Maximum of 5 concurrent running strategy instances allowed.', 'warning');
      return;
    }

    const symbol = rowSymbols[id] || 'EURUSD';
    const params = rowParams[id] || {};

    try {
      const res = await runApi.start(id, {
        mode,
        symbol,
        params
      });

      if (res.success) {
        updateStrategyStatus(id, 'running');
        showToast(`Core thread active. Running '${strat.name}' in ${mode} mode.`, 'success');
        fetchActiveRuntimes();
      } else {
        showToast(res.error || 'Failed to boot sandbox engine thread', 'error');
      }
    } catch (e: any) {
      console.error(e);
      showToast(e.response?.data?.error || 'Failed to spin up execution runtime', 'error');
    }
  };

  // General Dispatch handler for START button
  const handleStartDispatch = (id: string) => {
    const mode = rowModes[id] || 'PAPER';
    
    if (mode === 'LIVE') {
      if (!connectorSaved) {
        openLiveSettings(id);
      } else {
        triggerStart(id, 'LIVE');
      }
    } else {
      triggerStart(id, 'PAPER');
    }
  };

  // Toggle Row parameter dropdown expander
  const toggleRowExpansion = (id: string) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Filtered strategies list
  const filteredStrategies = strategies.filter(strat => 
    strat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full overflow-hidden select-none bg-[var(--ui-bg)]">
      {/* View Header */}
      <div className="p-4 border-b border-[var(--ui-border)] shrink-0 bg-[#070e20] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-display font-black uppercase tracking-wider text-white flex items-center gap-2">
            <Cpu size={16} className="text-[var(--ui-accent)]" />
            UNIFIED EXECUTION WORKSPACE
          </h2>
          <p className="text-[10px] text-[var(--ui-muted)] uppercase tracking-wider mt-0.5 font-bold">
            Monitor and execute algorithmic strategies across Sandbox and Live Broker connections
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          {/* Quick Search */}
          <div className="relative w-full sm:w-64">
            <Search size={12} className="absolute left-2.5 top-2.5 text-[var(--ui-muted)]" />
            <input 
              type="text"
              placeholder="Filter by strategy name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs py-1.5 pl-8 pr-3 rounded border focus:outline-none bg-[#020617] text-white transition-colors"
              style={{ borderColor: 'var(--ui-border)', fontFamily: 'var(--font-sans)' }}
            />
          </div>

          <button
            onClick={() => {
              setLoading(true);
              fetchData();
              fetchActiveRuntimes();
              fetchLiveConnectorSettings();
            }}
            className="p-1.5 rounded border border-[var(--ui-border)] hover:bg-[var(--ui-panel-soft)] text-white transition-all cursor-pointer flex items-center justify-center active:scale-95 self-end sm:self-auto"
            title="Refresh workspace telemetry"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="h-48 flex flex-col items-center justify-center gap-3">
            <Loader2 className="animate-spin text-[var(--ui-accent)]" size={24} />
            <span className="text-xs text-[var(--ui-muted)] uppercase font-bold tracking-wider">
              Initializing Strategy Execution Registry...
            </span>
          </div>
        ) : filteredStrategies.length === 0 ? (
          <div className="h-48 rounded-xl border border-dashed border-[var(--ui-border)] flex flex-col items-center justify-center text-center p-6">
            <Sliders size={32} className="text-[var(--ui-muted)] mb-3" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              No strategy templates found
            </h3>
            <p className="text-[10px] text-[var(--ui-muted)] max-w-sm mt-1">
              {searchQuery ? "No results match your active workspace query filter." : "Get started by compiling or creating a strategy script inside the Strategy Library first."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredStrategies.map((strat) => {
              const stratRuntimes = allRuntimes.filter(r => r.strategyId === strat.id || r.name === strat.name || r.strategyName === strat.name);
              const isUsed = stratRuntimes.length > 0;
              const isExpanded = !!expandedRows[strat.id];
              const activeMode = rowModes[strat.id] || 'PAPER';
              const activeSymbol = rowSymbols[strat.id] || 'EURUSD';

              // Calculate combined real-time P&L for all active instances of this strategy
              const combinedPnl = stratRuntimes.reduce((sum, run) => {
                const p = run.pnl !== undefined ? run.pnl : (run.unrealizedPnl !== undefined ? run.unrealizedPnl : 0);
                return sum + p;
              }, 0);

              return (
                <div 
                  key={strat.id} 
                  className="border rounded-xl bg-[#070e20] shadow-lg overflow-hidden transition-all duration-300 group"
                  style={{ 
                    borderColor: isExpanded 
                      ? 'var(--ui-accent)' 
                      : isUsed 
                        ? 'rgba(16, 185, 129, 0.4)' 
                        : 'var(--ui-border)',
                    boxShadow: isExpanded ? '0 0 15px rgba(30, 144, 255, 0.15)' : 'none'
                  }}
                >
                  {/* --- PARENT SLOT HEADER RACK --- */}
                  <div 
                    onClick={() => toggleRowExpansion(strat.id)}
                    className="relative flex flex-col lg:flex-row items-stretch lg:items-center justify-between p-4 cursor-pointer hover:bg-slate-900/40 transition-all gap-4 select-none"
                  >
                    {/* Left Active/Idle Accent Strip */}
                    <div 
                      className="absolute left-0 top-0 bottom-0 w-1 transition-all duration-300" 
                      style={{ 
                        backgroundColor: isExpanded 
                          ? 'var(--ui-accent)' 
                          : isUsed 
                            ? 'var(--ui-positive)' 
                            : 'rgba(255, 255, 255, 0.15)' 
                      }}
                    />

                    {/* Left side info block */}
                    <div className="flex items-center gap-3.5 pl-2 min-w-0 flex-1">
                      <div className="p-1.5 rounded-lg bg-[#020617] border border-[var(--ui-border)]/60 text-[var(--ui-muted)] group-hover:text-white transition-colors shrink-0">
                        <ChevronDown 
                          size={15} 
                          className={`transition-transform duration-300 ${isExpanded ? 'rotate-180 text-[var(--ui-accent)]' : ''}`} 
                        />
                      </div>
                      
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <h3 className="font-display font-black text-xs md:text-sm text-white tracking-wide truncate uppercase">
                            {strat.name}
                          </h3>
                          <span className={`text-[8px] font-sans font-black px-2 py-0.5 rounded border tracking-wider transition-all duration-300 ${
                            isUsed 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                              : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                          }`}>
                            {isUsed ? 'ACTIVE RUNTIME' : 'IDLE SLOT'}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2 mt-1 font-mono text-[9px] text-[var(--ui-muted)] flex-wrap">
                          <span className="text-[var(--ui-accent)] font-semibold">REF // {strat.id.slice(0, 8).toUpperCase()}</span>
                          <span>•</span>
                          <span>UPDATED: {new Date(strat.updatedAt).toLocaleTimeString()}</span>
                          {strat.schema && (
                            <>
                              <span>•</span>
                              <span>PARAMS: {Object.keys(strat.schema).length} MATRIX</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right side stats metadata */}
                    <div className="flex items-center gap-4 text-xs font-mono shrink-0 pl-2 lg:pl-0 border-l lg:border-l-0 border-[var(--ui-border)]/30">
                      <div className="flex flex-col items-start lg:items-end gap-0.5">
                        <span className="text-[9px] text-[var(--ui-muted)] uppercase tracking-wider font-bold">Threads Slot Count</span>
                        <span className="text-[11px] font-black text-white">
                          [ <span className={isUsed ? "text-[var(--ui-positive)]" : "text-slate-500"}>{stratRuntimes.length} Active</span> ]
                        </span>
                      </div>

                      {isUsed && (
                        <div className="flex flex-col items-start lg:items-end gap-0.5 border-l border-[var(--ui-border)]/30 pl-4">
                          <span className="text-[9px] text-[var(--ui-muted)] uppercase tracking-wider font-bold">Combined Float P&amp;L</span>
                          <span className={`text-[11px] font-black font-mono px-2 py-0.5 rounded ${
                            combinedPnl >= 0 
                              ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.08)]' 
                              : 'text-red-400 bg-red-500/10 border border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.08)]'
                          }`}>
                            {combinedPnl >= 0 ? '+' : ''}${combinedPnl.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* --- CHILD SUBSLOTS PANEL --- */}
                  {isExpanded && (
                    <div className="border-t border-[var(--ui-border)] bg-[#020617]/70 p-4 space-y-5 transition-all duration-300">
                      
                      {/* Active Subslots Section */}
                      <div>
                        <div className="flex items-center justify-between mb-3.5">
                          <span className="text-[9px] font-black uppercase tracking-widest text-[var(--ui-muted)] flex items-center gap-1.5">
                            <Terminal size={10} className="text-[var(--ui-accent)]" />
                            Active Engine Instance Threads (Nested Subslots)
                          </span>
                          <span className="text-[9px] font-mono text-[var(--ui-muted)]">
                            Active allocation limit: 1 Strategy / 5 Instances
                          </span>
                        </div>

                        {isUsed ? (
                          <div className="space-y-2">
                            {stratRuntimes.map((runtime, idx) => {
                              const rStatus = (runtime.status || 'running').toLowerCase();
                              const rPnl = runtime.pnl !== undefined ? runtime.pnl : (runtime.unrealizedPnl !== undefined ? runtime.unrealizedPnl : 0);
                              const rSide = runtime.positionSnapshot?.side || runtime.side || 'FLAT';
                              const rQty = runtime.positionSnapshot?.qty || runtime.qty || 0;
                              const rEntry = runtime.positionSnapshot?.entryPrice || runtime.entryPrice || 0;
                              
                              return (
                                <div 
                                  key={runtime.id || idx} 
                                  className="p-3 rounded-lg border bg-[#070e20]/90 border-[var(--ui-border)]/50 hover:border-[var(--ui-border-strong)] transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3 group/row"
                                >
                                  {/* Thread ID & Mode & Symbol */}
                                  <div className="flex items-center gap-3 min-w-0">
                                    <span className="text-[9px] font-mono font-black text-[var(--ui-muted)] bg-[#020617] px-2 py-1 rounded border border-[var(--ui-border)]/40 shrink-0">
                                      T#{String(idx + 1).padStart(2, '0')}
                                    </span>

                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`text-[8px] font-black font-sans px-1.5 py-0.5 rounded border tracking-wider uppercase shrink-0 ${
                                          runtime.mode === 'LIVE' 
                                            ? 'bg-amber-500/15 border-amber-500/25 text-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.05)]' 
                                            : 'bg-blue-500/15 border-blue-500/25 text-blue-400'
                                        }`}>
                                          {runtime.mode}
                                        </span>
                                        <span className="text-xs font-mono font-black text-white tracking-widest uppercase">
                                          {runtime.symbol}
                                        </span>
                                        <div className="flex items-center gap-1">
                                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                          <span className="text-[9px] font-bold text-emerald-400 uppercase font-sans">
                                            {rStatus}
                                          </span>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2 mt-1 font-mono text-[9px] text-[var(--ui-muted)] flex-wrap">
                                        <span>UPTIME: {runtime.uptime || '00:14:42'}</span>
                                        <span>•</span>
                                        <span>LATENCY: {runtime.latency || '24'}ms</span>
                                        <span>•</span>
                                        <span>ID: {runtime.id ? runtime.id.slice(0, 10) : 'N/A'}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Position Snapshot & Float P&L */}
                                  <div className="flex items-center gap-4 font-mono text-xs w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-2.5 md:pt-0 border-[var(--ui-border)]/20">
                                    <div className="flex flex-col items-start md:items-end gap-0.5">
                                      <span className="text-[8px] uppercase font-bold text-[var(--ui-muted)] tracking-wider">Position side</span>
                                      <div className="flex items-center gap-1.5">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                          rSide === 'LONG' 
                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                            : rSide === 'SHORT' 
                                              ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                                              : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                        }`}>
                                          {rSide}
                                        </span>
                                        {rQty > 0 && (
                                          <span className="text-[10px] text-white font-medium">
                                            {rQty.toFixed(2)} Lots @ {rEntry.toFixed(5)}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex flex-col items-start md:items-end gap-0.5 border-l border-[var(--ui-border)]/30 pl-4">
                                      <span className="text-[8px] uppercase font-bold text-[var(--ui-muted)] tracking-wider">Unrealized profit</span>
                                      <span className={`text-xs font-black tracking-wide ${rPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {rPnl >= 0 ? '▲' : '▼'} {rPnl >= 0 ? '+' : ''}${rPnl.toFixed(2)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Thread Control Operations */}
                                  <div className="flex items-center gap-1.5 shrink-0 w-full md:w-auto mt-2 md:mt-0 pt-2 md:pt-0 border-t md:border-t-0 border-[var(--ui-border)]/20">
                                    {onMonitor && (
                                      <button
                                        onClick={() => onMonitor(runtime.id || runtime.runtimeId)}
                                        className="flex-1 md:flex-none px-2.5 py-1.5 rounded text-[9px] font-black uppercase tracking-wider bg-[var(--ui-accent)] hover:opacity-90 text-white transition-all cursor-pointer flex items-center justify-center gap-1 active:scale-95 shadow-sm"
                                        title="Monitor active charting data and logs feed"
                                      >
                                        <Activity size={10} />
                                        <span>Monitor</span>
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleStop(runtime.id || runtime.runtimeId, `${strat.name} [T#${idx + 1}]`)}
                                      className="flex-1 md:flex-none px-2.5 py-1.5 rounded text-[9px] font-black uppercase tracking-wider bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 transition-all cursor-pointer flex items-center justify-center gap-1 active:scale-95"
                                      title="Dispatch emergency stop signal to strategy container"
                                    >
                                      <Square size={10} className="fill-red-400" />
                                      <span>Stop Thread</span>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-4 text-center border border-dashed border-[var(--ui-border)]/40 rounded-xl text-[10px] text-[var(--ui-muted)] italic font-mono bg-black/10">
                            NO ACTIVE RUNNING THREADS DETECTED IN THIS STRATEGY SLOT
                          </div>
                        )}
                      </div>

                      {/* Horizontal Separator */}
                      <div className="border-t border-[var(--ui-border)]/50 my-1" />

                      {/* Provisioning Console */}
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-1">
                        
                        {/* Provision New Thread */}
                        <div className="lg:col-span-1 space-y-4 pr-0 lg:pr-5 lg:border-r border-[var(--ui-border)]/40 flex flex-col justify-between">
                          <div>
                            <span className="text-[9px] font-black uppercase tracking-widest text-[var(--ui-muted)] block mb-3.5">
                              PROVISION NEW THREAD
                            </span>

                            <div className="space-y-3.5">
                              <div>
                                <label className="text-[9px] text-[var(--ui-muted)] uppercase tracking-wider font-bold block mb-1.5">Execution Environment</label>
                                <div className="flex items-center rounded border border-[var(--ui-border)] bg-[#020617] p-0.5 w-full">
                                  <button
                                    onClick={() => setRowModes(prev => ({ ...prev, [strat.id]: 'PAPER' }))}
                                    className={`flex-1 py-1 rounded text-[9px] font-sans font-black uppercase tracking-wider transition-all cursor-pointer text-center ${activeMode === 'PAPER' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20 shadow-[0_0_8px_rgba(59,130,246,0.08)]' : 'text-[var(--ui-muted)] hover:text-slate-300'}`}
                                  >
                                    Sandbox (Paper)
                                  </button>
                                  <button
                                    onClick={() => setRowModes(prev => ({ ...prev, [strat.id]: 'LIVE' }))}
                                    className={`flex-1 py-1 rounded text-[9px] font-sans font-black uppercase tracking-wider transition-all cursor-pointer text-center ${activeMode === 'LIVE' ? 'bg-amber-500/15 text-amber-500 border border-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.08)]' : 'text-[var(--ui-muted)] hover:text-slate-300'}`}
                                  >
                                    Live Broker
                                  </button>
                                </div>
                              </div>

                              <div>
                                <label className="text-[9px] text-[var(--ui-muted)] uppercase tracking-wider font-bold block mb-1.5">Target Symbol Ticker</label>
                                <div className="flex items-center gap-1.5 bg-[#020617] px-2.5 py-1.5 rounded border border-[var(--ui-border)] w-full">
                                  <input 
                                    type="text"
                                    value={activeSymbol}
                                    onChange={(e) => setRowSymbols(prev => ({ ...prev, [strat.id]: e.target.value.toUpperCase() }))}
                                    placeholder="EURUSD"
                                    className="w-full text-xs font-mono font-black uppercase bg-transparent text-white focus:outline-none"
                                  />
                                </div>
                              </div>

                              {activeMode === 'LIVE' && (
                                <div>
                                  <label className="text-[9px] text-[var(--ui-muted)] uppercase tracking-wider font-bold block mb-1.5">Live Connection Credentials</label>
                                  <button
                                    onClick={() => openLiveSettings(strat.id)}
                                    className={`w-full py-1.5 rounded text-[10px] font-bold uppercase tracking-wide border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${connectorSaved ? "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20" : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"}`}
                                  >
                                    <Settings size={11} className={connectorSaved ? "" : "animate-spin"} />
                                    <span>{connectorSaved ? 'Broker Connection Valid' : 'Connect Account Now'}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="pt-4 space-y-2 mt-4 lg:mt-0">
                            <button
                              onClick={() => handleStartDispatch(strat.id)}
                              className={`w-full py-2.5 rounded text-[10px] font-black uppercase tracking-widest border transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-[0.98] shadow-md ${activeMode === 'LIVE' ? "bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25" : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"}`}
                            >
                              <Play size={11} className="fill-current" />
                              <span>
                                {activeMode === 'LIVE' ? 'Deploy Live Thread' : 'Boot Sandbox Instance'}
                              </span>
                            </button>

                            <button
                              onClick={() => handleTransportBacktest(strat.id)}
                              className="w-full py-2 bg-violet-600/10 hover:bg-violet-600/20 border border-violet-500/20 text-violet-400 text-[10px] font-black uppercase tracking-wider rounded flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] transition-all"
                              title="Send parameter set to Backtest report simulation panel"
                            >
                              <TrendingUp size={11} />
                              <span>Run Backtest in Lab ↗</span>
                            </button>
                          </div>
                        </div>

                        {/* Parameter Matrix Matrix */}
                        <div className="lg:col-span-2 space-y-4">
                          <span className="text-[9px] font-black uppercase tracking-widest text-[var(--ui-muted)] block">
                            STRATEGY RUNTIME PARAMETER MATRIX
                          </span>

                          {strat.schema && Object.keys(strat.schema).length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-1">
                              {Object.entries(strat.schema).map(([key, config]: [string, any]) => {
                                const val = (rowParams[strat.id] || {})[key];
                                const isNumeric = config.type === 'number' || config.type === 'integer';
                                const isBoolean = config.type === 'boolean';

                                return (
                                  <div key={key} className="p-3 rounded border border-[var(--ui-border)]/45 bg-[#070e20] flex flex-col justify-between min-h-[85px] hover:border-[var(--ui-border)]/80 transition-colors">
                                    <div className="flex flex-col">
                                      <span className="text-[10px] font-bold text-slate-300 font-mono tracking-wide">{key}</span>
                                      <span className="text-[9px] text-[var(--ui-muted)] leading-tight mt-0.5">{config.description || 'Custom strategy config.'}</span>
                                    </div>

                                    <div className="mt-3">
                                      {isBoolean ? (
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => {
                                              setRowParams(prev => {
                                                const sParams = prev[strat.id] || {};
                                                return {
                                                  ...prev,
                                                  [strat.id]: { ...sParams, [key]: !val }
                                                };
                                              });
                                            }}
                                            className="w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer"
                                            style={{
                                              backgroundColor: val ? 'var(--ui-accent)' : 'var(--ui-border)'
                                            }}
                                          >
                                            <div 
                                              className="w-3 h-3 rounded-full bg-white transition-transform duration-200"
                                              style={{
                                                transform: val ? 'translateX(16px)' : 'translateX(0)'
                                              }}
                                            />
                                          </button>
                                          <span className="text-[9px] font-mono text-[var(--ui-muted)] uppercase">
                                            {val ? 'TRUE' : 'FALSE'}
                                          </span>
                                        </div>
                                      ) : (
                                        <input 
                                          type={isNumeric ? "number" : "text"}
                                          step={config.type === 'number' ? "0.01" : "1"}
                                          value={val !== undefined ? val : ''}
                                          onChange={(e) => {
                                            const raw = e.target.value;
                                            const parsed = isNumeric ? parseFloat(raw) : raw;
                                            setRowParams(prev => {
                                              const sParams = prev[strat.id] || {};
                                              return {
                                                ...prev,
                                                [strat.id]: { ...sParams, [key]: isNaN(parsed as any) ? raw : parsed }
                                              };
                                            });
                                          }}
                                          className="w-full text-xs p-1.5 rounded border focus:outline-none bg-[#020617] border-[var(--ui-border)] text-white font-mono"
                                        />
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="p-8 rounded-xl border border-dashed border-[var(--ui-border)]/40 bg-black/15 flex flex-col items-center justify-center text-center">
                              <Database size={16} className="text-[var(--ui-muted)] mb-1" />
                              <span className="text-[9px] uppercase font-bold text-[var(--ui-muted)] font-mono">No configurable parameter matrix schema</span>
                              <p className="text-[9px] text-[var(--ui-muted)] mt-1 max-w-xs leading-normal">Use a defineSchema() block inside strategy script code to register parameter controls dynamically.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL: LIVE ACCOUNT INTEGRATION SETUP */}
      {isLiveModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md bg-[#0a0f1d] border border-amber-500/20 rounded-xl overflow-hidden shadow-2xl relative flex flex-col">
            <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500/40" />

            <div className="p-4 border-b border-[var(--ui-border)] bg-slate-900/40 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-xs font-display font-black uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
                  <Settings size={14} className="text-amber-500" />
                  MetaTrader 5 LIVE CONNECT Gateway
                </h3>
                <span className="text-[9px] text-[var(--ui-muted)] uppercase tracking-wider font-semibold block mt-0.5">
                  Configure high-performance secure live-tick feed bridge credentials
                </span>
              </div>
              <button 
                onClick={() => setIsLiveModalOpen(false)}
                className="text-[var(--ui-muted)] hover:text-white font-mono text-xs cursor-pointer p-1"
                disabled={isSavingConnector}
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="flex rounded border border-[var(--ui-border)] bg-[#020617] p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setConnectorType('mt5')}
                  className={`flex-1 py-1 text-[9px] font-black uppercase rounded transition-all cursor-pointer ${connectorType === 'mt5' ? "bg-amber-500/15 text-amber-500 border border-amber-500/20" : "text-[var(--ui-muted)] hover:text-white"}`}
                >
                  Direct MT5 Server
                </button>
                <button
                  type="button"
                  onClick={() => setConnectorType('metaapi')}
                  className={`flex-1 py-1 text-[9px] font-black uppercase rounded transition-all cursor-pointer ${connectorType === 'metaapi' ? "bg-amber-500/15 text-amber-500 border border-amber-500/20" : "text-[var(--ui-muted)] hover:text-white"}`}
                >
                  MetaAPI Cloud API
                </button>
              </div>

              <div className="space-y-3.5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-sans font-bold uppercase tracking-widest text-[var(--ui-muted)]">
                    Broker MT5 Account ID
                  </label>
                  <input
                    type="text"
                    value={liveAccountId}
                    onChange={(e) => setLiveAccountId(e.target.value)}
                    placeholder="Enter terminal login credential ID..."
                    className="w-full text-xs p-2 rounded border focus:outline-none bg-slate-900 border-[var(--ui-border)] text-white font-mono font-bold"
                  />
                </div>

                {connectorType === 'mt5' ? (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-sans font-bold uppercase tracking-widest text-[var(--ui-muted)]">
                      Broker Server Name
                    </label>
                    <input
                      type="text"
                      value={liveServer}
                      onChange={(e) => setLiveServer(e.target.value)}
                      placeholder="e.g. MetaQuotes-Demo, IC-Markets-Live..."
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-slate-900 border-[var(--ui-border)] text-white font-mono"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-sans font-bold uppercase tracking-widest text-[var(--ui-muted)]">
                      MetaAPI Auth Token
                    </label>
                    <input
                      type="password"
                      value={liveToken}
                      onChange={(e) => setLiveToken(e.target.value)}
                      placeholder="Paste your API security token..."
                      className="w-full text-xs p-2 rounded border focus:outline-none bg-slate-900 border-[var(--ui-border)] text-white font-mono"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 bg-slate-950 border-t border-[var(--ui-border)] flex items-center justify-end gap-2.5 shrink-0">
              <button
                onClick={() => setIsLiveModalOpen(false)}
                className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide bg-[var(--ui-panel-soft)] text-white hover:bg-slate-800 transition-all cursor-pointer"
                disabled={isSavingConnector}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveConnector}
                disabled={isSavingConnector}
                className="px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-500 transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isSavingConnector ? <Loader2 className="animate-spin" size={12} /> : null}
                <span>Verify &amp; Save Connector</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
