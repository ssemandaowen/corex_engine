import React, { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { 
  Activity, 
  Cpu, 
  Database, 
  Globe, 
  Hash, 
  Terminal, 
  Zap, 
  ChevronUp, 
  ChevronDown, 
  Wifi, 
  WifiOff 
} from 'lucide-react';

const HomeView = () => {
  const { pulse, strategiesLive, wsEvents, wsStatus, apiStatus, latestTicks, tickCount } = useStore();

  // --- Data Processing (Memoized) ---
  const liveStats = useMemo(() => {
    const summary = { ticks: tickCount || 0, orders: 0, paramUpdates: 0 };
    wsEvents.forEach(evt => {
      if (evt?.type === 'ORDER_FILLED') summary.orders++;
      else if (evt?.type === 'PARAM_UPDATE') summary.paramUpdates++;
    });
    return summary;
  }, [wsEvents, tickCount]);

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

  // --- UI State ---
  const [logOpen, setLogOpen] = useState(true);
  const [logHeight] = useState(240);
  const [logCategory, setLogCategory] = useState('all');
  const [errorsOnly, setErrorsOnly] = useState(false);

  const filteredLogs = useMemo(() => {
    let events = wsEvents || [];
    if (logCategory !== 'all') {
      events = events.filter(e => e?.meta?.category === logCategory);
    }
    if (errorsOnly) {
      events = events.filter(e => String(e?.type || '').includes('ERROR') || e?.payload?.error || e?.payload?.reason);
    }
    return events;
  }, [wsEvents, logCategory, errorsOnly]);

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

      {/* SECTION: CONSOLE */}
      <div className="shrink-0 bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] rounded-t-xl overflow-hidden" style={{ height: logOpen ? logHeight : 42 }}>
        <div className="h-10 flex items-center justify-between px-4 bg-[var(--ui-header-glass)] border-b border-[var(--ui-border)] cursor-pointer" onClick={() => setLogOpen(!logOpen)}>
          <div className="flex items-center gap-3">
            <Terminal size={14} className="text-[var(--ui-muted)]" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-muted)]">Hub Event Stream</span>
          </div>
          {logOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
        {logOpen && (
          <div className="p-4 overflow-y-auto font-mono text-[11px] h-full pb-12">
            <div className="flex items-center gap-2 mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--ui-muted)]">
              <button
                onClick={() => setLogCategory('all')}
                className={`px-2 py-1 rounded border ${logCategory === 'all' ? 'text-[var(--ui-accent)] border-[var(--ui-border-strong)] bg-[var(--ui-row-hover)]' : 'border-[var(--ui-border)] text-[var(--ui-muted)]'}`}
              >
                All
              </button>
              {['system', 'strategy', 'execution', 'market', 'mt5'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setLogCategory(cat)}
                  className={`px-2 py-1 rounded border ${logCategory === cat ? 'text-[var(--ui-accent)] border-[var(--ui-border-strong)] bg-[var(--ui-row-hover)]' : 'border-[var(--ui-border)] text-[var(--ui-muted)]'}`}
                >
                  {cat}
                </button>
              ))}
              <button
                onClick={() => setErrorsOnly(!errorsOnly)}
                className={`ml-auto px-2 py-1 rounded border ${errorsOnly ? 'text-[var(--ui-negative)] border-[var(--ui-border-strong)] bg-[var(--ui-row-hover)]' : 'border-[var(--ui-border)] text-[var(--ui-muted)]'}`}
              >
                Errors Only
              </button>
            </div>
            {filteredLogs.slice(0, 80).map((evt, idx) => (
              <div key={idx} className="flex gap-4 mb-1 opacity-80 hover:opacity-100">
                <span className="text-[var(--ui-subtle)]">[{new Date(evt.meta?.ts).toLocaleTimeString()}]</span>
                <span className={`w-24 font-bold ${getLogColor(evt.type, evt.meta?.category)}`}>{evt.type}</span>
                <span className="text-[var(--ui-muted)] uppercase w-20">{evt.meta?.category || 'system'}</span>
                <span className="text-[var(--ui-text)]">{formatPayload(evt.payload)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
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

const getLogColor = (type, category) => {
  switch (category) {
    case 'strategy':
      return 'text-[var(--ui-accent-strong)]';
    case 'execution':
      return 'text-[var(--ui-positive)]';
    case 'market':
      return 'text-[var(--ui-accent)]';
    case 'mt5':
      return 'text-[var(--ui-warning)]';
  }
  if (type === 'ORDER_FILLED') return 'text-[var(--ui-positive)]';
  if (type === 'PARAM_UPDATE') return 'text-[var(--ui-warning)]';
  if (type.includes('ERROR')) return 'text-[var(--ui-negative)]';
  return 'text-[var(--ui-accent)]';
};

const formatPayload = (payload) => {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (payload.message) return payload.message;
  if (payload.reason) return payload.reason;
  if (payload.error) return payload.error;
  if (payload.strategyId) return `strategy=${payload.strategyId}`;
  if (payload.symbol) return `symbol=${payload.symbol}`;
  return JSON.stringify(payload).slice(0, 100);
};

export default HomeView;
