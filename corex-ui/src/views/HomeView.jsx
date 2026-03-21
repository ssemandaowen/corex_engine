import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import ActivityLogger from '../components/home/ActivityLogger';
import { 
  Activity, 
  Cpu, 
  Database, 
  Globe, 
  Terminal, 
  Zap, 
  ChevronUp, 
  ChevronDown, 
  WifiOff 
} from 'lucide-react';

const HomeView = () => {
  const pulse = useStore((s) => s.pulse);
  const resourceTrend = useStore((s) => s.resourceTrend);
  const strategiesLive = useStore((s) => s.strategiesLive);
  const appTerminal = useStore((s) => s.appTerminal);
  const execTerminal = useStore((s) => s.execTerminal);
  const wsStatus = useStore((s) => s.wsStatus);
  const apiStatus = useStore((s) => s.apiStatus);
  const latestTicks = useStore((s) => s.latestTicks);
  const tickCount = useStore((s) => s.tickCount);
  const activityLoggerOpen = useStore((s) => s.activityLoggerOpen);
  const toggleActivityLogger = useStore((s) => s.toggleActivityLogger);

  // --- Data Processing (Memoized) ---
  const liveStats = useMemo(() => {
    const summary = { ticks: tickCount || 0, orders: 0, paramUpdates: 0 };
    const exec = Array.isArray(execTerminal) ? execTerminal : [];
    const app = Array.isArray(appTerminal) ? appTerminal : [];
    summary.orders = exec.length;
    summary.paramUpdates = app.filter((e) => String(e?.message || "").toLowerCase().includes("param")).length;
    return summary;
  }, [appTerminal, execTerminal, tickCount]);

  const latestTickBySymbol = useMemo(() => {
    const map = new Map();
    Object.entries(latestTicks || {}).forEach(([symbol, data]) => {
      map.set(symbol, {
        price: Number(data?.price || 0),
        change: Number(data?.change || 0)
      });
    });
    return map;
  }, [latestTicks]);

  const runningStrategies = useMemo(() => {
    return strategiesLive.filter((s) => {
      const status = String(s?.status || s?.state || '').toUpperCase();
      return ['ACTIVE', 'WARMING_UP', 'RUNNING'].includes(status) || s?.active;
    });
  }, [strategiesLive]);

  // Logger state and resize handling
  const [loggerHeight, setLoggerHeight] = useState(240);
  const dragRef = useRef({ active: false, startY: 0, startH: 240 });

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.active) return;
      const dy = dragRef.current.startY - e.clientY;
      const newHeight = Math.max(120, Math.min(600, dragRef.current.startH + dy));
      setLoggerHeight(newHeight);
    };
    const onUp = () => { dragRef.current.active = false; };
    
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Initializing State (Google-style)
  if (!pulse) return <GoogleLoader />;

  return (
    <div className="ui-page flex flex-col h-full overflow-hidden bg-transparent text-[var(--ui-text)] p-6 gap-6">
      
      {/* SECTION: SYSTEM HONOR VIEW (Connection Bridge) */}
      <div className="flex items-center justify-between bg-[var(--ui-header-glass)] border border-[var(--ui-border)] rounded-lg px-6 py-3 shrink-0">
        <div className="flex items-center gap-8">
          <StatusNode label="CORE ENGINE" status={apiStatus === 'OK'} icon={<Cpu size={14}/>} />
          <div className="h-4 w-px bg-[var(--ui-border)]" />
          <StatusNode label="WS STREAM" status={wsStatus === 'CONNECTED'} icon={<Zap size={14}/>} />
          <div className="h-4 w-px bg-[var(--ui-border)]" />
          <StatusNode label="MT5 BRIDGE" status={pulse?.connectivity?.bridge === 'CONNECTED'} icon={<Database size={14}/>} />
        </div>
        <div className="flex items-center gap-4 text-[11px] font-mono text-[var(--ui-muted)]">
          <span>UPTIME: {pulse?.uptime || '0h 0m'}</span>
          <MiniResourceChart cpu={resourceTrend?.cpu || []} ram={resourceTrend?.ram || []} />
          <span className="text-[var(--ui-accent)]">v2.4.0-PRO</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 h-48 shrink-0">
        {/* Session Activity */}
        <div className="col-span-3 ui-panel flex flex-col justify-between p-5 border-t-2 border-t-[var(--ui-accent)]">
          <div>
            <div className="flex items-center gap-2 text-[var(--ui-muted)] mb-1">
              <Activity size={12} />
              <p className="text-[10px] uppercase tracking-widest font-bold">Session Fills</p>
            </div>
            <h3 className="text-4xl font-light text-[var(--ui-text)]">{liveStats.orders}</h3>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[var(--ui-positive)] uppercase font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ui-positive)] animate-pulse" />
            Order Execution Live
          </div>
        </div>

        {/* Telemetry Metrics */}
        <div className="col-span-4 ui-panel p-5">
          <div className="flex justify-between items-center mb-6">
            <p className="text-[10px] uppercase tracking-widest text-[var(--ui-muted)] font-bold">Hardware Telemetry</p>
            <span className="text-[10px] font-mono text-[var(--ui-accent)]">LATENCY: {pulse?.connectivity?.latency || 0}ms</span>
          </div>
          <div className="space-y-5">
            <ResourceBar label="CPU Load" percent={pulse.resources.cpuPct} color="var(--ui-accent)" />
            <ResourceBar label="RAM Alloc" percent={pulse.resources.ramPct} color="var(--ui-accent-strong)" />
          </div>
        </div>

        {/* Market Snapshot */}
        <div className="col-span-5 ui-panel p-5 overflow-hidden">
          <p className="text-[10px] uppercase tracking-widest text-[var(--ui-muted)] font-bold mb-4">Market Monitor</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {Array.from(latestTickBySymbol.entries()).slice(0, 4).map(([sym, data]) => (
              <div key={sym} className="flex justify-between items-center border-b border-[var(--ui-border)] pb-1">
                <span className="text-xs font-bold text-[var(--ui-muted)]">{sym}</span>
                <span className={`text-xs font-mono ${data.change >= 0 ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-negative)]'}`}>
                  {data.price.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION: STRATEGY DEPLOYMENT */}
      <div className="flex-1 ui-panel flex flex-col overflow-hidden rounded-xl">
        <div className="px-6 py-4 border-b border-[var(--ui-border)] flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Globe size={16} className="text-[var(--ui-accent)]" />
            <h3 className="text-xs font-bold uppercase tracking-widest">Active Deployments</h3>
          </div>
          <span className="px-3 py-1 rounded-full bg-[color:color-mix(in srgb,var(--ui-accent) 16%,transparent)] text-[var(--ui-accent)] text-[10px] font-bold border border-[color:color-mix(in srgb,var(--ui-accent) 28%,transparent)]">
            {runningStrategies.length} SENSORS LIVE
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead className="sticky top-0 bg-[var(--ui-panel-strong)] z-10">
              <tr className="text-[10px] uppercase text-[var(--ui-muted)] font-bold">
                <th className="px-6 py-3 border-b border-[var(--ui-border)]">Instance ID</th>
                <th className="px-6 py-3 border-b border-[var(--ui-border)]">Operational Logic</th>
                <th className="px-6 py-3 border-b border-[var(--ui-border)] text-right">Last Price</th>
                <th className="px-6 py-3 border-b border-[var(--ui-border)] text-right">Data Depth</th>
                <th className="px-6 py-3 border-b border-[var(--ui-border)] text-right">Lookback</th>
              </tr>
            </thead>
            <tbody className="text-[12px]">
              {runningStrategies.map((s) => {
                const priceInfo = latestTickBySymbol.get(s.symbols?.[0]);
                return (
                  <StrategyRow key={s.id} s={s} priceInfo={priceInfo} />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION: SYSTEM ACTIVITY LOGGER - Resizable & Toggleable */}
      {activityLoggerOpen && (
        <div 
          className="shrink-0 bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] rounded-t-xl overflow-hidden flex flex-col group"
          style={{ height: `${loggerHeight}px` }}
        >
          {/* Resize Handle (Top) */}
          <div
            onMouseDown={(e) => {
              dragRef.current.active = true;
              dragRef.current.startY = e.clientY;
              dragRef.current.startH = loggerHeight;
            }}
            className="h-1 bg-[var(--ui-border)] hover:bg-[var(--ui-accent)] cursor-ns-resize transition-colors shrink-0"
            title="Drag to resize"
          />

          {/* Header */}
          <div className="px-6 py-3 border-b border-[var(--ui-border)] flex items-center justify-between bg-[var(--ui-header-glass)] shrink-0">
            <div className="flex items-center gap-3">
              <Terminal size={14} className="text-[var(--ui-accent)]" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ui-text)]">System Activity</h3>
              <span className="text-[10px] text-[var(--ui-muted)] font-mono ml-2">
                ({(Array.isArray(appTerminal) ? appTerminal.length : 0) + (Array.isArray(execTerminal) ? execTerminal.length : 0)} events)
              </span>
            </div>
            <button
              onClick={() => toggleActivityLogger()}
              className="p-1 text-[var(--ui-muted)] hover:text-[var(--ui-text)] transition-colors"
              title="Close logger"
            >
              <ChevronDown size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            <ActivityLogger />
          </div>
        </div>
      )}

      {/* Collapsed Logger Button */}
      {!activityLoggerOpen && (
        <div className="shrink-0">
          <button
            onClick={() => toggleActivityLogger()}
            className="w-full px-6 py-3 bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] rounded-lg flex items-center justify-between hover:bg-[var(--ui-row-hover)] transition-colors"
          >
            <div className="flex items-center gap-3">
              <Terminal size={14} className="text-[var(--ui-accent)]" />
              <span className="text-xs font-bold uppercase tracking-widest text-[var(--ui-text)]">System Activity</span>
              <span className="text-[10px] text-[var(--ui-muted)] font-mono">
                ({(Array.isArray(appTerminal) ? appTerminal.length : 0) + (Array.isArray(execTerminal) ? execTerminal.length : 0)} events)
              </span>
            </div>
            <ChevronUp size={16} className="text-[var(--ui-muted)]" />
          </button>
        </div>
      )}
    </div>
  );
};

// --- Helper Components ---

const GoogleLoader = () => (
  <div className="h-full w-full flex flex-col items-center justify-center">
    <div className="w-64">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--ui-accent)] uppercase">CoreX Bootstrapping</span>
        <span className="text-[10px] text-[var(--ui-muted)] font-mono">ESTABLISHING HANDSHAKE...</span>
      </div>
      <div className="h-1 w-full bg-[var(--ui-border)] rounded-full overflow-hidden relative">
        <div className="absolute h-full bg-[var(--ui-accent)] animate-[google-loader_2s_infinite_ease-in-out]" style={{ width: '40%' }} />
      </div>
    </div>
    <style>{`
      @keyframes google-loader {
        0% { left: -40%; }
        50% { left: 100%; }
        100% { left: -40%; }
      }
    `}</style>
  </div>
);

const StatusNode = React.memo(({ label, status, icon }) => (
  <div className="flex items-center gap-3">
    <div className={`p-1.5 rounded-md ${status ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-negative)]'}`} style={{ backgroundColor: status ? 'color-mix(in srgb, var(--ui-positive) 16%, transparent)' : 'color-mix(in srgb, var(--ui-negative) 16%, transparent)' }}>
      {status ? icon : <WifiOff size={14} />}
    </div>
    <div>
      <p className="text-[8px] uppercase text-[var(--ui-muted)] font-bold leading-none mb-1">{label}</p>
      <p className={`text-[10px] font-bold leading-none ${status ? 'text-[var(--ui-text)]' : 'text-[var(--ui-negative)]'}`}>
        {status ? 'SECURE' : 'OFFLINE'}
      </p>
    </div>
  </div>
));

const ResourceBar = React.memo(({ label, percent, color }) => (
  <div className="group">
    <div className="flex justify-between text-[10px] mb-1.5 font-bold uppercase tracking-tighter">
      <span className="text-[var(--ui-muted)]">{label}</span>
      <span className="text-[var(--ui-text)] transition-colors">{percent}%</span>
    </div>
    <div className="w-full bg-[var(--ui-border)] h-1.5 rounded-full overflow-hidden">
      <div className="h-full transition-all duration-1000 ease-out" style={{ width: `${percent}%`, backgroundColor: color, boxShadow: `0 0 8px color-mix(in srgb, ${color} 50%, transparent)` }} />
    </div>
  </div>
));

const StrategyRow = React.memo(({ s, priceInfo }) => (
  <tr className="hover:bg-[var(--ui-row-hover)] transition-colors group">
    <td className="px-6 py-4 border-b border-[var(--ui-border)] font-mono text-[var(--ui-accent)]">{s.id || s.name}</td>
    <td className="px-6 py-4 border-b border-[var(--ui-border)]">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--ui-positive)] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--ui-positive)]"></span>
        </span>
        <span className="font-bold text-[var(--ui-text)]">EXECUTING</span>
      </div>
    </td>
    <td className={`px-6 py-4 border-b border-[var(--ui-border)] text-right font-mono ${priceInfo?.change >= 0 ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-negative)]'}`}>
      {priceInfo?.price?.toFixed(5) || '---'}
    </td>
    <td className="px-6 py-4 border-b border-[var(--ui-border)] text-right text-[var(--ui-muted)] font-mono italic">
      hist:{s.historyPoints || 0} / total:{s.dataPoints || 0}
    </td>
    <td className="px-6 py-4 border-b border-[var(--ui-border)] text-right text-[var(--ui-muted)] font-mono italic">
      {s.lookback || 0} ({Number(s.lookbackCoveragePct || 0).toFixed(1)}%)
    </td>
  </tr>
));

const MiniResourceChart = React.memo(({ cpu = [], ram = [] }) => {
  const w = 120;
  const h = 32;
  const pointsToPath = (series = []) => {
    if (!Array.isArray(series) || series.length === 0) return '';
    const step = series.length > 1 ? w / (series.length - 1) : w;
    return series
      .map((v, i) => {
        const clamped = Math.max(0, Math.min(100, Number(v || 0)));
        const x = i * step;
        const y = h - ((clamped / 100) * h);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  };
  const cpuNow = Math.round(Number(cpu[cpu.length - 1] || 0));
  const ramNow = Math.round(Number(ram[ram.length - 1] || 0));

  return (
    <div className="hidden xl:flex items-center gap-2 px-2 py-1 rounded-md border border-[var(--ui-border)] bg-[var(--ui-panel)]">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
        <path d={pointsToPath(cpu)} fill="none" stroke="var(--ui-accent)" strokeWidth="1.5" />
        <path d={pointsToPath(ram)} fill="none" stroke="var(--ui-accent-strong)" strokeWidth="1.5" />
      </svg>
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-wide text-[var(--ui-muted)]">CPU {cpuNow}%</div>
        <div className="text-[9px] uppercase tracking-wide text-[var(--ui-muted)]">RAM {ramNow}%</div>
      </div>
    </div>
  );
});

export default HomeView;
