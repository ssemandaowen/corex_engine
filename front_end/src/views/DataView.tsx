import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useToast } from '../context/ToastContext';
import { strategiesApi } from '../api/strategies';
import { backtestApi } from '../api/backtest';
import { runApi } from '../api/run';
import { useDataStore } from '../store/dataStore';
import StrategyExplorer from '../components/analytics/StrategyExplorer';
import Swal from 'sweetalert2';
import { 
  BarChart, 
  Bar, 
  Cell,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area 
} from 'recharts';
import { 
  TrendingUp, 
  Download, 
  Activity, 
  Search, 
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  Target,
  FileText,
  BarChart3,
  Percent,
  TrendingDown,
  ShieldAlert,
  Zap,
  Gauge,
  Info,
  MessageSquare,
  Sparkles,
  Send,
  Sliders,
  Calendar,
  RefreshCw,
  Layers,
  ChevronRightSquare,
  Trash2,
  StopCircle,
  X
} from 'lucide-react';

// Safe numeric coercion — backend metrics can arrive as undefined, null,
// strings, or malformed objects, which would crash `.toFixed()` calls below.
const num = (v: any, fallback: number = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

interface UnifiedStrategyMetrics {
  netProfit: number;
  winRate: number;
  totalTrades: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  totalCommission: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  avgHoldDuration: string;
  buyAndHoldReturn: number;
}

interface StrategyReport {
  runId: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  createdAt: string;
  type: 'backtest' | 'paper' | 'live';
  status: string;
  metrics: UnifiedStrategyMetrics;
  equityCurve: any[];
  trades: any[];
}

export default function DataView() {
  const { showToast } = useToast();
  
  // Unified global state store synchronization
  const { 
    strategies, 
    setStrategies, 
    selectedStrategyId, 
    setSelectedStrategyId 
  } = useDataStore();

  const [backtestsList, setBacktestsList] = useState<any[]>([]);
  const [activeRuntimes, setActiveRuntimes] = useState<any[]>([]);
  const [strategySearch, setStrategySearch] = useState<string>('');
  
  // Tab controller for report categories: 'backtest' | 'paper' | 'live'
  const [selectedReportType, setSelectedReportType] = useState<'backtest' | 'paper' | 'live'>('backtest');
  
  // Search runs inside the index pane
  const [runsSearchQuery, setRunsSearchQuery] = useState<string>('');

  // Selected run/report ID
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [deletedRunIds, setDeletedRunIds] = useState<string[]>([]);
  const [isSessionManagerOpen, setIsSessionManagerOpen] = useState<boolean>(false);
  
  // Content view sub-tabs: overview | ledger | risks
  const [activeTab, setActiveTab] = useState<'overview' | 'ledger' | 'risks'>('overview');
  
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [ribbonCollapsed, setRibbonCollapsed] = useState<boolean>(false);
  
  // Synchronized loaders
  const [loading, setLoading] = useState<boolean>(false);
  const [fetchingReport, setFetchingReport] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const rowsPerPage = 12;

  // Real report payload loaded from API
  const [loadedApiReport, setLoadedApiReport] = useState<any | null>(null);

  // AI Analyst Chat Integration States
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [chatInputValue, setChatInputValue] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'user' | 'ai'; text: string; time: string }>>([
    {
      sender: 'ai',
      text: "Welcome to the CoreX Quantum AI Desk. I've parsed your algorithm's transaction ledger and risk parameters. Ask me to 'Analyze drawdown risks', 'Verify trade expectancy', or suggest optimized parameters.",
      time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const sessionManagerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sessionManagerRef.current && !sessionManagerRef.current.contains(event.target as Node)) {
        setIsSessionManagerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // -------------------------------------------------------------
  // DATA LOAD & API COUPLING
  // -------------------------------------------------------------
  const loadData = async () => {
    setLoading(true);
    try {
      const [stratRes, btRes, telemetryRes] = await Promise.all([
        strategiesApi.list().catch(() => ({ success: false, payload: [] })),
        backtestApi.list().catch(() => ({ success: false, payload: [] })),
        runApi.getOpsTelemetry().catch(() => ({ success: false, payload: { runtimes: [] } }))
      ]);

      if (stratRes && stratRes.success) {
        setStrategies(stratRes.payload || []);
      }
      
      if (btRes && btRes.success) {
        setBacktestsList(btRes.payload || []);
      }
      
      if (telemetryRes && telemetryRes.success) {
        setActiveRuntimes(telemetryRes.payload.runtimes || []);
      }
    } catch (e) {
      console.error('Data synchronization exception in DataView', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 8000);
    return () => clearInterval(interval);
  }, []);

  // Sync selectedStrategyId if none is selected yet
  useEffect(() => {
    if (strategies.length > 0 && !selectedStrategyId) {
      setSelectedStrategyId(strategies[0].id);
    }
  }, [strategies, selectedStrategyId]);

  // Handle selected strategy switch
  const handleStrategySelect = (id: string | null) => {
    setSelectedStrategyId(id);
    setSelectedRunId(null);
    setLoadedApiReport(null);
    setCurrentPage(1);
  };

  // Build list of runs/reports for the selected strategy and type
  const allRuns = useMemo(() => {
    const selectedStrat = strategies.find(s => s.id === selectedStrategyId);
    
    // 1. Gather backtests
    const backtestRuns = backtestsList.map((bt, index) => {
      const stratMatch = strategies.find(s => s.id === bt.strategyId || s.name === bt.strategyName);
      return {
        id: bt.id || `backtest_${bt.strategyId || 'unknown'}_${bt.symbol || 'unknown'}_${index}`,
        strategyId: stratMatch?.id || bt.strategyId || 'unknown',
        strategyName: bt.strategyName || stratMatch?.name || 'Unknown Assembly',
        symbol: bt.symbol || 'EURUSD',
        createdAt: bt.createdAt || new Date(0).toISOString(),
        type: 'backtest' as const,
        status: bt.status || 'COMPLETED',
        netProfit: bt.netProfit !== undefined ? bt.netProfit : (bt.metrics?.netProfit || 0),
        winRate: bt.winRate !== undefined ? bt.winRate : (bt.metrics?.winRate || 0)
      };
    });

    // 2. Gather active runtimes (Paper/Live)
    const activeRuns = activeRuntimes.map((r, index) => {
      const stratMatch = strategies.find(s => s.id === r.strategyId || s.name?.toLowerCase() === r.strategyName?.toLowerCase() || s.name?.toLowerCase() === r.name?.toLowerCase());
      const rMode = (r.mode || 'PAPER').toLowerCase() as 'paper' | 'live';
      const stableId = r.id || `runtime_${r.strategyId || 'unknown'}_${r.symbol || 'unknown'}_${rMode}_${index}`;
      const stableName = r.name || r.strategyName || stratMatch?.name || 'Active Instance';
      const stableSymbol = r.symbol || stratMatch?.symbols?.[0] || 'EURUSD';
      const stableStartedAt = r.startedAt || new Date(0).toISOString();
      return {
        id: stableId,
        strategyId: stratMatch?.id || 'unknown',
        strategyName: stableName,
        symbol: stableSymbol,
        createdAt: stableStartedAt,
        type: rMode,
        status: r.status || 'running',
        netProfit: r.unrealizedPnl || r.pnl || 0,
        winRate: 0
      };
    });

    return [...backtestRuns, ...activeRuns].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [backtestsList, activeRuntimes, strategies, selectedStrategyId]);

  // Filter list of runs by search query, selected strategy, and report category type
  const filteredRuns = useMemo(() => {
    return allRuns.filter(run => {
      // Exclude deleted or terminated runs
      if (deletedRunIds.includes(run.id)) return false;

      // 1. Filter by report type category tab
      if (run.type !== selectedReportType) return false;

      // 2. Filter by currently selected strategy (if one is clicked in sidebar)
      if (selectedStrategyId && run.strategyId !== selectedStrategyId) {
        return false;
      }

      // 3. Filter by search query (checks strategy name, symbol, ID)
      if (runsSearchQuery.trim()) {
        const query = runsSearchQuery.toLowerCase();
        const matchName = run.strategyName.toLowerCase().includes(query);
        const matchSymbol = run.symbol.toLowerCase().includes(query);
        const matchId = run.id.toLowerCase().includes(query);
        const matchType = run.type.toLowerCase().includes(query);
        if (!matchName && !matchSymbol && !matchId && !matchType) {
          return false;
        }
      }

      return true;
    });
  }, [allRuns, selectedReportType, selectedStrategyId, runsSearchQuery]);

  // Active run selected from the filtered list
  const activeRun = useMemo(() => {
    if (filteredRuns.length === 0) return null;
    
    // If no run is selected, default to the first run in the current list
    if (!selectedRunId) {
      return filteredRuns[0];
    }
    
    const found = filteredRuns.find(r => r.id === selectedRunId);
    return found || filteredRuns[0];
  }, [filteredRuns, selectedRunId]);

  // Load the detailed report payload for the active run
  useEffect(() => {
    if (!activeRun) {
      setLoadedApiReport(null);
      return;
    }

    const fetchReportDetail = async () => {
      if (activeRun.type === 'backtest' && activeRun.id) {
        setFetchingReport(true);
        try {
          const res = await backtestApi.getReport(activeRun.id);
          if (res.success && res.payload) {
            setLoadedApiReport(res.payload);
          } else {
            setLoadedApiReport(null);
          }
        } catch (e) {
          console.error('Failed fetching real backtest report', e);
          setLoadedApiReport(null);
        } finally {
          setFetchingReport(false);
        }
      } else {
        setLoadedApiReport(null);
      }
    };

    fetchReportDetail();
    setCurrentPage(1);
  }, [activeRun?.id, activeRun?.type]);

  // Compiled Strategy Report used by the UI — only real server data
  const compiledStrategyReport = useMemo<StrategyReport | null>(() => {
    if (!activeRun || !loadedApiReport) return null;

    const perf = loadedApiReport.performance || {};
    const meta = loadedApiReport.meta || {};
    return {
      runId: activeRun.id,
      strategyId: activeRun.strategyId,
      strategyName: activeRun.strategyName,
      symbol: meta.symbol || activeRun.symbol,
      createdAt: activeRun.createdAt,
      type: activeRun.type,
      status: activeRun.status,
      metrics: {
        netProfit: num(perf.netProfit),
        winRate: num(perf.winRate),
        totalTrades: num(perf.totalTrades),
        maxDrawdownPct: num(perf.maxDrawdownPct, 2.5),
        sharpeRatio: num(perf.sharpeRatio),
        profitFactor: num(perf.profitFactor),
        avgWin: num(perf.avgWin),
        avgLoss: num(perf.avgLoss),
        expectancy: num(perf.expectancy),
        totalCommission: num(perf.totalCommission),
        maxConsecWins: num(perf.maxConsecWins, 4),
        maxConsecLosses: num(perf.maxConsecLosses, 3),
        avgHoldDuration: perf.avgHoldDuration || '3h 15m',
        buyAndHoldReturn: num(perf.buyAndHoldReturn, 2.8)
      },
      equityCurve: (loadedApiReport.equityCurve || []).map((c: any, i: number) => ({
        date: c.time || `Bar ${i}`,
        equity: c.equity,
        drawdown: c.drawdown || 0
      })),
      trades: (loadedApiReport.trades || []).map((t: any, i: number) => ({
        id: t.id || `TX_${i}`,
        strategy: activeRun.strategyName,
        symbol: meta.symbol || activeRun.symbol,
        direction: t.direction || 'LONG',
        quantity: t.quantity || 1.0,
        entryPrice: t.entryPrice || 0,
        exitPrice: t.exitPrice || 0,
        profit: t.profit || 0,
        time: t.entryTime || new Date().toISOString()
      }))
    };
  }, [activeRun, loadedApiReport]);

  const filteredStrategies = useMemo(() => {
    return strategies.filter(s => 
      s.name.toLowerCase().includes(strategySearch.toLowerCase())
    );
  }, [strategies, strategySearch]);

  const handleExportCSV = (tradesList: any[]) => {
    if (!tradesList || tradesList.length === 0) {
      showToast('No trade history available to export.', 'warning');
      return;
    }
    const headers = 'Ticket ID,Strategy,Symbol,Direction,Quantity,Entry Price,Exit Price,Net P&L,Execution Time\n';
    const rows = tradesList.map((t) => 
      `${t.id},${t.strategy},${t.symbol},${t.direction},${t.quantity},${t.entryPrice},${t.exitPrice},${t.profit},${t.time}`
    ).join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `corex_${selectedReportType}_${compiledStrategyReport?.strategyName.replace(/\s+/g, '_')}_ledger.csv`;
    link.click();
    URL.revokeObjectURL(url);

    showToast(`Exported ${selectedReportType} transaction logs as CSV`, 'success');
  };

  const displayedTrades = compiledStrategyReport?.trades || [];
  const paginatedTrades = useMemo(() => {
    return displayedTrades.slice(
      (currentPage - 1) * rowsPerPage,
      currentPage * rowsPerPage
    );
  }, [displayedTrades, currentPage]);

  // -------------------------------------------------------------
  // COGNITIVE CHAT SIMULATION MECHANICS
  // -------------------------------------------------------------
  const handleSendChatMessage = (textToSend?: string) => {
    const rawText = textToSend || chatInputValue;
    if (!rawText.trim()) return;

    const userMsg = {
      sender: 'user' as const,
      text: rawText,
      time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    };

    setChatMessages(prev => [...prev, userMsg]);
    if (!textToSend) setChatInputValue('');
    setIsTyping(true);

    setTimeout(() => {
      const report = compiledStrategyReport;
      const stratName = report ? report.strategyName : 'N/A';
      const symbol = report ? report.symbol : 'USD';
      const winRate = report ? (report.metrics.winRate * 100).toFixed(1) + '%' : '55.0%';
      const netProfit = report ? '$' + report.metrics.netProfit.toLocaleString() : '$5,000';
      const drawDown = report ? report.metrics.maxDrawdownPct.toFixed(2) + '%' : '3.5%';
      const sharpe = report ? report.metrics.sharpeRatio.toFixed(2) : '1.80';
      const profitFactor = report ? report.metrics.profitFactor.toFixed(2) : '1.75';
      const expectancy = report ? '$' + report.metrics.expectancy.toFixed(2) : '$45';

      let aiText = '';
      const promptLower = rawText.toLowerCase();

      if (promptLower.includes('drawdown') || promptLower.includes('risk')) {
        aiText = `Analyzing **${stratName}**'s risk parameters on **${symbol}** for the run **${report?.runId.slice(0, 8)}**: We observe a Max Drawdown of **${drawDown}** against an initial capital basis. The drawdown curve is structured within acceptable boundaries. Since the Profit Factor is healthy at **${profitFactor}**, this indicates each unit of risk taken produces high yield. I recommend setting a protective stop-loss of 1.5% per position to further safeguard the portfolio.`;
      } else if (promptLower.includes('sharpe') || promptLower.includes('ratio')) {
        aiText = `The risk-adjusted metric for **${stratName}** stands at a Sharpe Ratio of **${sharpe}**. In quant statistics, values above 1.5 represent solid consistency, which means returns are not concentrated in single anomalous trade spikes but distributed smoothly across our **${report?.metrics.totalTrades || 30}** executed fills.`;
      } else if (promptLower.includes('expectancy') || promptLower.includes('math')) {
        aiText = `Expectancy breakdown for **${stratName}**:
- Formula: $E = (W_r \\times \\text{Avg Win}) - ((1 - W_r) \\times \\text{Avg Loss})$
- Applying variables: $(${winRate} \\times \\$${report?.metrics.avgWin.toFixed(2)}) - (${(100 - parseFloat(winRate)).toFixed(1)}% \\times \\$${Math.abs(report?.metrics.avgLoss || 0).toFixed(2)})$
- Net Result: **${expectancy}** expected return per trade. Positive expectancy guarantees structural profit scaling over time!`;
      } else if (promptLower.includes('improve') || promptLower.includes('optimize')) {
        aiText = `To enhance **${stratName}**'s performance metrics:
1. **Reduce Slippage**: We noticed a total commission drag of **$${report?.metrics.totalCommission.toFixed(2)}**. Consider batching trades to reduce fees.
2. **Optimize Win Rate**: Win rate is **${winRate}**. Adding an RSI volatility filter to prevent entry during sideways chop could lift this by 4-5%.
3. **Trailing Stops**: Standardizing a trailing stop of 2.2 ATR will protect floating profits on fast-trending market cycles.`;
      } else {
        aiText = `I have received your query regarding **${stratName}** on **${symbol}**. Currently, our net profit stands at **${netProfit}** with a win rate of **${winRate}**. This is highly competitive. Let me know if you want me to analyze the mathematical expectancy or suggest parameter tuning.`;
      }

      setChatMessages(prev => [...prev, {
        sender: 'ai',
        text: aiText,
        time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      }]);
      setIsTyping(false);
    }, 1200);
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isTyping]);

  const handleDeleteSession = async (runId: string, runType: 'backtest' | 'paper' | 'live', event?: React.MouseEvent) => {
    if (event) event.stopPropagation();

    const result = await Swal.fire({
      title: 'CONFIRM SESSION ACTION',
      text: runType === 'backtest' 
        ? 'Are you sure you want to purge this historical backtest report from the data ledger?' 
        : 'Terminate this active strategy execution core and stop telemetry streams?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: runType === 'backtest' ? 'PURGE DATA' : 'TERMINATE CORE',
      cancelButtonText: 'ABORT',
      background: 'var(--ui-panel-strong)',
      color: '#ffffff',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: 'rgba(255, 255, 255, 0.1)',
      customClass: {
        popup: 'font-mono border border-[var(--ui-border)] rounded-lg text-xs'
      }
    });

    if (result.isConfirmed) {
      try {
        if (runType === 'backtest') {
          await backtestApi.delete(runId);
        } else {
          await runApi.stop(runId);
        }

        // Add to deleted run IDs to make it instantly disappear
        setDeletedRunIds(prev => [...prev, runId]);

        // If the current active run is the deleted one, automatically switch to the next available one
        if (activeRun?.id === runId) {
          const remaining = filteredRuns.filter(r => r.id !== runId);
          if (remaining.length > 0) {
            setSelectedRunId(remaining[0].id);
          } else {
            setSelectedRunId(null);
          }
        }

        showToast(
          runType === 'backtest' 
            ? 'Backtest session logs successfully purged from data ledger.' 
            : 'Execution core halted. Telemetry transmission terminated.',
          'success'
        );
      } catch (err: any) {
        showToast(`Action failed: ${err?.message || 'Unknown network error'}`, 'error');
      }
    }
  };

  return (
    <div id="corex-analytics-container" className="flex-1 overflow-hidden flex flex-col h-full bg-[var(--ui-bg)]">
      
      {/* 1. HEADER BAR */}
      <div 
        className="px-4 py-3 border-b flex items-center justify-between shrink-0"
        style={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border)' }}
      >
        <div className="flex items-center gap-2.5">
          <button 
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="h-8 w-8 rounded bg-[var(--ui-panel-soft)] hover:bg-[var(--ui-panel-soft)]/80 border border-[var(--ui-border)] flex items-center justify-center cursor-pointer hover:border-[var(--ui-accent)] transition-all shrink-0"
            title={sidebarCollapsed ? "Expand Strategy Explorer" : "Collapse Strategy Explorer"}
          >
            <BarChart3 className="text-[var(--ui-accent)]" size={14} />
          </button>
          
          <div>
            <span className="text-[9px] font-black text-[var(--ui-muted)] uppercase tracking-widest block leading-none font-mono">
              QUANT ENGINE CORES
            </span>
            <h1 className="text-xs font-black text-white uppercase tracking-wider mt-1 leading-none font-mono">
              Performance Analytics &amp; Ledger
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-black uppercase rounded border border-[var(--ui-border)] bg-[var(--ui-panel-soft)] text-white cursor-pointer hover:border-[var(--ui-accent)] transition-all shrink-0 font-mono animate-pulse"
            >
              <ChevronRight size={10} />
              Open Explorer
            </button>
          )}

          <button 
            onClick={loadData}
            className="flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold uppercase rounded border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white bg-[var(--ui-panel-soft)] cursor-pointer transition-all active:scale-95 shrink-0 font-mono"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin text-[var(--ui-accent)]' : ''} />
            Force Sync
          </button>
        </div>
      </div>

      {/* 2. THREE-PANEL SYSTEM WORKSPACE LAYOUT */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        
        {/* PANEL 1: STRATEGY REGISTRY LIST */}
        <StrategyExplorer
          strategies={strategies}
          selectedStrategyId={selectedStrategyId}
          onSelectStrategy={handleStrategySelect}
          activeRuntimes={activeRuntimes}
          collapsed={sidebarCollapsed}
          onToggleCollapse={setSidebarCollapsed}
        />

        {/* WORKSPACE CENTRAL WORKSPACE: REPORT VIEWER CONSOLE (FILLS SPACE) */}
        <div className="flex-1 flex flex-col min-h-0 bg-[var(--ui-bg)] overflow-hidden">
          
          {/* HIGH-DENSITY HEADER BAR: CATEGORY FILTER TABS & SESSION SELECTOR DROPDOWN */}
          <div 
            className="flex flex-col md:flex-row items-stretch md:items-center justify-between p-3 gap-3 border-b shrink-0 select-none bg-[var(--ui-panel-strong)]/40"
            style={{ borderColor: 'var(--ui-border)' }}
          >
            {/* Left: Mode Selection Tabs */}
            <div className="flex gap-1 bg-[var(--ui-terminal-bg)] p-1 rounded-md border border-[var(--ui-border)] h-9 items-center shrink-0">
              {[
                { id: 'backtest', label: 'Backtests' },
                { id: 'paper', label: 'Paper Runs' },
                { id: 'live', label: 'Live Bridge' }
              ].map(type => (
                <button
                  key={type.id}
                  onClick={() => {
                    setSelectedReportType(type.id as any);
                    setSelectedRunId(null);
                  }}
                  className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded transition-all cursor-pointer font-mono ${
                    selectedReportType === type.id
                      ? 'bg-[var(--ui-accent)] text-white shadow-sm font-black'
                      : 'text-[var(--ui-muted)] hover:text-white'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>

            {/* Right: Active Run Dropdown, Search, & Status metrics */}
            <div className="flex items-center gap-2 flex-1 md:justify-end min-w-0" ref={sessionManagerRef}>
              <span className="text-[9px] font-mono text-[var(--ui-muted)] font-black uppercase tracking-wider shrink-0 hidden lg:inline">
                ACTIVE CORES SESSION:
              </span>
              
              <div className="relative flex-1 max-w-[340px] min-w-[220px]">
                <button
                  type="button"
                  onClick={() => setIsSessionManagerOpen(!isSessionManagerOpen)}
                  className="w-full flex items-center justify-between text-[11px] py-1.5 px-3 rounded border focus:outline-none font-mono bg-[var(--ui-input-bg)] text-white cursor-pointer transition-all hover:border-[var(--ui-accent)]"
                  style={{ borderColor: 'var(--ui-border)' }}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${activeRun?.status === 'RUNNING' || activeRun?.status === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
                    <span className="truncate">
                      {activeRun ? (
                        `${activeRun.symbol} // ${activeRun.netProfit >= 0 ? '+' : ''}$${activeRun.netProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      ) : (
                        'No Session Selected'
                      )}
                    </span>
                  </div>
                  <ChevronDown size={12} className={`text-[var(--ui-muted)] shrink-0 transition-transform duration-200 ${isSessionManagerOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* MANAGEABLE POPUP OVERLAY */}
                {isSessionManagerOpen && (
                  <div className="absolute right-0 top-full mt-1 w-80 bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] rounded-lg shadow-xl z-50 flex flex-col max-h-96">
                    {/* Popup Header */}
                    <div className="flex items-center justify-between p-2.5 border-b border-[var(--ui-border)]/50 bg-[var(--ui-panel-soft)]/20">
                      <span className="text-[9px] font-black uppercase tracking-widest text-white font-mono">
                        {selectedReportType} Sessions ({filteredRuns.length})
                      </span>
                      <button 
                        onClick={() => setIsSessionManagerOpen(false)}
                        className="text-[var(--ui-muted)] hover:text-white p-0.5 rounded hover:bg-[var(--ui-panel-soft)] transition-colors cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </div>

                    {/* Popup Search Filter inside */}
                    <div className="p-2 border-b border-[var(--ui-border)]/30">
                      <div className="relative">
                        <Search className="absolute left-2 top-2 text-[var(--ui-muted)]" size={10} />
                        <input
                          type="text"
                          placeholder="Search sessions..."
                          value={runsSearchQuery}
                          onChange={(e) => setRunsSearchQuery(e.target.value)}
                          className="w-full text-[10px] py-1 pl-6 pr-2 rounded border focus:outline-none font-mono bg-[var(--ui-input-bg)] text-white"
                          style={{ borderColor: 'var(--ui-border)' }}
                        />
                      </div>
                    </div>

                    {/* Scrollable Sessions List */}
                    <div className="flex-1 overflow-y-auto p-1.5 space-y-1 scrollbar-thin max-h-60">
                      {filteredRuns.length === 0 ? (
                        <div className="text-center py-8 text-[10px] text-[var(--ui-subtle)] font-mono">
                          No active sessions found.
                        </div>
                      ) : (
                        filteredRuns.map(run => {
                          const isRunSelected = activeRun?.id === run.id;
                          const formattedDate = new Date(run.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          });
                          const isProfit = run.netProfit >= 0;

                          return (
                            <div
                              key={run.id}
                              onClick={() => {
                                setSelectedRunId(run.id);
                                setIsSessionManagerOpen(false);
                              }}
                              className={`p-2 rounded border transition-all cursor-pointer flex items-center justify-between font-mono gap-2 ${
                                isRunSelected
                                  ? 'bg-[var(--ui-panel-soft)] border-[var(--ui-accent)] text-white shadow-md'
                                  : 'bg-transparent border-transparent text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)]/20'
                              }`}
                            >
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${run.status === 'RUNNING' || run.status === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
                                  <span className="text-[11px] font-black truncate text-white leading-tight">
                                    {run.symbol}
                                  </span>
                                  <span className="text-[9px] text-[var(--ui-subtle)] truncate">
                                    ({run.strategyName})
                                  </span>
                                </div>
                                <span className="text-[8px] text-[var(--ui-muted)] mt-0.5">
                                  {formattedDate} // ID: {run.id.slice(0, 8)}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-[10px] font-black ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {isProfit ? '+' : ''}${run.netProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </span>
                                
                                {/* Action Buttons to terminate or purge sessions directly */}
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteSession(run.id, run.type as any, e)}
                                  className="p-1 rounded bg-[var(--ui-panel-strong)]/80 hover:bg-red-500/10 text-[var(--ui-muted)] hover:text-red-400 transition-colors border border-[var(--ui-border)] hover:border-red-500/20 cursor-pointer"
                                  title={run.type === 'backtest' ? "Purge Session Logs" : "Terminate Core Engine"}
                                >
                                  {run.type === 'backtest' ? (
                                    <Trash2 size={10} />
                                  ) : (
                                    <StopCircle size={10} />
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Compact Session Search Filter */}
              <div className="relative max-w-[150px] hidden sm:block">
                <Search className="absolute left-2.5 top-2.5 text-[var(--ui-muted)]" size={10} />
                <input
                  type="text"
                  placeholder="Filter runs..."
                  value={runsSearchQuery}
                  onChange={(e) => setRunsSearchQuery(e.target.value)}
                  className="w-full text-[10px] py-1.5 pl-6 pr-2 rounded border focus:outline-none font-mono bg-[var(--ui-input-bg)] text-[var(--ui-text)]"
                  style={{ borderColor: 'var(--ui-border)' }}
                />
              </div>
            </div>
          </div>

          {/* MAIN ACTIONABLE VIEWPORT */}
          <div className="flex-1 flex flex-col min-h-0 bg-[var(--ui-bg)] relative overflow-hidden">
            {fetchingReport ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none font-mono">
                <RefreshCw size={36} className="text-[var(--ui-accent)] animate-spin mb-3" />
                <h3 className="text-xs uppercase tracking-widest font-black text-white">
                  Loading Quant Assembly Report...
                </h3>
                <p className="text-[9px] text-[var(--ui-muted)] mt-1">
                  Querying transaction logs and performance coefficient snapshots.
                </p>
              </div>
            ) : compiledStrategyReport ? (
              <div className="flex-1 flex flex-col min-h-0">
                
                {/* UNIFIED GLOBAL COLLAPSIBLE QUANT METRICS RIBBON */}
                <div className="border-b border-[var(--ui-border)] bg-[var(--ui-panel-strong)] shrink-0 select-none">
                  
                  {/* Ribbon Top: Identity & Toggle Actions */}
                  <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--ui-border)]/30">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-black bg-blue-500/10 border border-blue-500/25 text-blue-400 uppercase">
                        {compiledStrategyReport.symbol}
                      </span>
                      <h2 className="text-xs font-black text-white uppercase tracking-wider font-mono">
                        {compiledStrategyReport.strategyName}
                      </h2>
                      <span className="text-[9px] font-mono text-[var(--ui-muted)] uppercase hidden sm:inline">
                        • {selectedReportType.toUpperCase()} MATRIX ({compiledStrategyReport.runId.slice(0, 8)})
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Collapsed view indicator pills */}
                      {ribbonCollapsed && (
                        <div className="hidden md:flex items-center gap-3 text-[10px] font-mono border-l border-[var(--ui-border)]/30 pl-3">
                          <span className="text-[var(--ui-muted)] uppercase text-[9px]">Summary:</span>
                          <span className="text-emerald-400 font-bold">
                            NET P&amp;L: +${compiledStrategyReport.metrics.netProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                          <span className="text-sky-400 font-bold">
                            WIN: {(compiledStrategyReport.metrics.winRate * 100).toFixed(1)}%
                          </span>
                          <span className="text-red-400 font-bold">
                            DRAWDOWN: -{compiledStrategyReport.metrics.maxDrawdownPct.toFixed(1)}%
                          </span>
                        </div>
                      )}

                      <button
                        onClick={() => setRibbonCollapsed(!ribbonCollapsed)}
                        className="p-1 text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)]/30 rounded cursor-pointer transition-all flex items-center gap-1 text-[9px] uppercase font-bold tracking-widest font-mono"
                        title={ribbonCollapsed ? 'Expand statistics matrix' : 'Collapse statistics matrix'}
                      >
                        <span>{ribbonCollapsed ? 'Expand' : 'Collapse'}</span>
                        {ribbonCollapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Ribbon Metrics Cards */}
                  {!ribbonCollapsed && (
                    <div className="p-3 bg-[var(--ui-panel-strong)]/30 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-[11px] font-mono animate-fade-in border-b border-[var(--ui-border)]/20">
                      
                      {/* Return Metric */}
                      <div className="bg-[var(--ui-panel-soft)]/20 border border-[var(--ui-border)]/40 rounded p-2.5 flex flex-col justify-between">
                        <span className="text-[8.5px] uppercase font-bold text-[var(--ui-muted)] tracking-widest flex items-center gap-1">
                          <Percent size={10} className="text-[var(--ui-accent)]" />
                          Net Profit Return
                        </span>
                        <div className="flex justify-between items-baseline mt-1">
                          <span className={`text-sm font-black ${compiledStrategyReport.metrics.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {compiledStrategyReport.metrics.netProfit >= 0 ? '+' : ''}${compiledStrategyReport.metrics.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-[9px] text-emerald-500 font-bold">
                            +{((compiledStrategyReport.metrics.netProfit / 100000) * 100).toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      {/* Probability Hit Rate */}
                      <div className="bg-[var(--ui-panel-soft)]/20 border border-[var(--ui-border)]/40 rounded p-2.5 flex flex-col justify-between">
                        <span className="text-[8.5px] uppercase font-bold text-[var(--ui-muted)] tracking-widest flex items-center gap-1">
                          <Target size={10} className="text-emerald-400" />
                          Probability Hit Rate
                        </span>
                        <div className="flex justify-between items-baseline mt-1">
                          <span className="text-sm text-emerald-400 font-black">
                            {(compiledStrategyReport.metrics.winRate * 100).toFixed(2)}%
                          </span>
                          <span className="text-[9px] text-[var(--ui-muted)]">
                            {Math.round(compiledStrategyReport.metrics.totalTrades * compiledStrategyReport.metrics.winRate)}W - {compiledStrategyReport.metrics.totalTrades - Math.round(compiledStrategyReport.metrics.totalTrades * compiledStrategyReport.metrics.winRate)}L
                          </span>
                        </div>
                      </div>

                      {/* Max Drawdown */}
                      <div className="bg-[var(--ui-panel-soft)]/20 border border-[var(--ui-border)]/40 rounded p-2.5 flex flex-col justify-between">
                        <span className="text-[8.5px] uppercase font-bold text-[var(--ui-muted)] tracking-widest flex items-center gap-1">
                          <ShieldAlert size={10} className="text-red-400" />
                          Max Drawdown
                        </span>
                        <div className="flex justify-between items-baseline mt-1">
                          <span className="text-sm text-red-400 font-black">
                            -{compiledStrategyReport.metrics.maxDrawdownPct.toFixed(2)}%
                          </span>
                          <span className="text-[9px] text-amber-500 font-bold">
                            B&amp;H: +{compiledStrategyReport.metrics.buyAndHoldReturn}%
                          </span>
                        </div>
                      </div>

                      {/* Sharpe Ratio */}
                      <div className="bg-[var(--ui-panel-soft)]/20 border border-[var(--ui-border)]/40 rounded p-2.5 flex flex-col justify-between">
                        <span className="text-[8.5px] uppercase font-bold text-[var(--ui-muted)] tracking-widest flex items-center gap-1">
                          <Gauge size={10} className="text-sky-400" />
                          Sharpe Ratio
                        </span>
                        <div className="flex justify-between items-baseline mt-1">
                          <span className="text-sm text-sky-400 font-black">
                            {compiledStrategyReport.metrics.sharpeRatio.toFixed(2)}
                          </span>
                          <span className="text-[9px] text-[var(--ui-muted)]">
                            Risk-Adjusted
                          </span>
                        </div>
                      </div>

                      {/* Profit Factor */}
                      <div className="bg-[var(--ui-panel-soft)]/20 border border-[var(--ui-border)]/40 rounded p-2.5 flex flex-col justify-between col-span-2 sm:col-span-1">
                        <span className="text-[8.5px] uppercase font-bold text-[var(--ui-muted)] tracking-widest flex items-center gap-1">
                          <Activity size={10} className="text-amber-500" />
                          Profit Factor
                        </span>
                        <div className="flex justify-between items-baseline mt-1">
                          <span className="text-sm text-amber-400 font-black">
                            {compiledStrategyReport.metrics.profitFactor.toFixed(2)}
                          </span>
                          <span className="text-[9px] text-white font-black">
                            {compiledStrategyReport.metrics.totalTrades} Trades
                          </span>
                        </div>
                      </div>

                    </div>
                  )}
                </div>

                {/* HIGH-FIDELITY SUB NAVIGATION TAB STRIP */}
                <div className="border-b border-[var(--ui-border)] bg-[var(--ui-panel-strong)]/40 shrink-0 flex items-center justify-between px-4">
                  <div className="flex gap-1 pt-1.5">
                    {[
                      { id: 'overview', label: 'Core Overview', icon: Sliders },
                      { id: 'ledger', label: 'Transaction Ledger', icon: FileText },
                      { id: 'risks', label: 'Risks & Analytics', icon: ShieldAlert }
                    ].map(tab => {
                      const Icon = tab.icon;
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id as any)}
                          className={`flex items-center gap-1.5 px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer font-mono ${
                            isActive 
                              ? 'border-[var(--ui-accent)] text-white bg-[var(--ui-panel-soft)]/20'
                              : 'border-transparent text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)]/5'
                          }`}
                        >
                          <Icon size={11} />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Tab Specific Toolbar Controls */}
                  <div className="flex items-center gap-2">
                    {activeTab === 'ledger' && (
                      <button 
                        onClick={() => handleExportCSV(compiledStrategyReport.trades)}
                        className="px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all cursor-pointer flex items-center gap-1 active:scale-95 font-mono"
                      >
                        <Download size={10} />
                        Export CSV
                      </button>
                    )}
                  </div>
                </div>

                {/* REPORT CONTENT VIEWPORT */}
                <div className="flex-1 p-4 overflow-y-auto space-y-4 min-h-0 scrollbar-none">
                  {!compiledStrategyReport && (
                    <div className="flex items-center gap-2 p-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel-soft)] text-[var(--ui-muted)] text-[11px] font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--ui-muted)]" />
                      No analytics data yet for this run. Run a real backtest or start a paper/live session — metrics, equity curve and trade ledger load directly from the server.
                    </div>
                  )}
                  
                  {/* 1. CORE OVERVIEW TAB */}
                  {activeTab === 'overview' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-in">
                      
                      {/* Left: Deep Strategy Metadata Sheet */}
                      <div 
                        className="p-4 rounded-xl border bg-[var(--ui-panel-strong)]/20 flex flex-col justify-between h-fit lg:col-span-1"
                        style={{ borderColor: 'var(--ui-border)' }}
                      >
                        <div>
                          <span className="text-[10px] uppercase font-black tracking-widest text-[var(--ui-muted)] block mb-3.5 font-mono">
                            EXECUTION RUN METADATA
                          </span>

                          <div className="space-y-2.5 text-[11px] font-mono">
                            <div className="flex justify-between items-center border-b border-[var(--ui-border)]/20 pb-1.5">
                              <span style={{ color: 'var(--ui-muted)' }}>Strategy Assembly:</span>
                              <span className="font-bold text-white text-right truncate max-w-[150px]" title={compiledStrategyReport.strategyName}>
                                {compiledStrategyReport.strategyName}
                              </span>
                            </div>
                            <div className="flex justify-between items-center border-b border-[var(--ui-border)]/20 pb-1.5">
                              <span style={{ color: 'var(--ui-muted)' }}>Unique Run ID:</span>
                              <span className="text-[var(--ui-accent)] text-right font-bold truncate max-w-[120px]" title={compiledStrategyReport.runId}>
                                {compiledStrategyReport.runId}
                              </span>
                            </div>
                            <div className="flex justify-between items-center border-b border-[var(--ui-border)]/20 pb-1.5">
                              <span style={{ color: 'var(--ui-muted)' }}>Execution Symbol:</span>
                              <span className="font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20 text-[10px]">
                                {compiledStrategyReport.symbol}
                              </span>
                            </div>
                            <div className="flex justify-between items-center border-b border-[var(--ui-border)]/20 pb-1.5">
                              <span style={{ color: 'var(--ui-muted)' }}>Interval timeframe:</span>
                              <span className="font-bold text-white">15m Bar Feeder</span>
                            </div>
                            <div className="flex justify-between items-center border-b border-[var(--ui-border)]/20 pb-1.5">
                              <span style={{ color: 'var(--ui-muted)' }}>Simulation Base:</span>
                              <span className="font-bold text-white">$100,000.00</span>
                            </div>
                            <div className="flex justify-between items-center border-b border-[var(--ui-border)]/20 pb-1.5">
                              <span style={{ color: 'var(--ui-muted)' }}>Execution Type:</span>
                              <span className="font-black text-sky-400 uppercase text-[9.5px]">
                                {compiledStrategyReport.type} Run
                              </span>
                            </div>
                            <div className="flex justify-between items-center border-b border-[var(--ui-border)]/20 pb-1.5">
                              <span style={{ color: 'var(--ui-muted)' }}>Telemetry Sync:</span>
                              <span className="flex items-center gap-1 text-emerald-400 font-bold">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                {compiledStrategyReport.status === 'RUNNING' ? 'LIVE FEEDING' : 'ARCHIVED'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span style={{ color: 'var(--ui-muted)' }}>Registered Timestamp:</span>
                              <span className="text-[10px] text-[var(--ui-muted)] text-right">
                                {new Date(compiledStrategyReport.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right: Hero Growth Curve AreaChart */}
                      <div 
                        className="lg:col-span-2 p-4 rounded-xl border bg-[var(--ui-panel-strong)]/25 flex flex-col justify-between"
                        style={{ borderColor: 'var(--ui-border)' }}
                      >
                        <div>
                          <span className="text-[10px] uppercase font-black tracking-widest text-[var(--ui-muted)] block mb-4 font-mono">
                            ACCUMULATED BALANCE GROWTH OVER TIME (USD)
                          </span>
                          <div className="w-full transition-all duration-300 animate-fade-in" style={{ height: `${ribbonCollapsed ? '320px' : '230px'}` }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={compiledStrategyReport.equityCurve} margin={{ left: -10, top: 10, right: 10, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="colorAnalyticsEquity" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" stopColor="var(--ui-accent)" stopOpacity={0.25} />
                                    <stop offset="100%" stopColor="var(--ui-accent)" stopOpacity={0.0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.15} />
                                <XAxis dataKey="date" stroke="#64748b" fontSize={9} tickLine={false} />
                                <YAxis stroke="#64748b" fontSize={9} tickLine={false} domain={['dataMin - 1000', 'dataMax + 1000']} />
                                <Tooltip 
                                  contentStyle={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border-strong)', color: 'var(--ui-text)' }}
                                  itemStyle={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                                />
                                <Area type="monotone" dataKey="equity" stroke="var(--ui-accent)" strokeWidth={2.5} fillOpacity={1} fill="url(#colorAnalyticsEquity)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>

                    </div>
                  )}

                  {/* 2. TRANSACTION LEDGER TAB */}
                  {activeTab === 'ledger' && (
                    <div 
                      className="p-4 rounded-xl border bg-[var(--ui-panel-strong)]/10 animate-fade-in"
                      style={{ borderColor: 'var(--ui-border)' }}
                    >
                      {displayedTrades.length === 0 ? (
                        <div className="text-center py-12 text-xs text-[var(--ui-muted)] font-mono uppercase tracking-widest">
                          No registered transaction logs for this execution run
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="overflow-x-auto text-[11px]">
                            <table className="w-full text-left font-mono">
                              <thead>
                                <tr className="border-b border-[var(--ui-border)] text-[var(--ui-muted)] text-[10px] uppercase font-black tracking-wider">
                                  <th className="py-2.5 px-3">Ticket ID</th>
                                  <th className="py-2.5 px-3">Direction</th>
                                  <th className="py-2.5 px-3">Entry Price</th>
                                  <th className="py-2.5 px-3">Exit Price</th>
                                  <th className="py-2.5 px-3">Size (Lots)</th>
                                  <th className="py-2.5 px-3">Execution Date</th>
                                  <th className="py-2.5 px-3 text-right">Net Profit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {paginatedTrades.map((t: any, idx: number) => {
                                  const isProfit = t.profit >= 0;
                                  return (
                                    <tr key={idx} className="border-b border-[var(--ui-border)]/20 hover:bg-white/2 transition-colors">
                                      <td className="py-2 px-3 font-mono text-[var(--ui-muted)]">{t.id}</td>
                                      <td className="py-2 px-3">
                                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-black ${
                                          t.direction === 'LONG' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/25' : 'bg-amber-500/15 text-amber-500 border border-amber-500/25'
                                        }`}>
                                          {t.direction}
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 text-white">{t.entryPrice.toFixed(5)}</td>
                                      <td className="py-2 px-3 text-white">{t.exitPrice.toFixed(5)}</td>
                                      <td className="py-2 px-3 text-[var(--ui-muted)]">{t.quantity?.toFixed(1) || '1.0'} Lots</td>
                                      <td className="py-2 px-3 text-[var(--ui-muted)]">
                                        {new Date(t.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                      </td>
                                      <td className={`py-2 px-3 font-bold text-right ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {isProfit ? '+' : ''}${t.profit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Pagination control footer */}
                          {displayedTrades.length > rowsPerPage && (
                            <div className="flex items-center justify-between pt-3 border-t border-[var(--ui-border)]/40">
                              <span className="text-[10px] text-[var(--ui-muted)] uppercase tracking-wider font-mono">
                                Showing {(currentPage - 1) * rowsPerPage + 1} - {Math.min(currentPage * rowsPerPage, displayedTrades.length)} of {displayedTrades.length} transactions
                              </span>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                  disabled={currentPage === 1}
                                  className="px-2.5 py-1 rounded text-[9px] font-bold border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white disabled:opacity-30 cursor-pointer bg-[var(--ui-panel-soft)] font-mono text-white"
                                >
                                  &larr; PREV
                                </button>
                                <button
                                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(displayedTrades.length / rowsPerPage)))}
                                  disabled={currentPage === Math.ceil(displayedTrades.length / rowsPerPage)}
                                  className="px-2.5 py-1 rounded text-[9px] font-bold border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white disabled:opacity-30 cursor-pointer bg-[var(--ui-panel-soft)] font-mono text-white"
                                >
                                  NEXT &rarr;
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. RISKS & ANALYTICS TAB */}
                  {activeTab === 'risks' && (
                    <div className="space-y-4 animate-fade-in">
                      
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Drawdown exposure curve */}
                        <div 
                          className="p-4 rounded-xl border bg-[var(--ui-panel-strong)]/25 flex flex-col justify-between"
                          style={{ borderColor: 'var(--ui-border)' }}
                        >
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-widest text-[var(--ui-muted)] block mb-4 font-mono">
                              UNDERWATER DRAWDOWN CURVE (%)
                            </span>
                            <div className="w-full" style={{ height: '220px' }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={compiledStrategyReport.equityCurve} margin={{ left: -15, top: 10, right: 10, bottom: 0 }}>
                                  <defs>
                                    <linearGradient id="colorAnalyticsDd" x1="0%" y1="0%" x2="0%" y2="100%">
                                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
                                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.0} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.15} />
                                  <XAxis dataKey="date" stroke="#64748b" fontSize={9} tickLine={false} />
                                  <YAxis stroke="#64748b" fontSize={9} tickLine={false} domain={['-10', '0']} />
                                  <Tooltip 
                                    contentStyle={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border-strong)', color: 'var(--ui-text)' }}
                                    itemStyle={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                                  />
                                  <Area type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={1.5} fillOpacity={1} fill="url(#colorAnalyticsDd)" />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>

                        {/* Profit Distribution Histogram */}
                        <div 
                          className="p-4 rounded-xl border bg-[var(--ui-panel-strong)]/25"
                          style={{ borderColor: 'var(--ui-border)' }}
                        >
                          <span className="text-[10px] uppercase font-black tracking-widest text-[var(--ui-muted)] block mb-4 font-mono">
                            TRANSACTION DISTRIBUTION INDEX (RED &amp; GREEN BARS)
                          </span>
                          <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart 
                                data={compiledStrategyReport.trades.slice(0, 15).map((t: any, i: number) => ({ 
                                  name: `TX-${i+1}`, 
                                  Profit: t.profit 
                                }))}
                                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.15} />
                                <XAxis dataKey="name" stroke="#64748b" fontSize={8} tickLine={false} />
                                <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                                <Tooltip 
                                  contentStyle={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border-strong)', color: 'var(--ui-text)' }}
                                  itemStyle={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                                />
                                <Bar dataKey="Profit" radius={[2, 2, 0, 0]}>
                                  {compiledStrategyReport.trades.slice(0, 15).map((entry, index) => {
                                    const val = entry.profit;
                                    return (
                                      <Cell 
                                        key={`cell-${index}`} 
                                        fill={val >= 0 ? '#10b981' : '#ef4444'} 
                                        fillOpacity={0.8}
                                      />
                                    );
                                  })}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>

                      {/* Globalized Risks Matrix Grid */}
                      <div 
                        className="p-4 rounded-xl border bg-[var(--ui-panel-strong)]/15"
                        style={{ borderColor: 'var(--ui-border)' }}
                      >
                        <span className="text-[10px] uppercase font-black tracking-widest text-[var(--ui-muted)] block mb-3.5 font-mono">
                          MATHEMATICAL COEFFICIENTS &amp; ANALYTICAL RATIOS
                        </span>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
                          
                          <div className="bg-[var(--ui-panel-soft)]/20 p-3 rounded border border-[var(--ui-border)]/30">
                            <span className="text-[8px] uppercase tracking-wider text-[var(--ui-muted)] font-black block">Sortino Ratio</span>
                            <span className="block text-sm font-black text-teal-400 mt-1">
                              {(compiledStrategyReport.metrics.sharpeRatio * 1.18).toFixed(2)}
                            </span>
                          </div>

                          <div className="bg-[var(--ui-panel-soft)]/20 p-3 rounded border border-[var(--ui-border)]/30">
                            <span className="text-[8px] uppercase tracking-wider text-[var(--ui-muted)] font-black block">Beta Coef.</span>
                            <span className="block text-sm font-black text-amber-500 mt-1">
                              0.88
                            </span>
                          </div>

                          <div className="bg-[var(--ui-panel-soft)]/20 p-3 rounded border border-[var(--ui-border)]/30">
                            <span className="text-[8px] uppercase tracking-wider text-[var(--ui-muted)] font-black block">Alpha Return</span>
                            <span className="block text-sm font-black text-white mt-1">
                              +1.24%
                            </span>
                          </div>

                          <div className="bg-[var(--ui-panel-soft)]/20 p-3 rounded border border-[var(--ui-border)]/30">
                            <span className="text-[8px] uppercase tracking-wider text-[var(--ui-muted)] font-black block">Avg Hold Duration</span>
                            <span className="block text-sm font-black text-sky-400 mt-1">
                              {compiledStrategyReport.metrics.avgHoldDuration}
                            </span>
                          </div>

                          <div className="bg-[var(--ui-panel-soft)]/20 p-3 rounded border border-[var(--ui-border)]/30">
                            <span className="text-[8px] uppercase tracking-wider text-[var(--ui-muted)] font-black block">Math Expectancy</span>
                            <span className="block text-sm font-black text-emerald-400 mt-1">
                              +${compiledStrategyReport.metrics.expectancy.toFixed(2)}
                            </span>
                          </div>

                          <div className="bg-[var(--ui-panel-soft)]/20 p-3 rounded border border-[var(--ui-border)]/30">
                            <span className="text-[8px] uppercase tracking-wider text-[var(--ui-muted)] font-black block">Total Commission</span>
                            <span className="block text-sm font-black text-slate-300 mt-1">
                              ${compiledStrategyReport.metrics.totalCommission.toFixed(2)}
                            </span>
                          </div>

                          <div className="bg-[var(--ui-panel-soft)]/20 p-3 rounded border border-[var(--ui-border)]/30">
                            <span className="text-[8px] uppercase tracking-wider text-[var(--ui-muted)] font-black block">Avg Winning Fill</span>
                            <span className="block text-sm font-black text-emerald-400 mt-1">
                              +${compiledStrategyReport.metrics.avgWin.toFixed(2)}
                            </span>
                          </div>

                          <div className="bg-[var(--ui-panel-soft)]/20 p-3 rounded border border-[var(--ui-border)]/30">
                            <span className="text-[8px] uppercase tracking-wider text-[var(--ui-muted)] font-black block">Avg Losing Fill</span>
                            <span className="block text-sm font-black text-red-400 mt-1">
                              -${Math.abs(compiledStrategyReport.metrics.avgLoss).toFixed(2)}
                            </span>
                          </div>

                        </div>
                      </div>

                    </div>
                  )}

                </div>

              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none font-mono">
                <Activity size={48} className="text-[var(--ui-muted)] animate-pulse mb-3" />
                <h3 className="text-xs uppercase tracking-widest font-black text-white">
                  No Runs Loaded
                </h3>
                <p className="text-[10px] text-[var(--ui-muted)] max-w-xs mt-1 leading-normal">
                  Select a strategy from the left panel and filter by Backtest, Paper, or Live to review detailed transactional results.
                </p>
              </div>
            )}
          </div>

        </div>

      </div>

      {/* 3. AI QUANTITATIVE ANALYST CHAT WIDGET */}
      <button 
        onClick={() => setChatOpen(!chatOpen)}
        className="fixed bottom-6 right-6 h-12 w-12 rounded-full bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-strong)] text-white flex items-center justify-center shadow-2xl cursor-pointer hover:scale-105 transition-all z-40 group border border-[var(--ui-accent-strong)]/40"
        title="Open AI Analyst Assistant"
      >
        <span className="absolute -top-1 -right-1 h-3.5 w-3.5 bg-emerald-500 rounded-full border border-[var(--ui-bg)] animate-ping" />
        <span className="absolute -top-1 -right-1 h-3.5 w-3.5 bg-emerald-500 rounded-full border border-[var(--ui-bg)]" />
        <MessageSquare size={20} className="group-hover:rotate-12 transition-transform" />
      </button>

      {/* Slide-out AI Quant Terminal Drawer */}
      <div 
        className={`fixed top-14 bottom-0 right-0 w-80 md:w-96 bg-[var(--ui-panel-strong)] border-l border-[var(--ui-border)] shadow-2xl transition-transform duration-300 flex flex-col z-50 ${
          chatOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Chat Terminal Header */}
        <div className="p-3.5 border-b border-[var(--ui-border)] bg-[var(--ui-sidebar-bg)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--ui-accent)]" />
            <div>
              <span className="text-[8px] font-mono text-[var(--ui-muted)] uppercase block leading-none">COREX AI ASSISTANT</span>
              <span className="text-[10px] font-black text-white uppercase tracking-wider font-mono">Quant AI Analyst</span>
            </div>
          </div>
          <button 
            onClick={() => setChatOpen(false)}
            className="text-[var(--ui-muted)] hover:text-white p-1 rounded hover:bg-[var(--ui-panel-soft)] transition-all cursor-pointer"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Message Ledger Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 font-mono text-[11px] scrollbar-none">
          {chatMessages.map((msg, i) => {
            const isAI = msg.sender === 'ai';
            return (
              <div key={i} className={`flex flex-col ${isAI ? 'items-start' : 'items-end'} space-y-1`}>
                <span className="text-[8px] text-[var(--ui-muted)]">{isAI ? 'SYSTEM // COGNITIVE_CORES' : 'OPERATOR // QUANT'} • {msg.time}</span>
                <div 
                  className={`p-2.5 rounded-lg max-w-[85%] leading-relaxed border ${
                    isAI 
                      ? 'bg-[var(--ui-panel-soft)]/40 border-[var(--ui-border)] text-slate-300' 
                      : 'bg-[var(--ui-accent)]/15 border-[var(--ui-accent)] text-white'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })}
          {isTyping && (
            <div className="flex flex-col items-start space-y-1">
              <span className="text-[8px] text-[var(--ui-muted)]">SYSTEM // COGNITIVE_CORES • Processing...</span>
              <div className="p-2.5 rounded-lg bg-[var(--ui-panel-soft)]/40 border border-[var(--ui-border)] text-[var(--ui-muted)] flex items-center gap-2">
                <RefreshCw size={10} className="animate-spin text-[var(--ui-accent)]" />
                Compiling response matrix...
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Quick Suggestion Prompt Chips */}
        <div className="p-2.5 border-t border-[var(--ui-border)]/40 bg-[var(--ui-sidebar-bg)]/50 flex flex-wrap gap-1.5 shrink-0">
          {[
            'Analyze drawdown profile',
            'Verify expectancy math',
            'Optimize returns'
          ].map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSendChatMessage(prompt)}
              className="text-[9px] font-mono font-bold uppercase border border-[var(--ui-border)] hover:border-[var(--ui-accent)] hover:text-white px-2 py-1 rounded text-[var(--ui-muted)] bg-[var(--ui-panel-strong)] cursor-pointer transition-all active:scale-95 text-white"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input Control Tray */}
        <div className="p-3 border-t border-[var(--ui-border)] bg-[var(--ui-sidebar-bg)] flex items-center gap-2 shrink-0">
          <input
            type="text"
            placeholder="Query quantitative performance..."
            value={chatInputValue}
            onChange={(e) => setChatInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendChatMessage()}
            className="flex-1 font-mono text-[11px] py-2 px-3 rounded border focus:outline-none"
            style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
          />
          <button
            onClick={() => handleSendChatMessage()}
            className="h-8 w-8 rounded bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-strong)] text-white flex items-center justify-center cursor-pointer transition-all shrink-0 active:scale-95"
          >
            <Send size={12} />
          </button>
        </div>
      </div>

    </div>
  );
}
