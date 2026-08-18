import React, { useState, useEffect, useRef } from 'react';
import { 
  createChart, 
  IChartApi, 
  ISeriesApi, 
  CandlestickSeries, 
  HistogramSeries, 
  LineSeries, 
  BarSeries, 
  AreaSeries 
} from 'lightweight-charts';
import { runApi } from '../../api/run';
import { useDataStore } from '../../store/dataStore';
import { useToast } from '../../context/ToastContext';
import { useUiStore } from '../../store/uiStore';
import { useTerminalContext } from '../../context/TerminalContext';
import Swal from 'sweetalert2';
import { toChartTime } from '../../utils/chartTime';
import SingleInstanceChartCard from './SingleInstanceChartCard';
import {
  TrendingUp, 
  ShieldAlert, 
  Zap, 
  FileText, 
  Terminal, 
  BarChart, 
  TrendingDown, 
  Target,
  Maximize2,
  LayoutGrid,
  Tv,
  Settings,
  ChevronDown,
  Eye,
  EyeOff
} from 'lucide-react';

interface MonitorSubTabProps {
  initialRuntimeId?: string | null;
}

export default function MonitorSubTab({ initialRuntimeId }: MonitorSubTabProps) {
  const { showToast } = useToast();
  const { strategies, stratTerminalById, clearStrategyLogs } = useDataStore();
  const { terminalCollapsed, setTerminalCollapsed } = useUiStore();
  const { isTerminalVisible } = useTerminalContext();

  const [viewMode, setViewMode] = useState<'grid' | 'single'>('grid');
  const [activeRuntimeId, setActiveRuntimeId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<any | null>(null);
  const [runningInstances, setRunningInstances] = useState<any[]>([]);

  // Workspace settings & UI custom states
  const [showSnapshot, setShowSnapshot] = useState(true);
  const [isStrategyDropdownOpen, setIsStrategyDropdownOpen] = useState(false);
  const [strategySearchQuery, setStrategySearchQuery] = useState('');
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [chartType, setChartType] = useState<'candlestick' | 'line' | 'bar' | 'area'>('candlestick');
  const [upColor, setUpColor] = useState('#10b981');
  const [downColor, setDownColor] = useState('#ef4444');
  const [showVolume, setShowVolume] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [bgPreset, setBgPreset] = useState('#010409');

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Sync initial monitored runtime selection
  useEffect(() => {
    if (initialRuntimeId) {
      setActiveRuntimeId(initialRuntimeId);
      setViewMode('single');
    }
  }, [initialRuntimeId]);

  // Load instances list to allow switching selection
  const loadInstances = async () => {
    try {
      const res = await runApi.getOpsTelemetry();
      if (res.success) {
        setRunningInstances(res.payload.runtimes || []);
        if (res.payload.runtimes.length > 0 && !activeRuntimeId) {
          setActiveRuntimeId(res.payload.runtimes[0].id);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadInstances();
    const t = setInterval(loadInstances, 6000);
    return () => clearInterval(t);
  }, []);

  // Fetch telemetry for selected runtime
  const fetchTelemetry = async () => {
    if (!activeRuntimeId || viewMode !== 'single') return;
    try {
      const res = await runApi.getTelemetry(activeRuntimeId);
      if (res.success) {
        setTelemetry(res.payload);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const t = setInterval(fetchTelemetry, 3000);
    return () => clearInterval(t);
  }, [activeRuntimeId, viewMode]);

  // Lightweight charts initialization (runs only in 'single' view mode)
  useEffect(() => {
    if (viewMode !== 'single' || !chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: bgPreset }, // Dynamic preset
        textColor: '#64748b',
      },
      grid: {
        vertLines: { color: showGrid ? '#0f172a' : 'transparent' },
        horzLines: { color: showGrid ? '#0f172a' : 'transparent' },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
      },
    }) as any;

    chartRef.current = chart;

    // Add main series based on selected style
    let mainSeries: any;
    if (chartType === 'candlestick') {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: upColor,
        downColor: downColor,
        borderVisible: false,
        wickUpColor: upColor,
        wickDownColor: downColor,
      });
    } else if (chartType === 'line') {
      mainSeries = chart.addSeries(LineSeries, {
        color: upColor,
        lineWidth: 2,
      });
    } else if (chartType === 'bar') {
      mainSeries = chart.addSeries(BarSeries, {
        upColor: upColor,
        downColor: downColor,
      });
    } else if (chartType === 'area') {
      mainSeries = chart.addSeries(AreaSeries, {
        topColor: `${upColor}40`,
        bottomColor: `${upColor}00`,
        lineColor: upColor,
        lineWidth: 2,
      });
    }
    candleSeriesRef.current = mainSeries;

    // Add volume histogram series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#F27D26',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // overlay
    });
    volumeSeriesRef.current = volumeSeries;

    // Set up ResizeObserver to handle responsive resizing natively
    const observer = new ResizeObserver((entries) => {
      if (entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
    });

    observer.observe(chartContainerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [viewMode, activeRuntimeId, chartType, upColor, downColor, showVolume, showGrid, bgPreset]);

  // Update chart data whenever telemetry arrives
  useEffect(() => {
    if (viewMode !== 'single' || !telemetry || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candles = telemetry.candles || [];
    if (candles.length > 0) {
      // Backend emits candle.time in milliseconds; lightweight-charts expects
      // a UNIX timestamp in seconds. Normalize so candles actually render.
      if (chartType === 'candlestick' || chartType === 'bar') {
        const formattedCandles = candles.map((c: any) => ({
          time: toChartTime(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        candleSeriesRef.current.setData(formattedCandles);
      } else {
        // Line or Area series expect just { time, value }
        const formattedLines = candles.map((c: any) => ({
          time: toChartTime(c.time),
          value: c.close,
        }));
        candleSeriesRef.current.setData(formattedLines);
      }

      if (showVolume) {
        const formattedVolumes = candles.map((c: any) => ({
          time: toChartTime(c.time),
          value: c.volume || 100,
          color: c.close >= c.open ? `${upColor}40` : `${downColor}40`,
        }));
        volumeSeriesRef.current.setData(formattedVolumes);
      } else {
        volumeSeriesRef.current.setData([]);
      }
    }
  }, [telemetry, viewMode, chartType, showVolume, upColor, downColor]);

  const handleStop = async (id: string, name: string) => {
    const result = await Swal.fire({
      title: 'Halt Strategy Instance?',
      text: `Are you sure you want to stop the active thread for "${name}"? This will terminate all active live feed ticks.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: 'var(--ui-panel-strong)',
      confirmButtonText: 'Halt Thread',
      background: '#070e20',
      color: '#fff',
    });

    if (result.isConfirmed) {
      try {
        const res = await runApi.stop(id);
        if (res.success) {
          showToast(`Successfully terminated strategy thread: ${name}`, 'success');
          loadInstances();
          if (activeRuntimeId === id) {
            setActiveRuntimeId(null);
          }
        } else {
          showToast(res.error || 'Failed to stop strategy.', 'error');
        }
      } catch (e) {
        console.error(e);
        showToast('Internal error halting strategy thread.', 'error');
      }
    }
  };

  const getPositionStyle = (side: string) => {
    switch (side) {
      case 'LONG': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25';
      case 'SHORT': return 'bg-red-500/10 text-red-400 border-red-500/25';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/25';
    }
  };

  const selectedLogLines = activeRuntimeId ? (stratTerminalById[activeRuntimeId] || []) : [];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--ui-bg)]">
      
      {/* Selection toolbar topbar */}
      <div 
        className="px-4 py-2 flex flex-row gap-3 items-center justify-between shrink-0 h-11 border-b"
        style={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border)' }}
      >
        <div className="flex items-center gap-1 min-w-0">
          <Maximize2 size={12} style={{ color: 'var(--ui-muted)' }} className="shrink-0 hidden xs:inline" />
          <span className="text-[10px] uppercase font-black tracking-widest text-[var(--ui-muted)] truncate shrink-0 hidden md:inline mr-1">
            RUN MONITOR
          </span>

          {viewMode === 'single' && runningInstances.length > 0 && (() => {
            const currentInst = runningInstances.find(i => i.id === activeRuntimeId) || runningInstances[0];
            return (
              <div className="relative inline-block text-left z-50">
                <button
                  type="button"
                  onClick={() => setIsStrategyDropdownOpen(!isStrategyDropdownOpen)}
                  className="px-2 py-1 text-[10px] rounded border bg-[var(--ui-input-bg)] hover:bg-[var(--ui-panel-soft)] text-white focus:outline-none cursor-pointer font-mono font-bold flex items-center gap-1 transition-colors"
                  style={{ borderColor: 'var(--ui-border)' }}
                  title="Search & select running strategy instance"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--ui-positive)] animate-pulse shrink-0" />
                  <span className="truncate max-w-[110px] sm:max-w-[200px]">
                    {currentInst?.name || 'Select Instance'}
                  </span>
                  <span className="text-[9px] text-[var(--ui-muted)] font-normal hidden sm:inline">
                    ({currentInst?.symbol || 'N/A'})
                  </span>
                  <ChevronDown size={11} className="text-[var(--ui-muted)] ml-0.5 shrink-0" />
                </button>

                {isStrategyDropdownOpen && (
                  <>
                    {/* Backdrop to close click outside */}
                    <div 
                      className="fixed inset-0 z-40 cursor-default" 
                      onClick={() => setIsStrategyDropdownOpen(false)}
                    />
                    
                    <div 
                      className="absolute left-0 mt-1 w-64 rounded-md shadow-lg border bg-[#070e20] z-50 focus:outline-none overflow-hidden"
                      style={{ borderColor: 'var(--ui-border)' }}
                    >
                      {/* Search box */}
                      <div className="p-2 border-b" style={{ borderColor: 'var(--ui-border)' }}>
                        <input
                          type="text"
                          placeholder="Search active instances..."
                          value={strategySearchQuery}
                          onChange={(e) => setStrategySearchQuery(e.target.value)}
                          className="w-full text-[10px] py-1 px-2.5 rounded bg-[#020617] text-white placeholder-slate-500 border focus:outline-none focus:border-[var(--ui-accent)] font-mono"
                          style={{ borderColor: 'var(--ui-border)' }}
                          autoFocus
                        />
                      </div>

                      {/* Items list */}
                      <div className="max-h-48 overflow-y-auto divide-y divide-[var(--ui-border)]/35">
                        {runningInstances
                          .filter(inst => 
                            inst.name.toLowerCase().includes(strategySearchQuery.toLowerCase()) ||
                            inst.symbol.toLowerCase().includes(strategySearchQuery.toLowerCase()) ||
                            inst.mode.toLowerCase().includes(strategySearchQuery.toLowerCase())
                          )
                          .map((inst) => {
                            const isSelected = inst.id === activeRuntimeId;
                            return (
                              <button
                                key={inst.id}
                                onClick={() => {
                                  setActiveRuntimeId(inst.id);
                                  setIsStrategyDropdownOpen(false);
                                  setStrategySearchQuery('');
                                }}
                                className={`w-full text-left px-3 py-1.5 text-[10px] flex items-center justify-between transition-colors hover:bg-slate-900/60 font-mono ${
                                  isSelected ? 'bg-blue-500/10 text-white' : 'text-slate-300'
                                }`}
                              >
                                <div className="flex flex-col min-w-0">
                                  <div className="flex items-center gap-1 min-w-0">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                    <span className="font-bold truncate">{inst.name}</span>
                                  </div>
                                  <div className="text-[8px] text-[var(--ui-muted)] flex items-center gap-1 mt-0.5">
                                    <span>{inst.symbol}</span>
                                    <span>•</span>
                                    <span className={inst.mode === 'LIVE' ? 'text-amber-500 font-bold' : 'text-blue-400'}>
                                      {inst.mode}
                                    </span>
                                  </div>
                                </div>
                                {isSelected && (
                                  <span className="text-[8px] text-[var(--ui-accent)] font-black shrink-0">ACTIVE</span>
                                )}
                              </button>
                            );
                          })}
                        {runningInstances.filter(inst => 
                          inst.name.toLowerCase().includes(strategySearchQuery.toLowerCase()) ||
                          inst.symbol.toLowerCase().includes(strategySearchQuery.toLowerCase()) ||
                          inst.mode.toLowerCase().includes(strategySearchQuery.toLowerCase())
                        ).length === 0 && (
                          <div className="p-3 text-center text-[9px] text-[var(--ui-muted)] uppercase tracking-wider">
                            No matching runs
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {/* View Mode Toggle Switch */}
        <div className="flex items-center gap-2 shrink-0">
          {viewMode === 'single' && telemetry?.metrics && (
            <div className="hidden lg:flex items-center gap-1 text-[10px] font-mono shrink-0 mr-1.5">
              <span style={{ color: 'var(--ui-muted)' }}>Feed:</span>
              <span className="text-emerald-400 font-bold">{telemetry.metrics.ticksProcessed || '---'} ticks/s</span>
            </div>
          )}

          {/* Collapsible Container Snapshot Panel Eye toggle */}
          {viewMode === 'single' && (
            <button
              type="button"
              onClick={() => setShowSnapshot(!showSnapshot)}
              className={`p-1.5 rounded border transition-all cursor-pointer flex items-center justify-center active:scale-95 shrink-0 ${
                showSnapshot ? 'bg-slate-800 text-white border-[var(--ui-border)]' : 'border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)]'
              }`}
              title={showSnapshot ? 'Hide Container Snapshot Panel' : 'Show Container Snapshot Panel'}
            >
              {showSnapshot ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          )}

          {/* Chart Settings Gear Dropdown */}
          {viewMode === 'single' && (
            <div className="relative inline-block text-left z-50 shrink-0">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={`p-1.5 rounded border transition-all cursor-pointer flex items-center justify-center active:scale-95 ${
                  isSettingsOpen ? 'bg-[var(--ui-accent)] text-white border-[var(--ui-accent)]' : 'border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)]'
                }`}
                title="Chart Options & Colors"
              >
                <Settings size={13} />
              </button>

              {isSettingsOpen && (
                <>
                  <div className="fixed inset-0 z-40 cursor-default" onClick={() => setIsSettingsOpen(false)} />
                  <div 
                    className="absolute right-0 mt-1 w-64 rounded-md shadow-xl border bg-[#070e20] z-50 p-4 font-mono text-[11px] text-slate-300 focus:outline-none space-y-4"
                    style={{ borderColor: 'var(--ui-border)' }}
                  >
                    <div className="border-b pb-1.5 border-[var(--ui-border)]/50">
                      <span className="text-[9px] uppercase font-black tracking-widest text-[var(--ui-muted)]">
                        Chart Options
                      </span>
                    </div>

                    {/* Chart Style Selector */}
                    <div className="space-y-1.5">
                      <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)]">
                        Chart Style
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(['candlestick', 'line', 'bar', 'area'] as const).map((style) => (
                          <button
                            key={style}
                            onClick={() => setChartType(style)}
                            className={`py-1 px-1.5 rounded border text-[9px] uppercase font-bold transition-all text-center cursor-pointer ${
                              chartType === style 
                                ? 'bg-[var(--ui-accent)] border-[var(--ui-accent)] text-white hover:bg-opacity-95' 
                                : 'border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white hover:bg-slate-950'
                            }`}
                          >
                            {style}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Color Palette customization */}
                    <div className="space-y-1.5">
                      <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)]">
                        Up / Down Accent Colors
                      </label>
                      <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                          <span className="text-[8px] text-[var(--ui-muted)]">Bullish</span>
                          <div className="flex gap-1 flex-wrap">
                            {['#10b981', '#3b82f6', '#06b6d4', '#22c55e'].map((color) => (
                              <button
                                key={color}
                                onClick={() => setUpColor(color)}
                                className={`w-4 h-4 rounded-full transition-all cursor-pointer ${
                                  upColor === color ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                                }`}
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="flex-1 space-y-1">
                          <span className="text-[8px] text-[var(--ui-muted)]">Bearish</span>
                          <div className="flex gap-1 flex-wrap">
                            {['#ef4444', '#f43f5e', '#f97316', '#ff6b6b'].map((color) => (
                              <button
                                key={color}
                                onClick={() => setDownColor(color)}
                                className={`w-4 h-4 rounded-full transition-all cursor-pointer ${
                                  downColor === color ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                                }`}
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Display toggles */}
                    <div className="space-y-2 border-t pt-3 border-[var(--ui-border)]/30">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] uppercase font-bold text-[var(--ui-muted)]">
                          Volume Overlay
                        </span>
                        <button
                          onClick={() => setShowVolume(!showVolume)}
                          className={`px-2 py-0.5 rounded border text-[8px] font-black uppercase cursor-pointer hover:bg-slate-900 ${
                            showVolume ? 'text-[var(--ui-accent)] border-[var(--ui-accent)] bg-[var(--ui-accent)]/5' : 'text-slate-400 border-[var(--ui-border)]'
                          }`}
                        >
                          {showVolume ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-[9px] uppercase font-bold text-[var(--ui-muted)]">
                          Grid Lines
                        </span>
                        <button
                          onClick={() => setShowGrid(!showGrid)}
                          className={`px-2 py-0.5 rounded border text-[8px] font-black uppercase cursor-pointer hover:bg-slate-900 ${
                            showGrid ? 'text-[var(--ui-accent)] border-[var(--ui-accent)] bg-[var(--ui-accent)]/5' : 'text-slate-400 border-[var(--ui-border)]'
                          }`}
                        >
                          {showGrid ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    </div>

                    {/* Background preset choices */}
                    <div className="space-y-1.5 border-t pt-3 border-[var(--ui-border)]/30">
                      <label className="block text-[9px] uppercase font-bold text-[var(--ui-muted)]">
                        Background Preset
                      </label>
                      <div className="grid grid-cols-2 gap-1 font-mono text-[8px] text-center">
                        {[
                          { name: 'Deep Dark', value: '#010409' },
                          { name: 'Pure Black', value: '#000000' },
                          { name: 'Slate Gray', value: '#0f172a' },
                          { name: 'Navy Black', value: '#020617' }
                        ].map((theme) => (
                          <button
                            key={theme.value}
                            onClick={() => setBgPreset(theme.value)}
                            className={`py-1 rounded border transition-all text-[8px] uppercase font-bold cursor-pointer truncate ${
                              bgPreset === theme.value 
                                ? 'bg-[var(--ui-accent)] border-[var(--ui-accent)] text-white hover:bg-opacity-95' 
                                : 'border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white hover:bg-slate-950'
                            }`}
                          >
                            {theme.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* View Toggles (Grid vs Deep) */}
          <div className="flex items-center bg-[var(--ui-panel-soft)] p-0.5 rounded border border-[var(--ui-border)] shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded transition-all cursor-pointer flex items-center justify-center active:scale-95 ${
                viewMode === 'grid' ? 'bg-[var(--ui-accent)] text-white shadow' : 'text-[var(--ui-muted)] hover:text-white'
              }`}
              title={`Grid Monitor View (${runningInstances.length} active runs)`}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              onClick={() => {
                if (runningInstances.length > 0) {
                  if (!activeRuntimeId) {
                    setActiveRuntimeId(runningInstances[0].id);
                  }
                  setViewMode('single');
                } else {
                  showToast('No active running strategy threads to monitor.', 'warning');
                }
              }}
              className={`p-1.5 rounded transition-all cursor-pointer flex items-center justify-center active:scale-95 ${
                viewMode === 'single' ? 'bg-[var(--ui-accent)] text-white shadow' : 'text-[var(--ui-muted)] hover:text-white'
              }`}
              title="Deep Monitor View"
            >
              <Tv size={13} />
            </button>
          </div>
        </div>
      </div>

      {runningInstances.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
          <Maximize2 size={48} className="text-[var(--ui-muted)] animate-pulse mb-3" />
          <h3 className="text-xs uppercase tracking-widest font-black text-[var(--ui-text)]">Workstation Empty</h3>
          <p className="text-[10px] text-[var(--ui-muted)] max-w-xs mt-1">
            Please run or deploy a strategy template using the Workspace tab to launch active container instances with real-time TradingView charts.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        /* GRID MONITOR MODE: RENDERS A BEAUTIFUL GRID OF ALL RUNNING INSTANCES WITH INDIVIDUAL CANDLESTICK CHARTS */
        <div className="flex-1 p-4 overflow-y-auto bg-[var(--ui-bg)]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-7xl mx-auto">
            {runningInstances.map((inst) => (
              <SingleInstanceChartCard
                key={inst.id}
                id={inst.id}
                name={inst.name}
                symbol={inst.symbol}
                mode={inst.mode}
                status={inst.status}
                onFocus={(id) => {
                  setActiveRuntimeId(id);
                  setViewMode('single');
                }}
                onStop={(id) => handleStop(id, inst.name)}
              />
            ))}
          </div>
        </div>
      ) : (
        /* SINGLE DETAILED WORKSTATION DEEP MONITOR */
        activeRuntimeId && (
          <div className="flex-1 flex flex-col min-h-0">
            
            {/* Main top workspace - left: chart, right: position summary */}
            <div className="flex-1 flex flex-col md:flex-row min-h-0 border-b md:overflow-hidden overflow-y-auto" style={{ borderColor: 'var(--ui-border)' }}>
              {/* Chart */}
              <div className="flex-1 min-w-0 h-[320px] md:h-full relative bg-[#010409]" ref={chartContainerRef} />

              {/* Position details right rail */}
              {showSnapshot && (
                <div 
                  className="w-full md:w-[280px] border-t md:border-t-0 md:border-l p-4 md:overflow-y-auto space-y-5 shrink-0 bg-[var(--ui-sidebar-bg)] transition-all duration-300"
                  style={{ borderColor: 'var(--ui-border)' }}
                >
                  {/* Active margins status */}
                  <div className="space-y-3">
                    <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] block leading-none pb-1.5 border-b border-[var(--ui-border)]/50">
                      Container State Snapshot
                    </span>

                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--ui-muted)' }}>Holding Position:</span>
                      <span className={`text-[10px] uppercase font-bold px-1.5 rounded border leading-none py-0.5 ${getPositionStyle(typeof telemetry?.position === 'object' && telemetry?.position !== null ? telemetry?.position?.side : (telemetry?.position || 'FLAT'))}`}>
                        {typeof telemetry?.position === 'object' && telemetry?.position !== null ? telemetry?.position?.side : (telemetry?.position || 'FLAT')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--ui-muted)' }}>Entry Threshold:</span>
                      <span className="text-xs font-mono font-bold text-white">
                        {telemetry?.engineState?.positionSnapshot?.entryPrice?.toFixed(5) || '---'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--ui-muted)' }}>Floating Net P&amp;L:</span>
                      <span className={`text-xs font-mono font-black ${(telemetry?.engineState?.positionSnapshot?.totalUnrealized >= 0 || !telemetry) ? 'text-emerald-400' : 'text-red-400'}`}>
                        ${telemetry?.engineState?.positionSnapshot?.totalUnrealized?.toFixed(2) || '---'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--ui-muted)' }}>Total Equity:</span>
                      <span className="text-xs font-mono text-white">
                        ${telemetry?.metrics?.equity?.toLocaleString() || '---'}
                      </span>
                    </div>
                  </div>

                  {/* SL / TP / Trailing indicators */}
                  <div className="space-y-3 border-t border-[var(--ui-border)]/50 pt-4">
                    <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] block leading-none pb-1.5 border-b border-[var(--ui-border)]/50">
                      Risk Safeguards
                    </span>

                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1" style={{ color: 'var(--ui-muted)' }}>
                        <Target size={11} className="text-red-400" />
                        Stop Loss:
                      </span>
                      <span className="font-mono text-[var(--ui-muted)]">
                        {telemetry?.engineState?.risk?.stopLoss?.toFixed(5) || '---'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1" style={{ color: 'var(--ui-muted)' }}>
                        <Target size={11} className="text-emerald-400" />
                        Take Profit:
                      </span>
                      <span className="font-mono text-[var(--ui-muted)]">
                        {telemetry?.engineState?.risk?.takeProfit?.toFixed(5) || '---'}
                      </span>
                    </div>
                  </div>

                  {/* Compact Trade History */}
                  <div className="space-y-2 border-t border-[var(--ui-border)]/50 pt-4">
                    <span className="text-[9px] uppercase font-black tracking-wider text-[var(--ui-muted)] block leading-none pb-1.5 border-b border-[var(--ui-border)]/50">
                      Recent Fills History
                    </span>
                    
                    {telemetry?.fills && telemetry.fills.length > 0 ? (
                      <div className="space-y-1.5">
                        {telemetry.fills.slice(0, 5).map((fill: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-1.5 rounded border border-[var(--ui-border)]/50 bg-[var(--ui-panel-soft)] font-mono text-[10px]">
                            <span className={`font-bold ${fill.side === 'LONG' || fill.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {fill.side || fill.direction || 'FILL'}
                            </span>
                            <span className="text-white">{fill.price?.toFixed(5) || fill.price || '---'}</span>
                            <span className="text-[var(--ui-muted)]">{fill.time ? new Date(fill.time).toLocaleTimeString() : '---'}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-[10px] text-[var(--ui-muted)] italic">
                        No recent fills recorded for this instance.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom terminal log strip */}
            {isTerminalVisible && (
              <div className={`flex flex-col bg-[var(--ui-terminal-bg)] overflow-hidden shrink-0 transition-all duration-200 ${terminalCollapsed ? 'h-8' : 'h-44'}`}>
                <div 
                  className="flex items-center justify-between px-3 h-8 border-b shrink-0 cursor-pointer select-none"
                  style={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border)' }}
                  onClick={() => setTerminalCollapsed(!terminalCollapsed)}
                >
                  <div className="flex items-center gap-1.5">
                    <Terminal size={11} style={{ color: 'var(--ui-muted)' }} />
                    <span className="text-[9px] uppercase font-bold tracking-wider" style={{ color: 'var(--ui-muted)' }}>
                      CONTAINER SYSTEM THREAD OUTPUT
                    </span>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button 
                      onClick={() => activeRuntimeId && clearStrategyLogs(activeRuntimeId)}
                      className="text-[8px] px-1.5 py-0.5 rounded border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white transition-colors cursor-pointer"
                    >
                      CLEAR STREAM
                    </button>
                    <button 
                      onClick={() => setTerminalCollapsed(!terminalCollapsed)}
                      className="text-[8px] px-1.5 py-0.5 rounded border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white transition-colors cursor-pointer uppercase font-black"
                    >
                      {terminalCollapsed ? 'Expand' : 'Collapse'}
                    </button>
                  </div>
                </div>

                {!terminalCollapsed && (
                  <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] leading-relaxed flex flex-col space-y-1">
                    {selectedLogLines.length > 0 ? (
                      selectedLogLines.map((log) => (
                        <div key={log.id} className="flex items-start gap-1.5">
                          <span className="text-[var(--ui-muted)] shrink-0">[{log.timestamp}]</span>
                          <span className={`px-1 text-[8px] rounded border uppercase shrink-0 ${
                            log.level === 'ERROR' ? 'text-red-400 border-red-500/25 bg-red-500/5' : 'text-blue-400 border-blue-500/25 bg-blue-500/5'
                          }`}>
                            {log.level}
                          </span>
                          <span className="text-[var(--ui-text)] break-all font-mono">{log.message}</span>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-full text-[var(--ui-muted)] text-[9px] uppercase tracking-wider">
                        Listening to thread live channels...
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        )
      )}
    </div>
  );
}
