
import React, { useState, useEffect } from 'react';
import { runApi } from '../../api/run';
import { strategiesApi } from '../../api/strategies';
import { useToast } from '../../context/ToastContext';
import { useDataStore } from '../../store/dataStore';
import { 
  Search, 
  Play, 
  Square, 
  Terminal, 
  Eye, 
  RefreshCw,
  Cpu,
  Database,
  Shield,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Layers
} from 'lucide-react';

interface RuntimeInstance {
  id: string;
  name: string;
  symbol: string;
  mode: 'PAPER' | 'LIVE' | 'BACKTEST';
  status: 'running' | 'stopped' | 'error';
  position: 'LONG' | 'SHORT' | 'FLAT';
  unrealizedPnl: number;
  equity: number;
  dailyChangePct: number;
  uptime: string;
  lastBarTime: string;
}

interface RuntimesSubTabProps {
  onMonitorRuntime: (id: string) => void;
}

export default function RuntimesSubTab({ onMonitorRuntime }: RuntimesSubTabProps) {
  const { showToast } = useToast();
  const { strategies, updateStrategyStatus } = useDataStore();

  const [instances, setInstances] = useState<RuntimeInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<'ALL' | 'PAPER' | 'LIVE'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RUNNING' | 'STOPPED'>('ALL');

  // Strategy Launcher States
  const [localStrategies, setLocalStrategies] = useState<any[]>([]);
  const [isLauncherOpen, setIsLauncherOpen] = useState(true);
  const [selectedLauncherStratId, setSelectedLauncherStratId] = useState<string>('');
  const [launchSymbol, setLaunchSymbol] = useState('EURUSD');
  const [launchMode, setLaunchMode] = useState<'PAPER' | 'LIVE'>('PAPER');
  const [launchParams, setLaunchParams] = useState<Record<string, any>>({});
  const [isDeploying, setIsDeploying] = useState(false);

  // Load telemetry
  const fetchInstances = async () => {
    if (document.hidden) return; // Prevent CPU bloat when tab is in background
    try {
      const res = await runApi.getOpsTelemetry();
      if (res.success) {
        // Map the payload runtimes
        const rawList = res.payload.runtimes || [];
        const mapped = rawList.map((r: any) => ({
          id: r.id,
          name: r.name || r.strategyName || 'Unnamed Strategy',
          symbol: r.symbol || 'EURUSD',
          mode: r.mode || 'PAPER',
          status: r.status || 'stopped',
          position: r.position?.side || 'FLAT',
          unrealizedPnl: r.pnl !== undefined ? r.pnl : (r.position?.unrealizedPnl || 0),
          equity: r.equity !== undefined ? r.equity : 0,
          dailyChangePct: r.dailyChangePct !== undefined ? r.dailyChangePct : 0,
          uptime: typeof r.uptime === 'number' ? `${r.uptime}s` : (r.uptime || '4h 12m'),
          lastBarTime: r.lastBarTime || new Date().toLocaleTimeString()
        }));
        setInstances(mapped);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch available strategies for launcher
  const fetchStrategiesForLauncher = async () => {
    try {
      const res = await strategiesApi.list();
      if (res.success) {
        setLocalStrategies(res.payload);
        if (res.payload.length > 0 && !selectedLauncherStratId) {
          setSelectedLauncherStratId(res.payload[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to load strategies for launcher', e);
    }
  };

  // Sync parameter inputs when strategy selection changes
  useEffect(() => {
    const selectedStrat = localStrategies.find(s => s.id === selectedLauncherStratId);
    if (selectedStrat && selectedStrat.schema) {
      const initialParams: Record<string, any> = {};
      Object.entries(selectedStrat.schema).forEach(([key, config]: [string, any]) => {
        initialParams[key] = config.default !== undefined ? config.default : '';
      });
      setLaunchParams(initialParams);
    } else {
      setLaunchParams({});
    }

    // FIX (Owen, Jul 2026): this used to only check
    // `selectedStrat.schema.symbol?.default` — a field that doesn't exist
    // anywhere in a real compiled strategy's schema (schema is the strategy's
    // *parameter* config, not its symbol universe). Since that lookup never
    // matched anything, launchSymbol stayed stuck at the hardcoded 'EURUSD'
    // default no matter what the strategy actually declared, which is why
    // BTC/USD-only strategies were failing to start with
    // "Symbol 'EURUSD' is not supported... Available: BTC/USD".
    // `symbols` is the strategy's real declared symbol list (now correctly
    // populated by the backend even when the strategy isn't running yet —
    // see strategyController.js).
    const declared: string[] = selectedStrat?.symbols || [];
    if (declared.length > 0 && !declared.includes(launchSymbol)) {
      setLaunchSymbol(declared[0]);
    }
  }, [selectedLauncherStratId, localStrategies]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchInstances(),
      fetchStrategiesForLauncher()
    ]).finally(() => setLoading(false));

    // Poll every 5 seconds to simulate active updates (CPU friendly)
    const timer = setInterval(() => {
      fetchInstances();
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleLaunch = async () => {
    if (!selectedLauncherStratId) {
      showToast('Select a strategy template to deploy', 'warning');
      return;
    }
    const selectedStrat = localStrategies.find(s => s.id === selectedLauncherStratId);
    if (!selectedStrat) return;

    try {
      setIsDeploying(true);
      const payload = {
        mode: launchMode,
        symbol: launchSymbol,
        params: launchParams
      };
      const res = await runApi.start(selectedLauncherStratId, payload);
      if (res.success) {
        showToast(`Successfully initialized and launched container instance for '${selectedStrat.name}'`, 'success');
        updateStrategyStatus(selectedLauncherStratId, 'running');
        // Instantly refresh the operational runtime registry
        fetchInstances();
      } else {
        showToast(res.error || 'Failed to start engine thread', 'error');
      }
    } catch (e: any) {
      console.error(e);
      showToast(e.response?.data?.error || 'Failed to dispatch start signal', 'error');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleStop = async (id: string, name: string) => {
    try {
      const res = await runApi.stop(id);
      if (res.success) {
        showToast(`Halted sandbox container for '${name}'`, 'warning');
        updateStrategyStatus(id, 'stopped');
        fetchInstances();
      }
    } catch (e) {
      console.error(e);
      showToast('Error sending halt interrupt', 'error');
    }
  };

  const getModeBadge = (mode: string) => {
    switch (mode) {
      case 'LIVE': return 'bg-amber-500/10 text-amber-500 border-amber-500/25';
      case 'PAPER': return 'bg-blue-500/10 text-blue-400 border-blue-500/25';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/25';
    }
  };

  const getPositionBadge = (pos: string) => {
    switch (pos) {
      case 'LONG': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 font-bold';
      case 'SHORT': return 'bg-red-500/10 text-red-400 border-red-500/25 font-bold';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/25';
    }
  };

  // Filter instances
  const filtered = instances.filter(inst => {
    const nameStr = inst.name || '';
    const symbolStr = inst.symbol || '';
    const matchesSearch = nameStr.toLowerCase().includes(search.toLowerCase()) || 
                          symbolStr.toLowerCase().includes(search.toLowerCase());
    const matchesMode = modeFilter === 'ALL' || inst.mode === modeFilter;
    const matchesStatus = statusFilter === 'ALL' || 
                          (statusFilter === 'RUNNING' && inst.status === 'running') ||
                          (statusFilter === 'STOPPED' && inst.status === 'stopped');

    return matchesSearch && matchesMode && matchesStatus;
  });

  const selectedStrat = localStrategies.find(s => s.id === selectedLauncherStratId);

  return (
    <div className="flex-1 flex h-full w-full overflow-hidden bg-[var(--ui-bg)] select-none">
      
      {/* LEFT PANEL: ACTIVE RUNTIMES REGISTRY */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden h-full">
        
        {/* Search and Filters Strip */}
        <div 
          className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 shrink-0"
          style={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border)' }}
        >
          <div className="flex items-center gap-2">
            {/* Search container */}
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-2.5 text-[var(--ui-muted)]" size={12} />
              <input 
                type="text"
                placeholder="Search runtime/symbol..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full text-xs py-1.5 pl-8 pr-2.5 rounded border focus:outline-none"
                style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)' }}
              />
            </div>

            <div className="w-px h-4 bg-[var(--ui-border)] hidden md:block" />

            {/* Mode filters */}
            <div className="flex rounded border bg-[var(--ui-input-bg)] overflow-hidden" style={{ borderColor: 'var(--ui-border)' }}>
              {(['ALL', 'PAPER', 'LIVE'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setModeFilter(m)}
                  className={`px-2.5 py-1 text-[9px] font-bold uppercase transition-colors cursor-pointer border-r last:border-r-0 ${
                    modeFilter === m ? 'bg-[var(--ui-accent)] text-white' : 'text-[var(--ui-muted)] hover:text-white'
                  }`}
                  style={{ borderColor: 'var(--ui-border)' }}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Status filters */}
            <div className="flex rounded border bg-[var(--ui-input-bg)] overflow-hidden" style={{ borderColor: 'var(--ui-border)' }}>
              {(['ALL', 'RUNNING', 'STOPPED'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 text-[9px] font-bold uppercase transition-colors cursor-pointer border-r last:border-r-0 ${
                    statusFilter === s ? 'bg-[var(--ui-accent)] text-white' : 'text-[var(--ui-muted)] hover:text-white'
                  }`}
                  style={{ borderColor: 'var(--ui-border)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle Launcher Button */}
            <button
              onClick={() => setIsLauncherOpen(!isLauncherOpen)}
              className="px-2.5 py-1.5 rounded text-[9px] font-sans font-bold uppercase tracking-wider border cursor-pointer select-none transition-all flex items-center gap-1.5"
              style={{
                backgroundColor: isLauncherOpen ? 'rgba(30, 144, 255, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                borderColor: isLauncherOpen ? 'var(--ui-accent)' : 'var(--ui-border)',
                color: isLauncherOpen ? 'var(--ui-text)' : 'var(--ui-muted)'
              }}
            >
              <Cpu size={11} />
              LAUNCHER: {isLauncherOpen ? 'OPEN' : 'CLOSED'}
            </button>

            <button 
              onClick={fetchInstances}
              className="p-1.5 rounded hover:bg-[var(--ui-panel-soft)] border text-[var(--ui-muted)] hover:text-white cursor-pointer"
              style={{ borderColor: 'var(--ui-border)' }}
              title="Manual refresh"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Grid items */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(inst => {
                const isRunning = inst.status === 'running';
                const pnlIsPositive = inst.unrealizedPnl >= 0;

                return (
                  <div 
                    key={inst.id}
                    className="rounded-xl border p-4 bg-[var(--ui-panel)] flex flex-col justify-between hover:border-[var(--ui-accent)] transition-all group"
                    style={{ borderColor: 'var(--ui-border)' }}
                  >
                    <div>
                      {/* Header line */}
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 pr-1">
                          <h4 className="text-xs font-display font-black text-white truncate leading-tight">
                            {inst.name}
                          </h4>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--ui-accent)]">
                              {inst.symbol}
                            </span>
                            <span className={`text-[8px] font-bold uppercase px-1 rounded border leading-none py-0.5 ${getModeBadge(inst.mode)}`}>
                              {inst.mode}
                            </span>
                          </div>
                        </div>

                        {/* Status light */}
                        <span className="flex h-2 w-2 relative">
                          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isRunning ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${isRunning ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        </span>
                      </div>

                      {/* Operational indicators list */}
                      <div className="mt-4 space-y-2 border-t border-[var(--ui-border)]/50 pt-3">
                        <div className="flex justify-between items-center text-[10px]">
                          <span style={{ color: 'var(--ui-muted)' }}>CURRENT HOLDING:</span>
                          <span className={`px-1 rounded border text-[9px] ${getPositionBadge(inst.position)}`}>
                            {inst.position}
                          </span>
                        </div>

                        <div className="flex justify-between items-center text-[10px]">
                          <span style={{ color: 'var(--ui-muted)' }}>UNREALIZED P&amp;L:</span>
                          <span className={`font-mono font-bold ${pnlIsPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pnlIsPositive ? '+' : ''}${(inst.unrealizedPnl ?? 0).toLocaleString()}
                          </span>
                        </div>

                        <div className="flex justify-between items-center text-[10px]">
                          <span style={{ color: 'var(--ui-muted)' }}>EQUITY BALANCE:</span>
                           <span className="font-mono text-white">
                             {inst.equity !== undefined && inst.equity !== null ? `$${inst.equity.toLocaleString()}` : '---'}
                           </span>
                        </div>

                        <div className="flex justify-between items-center text-[10px]">
                          <span style={{ color: 'var(--ui-muted)' }}>24H NET VALUE:</span>
                          <span className={`font-mono flex items-center ${inst.dailyChangePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {inst.dailyChangePct >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                            {inst.dailyChangePct.toFixed(2)}%
                          </span>
                        </div>

                        <div className="flex justify-between items-center text-[10px]">
                          <span style={{ color: 'var(--ui-muted)' }}>ACTIVE UPTIME:</span>
                          <span className="font-mono text-[var(--ui-muted)]">{inst.uptime}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions footer */}
                    <div className="flex items-center gap-1.5 mt-4 border-t border-[var(--ui-border)]/50 pt-3">
                      {/* Monitor View */}
                      <button
                        onClick={() => onMonitorRuntime(inst.id)}
                        className="flex-1 py-1 text-[9px] font-bold uppercase tracking-wider rounded border border-[var(--ui-accent)]/30 text-[var(--ui-accent)] hover:bg-[var(--ui-accent)] hover:text-white transition-all cursor-pointer flex items-center justify-center gap-1"
                      >
                        <Eye size={10} />
                        MONITOR
                      </button>

                      {/* Quick Halt */}
                      {isRunning && (
                        <button
                          onClick={() => handleStop(inst.id, inst.name)}
                          className="p-1.5 rounded border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-colors cursor-pointer"
                          title="Halt connection"
                        >
                          <Square size={10} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center border border-dashed rounded-xl p-8 h-full" style={{ borderColor: 'var(--ui-border)' }}>
              <Activity size={48} className="text-[var(--ui-muted)] animate-pulse mb-3" />
              <h3 className="text-sm font-display font-black uppercase tracking-wider text-[var(--ui-text)] mb-1">
                Registry Container Empty
              </h3>
              <p className="text-xs text-[var(--ui-muted)] text-center max-w-sm">
                Currently no strategy threads are registered. Deploy a script using the Strategy Launcher panel to start active container instances.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* STRATEGY LAUNCHER SIDE-PANE */}
      <div 
        className="border-l border-[var(--ui-border)] flex flex-col h-full bg-[var(--ui-panel-strong)] overflow-hidden transition-all duration-300 ease-in-out shrink-0"
        style={{ 
          width: isLauncherOpen ? '320px' : '0px',
          opacity: isLauncherOpen ? 1 : 0
        }}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--ui-border)', backgroundColor: 'var(--ui-panel-strong)' }}>
          <div className="flex items-center gap-1.5">
            <Sparkles size={11} className="text-[var(--ui-accent)]" />
            <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: 'var(--ui-text)' }}>
              STRATEGY LAUNCHER
            </span>
          </div>
          <button 
            onClick={() => setIsLauncherOpen(false)}
            className="text-[10px] text-[var(--ui-muted)] hover:text-white transition-colors font-bold cursor-pointer"
          >
            HIDE
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {localStrategies.length === 0 ? (
            <div className="text-center p-4 border border-dashed rounded-lg border-[var(--ui-border)] text-[var(--ui-muted)]">
              <span className="text-xs uppercase tracking-wider font-bold block mb-1">No Strategy Templates</span>
              <p className="text-[10px]">Create or upload strategies in the Strategy Library tab first.</p>
            </div>
          ) : (
            <>
              {/* Select Strategy Dropdown */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'var(--ui-muted)' }}>
                  SELECT STRATEGY TEMPLATE
                </label>
                <select
                  value={selectedLauncherStratId}
                  onChange={(e) => setSelectedLauncherStratId(e.target.value)}
                  className="w-full text-xs p-2 rounded border focus:outline-none cursor-pointer"
                  style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                >
                  {localStrategies.map(strat => (
                    <option key={strat.id} value={strat.id}>
                      {strat.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Symbol Input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'var(--ui-muted)' }}>
                  SYMBOL TICKER
                </label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={launchSymbol}
                    onChange={(e) => setLaunchSymbol(e.target.value.toUpperCase())}
                    placeholder="EURUSD"
                    className="flex-1 text-xs p-2 rounded border focus:outline-none font-mono"
                    style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                  />
                  {/* Preset Quick Chips */}
                  <div className="flex flex-col gap-0.5 shrink-0 justify-center">
                    <select
                      onChange={(e) => setLaunchSymbol(e.target.value)}
                      value={['EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'ETHUSD'].includes(launchSymbol) ? launchSymbol : ''}
                      className="text-[9px] px-1 py-1 rounded border bg-[var(--ui-panel-soft)] focus:outline-none"
                      style={{ borderColor: 'var(--ui-border)', color: 'var(--ui-muted)' }}
                    >
                      <option value="" disabled>Presets</option>
                      <option value="EURUSD">EURUSD</option>
                      <option value="GBPUSD">GBPUSD</option>
                      <option value="USDJPY">USDJPY</option>
                      <option value="BTCUSD">BTCUSD</option>
                      <option value="ETHUSD">ETHUSD</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Execution Mode */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'var(--ui-muted)' }}>
                  EXECUTION ENVIRONMENT
                </label>
                <div className="flex rounded border overflow-hidden bg-[var(--ui-input-bg)]" style={{ borderColor: 'var(--ui-border)' }}>
                  <button
                    type="button"
                    onClick={() => setLaunchMode('PAPER')}
                    className={`flex-1 py-1.5 text-[9px] font-bold uppercase cursor-pointer transition-colors ${
                      launchMode === 'PAPER' ? 'bg-[var(--ui-accent)] text-white' : 'text-[var(--ui-muted)] hover:text-white'
                    }`}
                  >
                    PAPER SANDBOX
                  </button>
                  <button
                    type="button"
                    onClick={() => setLaunchMode('LIVE')}
                    className={`flex-1 py-1.5 text-[9px] font-bold uppercase cursor-pointer transition-colors ${
                      launchMode === 'LIVE' ? 'bg-amber-500 text-white' : 'text-[var(--ui-muted)] hover:text-white'
                    }`}
                  >
                    LIVE EXCHANGE
                  </button>
                </div>
              </div>

              {/* Dynamic Parameter overrides */}
              {selectedStrat && selectedStrat.schema && Object.keys(selectedStrat.schema).length > 0 && (
                <div className="pt-2 border-t border-[var(--ui-border)]/50 space-y-3">
                  <label className="text-[9px] uppercase tracking-wider font-bold block mb-1" style={{ color: 'var(--ui-muted)' }}>
                    STRATEGY SCHEMATIC PARAMETERS
                  </label>
                  {Object.entries(selectedStrat.schema).map(([key, config]: [string, any]) => {
                    const currentVal = launchParams[key] !== undefined ? launchParams[key] : config.default;

                    const updateParam = (val: any) => {
                      setLaunchParams(prev => ({ ...prev, [key]: val }));
                    };

                    return (
                      <div key={key} className="flex flex-col gap-1 pb-1">
                        <div className="flex justify-between items-center leading-none text-[10px]">
                          <span className="font-bold text-[var(--ui-text)] font-sans">{key}</span>
                          <span className="font-mono text-[var(--ui-accent)] font-bold">{String(currentVal)}</span>
                        </div>

                        {config.type === 'boolean' ? (
                          <div className="flex items-center mt-1">
                            <button
                              type="button"
                              onClick={() => updateParam(!currentVal)}
                              className="w-8 h-4.5 rounded-full p-0.5 transition-all cursor-pointer relative"
                              style={{ backgroundColor: currentVal ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                            >
                              <div 
                                className="w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200"
                                style={{ transform: currentVal ? 'translateX(14px)' : 'translateX(0)' }}
                              />
                            </button>
                          </div>
                        ) : config.type === 'string' && config.enum ? (
                          <select
                            value={currentVal}
                            onChange={(e) => updateParam(e.target.value)}
                            className="w-full text-[10px] p-1.5 rounded border focus:outline-none"
                            style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                          >
                            {config.enum.map((option: string) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex items-center gap-1.5 mt-1">
                            <input
                              type="range"
                              min={config.min !== undefined ? config.min : 0}
                              max={config.max !== undefined ? config.max : 100}
                              step={config.type === 'number' ? 0.1 : 1}
                              value={currentVal || 0}
                              onChange={(e) => updateParam(config.type === 'number' ? parseFloat(e.target.value) : parseInt(e.target.value))}
                              className="flex-1 accent-[var(--ui-accent)] h-1 rounded cursor-pointer"
                              style={{ backgroundColor: 'var(--ui-border)' }}
                            />
                            <input
                              type="number"
                              value={currentVal || 0}
                              onChange={(e) => updateParam(config.type === 'number' ? parseFloat(e.target.value) : parseInt(e.target.value))}
                              className="w-10 p-0.5 rounded border text-[10px] text-center font-mono"
                              style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Launch Button */}
              <div className="pt-3 border-t border-[var(--ui-border)]/50">
                <button
                  type="button"
                  onClick={handleLaunch}
                  disabled={isDeploying}
                  className="w-full py-2.5 rounded text-xs font-bold uppercase tracking-wider text-white shadow-md transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  style={{
                    backgroundColor: launchMode === 'LIVE' ? 'var(--ui-warning)' : 'var(--ui-accent)',
                  }}
                >
                  <Play size={12} className={isDeploying ? 'animate-spin' : ''} />
                  {isDeploying ? 'DEPLOYING TO ENGINE...' : 'DEPLOY & START INSTANCE'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
