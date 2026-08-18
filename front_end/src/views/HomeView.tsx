import React, { useEffect, useState, useRef, useMemo } from 'react';
import useDataStore from '../store/dataStore';
import useUiStore from '../store/uiStore';
import { useTerminalContext } from '../context/TerminalContext';
import { runApi } from '../api/run';
import {
  Trash2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  BarChart3,
  Play,
  RefreshCw,
  Activity,
  Radio,
  ClipboardCopy,
  X,
  Save
} from 'lucide-react';

const num = (v: any, fallback: number = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const MAX_LOGS = 300;
const HISTORY_LEN = 40;

export default function HomeView() {
  const { activityLogs, clearActivityLogs, strategies, latestTicks, runtimes } = useDataStore();
  const { engineStatus, setEngineStatus } = useUiStore();
  const { isTerminalVisible, setIsTerminalVisible } = useTerminalContext();

  const sysStatus = useDataStore(state => state.systemStatus);
  const feedMetrics = useDataStore(state => state.feedMetrics);

  const [opsTelemetry, setOpsTelemetry] = useState<{ runtimes: any[]; feed: any; engine: any }>({
    runtimes: [],
    feed: { eventsPerSec: 0, latencyMs: 0 },
    engine: { activeWorkerCount: 0, memoryUseMb: 0 }
  });

  const [activeTabFilter, setActiveTabFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [isHoveredTerminal, setIsHoveredTerminal] = useState(false);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const terminalBodyRef = useRef<HTMLDivElement>(null);

  // WS-driven CPU/RAM history — only append when server pushes new resource data
  useEffect(() => {
    const cpuVal = num(sysStatus?.resources?.cpuPct, 0);
    const ramVal = num(sysStatus?.resources?.ramPct, 0);
    setCpuHistory(prev => [...prev.slice(-HISTORY_LEN + 1), cpuVal]);
    setRamHistory(prev => [...prev.slice(-HISTORY_LEN + 1), ramVal]);
  }, [sysStatus?.resources?.cpuPct, sysStatus?.resources?.ramPct]);

  // Derive engineStatus from WS-pushed systemStatus
  useEffect(() => {
    if (!sysStatus || Object.keys(sysStatus).length === 0) {
      setEngineStatus('OFFLINE');
      return;
    }
    const dbStatus = sysStatus.db;
    const feedStatus = sysStatus.connectivity?.marketData;
    if (dbStatus !== 'CONNECTED' || feedStatus !== 'CONNECTED') {
      setEngineStatus('DEGRADED');
    } else {
      setEngineStatus('STABLE');
    }
  }, [sysStatus, setEngineStatus]);

  // Fetch running instances (still REST until WS push is added server-side)
  const fetchOpsTelemetry = async () => {
    try {
      const opsRes = await runApi.getOpsTelemetry();
      if (opsRes.success) {
        const p = opsRes.payload || {};
        setOpsTelemetry({
          runtimes: p.runtimes || [],
          feed: { eventsPerSec: num(p.feed?.eventsPerSec), latencyMs: num(p.feed?.latencyMs) },
          engine: { activeWorkerCount: num(p.engine?.activeWorkerCount), memoryUseMb: num(p.engine?.memoryUseMb) }
        });
      }
    } catch (e) {
      console.error('Failed to poll ops telemetry', e);
    }
  };

  useEffect(() => {
    fetchOpsTelemetry();
    const interval = setInterval(fetchOpsTelemetry, 20000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (!isHoveredTerminal && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activityLogs, isHoveredTerminal]);

  const getStatusColor = (status: string) => {
    const s = String(status || '').toUpperCase();
    if (['CONNECTED', 'ONLINE', 'STABLE', 'OK', 'RUNNING', 'ACTIVE'].includes(s)) return 'var(--ui-positive)';
    if (['IDLE', 'DEGRADED', 'PENDING', 'RECONNECTING', 'PENDING_AUTH', 'WARN'].includes(s)) return 'var(--ui-warning)';
    return 'var(--ui-negative)';
  };

  const getLogBadgeColor = (level: string) => {
    switch (level) {
      case 'ERROR': return 'var(--ui-negative)';
      case 'WARN': return 'var(--ui-warning)';
      default: return 'var(--ui-accent)';
    }
  };

  // Tiny combined CPU/RAM sparkline for the bottom bar
  const renderMiniSparkline = (points: number[], color: string) => {
    if (points.length === 0) return null;
    const width = 80;
    const height = 20;
    const coords = points.map((val, i) => {
      const safe = Number.isFinite(val) ? Math.max(0, Math.min(100, val)) : 0;
      const x = (i / (points.length - 1)) * width;
      const y = height - (safe / 100) * height;
      return `${x},${y}`;
    });
    const pathData = `M ${coords.join(' L ')}`;
    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible block">
        <path d={pathData} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };

  // Terminal actions
  const handleCopyLogs = async () => {
    const text = filteredLogs.map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveLogs = () => {
    const text = filteredLogs.map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `corex-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const navigateToExecution = () => {
    window.dispatchEvent(new CustomEvent('corex:navigate', { detail: { tab: 'run' } }));
  };

  const navigateToAnalytics = () => {
    window.dispatchEvent(new CustomEvent('corex:navigate', { detail: { tab: 'data' } }));
  };

  // Merge REST runtimes with WS runtimes for the most up-to-date view
  const wsRuntimeKeys = useMemo(() => {
    const map: Record<string, any> = {};
    for (const [k, v] of Object.entries(runtimes)) {
      map[k] = v;
    }
    return map;
  }, [runtimes]);

  const allRuntimes = useMemo(() => {
    const rest = (opsTelemetry.runtimes || []).map((r: any) => ({
      ...r,
      _source: 'rest' as const
    }));
    const wsEntries = Object.entries(wsRuntimeKeys).map(([k, v]: [string, any]) => ({
      ...v,
      runtimeId: v.runtimeId || k,
      strategyName: v.strategyName || v.name || k,
      _source: 'ws' as const
    }));
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const r of [...rest, ...wsEntries]) {
      const key = String(r.runtimeId || r.strategyName || r.id);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }
    return merged;
  }, [opsTelemetry.runtimes, wsRuntimeKeys]);

  const runningRuntimes = useMemo(() => {
    return allRuntimes.filter(r => String(r.status || '').toLowerCase() === 'running');
  }, [allRuntimes]);

  const paperCount = runningRuntimes.filter(r => String(r.mode || '').toUpperCase() === 'PAPER').length;
  const liveCount = runningRuntimes.filter(r => String(r.mode || '').toUpperCase() === 'LIVE').length;

  const filteredLogs = activityLogs.filter(log => {
    if (activeTabFilter === 'ALL') return true;
    return log.level === activeTabFilter;
  });

  const statusDot = (status: string) => (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
      style={{ backgroundColor: getStatusColor(status) }}
      title={status}
    />
  );

  return (
    <div className="flex flex-col lg:flex-row h-full w-full overflow-hidden select-none" style={{ backgroundColor: 'var(--ui-bg)' }}>
      {/* MAIN PANEL */}
      <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${isTerminalVisible ? 'lg:w-1/2' : 'w-full'}`}>
        {/* Instances Grid */}
        <div className="flex-1 overflow-y-auto p-3 lg:p-4">
          {runningRuntimes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <Activity size={32} style={{ color: 'var(--ui-muted)' }} />
              <div>
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--ui-muted)' }}>
                  No Active Runtimes
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--ui-subtle)' }}>
                  Launch a strategy from Execution to see live metrics here.
                </p>
              </div>
              <button
                onClick={navigateToExecution}
                className="mt-2 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider border cursor-pointer transition-all hover:border-[var(--ui-accent)]"
                style={{ color: 'var(--ui-accent)', borderColor: 'var(--ui-border)' }}
              >
                <Play size={10} className="inline mr-1" />
                Launch Strategy
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {runningRuntimes.map((r) => {
                const mode = String(r.mode || 'PAPER').toUpperCase();
                const isPaper = mode === 'PAPER';
                const tick = latestTicks[r.symbol] || latestTicks[r.symbol?.toLowerCase()];
                const price = tick ? (tick.bid || tick.ask || 0) : null;
                const strategyStatus = strategies.find(s => s.id === r.strategyName || s.name === r.strategyName);
                const isRunning = strategyStatus ? String(strategyStatus.status).toLowerCase() === 'running' : String(r.status).toLowerCase() === 'running';

                return (
                  <div
                    key={r.runtimeId || r.strategyName}
                    onClick={navigateToExecution}
                    className="group relative p-3 rounded-lg border cursor-pointer transition-all hover:border-[var(--ui-accent)]/40 hover:bg-[var(--ui-panel-soft)]/50"
                    style={{ backgroundColor: 'var(--ui-panel)', borderColor: 'var(--ui-border)' }}
                  >
                    {/* Header: name + mode */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-black font-mono truncate pr-2" style={{ color: 'var(--ui-text)' }}>
                        {r.strategyName || 'Unknown'}
                      </span>
                      <span
                        className="text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0"
                        style={{
                          backgroundColor: isPaper ? 'rgba(59,130,246,0.1)' : 'rgba(245,158,11,0.1)',
                          color: isPaper ? 'var(--ui-positive)' : 'var(--ui-warning)',
                          border: `1px solid ${isPaper ? 'rgba(59,130,246,0.2)' : 'rgba(245,158,11,0.2)'}`
                        }}
                      >
                        {mode}
                      </span>
                    </div>

                    {/* Symbol + Price */}
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-[10px] font-mono font-bold" style={{ color: 'var(--ui-muted)' }}>
                        {r.symbol || '—'}
                      </span>
                      <span className="text-sm font-mono font-black" style={{ color: price ? 'var(--ui-text)' : 'var(--ui-muted)' }}>
                        {price !== null ? price.toFixed(r.symbol?.includes('JPY') ? 3 : 5) : '—'}
                      </span>
                    </div>

                    {/* Footer: status + PnL */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {statusDot(isRunning ? 'RUNNING' : 'STOPPED')}
                        <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--ui-muted)' }}>
                          {isRunning ? 'LIVE' : 'IDLE'}
                        </span>
                      </div>
                      <span
                        className="text-[10px] font-mono font-black"
                        style={{ color: num(r.pnl) >= 0 ? 'var(--ui-positive)' : 'var(--ui-negative)' }}
                      >
                        {num(r.pnl) >= 0 ? '+' : ''}{num(r.pnl).toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Compact Bottom Bar */}
        <div
          className="shrink-0 border-t flex items-center gap-3 px-3 py-1.5"
          style={{ borderColor: 'var(--ui-border)', backgroundColor: 'var(--ui-panel-strong)' }}
        >
          {/* CPU/RAM Mini Sparkline */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col w-20">
              <span className="text-[8px] font-mono uppercase tracking-wider mb-0.5" style={{ color: 'var(--ui-muted)' }}>
                CPU {num(sysStatus?.resources?.cpuPct, 0).toFixed(0)}%
              </span>
              {renderMiniSparkline(cpuHistory, '#1e90ff')}
            </div>
            <div className="w-px h-6 bg-[var(--ui-border)]" />
            <div className="flex flex-col w-20">
              <span className="text-[8px] font-mono uppercase tracking-wider mb-0.5" style={{ color: 'var(--ui-muted)' }}>
                RAM {num(sysStatus?.resources?.ramPct, 0).toFixed(0)}%
              </span>
              {renderMiniSparkline(ramHistory, '#a855f7')}
            </div>
          </div>

          {/* Connection Status Dots */}
          <div className="hidden sm:flex items-center gap-2 ml-2">
            {statusDot(sysStatus.db || 'DISABLED')}
            {statusDot(sysStatus.connectivity?.marketData || 'DISCONNECTED')}
            {statusDot(sysStatus.connectivity?.bridge || 'DISCONNECTED')}
            {statusDot(sysStatus.worker || 'OFFLINE')}
          </div>

          <div className="flex-1" />

          {/* Shortcuts */}
          <button
            onClick={navigateToAnalytics}
            className="p-1.5 rounded border transition-all cursor-pointer hover:border-[var(--ui-accent)]"
            style={{ color: 'var(--ui-muted)', borderColor: 'var(--ui-border)' }}
            title="Recent Backtests → Analytics"
          >
            <BarChart3 size={12} />
          </button>

          <button
            onClick={fetchOpsTelemetry}
            className="p-1.5 rounded border transition-all cursor-pointer hover:border-[var(--ui-accent)]"
            style={{ color: 'var(--ui-muted)', borderColor: 'var(--ui-border)' }}
            title="Refresh Instances"
          >
            <RefreshCw size={12} />
          </button>

          <button
            onClick={() => setIsTerminalVisible(!isTerminalVisible)}
            className="p-1.5 rounded border transition-all cursor-pointer hover:border-[var(--ui-accent)]"
            style={{ color: 'var(--ui-muted)', borderColor: 'var(--ui-border)' }}
            title={isTerminalVisible ? 'Hide Terminal' : 'Show Terminal'}
          >
            {isTerminalVisible ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>
        </div>
      </div>

      {/* TERMINAL PANEL */}
      {isTerminalVisible && (
        <div
          className="hidden lg:flex flex-col w-full lg:w-80 xl:w-96 border-l"
          style={{ borderColor: 'var(--ui-border)', backgroundColor: 'var(--ui-bg)' }}
        >
          {/* Terminal Header */}
          <div className="shrink-0 border-b px-3 py-2 flex items-center justify-between" style={{ borderColor: 'var(--ui-border)' }}>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--ui-text)' }}>
                Terminal
              </span>
              <span className="text-[8px] font-mono px-1 rounded" style={{ color: 'var(--ui-muted)', backgroundColor: 'var(--ui-panel-soft)' }}>
                {filteredLogs.length}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <div className="flex rounded border overflow-hidden" style={{ borderColor: 'var(--ui-border)' }}>
                {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setActiveTabFilter(f)}
                    className="px-1.5 py-0.5 text-[8px] font-mono font-bold transition-colors cursor-pointer"
                    style={{
                      backgroundColor: activeTabFilter === f ? 'var(--ui-accent)' : 'transparent',
                      color: activeTabFilter === f ? '#fff' : 'var(--ui-muted)'
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <button
                onClick={handleCopyLogs}
                className="p-1 rounded transition-colors cursor-pointer"
                style={{ color: copied ? 'var(--ui-positive)' : 'var(--ui-muted)' }}
                title="Copy logs"
              >
                {copied ? <ClipboardCopy size={10} /> : <Copy size={10} />}
              </button>

              <button
                onClick={handleSaveLogs}
                className="p-1 rounded transition-colors cursor-pointer"
                style={{ color: saved ? 'var(--ui-positive)' : 'var(--ui-muted)' }}
                title="Save logs"
              >
                {saved ? <Save size={10} /> : <Download size={10} />}
              </button>

              <button
                onClick={clearActivityLogs}
                className="p-1 rounded transition-colors cursor-pointer hover:text-red-400"
                style={{ color: 'var(--ui-muted)' }}
                title="Clear logs"
              >
                <Trash2 size={10} />
              </button>

              <button
                onClick={() => setIsTerminalVisible(false)}
                className="p-1 rounded transition-colors cursor-pointer hover:text-white"
                style={{ color: 'var(--ui-muted)' }}
                title="Close terminal"
              >
                <X size={10} />
              </button>
            </div>
          </div>

          {/* Log Stream */}
          <div
            ref={terminalBodyRef}
            className="flex-1 overflow-y-auto p-2 font-mono text-[10px] leading-relaxed"
            style={{ backgroundColor: 'var(--ui-terminal-bg)' }}
            onMouseEnter={() => setIsHoveredTerminal(true)}
            onMouseLeave={() => setIsHoveredTerminal(false)}
          >
            {filteredLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2">
                <Radio size={16} style={{ color: 'var(--ui-muted)' }} />
                <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ui-muted)' }}>
                  No logs to display
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-1.5 hover:bg-white/5 px-1 py-0.5 rounded transition-colors group"
                  >
                    <span className="shrink-0 select-none" style={{ color: 'var(--ui-muted)' }}>
                      [{log.timestamp}]
                    </span>
                    <span
                      className="text-[8px] font-black uppercase tracking-wider shrink-0 leading-none mt-px"
                      style={{ color: getLogBadgeColor(log.level) }}
                    >
                      {log.level}
                    </span>
                    <span className="break-all flex-1" style={{ color: 'var(--ui-text)' }}>
                      {log.message}
                    </span>
                  </div>
                ))}
                <div ref={terminalEndRef} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
