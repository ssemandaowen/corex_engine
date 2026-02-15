import React, { useMemo, useState, useRef } from 'react';
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
  const { pulse, strategiesLive, wsEvents, wsStatus, apiStatus } = useStore();

  // --- Data Processing (Memoized) ---
  const liveStats = useMemo(() => {
    const summary = { ticks: 0, orders: 0, paramUpdates: 0 };
    wsEvents.forEach(evt => {
      if (evt?.type === 'DATA_TICK') summary.ticks++;
      else if (evt?.type === 'ORDER_FILLED') summary.orders++;
      else if (evt?.type === 'PARAM_UPDATE') summary.paramUpdates++;
    });
    return summary;
  }, [wsEvents]);

  const latestTickBySymbol = useMemo(() => {
    const map = new Map();
    wsEvents.filter(e => e.type === 'DATA_TICK').forEach(evt => {
      const symbol = evt?.payload?.symbol || evt?.payload?.instrument;
      const price = Number(evt?.payload?.price ?? evt?.payload?.close ?? 0);
      if (symbol) {
        const prev = map.get(symbol);
        map.set(symbol, { price, change: prev ? price - prev.price : 0 });
      }
    });
    return map;
  }, [wsEvents]);

  const runningStrategies = useMemo(() => {
    return strategiesLive.filter((s) => {
      const status = String(s?.status || s?.state || '').toUpperCase();
      return ['ACTIVE', 'WARMING_UP', 'RUNNING'].includes(status) || s?.active;
    });
  }, [strategiesLive]);

  // --- UI State ---
  const [logOpen, setLogOpen] = useState(true);
  const [logHeight, setLogHeight] = useState(240);

  // Initializing State (Google-style)
  if (!pulse) return <GoogleLoader />;

  return (
    <div className="ui-page flex flex-col h-screen overflow-hidden bg-[#0b0e14] text-slate-300 p-6 gap-6">
      
      {/* SECTION: SYSTEM HONOR VIEW (Connection Bridge) */}
      <div className="flex items-center justify-between bg-slate-900/40 border border-slate-800 rounded-lg px-6 py-3 shrink-0">
        <div className="flex items-center gap-8">
          <StatusNode label="CORE ENGINE" status={apiStatus === 'OK'} icon={<Cpu size={14}/>} />
          <div className="h-4 w-px bg-slate-800" />
          <StatusNode label="WS STREAM" status={wsStatus === 'CONNECTED'} icon={<Zap size={14}/>} />
          <div className="h-4 w-px bg-slate-800" />
          <StatusNode label="MT5 BRIDGE" status={pulse?.connectivity?.bridge === 'CONNECTED'} icon={<Database size={14}/>} />
        </div>
        <div className="flex items-center gap-4 text-[11px] font-mono text-slate-500">
          <span>UPTIME: {pulse?.uptime || '0h 0m'}</span>
          <span className="text-blue-500">v2.4.0-PRO</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 h-48 shrink-0">
        {/* Session Activity */}
        <div className="col-span-3 ui-panel flex flex-col justify-between p-5 border-t-2 border-t-blue-600 bg-slate-900/20">
          <div>
            <div className="flex items-center gap-2 text-slate-500 mb-1">
              <Activity size={12} />
              <p className="text-[10px] uppercase tracking-widest font-bold">Session Fills</p>
            </div>
            <h3 className="text-4xl font-light text-white">{liveStats.orders}</h3>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-emerald-500 uppercase font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Order Execution Live
          </div>
        </div>

        {/* Telemetry Metrics */}
        <div className="col-span-4 ui-panel p-5 bg-slate-900/20">
          <div className="flex justify-between items-center mb-6">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Hardware Telemetry</p>
            <span className="text-[10px] font-mono text-blue-400">LATENCY: {pulse?.connectivity?.latency || 0}ms</span>
          </div>
          <div className="space-y-5">
            <ResourceBar label="CPU Load" percent={pulse.resources.cpuPct} color="bg-blue-500" />
            <ResourceBar label="RAM Alloc" percent={pulse.resources.ramPct} color="bg-indigo-500" />
          </div>
        </div>

        {/* Market Snapshot */}
        <div className="col-span-5 ui-panel p-5 bg-slate-900/20 overflow-hidden">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-4">Market Monitor</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {Array.from(latestTickBySymbol.entries()).slice(0, 4).map(([sym, data]) => (
              <div key={sym} className="flex justify-between items-center border-b border-slate-800 pb-1">
                <span className="text-xs font-bold text-slate-400">{sym}</span>
                <span className={`text-xs font-mono ${data.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {data.price.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION: STRATEGY DEPLOYMENT */}
      <div className="flex-1 ui-panel flex flex-col overflow-hidden bg-slate-900/10 border border-slate-800 rounded-xl">
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Globe size={16} className="text-blue-500" />
            <h3 className="text-xs font-bold uppercase tracking-widest">Active Deployments</h3>
          </div>
          <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold border border-blue-500/20">
            {runningStrategies.length} SENSORS LIVE
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead className="sticky top-0 bg-[#0d1017] z-10">
              <tr className="text-[10px] uppercase text-slate-500 font-bold">
                <th className="px-6 py-3 border-b border-slate-800">Instance ID</th>
                <th className="px-6 py-3 border-b border-slate-800">Operational Logic</th>
                <th className="px-6 py-3 border-b border-slate-800 text-right">Last Price</th>
                <th className="px-6 py-3 border-b border-slate-800 text-right">Data Depth</th>
              </tr>
            </thead>
            <tbody className="text-[12px]">
              {runningStrategies.map((s) => {
                const priceInfo = latestTickBySymbol.get(s.symbols?.[0]);
                return (
                  <tr key={s.id} className="hover:bg-blue-500/[0.03] transition-colors group">
                    <td className="px-6 py-4 border-b border-slate-800/50 font-mono text-blue-400">{s.id || s.name}</td>
                    <td className="px-6 py-4 border-b border-slate-800/50">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span className="font-bold text-slate-200">EXECUTING</span>
                      </div>
                    </td>
                    <td className={`px-6 py-4 border-b border-slate-800/50 text-right font-mono ${priceInfo?.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {priceInfo?.price?.toFixed(5) || '---'}
                    </td>
                    <td className="px-6 py-4 border-b border-slate-800/50 text-right text-slate-500 font-mono italic">
                      {s.dataPoints || 0} pts
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION: CONSOLE */}
      <div className="shrink-0 bg-[#080a0f] border border-slate-800 rounded-t-xl overflow-hidden" style={{ height: logOpen ? logHeight : 42 }}>
        <div className="h-10 flex items-center justify-between px-4 bg-slate-900/50 border-b border-slate-800 cursor-pointer" onClick={() => setLogOpen(!logOpen)}>
          <div className="flex items-center gap-3">
            <Terminal size={14} className="text-slate-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Hub Event Stream</span>
          </div>
          {logOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
        {logOpen && (
          <div className="p-4 overflow-y-auto font-mono text-[11px] h-full pb-12">
            {wsEvents.slice(0, 50).map((evt, idx) => (
              <div key={idx} className="flex gap-4 mb-1 opacity-80 hover:opacity-100">
                <span className="text-slate-600">[{new Date(evt.meta?.ts).toLocaleTimeString()}]</span>
                <span className={`w-24 font-bold ${getLogColor(evt.type)}`}>{evt.type}</span>
                <span className="text-slate-300">{JSON.stringify(evt.payload).slice(0, 80)}...</span>
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
  <div className="h-screen w-full flex flex-col items-center justify-center bg-[#0b0e14]">
    <div className="w-64">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold tracking-[0.2em] text-blue-500 uppercase">CoreX Bootstrapping</span>
        <span className="text-[10px] text-slate-600 font-mono">ESTABLISHING HANDSHAKE...</span>
      </div>
      <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden relative">
        <div className="absolute h-full bg-blue-500 animate-[google-loader_2s_infinite_ease-in-out]" style={{ width: '40%' }} />
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

const StatusNode = ({ label, status, icon }) => (
  <div className="flex items-center gap-3">
    <div className={`p-1.5 rounded-md ${status ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
      {status ? icon : <WifiOff size={14} />}
    </div>
    <div>
      <p className="text-[8px] uppercase text-slate-500 font-bold leading-none mb-1">{label}</p>
      <p className={`text-[10px] font-bold leading-none ${status ? 'text-white' : 'text-rose-500'}`}>
        {status ? 'SECURE' : 'OFFLINE'}
      </p>
    </div>
  </div>
);

const ResourceBar = ({ label, percent, color }) => (
  <div className="group">
    <div className="flex justify-between text-[10px] mb-1.5 font-bold uppercase tracking-tighter">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 group-hover:text-white transition-colors">{percent}%</span>
    </div>
    <div className="w-full bg-slate-800/50 h-1.5 rounded-full overflow-hidden">
      <div className={`${color} h-full transition-all duration-1000 ease-out shadow-[0_0_8px_rgba(59,130,246,0.5)]`} style={{ width: `${percent}%` }} />
    </div>
  </div>
);

const getLogColor = (type) => {
  if (type === 'ORDER_FILLED') return 'text-emerald-400';
  if (type === 'PARAM_UPDATE') return 'text-amber-400';
  if (type.includes('ERROR')) return 'text-rose-400';
  return 'text-blue-500';
};

export default HomeView;