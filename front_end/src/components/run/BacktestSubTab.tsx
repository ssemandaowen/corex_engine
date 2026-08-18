
import React, { useState, useEffect, useRef } from 'react';
import { useDataStore } from '../../store/dataStore';
import { backtestApi } from '../../api/backtest';
import { strategiesApi } from '../../api/strategies';
import { useToast } from '../../context/ToastContext';
import { 
  Play, 
  Upload, 
  Trash2, 
  Sparkles, 
  FileText, 
  CheckCircle2, 
  HelpCircle,
  TrendingUp,
  AlertTriangle,
  History,
  XCircle,
  BarChart4,
  DollarSign,
  Sliders,
  ChevronDown,
  ChevronUp,
  Menu
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  BarChart, 
  Bar, 
  LineChart, 
  Line, 
  CartesianGrid 
} from 'recharts';

interface BacktestJob {
  id: string;
  strategyName: string;
  createdAt: string;
  status: string;
}

export default function BacktestSubTab() {
  const { showToast } = useToast();
  const { strategies, backtestProgress } = useDataStore();
  const handledJobRef = useRef<Set<string>>(new Set());

  // Selected config states
  const [selectedStratId, setSelectedStratId] = useState('');
  const [symbol, setSymbol] = useState('EURUSD');
  const [interval, setIntervalVal] = useState('15m');
  const [initialCapital, setInitialCapital] = useState(100000);
  const [dataSource, setDataSource] = useState<'ONLINE' | 'OFFLINE'>('ONLINE');
  const [rangeMode, setRangeMode] = useState<'points' | 'dates'>('points');
  const [rangePoints, setRangePoints] = useState(1000);
  const MAX_RANGE_POINTS = 5000; // mirrors backend MAX_BARS_LIMIT (Twelve Data single-request cap)
  
  // Custom Strategy-Specific Parameters (matrix)
  const [customParams, setCustomParams] = useState<Record<string, any>>({});
  
  // Collapsible registry panel state for mobile responsiveness
  const [isRegistryCollapsed, setIsRegistryCollapsed] = useState(false);

  // Risk & realism states
  const [stopLoss, setStopLoss] = useState(1.5);
  const [takeProfit, setTakeProfit] = useState(3.0);
  const [trailingStop, setTrailingStop] = useState(0.5);
  const [commission, setCommission] = useState(0.02);
  const [slippage, setSlippage] = useState(1.5);
  const [spread, setSpread] = useState(0.00015);
  
  // Accordions active
  const [activeAccordion, setActiveAccordion] = useState<string>('strategy');
  const [showRealism, setShowRealism] = useState(false);

  // Backtest processing state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ stage: 'LOADING', pct: 0, message: '' });
  const [report, setReport] = useState<any | null>(null);
  
  // Server uploads & past backtests
  const [uploadsList, setUploadsList] = useState<any[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [pastReports, setPastReports] = useState<BacktestJob[]>([]);
  const [selectedPastJobId, setSelectedPastJobId] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;

  // Sync / Load default parameters on strategy change
  const selectedStrat = strategies.find(s => s.id === selectedStratId);

  useEffect(() => {
    if (strategies.length > 0 && !selectedStratId) {
      setSelectedStratId(strategies[0].id);
    }
    fetchUploadsAndPast();
  }, [strategies]);

  useEffect(() => {
    if (selectedStrat && selectedStrat.schema) {
      const defaults: Record<string, any> = {};
      Object.entries(selectedStrat.schema).forEach(([key, config]: [string, any]) => {
        defaults[key] = config.default !== undefined ? config.default : '';
      });
      setCustomParams(defaults);
    } else {
      setCustomParams({});
    }
  }, [selectedStratId]);

  // Read Transported Parameters from Workspace Control
  useEffect(() => {
    const checkPendingTransport = () => {
      const pendingStr = localStorage.getItem('corex_backtest_pending');
      if (pendingStr) {
        try {
          const { strategyId, symbol: transportSymbol, params: transportParams } = JSON.parse(pendingStr);
          if (strategyId) {
            setSelectedStratId(strategyId);
            // Auto open the parameter matrix accordion to make it obvious
            setActiveAccordion('params');
          }
          if (transportSymbol) {
            setSymbol(transportSymbol);
          }
          if (transportParams) {
            setCustomParams(transportParams);
          }
          // Remove from local storage to prevent duplicate alerts
          localStorage.removeItem('corex_backtest_pending');
          showToast('Loaded strategy matrix parameters from Workspace execution!', 'success');
        } catch (e) {
          console.error('Failed to parse transported parameters', e);
        }
      }
    };

    checkPendingTransport();
    
    window.addEventListener('storage', checkPendingTransport);
    window.addEventListener('corex:navigate', checkPendingTransport);
    return () => {
      window.removeEventListener('storage', checkPendingTransport);
      window.removeEventListener('corex:navigate', checkPendingTransport);
    };
  }, [strategies]);

  const fetchUploadsAndPast = async () => {
    try {
      const [uRes, pRes] = await Promise.all([
        backtestApi.getUploads(),
        backtestApi.list()
      ]);
      if (uRes.success) setUploadsList(uRes.payload);
      if (pRes.success) setPastReports(pRes.payload);
    } catch (e) {
      console.error(e);
    }
  };

    const handleRunBacktest = async () => {
    if (!selectedStratId) {
      showToast('Please select a strategy assembly to test', 'warning');
      return;
    }

    const isOffline = dataSource === 'OFFLINE';
    if (isOffline && !selectedUploadId) {
      showToast('Offline mode needs a CSV dataset. Upload a file or pick an existing one.', 'warning');
      setActiveAccordion('data');
      return;
    }

    setReport(null);
    setProgress({ stage: 'LOADING', pct: 0, message: 'Registering job in queue...' });

    // Auto collapse registry menu upward on mobile when backtest starts so user can see progress!
    setIsRegistryCollapsed(true);

    try {
      const res = await backtestApi.run(selectedStratId, {
        symbol,
        interval,
        initialCapital,
        dataSource,
        uploadId: isOffline ? selectedUploadId : undefined,
        rangeMode,
        rangePoints,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        trailingStopLossPct: trailingStop,
        commissionPct: commission,
        slippageBps: slippage,
        spread,
        barBudgetMs: 100,
        batchSize: 500,
        params: customParams
      });

      if (res.success) {
        const { jobId } = res.payload;
        setActiveJobId(jobId);
        handledJobRef.current.delete(jobId);
        showToast('Backtest job started on container worker', 'success');
      }
    } catch (e) {
      console.error(e);
      showToast('Error allocating container thread', 'error');
    }
  };

  useEffect(() => {
    if (!activeJobId) return;
    const jobProgress = backtestProgress[activeJobId];
    if (!jobProgress) return;

    setProgress({
      stage: jobProgress.stage || 'RUNNING',
      pct: jobProgress.pct || 0,
      message: jobProgress.message || '',
    });

    if (
      (jobProgress.status === 'DONE' || jobProgress.pct === 100) &&
      !handledJobRef.current.has(activeJobId)
    ) {
      handledJobRef.current.add(activeJobId);
      setActiveJobId(null);
      // The job id is NOT the report id — the completed progress event carries
      // the real report id in resultMeta.id. Fall back to jobId only if absent.
      fetchReport(jobProgress.reportId || activeJobId);
    } else if (
      (jobProgress.status === 'ERROR' || jobProgress.status === 'CANCELLED') &&
      !handledJobRef.current.has(activeJobId)
    ) {
      handledJobRef.current.add(activeJobId);
      setActiveJobId(null);
      setProgress({
        stage: 'FAILED',
        pct: jobProgress.pct || 0,
        message: jobProgress.error || 'Backtest execution aborted or encountered a runtime error.',
      });
      showToast(`Backtest job finished with status: ${jobProgress.status}`, 'error');
    }
  }, [activeJobId, backtestProgress]);

  // REST progress polling FALLBACK. The loader is driven primarily by WS
  // BACKTEST_PROGRESS events, but if the socket drops, the tab unmounts, or the
  // worker is delayed, we must still resolve the loader instead of spinning
  // forever. Polls GET /api/backtest/progress/:jobId and reconciles the same
  // completion/error logic. Also clears the loader if the job can't be found
  // (e.g. DB queue not configured) so the user gets a real error, not a
  // permanent spinner.
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;

    const finish = (stage: string, pct: number, message: string) => {
      if (handledJobRef.current.has(activeJobId)) return;
      handledJobRef.current.add(activeJobId);
      setActiveJobId(null);
      setProgress({ stage, pct, message });
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await backtestApi.getProgress(activeJobId);
        if (cancelled) return;
        if (res && res.success && res.payload) {
          const p = res.payload;
          const status = String(p.status || '').toUpperCase();
          const pct = typeof p.pct === 'number' ? p.pct
            : (typeof p.progress?.pct === 'number' ? p.progress.pct : 0);
          setProgress({
            stage: p.currentStage || p.stage || 'RUNNING',
            pct,
            message: p.message || p.currentMessage || '',
          });
          if (status === 'DONE' || status === 'SUCCEEDED' || pct >= 100) {
            finish('DONE', pct, p.message || 'Backtest complete');
            fetchReport(p.resultMeta?.id || p.reportId || activeJobId);
          } else if (status === 'ERROR' || status === 'CANCELLED' || status === 'FAILED') {
            finish('FAILED', pct, p.error || p.message || 'Backtest execution failed.');
            showToast(`Backtest job finished with status: ${status}`, 'error');
          } else if (status === 'NOT_FOUND') {
            finish('FAILED', 0, 'Backtest job not found on server. The job queue may be offline (check DATABASE_URL / PGHOST and that the worker process started).');
            showToast('Backtest job not found — queue may be offline', 'error');
          }
        }
      } catch (e) {
        // Swallow transient poll errors; the interval keeps retrying.
      }
    };

    poll();
    const interval = setInterval(poll, 1500);
    // Hard safety timeout: if nothing resolves in 5 minutes, free the loader.
    const timeout = setTimeout(() => {
      if (cancelled) return;
      if (!handledJobRef.current.has(activeJobId)) {
        finish('FAILED', 0, 'Backtest timed out waiting for progress from the server.');
        showToast('Backtest timed out — no progress received', 'error');
      }
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [activeJobId]);

  const fetchReport = async (jobId: string) => {
    try {
      const res = await backtestApi.getReport(jobId);
      if (res.success) {
        setReport(res.payload);
        setActiveJobId(null);
        setSelectedPastJobId(jobId);
        fetchUploadsAndPast();
        showToast('Report generated successfully', 'success');
      }
    } catch (e) {
      console.error(e);
      showToast('Error compiling analytics report', 'error');
    }
  };

  const handlePastReportClick = (jobId: string) => {
    setSelectedPastJobId(jobId);
    setReport(null);
    fetchReport(jobId);
    // Collapse registry on mobile so results panel immediately slides up
    setIsRegistryCollapsed(true);
  };

  const handleDeleteJob = async (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    try {
      await backtestApi.delete(jobId);
      setPastReports(pastReports.filter(p => p.id !== jobId));
      if (selectedPastJobId === jobId) {
        setReport(null);
        setSelectedPastJobId(null);
      }
      showToast('Report cleared', 'info');
    } catch (e) {
      console.error(e);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Real CSV upload: push the file to the server, register it as a dataset,
  // then select it so the run uses OFFLINE mode against this data.
  const handleDatasetFile = async (file: File) => {
    if (!file) return;
    setUploadingFile(true);
    try {
      const res = await backtestApi.upload(file, symbol || 'UNASSIGNED');
      if (res.success) {
        const ds = res.payload;
        setUploadsList(prev => {
          if (prev.some((u: any) => u.id === ds.id)) return prev;
          return [ds, ...prev];
        });
        setSelectedUploadId(ds.id);
        showToast('Offline CSV uploaded. Select it below and run.', 'success');
      } else {
        showToast(res.message || 'CSV upload failed.', 'error');
      }
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'CSV upload failed.', 'error');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleDatasetFile(file);
  };

  // Format equity curve for recharts
  const chartData = report ? report.equityCurve.map((c: any) => ({
    date: new Date(c.time * 1000).toLocaleDateString(),
    equity: c.equity,
    drawdown: parseFloat(((c.equity - initialCapital) / initialCapital * 100).toFixed(2))
  })) : [];

  // Trade Win/Loss Distribution data
  const profitDistribution = report ? report.trades.slice(0, 15).map((t: any, i: number) => ({
    name: `#${i+1}`,
    PnL: t.profit
  })) : [];

  // Paginated trades
  const paginatedTrades = report ? report.trades.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  ) : [];

  return (
    <div className="flex flex-col lg:flex-row h-full w-full overflow-y-auto lg:overflow-hidden select-none bg-[var(--ui-bg)]">
      {/* LEFT COLUMN: Configuration Panel / Registry */}
      <div 
        className={`border-b lg:border-b-0 lg:border-r shrink-0 flex flex-col bg-[var(--ui-sidebar-bg)] overflow-hidden transition-all duration-300 ${
          isRegistryCollapsed 
            ? 'w-full h-[48px] lg:h-full lg:w-[50px]' 
            : 'w-full lg:w-[380px] h-auto lg:h-full'
        }`}
        style={{ borderColor: 'var(--ui-border)' }}
      >
        {isRegistryCollapsed ? (
          /* COLLAPSED STATE RENDERER */
          <div className="flex flex-row lg:flex-col items-center justify-between lg:justify-start lg:gap-4 h-full w-full bg-[#070e20] p-2">
            {/* On Mobile, show a compact horizontal bar with an expand toggle and run backtest */}
            <div className="flex items-center justify-between w-full lg:hidden">
              <button 
                onClick={() => setIsRegistryCollapsed(false)}
                className="flex items-center gap-2 hover:text-white transition-colors cursor-pointer text-left focus:outline-none"
                title="Expand configuration menu"
              >
                <Menu size={16} className="text-amber-500 animate-pulse" />
                <span className="text-[10px] uppercase font-black tracking-widest text-slate-200 flex items-center gap-1.5">
                  BACKTEST REGISTRY <span className="text-[8px] px-1 bg-amber-500/15 text-amber-500 rounded uppercase font-sans">Collapsed</span>
                </span>
              </button>
              
              <button 
                onClick={handleRunBacktest}
                disabled={activeJobId !== null}
                className="px-2.5 py-1 bg-[var(--ui-accent)] hover:opacity-90 text-white text-[9px] font-black uppercase tracking-widest rounded flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-all active:scale-95"
                title="Run Backtest"
              >
                <Play size={8} className="fill-current" />
                <span>Run Backtest</span>
              </button>
            </div>

            {/* On Desktop, show a vertical rail with icon-only buttons with tooltips */}
            <div className="hidden lg:flex flex-col items-center gap-4 w-full h-full py-2">
              {/* Menu trigger to expand */}
              <button 
                onClick={() => setIsRegistryCollapsed(false)}
                className="p-2 rounded text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)] transition-all cursor-pointer active:scale-95"
                title="Expand Backtest Configuration"
              >
                <Menu size={18} />
              </button>

              <div className="w-8 border-t border-[var(--ui-border)]/50 my-1" />

              {/* Run Backtest Icon Button */}
              <button 
                onClick={handleRunBacktest}
                disabled={activeJobId !== null}
                className="p-2.5 rounded-md bg-[var(--ui-accent)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center"
                title="Run Backtest Simulation"
              >
                <Play size={14} className="fill-current" />
              </button>

              {/* Past Reports / History Icon Button (Clock) */}
              <button 
                onClick={() => {
                  setIsRegistryCollapsed(false);
                  setTimeout(() => {
                    const el = document.getElementById('past-reports-section');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }, 100);
                }}
                className="p-2 rounded text-[var(--ui-muted)] hover:text-slate-200 hover:bg-[var(--ui-panel-soft)] transition-all cursor-pointer"
                title="View Past Run Registry History (Clock)"
              >
                <History size={16} />
              </button>

              {/* Sliders / Parameters shortcut */}
              <button 
                onClick={() => {
                  setIsRegistryCollapsed(false);
                  setActiveAccordion('params');
                }}
                className="p-2 rounded text-[var(--ui-muted)] hover:text-slate-200 hover:bg-[var(--ui-panel-soft)] transition-all cursor-pointer"
                title="Edit Strategy Parameter Matrix"
              >
                <Sliders size={16} />
              </button>

              {/* Data source shortcut */}
              <button 
                onClick={() => {
                  setIsRegistryCollapsed(false);
                  setActiveAccordion('data');
                }}
                className="p-2 rounded text-[var(--ui-muted)] hover:text-slate-200 hover:bg-[var(--ui-panel-soft)] transition-all cursor-pointer"
                title="Change Historical Data Source"
              >
                <TrendingUp size={16} />
              </button>
            </div>
          </div>
        ) : (
          /* EXPANDED STATE RENDERER */
          <>
            {/* Registry Top Header */}
            <div className="p-3 border-b border-[var(--ui-border)] flex items-center justify-between shrink-0 bg-[#070e20]">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsRegistryCollapsed(true)}
                  className="p-1.5 -ml-1 rounded text-[var(--ui-muted)] hover:text-white hover:bg-slate-800/50 transition-colors cursor-pointer"
                  title="Collapse Configuration Menu"
                >
                  <Menu size={14} />
                </button>
                <span className="text-[10px] uppercase font-black tracking-widest text-slate-200 flex items-center gap-1.5">
                  BACKTEST REGISTRY
                </span>
              </div>

              <button 
                onClick={handleRunBacktest}
                disabled={activeJobId !== null}
                className="px-3 py-1 bg-[var(--ui-accent)] hover:opacity-90 text-white text-[10px] font-black uppercase tracking-widest rounded flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-all active:scale-95"
              >
                <Play size={10} className="fill-current" />
                <span>Run Backtest</span>
              </button>
            </div>

            {/* Scrollable Accordions & Past Runs */}
            <div className="flex-1 lg:overflow-y-auto overflow-y-visible p-3 space-y-4">
          
          {/* STRATEGY Accordion */}
          <div className="rounded border border-[var(--ui-border)] bg-[var(--ui-panel)]">
            <button 
              onClick={() => setActiveAccordion(activeAccordion === 'strategy' ? '' : 'strategy')}
              className="w-full flex items-center justify-between p-2.5 text-left font-display font-black text-xs uppercase text-slate-300"
            >
              <span>1. Assembly Strategy</span>
              <span className="text-[10px] text-[var(--ui-accent)] font-mono">
                {activeAccordion === 'strategy' ? '▲' : '▼'}
              </span>
            </button>
            
            {activeAccordion === 'strategy' && (
              <div className="p-3 border-t border-[var(--ui-border)]/50 space-y-3">
                <div>
                  <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Select Script</label>
                  <select
                    value={selectedStratId}
                    onChange={(e) => setSelectedStratId(e.target.value)}
                    className="w-full text-xs p-2 rounded border text-white focus:outline-none bg-[var(--ui-input-bg)] pr-8 cursor-pointer border-[var(--ui-border)]"
                  >
                    {strategies.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Initial Bankroll</label>
                  <input 
                    type="number"
                    value={initialCapital}
                    onChange={(e) => setInitialCapital(parseInt(e.target.value))}
                    className="w-full text-xs p-2 rounded border text-white focus:outline-none bg-[var(--ui-input-bg)] border-[var(--ui-border)] font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* STRATEGY PARAMETERS ACCORDION */}
          {selectedStrat && selectedStrat.schema && Object.keys(selectedStrat.schema).length > 0 && (
            <div className="rounded border border-[var(--ui-border)] bg-[var(--ui-panel)]">
              <button 
                onClick={() => setActiveAccordion(activeAccordion === 'params' ? '' : 'params')}
                className="w-full flex items-center justify-between p-2.5 text-left font-display font-black text-xs uppercase text-slate-300"
              >
                <span>1b. Parameter Matrix</span>
                <span className="text-[10px] text-[var(--ui-accent)] font-mono">
                  {activeAccordion === 'params' ? '▲' : '▼'}
                </span>
              </button>
              
              {activeAccordion === 'params' && (
                <div className="p-3 border-t border-[var(--ui-border)]/50 space-y-3 max-h-60 overflow-y-auto">
                  {Object.entries(selectedStrat.schema).map(([key, config]: [string, any]) => {
                    const val = customParams[key] !== undefined ? customParams[key] : (config.default !== undefined ? config.default : '');
                    const isNumeric = config.type === 'number' || config.type === 'integer';
                    const isBoolean = config.type === 'boolean';

                    return (
                      <div key={key} className="flex flex-col gap-1 p-2 bg-[#020617]/50 rounded border border-[var(--ui-border)]/30">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-300 font-mono">{key}</span>
                          <span className="text-[8px] text-[var(--ui-muted)] uppercase">{config.type}</span>
                        </div>
                        <p className="text-[8px] text-[var(--ui-muted)] leading-tight">{config.description}</p>
                        {isBoolean ? (
                          <div className="flex items-center gap-2 mt-1">
                            <button
                              onClick={() => {
                                setCustomParams(prev => ({ ...prev, [key]: !val }));
                              }}
                              className="w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer"
                              style={{ backgroundColor: val ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                            >
                              <div className="w-3 h-3 rounded-full bg-white transition-transform duration-200" style={{ transform: val ? 'translateX(16px)' : 'translateX(0)' }} />
                            </button>
                            <span className="text-[9px] font-mono text-[var(--ui-muted)] uppercase">{val ? 'TRUE' : 'FALSE'}</span>
                          </div>
                        ) : (
                          <input 
                            type={isNumeric ? "number" : "text"}
                            step={config.type === 'number' ? "0.01" : "1"}
                            value={val}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const parsed = isNumeric ? parseFloat(raw) : raw;
                              setCustomParams(prev => ({ ...prev, [key]: isNaN(parsed as any) ? raw : parsed }));
                            }}
                            className="w-full text-xs p-1.5 rounded border focus:outline-none bg-slate-900 border-[var(--ui-border)] text-white font-mono mt-1"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* DATA SOURCE Accordion */}
          <div className="rounded border border-[var(--ui-border)] bg-[var(--ui-panel)]">
            <button 
              onClick={() => setActiveAccordion(activeAccordion === 'data' ? '' : 'data')}
              className="w-full flex items-center justify-between p-2.5 text-left font-display font-black text-xs uppercase text-slate-300"
            >
              <span>2. Historical Data</span>
              <span className="text-[10px] text-[var(--ui-accent)] font-mono">
                {activeAccordion === 'data' ? '▲' : '▼'}
              </span>
            </button>

            {activeAccordion === 'data' && (
              <div className="p-3 border-t border-[var(--ui-border)]/50 space-y-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => setDataSource('ONLINE')}
                    className={`flex-1 text-[9px] font-black py-1.5 px-2 rounded border text-center cursor-pointer transition-all ${
                      dataSource === 'ONLINE' ? 'bg-[var(--ui-accent)] border-[var(--ui-accent)] text-white' : 'border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white'
                    }`}
                  >
                    ONLINE PRICE FEED
                  </button>
                  <button
                    onClick={() => setDataSource('OFFLINE')}
                    className={`flex-1 text-[9px] font-black py-1.5 px-2 rounded border text-center cursor-pointer transition-all ${
                      dataSource === 'OFFLINE' ? 'bg-[var(--ui-accent)] border-[var(--ui-accent)] text-white' : 'border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white'
                    }`}
                  >
                    LOCAL CSV FILE
                  </button>
                </div>

                {dataSource === 'ONLINE' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Symbol</label>
                      <input 
                        type="text" 
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                        className="w-full text-xs p-2 rounded border text-white focus:outline-none bg-[var(--ui-input-bg)] uppercase border-[var(--ui-border)] font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Timeframe</label>
                      <select
                        value={interval}
                        onChange={(e) => setIntervalVal(e.target.value)}
                        className="w-full text-xs p-2 rounded border text-white focus:outline-none bg-[var(--ui-input-bg)] cursor-pointer border-[var(--ui-border)]"
                      >
                        <option value="1m">1 minute</option>
                        <option value="5m">5 minutes</option>
                        <option value="15m">15 minutes</option>
                        <option value="1h">1 hour</option>
                        <option value="4h">4 hours</option>
                        <option value="1d">Daily</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">
                        Output Size (Bars) — max {MAX_RANGE_POINTS}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={MAX_RANGE_POINTS}
                        value={rangePoints}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (Number.isNaN(v)) { setRangePoints(1); return; }
                          setRangePoints(Math.max(1, Math.min(MAX_RANGE_POINTS, v)));
                        }}
                        className="w-full text-xs p-2 rounded border text-white focus:outline-none bg-[var(--ui-input-bg)] border-[var(--ui-border)] font-mono font-bold"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div 
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      className="border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:border-[var(--ui-accent)] transition-colors py-6 bg-[var(--ui-input-bg)]"
                      style={{ borderColor: 'var(--ui-border)' }}
                    >
                      <Upload size={24} className="text-[var(--ui-muted)] animate-bounce mb-1" />
                      <span className="text-[10px] uppercase font-bold text-[var(--ui-text)]">
                        {uploadingFile ? 'Uploading…' : 'Drag & Drop or Click to Upload CSV'}
                      </span>
                      <span className="text-[9px] text-[var(--ui-muted)]">Accepts columns: Time,O,H,L,C,V</span>
                      <input
                        type="file"
                        accept=".csv,.txt"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleDatasetFile(f);
                          e.target.value = '';
                        }}
                        id="offline-csv-input"
                      />
                      <label
                        htmlFor="offline-csv-input"
                        className="mt-2 px-2 py-1 text-[9px] font-black uppercase tracking-wider rounded border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white cursor-pointer"
                      >
                        Choose File
                      </label>
                    </div>

                    {uploadsList.length > 0 && (
                      <div className="space-y-1.5 mt-2">
                        <span className="text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)]">Use Dataset</span>
                        {uploadsList.map(u => (
                          <div
                            key={u.id}
                            onClick={() => setSelectedUploadId(u.id)}
                            className={`flex items-center justify-between p-1.5 rounded border cursor-pointer transition-colors ${
                              selectedUploadId === u.id
                                ? 'border-[var(--ui-accent)] bg-[var(--ui-panel-soft)]'
                                : 'border-[var(--ui-border)]/60 bg-[var(--ui-panel-soft)] hover:border-[var(--ui-accent)]'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <FileText size={12} className="text-[var(--ui-accent)] shrink-0" />
                              <span className="text-[10px] font-mono truncate text-white">{u.filename}</span>
                            </div>
                            <span className="text-[8px] px-1 bg-[var(--ui-border)] rounded text-[var(--ui-muted)] shrink-0">{u.timeframe}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RISK PARAMETERS Accordion */}
          <div className="rounded border border-[var(--ui-border)] bg-[var(--ui-panel)]">
            <button 
              onClick={() => setActiveAccordion(activeAccordion === 'risk' ? '' : 'risk')}
              className="w-full flex items-center justify-between p-2.5 text-left font-display font-black text-xs uppercase text-slate-300"
            >
              <span>3. Risk Management</span>
              <span className="text-[10px] text-[var(--ui-accent)] font-mono">
                {activeAccordion === 'risk' ? '▲' : '▼'}
              </span>
            </button>

            {activeAccordion === 'risk' && (
              <div className="p-3 border-t border-[var(--ui-border)]/50 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Stop Loss %</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={stopLoss}
                      onChange={(e) => setStopLoss(parseFloat(e.target.value))}
                      className="w-full text-xs p-2 rounded border text-white focus:outline-none bg-[var(--ui-input-bg)] border-[var(--ui-border)] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Take Profit %</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={takeProfit}
                      onChange={(e) => setTakeProfit(parseFloat(e.target.value))}
                      className="w-full text-xs p-2 rounded border text-white focus:outline-none bg-[var(--ui-input-bg)] border-[var(--ui-border)] font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[9px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Trailing Stop %</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={trailingStop}
                    onChange={(e) => setTrailingStop(parseFloat(e.target.value))}
                    className="w-full text-xs p-2 rounded border text-white focus:outline-none bg-[var(--ui-input-bg)] border-[var(--ui-border)] font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* REALISM CONFIGURATION */}
          <div className="rounded border border-[var(--ui-border)]/85 bg-[#020617]/40">
            <button 
              onClick={() => setShowRealism(!showRealism)}
              className="w-full flex items-center justify-between p-2.5 text-left font-display text-[10px] text-[var(--ui-muted)] font-black uppercase"
            >
              <span>REALISM PARAMETERS</span>
              <span>{showRealism ? '▲' : '▼'}</span>
            </button>

            {showRealism && (
              <div className="p-3 border-t border-[var(--ui-border)]/50 space-y-3 bg-[var(--ui-panel-soft)]">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[8px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Commissions %</label>
                    <input 
                      type="number" 
                      step="0.005"
                      value={commission}
                      onChange={(e) => setCommission(parseFloat(e.target.value))}
                      className="w-full text-xs p-1.5 rounded border text-white focus:outline-none bg-[var(--ui-input-bg)] border-[var(--ui-border)] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[8px] uppercase tracking-wider font-bold text-[var(--ui-muted)] mb-1">Slippage (Bps)</label>
                    <input 
                      type="number" 
                      step="0.5"
                      value={slippage}
                      onChange={(e) => setSlippage(parseFloat(e.target.value))}
                      className="w-full text-xs p-1.5 rounded border text-white focus:outline-none bg-[var(--ui-input-bg)] border-[var(--ui-border)] font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* PAST REPORTS HISTORY LIST */}
          {pastReports.length > 0 && (
            <div id="past-reports-section" className="pt-2 border-t border-[var(--ui-border)]/30">
              <span className="text-[9px] text-[var(--ui-muted)] uppercase tracking-widest font-black block mb-2">
                PAST RUN REGISTRY HISTORY
              </span>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {pastReports.map(job => (
                  <div
                    key={job.id}
                    onClick={() => handlePastReportClick(job.id)}
                    className={`p-2 rounded border flex items-center justify-between cursor-pointer hover:bg-[var(--ui-panel-soft)] transition-colors ${
                      selectedPastJobId === job.id ? 'border-[var(--ui-accent)] bg-[var(--ui-panel-soft)]' : 'border-[var(--ui-border)]/60 bg-[#020617]/20'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 leading-none gap-1">
                      <span className="text-[11px] font-bold text-slate-300 truncate">{job.strategyName}</span>
                      <span className="text-[8px] text-[var(--ui-muted)]">
                        {job.createdAt ? new Date(job.createdAt).toLocaleString() : 'N/A'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[8px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-black uppercase">{job.status}</span>
                      <button 
                        onClick={(e) => handleDeleteJob(e, job.id)}
                        className="p-1 rounded text-[var(--ui-muted)] hover:text-red-500 transition-colors cursor-pointer"
                        title="Delete this historical report record"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    )}
  </div>

      {/* RIGHT COLUMN: Simulation results / Report charts */}
      <div className="flex-1 flex flex-col p-4 overflow-y-auto">
        
        {/* Toggle Expand/Collapse helper banner if menu is collapsed on mobile */}
        {isRegistryCollapsed && (
          <div className="lg:hidden shrink-0 mb-3 p-2 rounded-lg border border-amber-500/20 bg-amber-500/5 flex items-center justify-between">
            <span className="text-[10px] text-amber-500 uppercase tracking-wider font-bold">
              Backtest configuration menu is collapsed
            </span>
            <button 
              onClick={() => setIsRegistryCollapsed(false)}
              className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30 active:scale-95 cursor-pointer"
            >
              Expand Panel
            </button>
          </div>
        )}

        {activeJobId ? (
          /* RUNNING LOADER STATE */
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="relative w-20 h-20 flex items-center justify-center mb-4">
              <div className="absolute inset-0 border-4 border-[var(--ui-border)] border-t-[var(--ui-accent)] rounded-full animate-spin" />
              <Sparkles size={24} className="text-[var(--ui-accent)] animate-pulse" />
            </div>
            
            <h3 className="text-sm font-display font-black uppercase tracking-wider text-white mb-1">
              Executing simulation run: {progress.stage}
            </h3>
            
            <div className="w-64 bg-[var(--ui-border)] rounded-full h-1.5 mt-3 overflow-hidden">
              <div 
                className="h-full bg-[var(--ui-accent)] transition-all duration-300"
                style={{ width: `${progress.pct}%` }}
              />
            </div>

            <p className="text-[10px] font-mono text-[var(--ui-muted)] mt-2">
              {progress.message}
            </p>
          </div>
        ) : report ? (
          /* REPORT COMPLETED PANEL */
          <div className="space-y-6">
            
            {/* Header metrics details */}
            <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-2">
              <div>
                <h2 className="text-sm font-display font-black uppercase tracking-wider text-white">
                  Simulated Backtest Report
                </h2>
                <p className="text-[10px] text-[var(--ui-muted)] uppercase tracking-wider mt-1 leading-none font-semibold">
                  Script: {report.meta?.strategyName || 'Core Strategy'} · Feed: {report.meta?.symbol || 'EURUSD'} {report.meta?.interval || '15m'}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-[var(--ui-positive)] shrink-0" />
                <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--ui-muted)]">Verified Sandbox Build</span>
              </div>
            </div>

            {/* STATS GRID (6 panels) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* NET PROFIT */}
              <div className="p-3 bg-[var(--ui-panel)] rounded-lg border border-[var(--ui-border)] flex flex-col justify-between">
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] mb-1 leading-none">Net Profit</span>
                <span className="text-lg font-mono font-black mt-2 leading-none" style={{ color: (report.performance?.netProfit || 0) >= 0 ? 'var(--ui-positive)' : 'var(--ui-negative)' }}>
                  {report.performance?.netProfit !== undefined 
                    ? `${report.performance.netProfit >= 0 ? '+' : ''}$${report.performance.netProfit.toLocaleString()}`
                    : '$0.00'
                  }
                </span>
              </div>

              {/* WIN RATE */}
              <div className="p-3 bg-[var(--ui-panel)] rounded-lg border border-[var(--ui-border)] flex flex-col justify-between">
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] mb-1 leading-none">Win Rate</span>
                <span className="text-lg font-mono font-black mt-2 leading-none text-emerald-400">
                  {report.performance?.winRate !== undefined ? `${(report.performance.winRate * 100).toFixed(1)}%` : '0.0%'}
                </span>
              </div>

              {/* TOTAL TRADES */}
              <div className="p-3 bg-[var(--ui-panel)] rounded-lg border border-[var(--ui-border)] flex flex-col justify-between">
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] mb-1 leading-none">Total Trades</span>
                <span className="text-lg font-mono font-black mt-2 leading-none text-white">
                  {report.performance?.totalTrades || 0}
                </span>
              </div>

              {/* MAX DRAWDOWN */}
              <div className="p-3 bg-[var(--ui-panel)] rounded-lg border border-[var(--ui-border)] flex flex-col justify-between">
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] mb-1 leading-none">Max Drawdown</span>
                <span className="text-lg font-mono font-black mt-2 leading-none text-[var(--ui-negative)]">
                  -{report.performance?.maxDrawdownPct || 0}%
                </span>
              </div>

              {/* SHARPE */}
              <div className="p-3 bg-[var(--ui-panel)] rounded-lg border border-[var(--ui-border)] flex flex-col justify-between">
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] mb-1 leading-none">Sharpe Ratio</span>
                <span className="text-lg font-mono font-black mt-2 leading-none text-sky-400">
                  {report.performance?.sharpeRatio || '0.00'}
                </span>
              </div>

              {/* PROFIT FACTOR */}
              <div className="p-3 bg-[var(--ui-panel)] rounded-lg border border-[var(--ui-border)] flex flex-col justify-between">
                <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] mb-1 leading-none">Profit Factor</span>
                <span className="text-lg font-mono font-black mt-2 leading-none text-amber-500">
                  {report.performance?.profitFactor || '0.00'}
                </span>
              </div>
            </div>

            {/* EQUITY AREA CHART */}
            <div className="p-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel)] relative">
              <div className="panel-header shrink-0 h-6 mb-4 px-1" style={{ background: 'transparent', borderBottom: 'none' }}>
                <span className="section-label">PORTFOLIO EQUITY VALUE CURVE</span>
              </div>
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ left: -10, top: 10, right: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorEquity" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="var(--ui-accent)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--ui-accent)" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.3} />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={10} tickLine={false} domain={['dataMin - 1000', 'dataMax + 1000']} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border-strong)', color: 'var(--ui-text)' }} 
                      labelStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                      itemStyle={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                    />
                    <Area type="monotone" dataKey="equity" stroke="var(--ui-accent)" strokeWidth={2} fillOpacity={1} fill="url(#colorEquity)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* DRAWDOWN FILL CHART */}
            <div className="p-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel)] relative">
              <div className="panel-header shrink-0 h-6 mb-2 px-1" style={{ background: 'transparent', borderBottom: 'none' }}>
                <span className="section-label">DRAWDOWN EXPOSURE (%)</span>
              </div>
              <div className="h-[100px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ left: -10, top: 0, right: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorDd" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#ef4444" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.3} />
                    <XAxis dataKey="date" hide />
                    <YAxis stroke="#64748b" fontSize={9} tickLine={false} domain={['-10', '0']} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border-strong)', color: 'var(--ui-text)' }} 
                      itemStyle={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}
                    />
                    <Area type="monotone" dataKey="drawdown" stroke="var(--ui-negative)" strokeWidth={1} fillOpacity={1} fill="url(#colorDd)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* HISTOGRAM AND SHARPE LINE */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left: Trade Profit Histogram */}
              <div className="p-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel)]">
                <span className="section-label block mb-3">Profit Distribution Histogram</span>
                <div className="h-[140px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={profitDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.3} />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={8} tickLine={false} />
                      <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border-strong)' }}
                        itemStyle={{ fontSize: '10px', color: 'var(--ui-accent)' }}
                      />
                      <Bar dataKey="PnL" fill="var(--ui-accent)" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Right: Expectancy metrics list */}
              <div className="p-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel)] flex flex-col justify-between">
                <span className="section-label block mb-2">Extended Performance Metrics</span>
                <div className="flex-1 space-y-2 py-1 overflow-y-auto">
                  <div className="flex justify-between items-center text-xs">
                    <span style={{ color: 'var(--ui-muted)' }}>Average Win Trade</span>
                    <span className="font-mono font-bold text-emerald-400">+{report.performance?.avgWin ? `$${report.performance.avgWin}` : '$0.00'}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span style={{ color: 'var(--ui-muted)' }}>Average Loss Trade</span>
                    <span className="font-mono font-bold text-red-500">{report.performance?.avgLoss ? `$${report.performance.avgLoss}` : '$0.00'}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span style={{ color: 'var(--ui-muted)' }}>Expectancy per Trade</span>
                    <span className="font-mono font-bold text-sky-400">{report.performance?.expectancy ? `$${report.performance.expectancy}` : '$0.00'}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span style={{ color: 'var(--ui-muted)' }}>Aggregate Commissions Paid</span>
                    <span className="font-mono font-bold text-[var(--ui-muted)]">{report.performance?.totalCommission ? `$${report.performance.totalCommission}` : '$0.00'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* TRADES LIST TABLE */}
            <div className="p-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel)]">
              <span className="section-label block mb-3">SYSTEM TRADES EXECUTED SHEET</span>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--ui-border)]" style={{ color: 'var(--ui-muted)' }}>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">DIR</th>
                      <th className="py-2 px-3 font-mono">ENTRY TIME</th>
                      <th className="py-2 px-3 font-mono">EXIT TIME</th>
                      <th className="py-2 px-3 font-mono">ENTRY PX</th>
                      <th className="py-2 px-3 font-mono">EXIT PX</th>
                      <th className="py-2 px-3 font-mono">NET P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTrades.map((t, idx) => {
                      const absoluteIdx = (currentPage - 1) * rowsPerPage + idx + 1;
                      const isProfit = t.profit >= 0;
                      return (
                        <tr 
                          key={idx} 
                          className="border-b border-[var(--ui-border)]/50 hover:bg-white/2 transition-colors"
                        >
                          <td className="py-2 px-3 text-[var(--ui-muted)]">{absoluteIdx}</td>
                          <td className="py-2 px-3">
                            <span className={`px-1.5 py-0.2 rounded font-black text-[9px] ${
                              t.direction === 'LONG' ? 'bg-blue-500/10 text-blue-400' : 'bg-amber-500/10 text-amber-500'
                            }`}>
                              {t.direction}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-[var(--ui-muted)]">{new Date(t.entryTime).toLocaleString()}</td>
                          <td className="py-2 px-3 font-mono text-[var(--ui-muted)]">{new Date(t.exitTime).toLocaleString()}</td>
                          <td className="py-2 px-3 font-mono text-[var(--ui-text)]">{t.entryPrice.toFixed(5)}</td>
                          <td className="py-2 px-3 font-mono text-[var(--ui-text)]">{t.exitPrice.toFixed(5)}</td>
                          <td className={`py-2 px-3 font-mono font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                            {t.profit !== undefined 
                              ? `${isProfit ? '+' : ''}$${t.profit.toLocaleString()}`
                              : '$0.00'
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Table Pagination */}
              {report.trades.length > rowsPerPage && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--ui-border)]/50">
                  <span className="text-[10px] text-[var(--ui-muted)] uppercase tracking-wider font-bold">
                    Showing {(currentPage - 1) * rowsPerPage + 1} - {Math.min(currentPage * rowsPerPage, report.trades.length)} of {report.trades.length} trades
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="px-2 py-0.5 rounded text-[10px] font-bold border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white disabled:opacity-30 cursor-pointer"
                    >
                      &larr; PREV
                    </button>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(report.trades.length / rowsPerPage)))}
                      disabled={currentPage === Math.ceil(report.trades.length / rowsPerPage)}
                      className="px-2 py-0.5 rounded text-[10px] font-bold border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white disabled:opacity-30 cursor-pointer"
                    >
                      NEXT &rarr;
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        ) : (
          /* EMPTY STATE */
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 m-6 border-[var(--ui-border)]">
            <BarChart4 size={48} className="text-[var(--ui-muted)] animate-pulse mb-3" />
            <h3 className="text-sm font-display font-black uppercase tracking-wider text-[var(--ui-text)] mb-1">
              Simulation Station Offline
            </h3>
            <p className="text-xs text-[var(--ui-muted)] text-center max-w-sm font-sans">
              Trigger a historical backtest run from the configuration panel on the left to evaluate performance indicators.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
