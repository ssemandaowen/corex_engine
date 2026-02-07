import React, { useMemo, useState, useRef } from 'react';
import { useStore } from '../store/useStore';

/**
 * @component HomeView
 * @description Primary dashboard for real-time strategy monitoring and system telemetry.
 */
const HomeView = () => {
  const { pulse, strategiesLive, wsEvents, wsStatus } = useStore();

  // --- Data Processing ---

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
      const statusRaw = s?.status ?? s?.state ?? s?.lifecycle ?? s?.meta?.status;
      const status = String(statusRaw || '').toUpperCase();
      if (['ACTIVE', 'WARMING_UP', 'STOPPING', 'RUNNING'].includes(status)) return true;
      if (s?.enabled === true || s?.isRunning === true || s?.active === true) return true;
      return false;
    });
  }, [strategiesLive]);

  const lastOrder = useMemo(() => 
    wsEvents.find(evt => evt?.type === 'ORDER_FILLED'), 
    [wsEvents]
  );

  // --- UI State Management ---

  const [logOpen, setLogOpen] = useState(true);
  const [logHeight, setLogHeight] = useState(240);
  const resizeRef = useRef({ dragging: false, startY: 0, startH: 0 });

  const onResizeStart = (e) => {
    resizeRef.current = { dragging: true, startY: e.clientY, startH: logHeight };
    const onMove = (me) => {
      if (!resizeRef.current.dragging) return;
      const next = Math.max(120, Math.min(600, resizeRef.current.startH - (me.clientY - resizeRef.current.startY)));
      setLogHeight(next);
    };
    const onUp = () => {
      resizeRef.current.dragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!pulse) return (
    <div className="flex items-center justify-center h-full text-slate-500 font-medium">
      <span className="animate-pulse">INITIALIZING COREX INTERFACE...</span>
    </div>
  );

  return (
    <div className="ui-page flex flex-col h-screen overflow-hidden p-6 gap-6">
      
      {/* SECTION: EXECUTIVE SUMMARY & SYSTEM HEALTH */}
      <div className="grid grid-cols-12 gap-4 h-48 shrink-0">
        
        {/* Trading Volume */}
        <div className="col-span-3 ui-panel flex flex-col justify-between p-4 border-l-2 border-l-blue-500">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Session Activity</p>
            <h3 className="text-3xl font-light text-white mt-1">{liveStats.orders} <span className="text-sm text-slate-500">Fills</span></h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-[10px] text-slate-400 uppercase tracking-tighter">Live Order Stream Active</span>
          </div>
        </div>

        {/* Telemetry Metrics */}
        <div className="col-span-4 ui-panel p-4">
          <div className="flex justify-between items-start mb-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">System Resource Load</p>
            <span className={`text-[10px] font-bold ${wsStatus === 'CONNECTED' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {wsStatus} // {pulse?.connectivity?.latency || 0}ms
            </span>
          </div>
          <div className="space-y-4">
            <ResourceBar label="CPU Utilization" percent={pulse.resources.cpuPct} color="bg-blue-500" />
            <ResourceBar label="Memory Allocation" percent={pulse.resources.ramPct} color="bg-emerald-500" />
          </div>
        </div>

        {/* Last Execution Snapshot */}
        <div className="col-span-5 ui-panel p-4 bg-slate-900/20">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3">Last Execution Detail</p>
          {lastOrder ? (
            <div className="grid grid-cols-3 gap-2">
              <DataField label="Instrument" value={lastOrder.payload?.symbol || '--'} />
              <DataField label="Side" value={lastOrder.payload?.side || '--'} highlight />
              <DataField label="Price" value={lastOrder.payload?.price || '--'} />
              <DataField label="Quantity" value={lastOrder.payload?.qty || '--'} />
              <DataField label="Timestamp" value={new Date(lastOrder.meta?.ts).toLocaleTimeString()} />
            </div>
          ) : (
            <div className="flex items-center h-full text-slate-600 italic text-sm">No fills recorded in current session.</div>
          )}
        </div>
      </div>

      {/* SECTION: STRATEGY MANAGEMENT */}
      <div className="flex-1 ui-panel flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/30">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">Active Strategy Deployment</h3>
          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">{runningStrategies.length} Instance(s)</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead className="sticky top-0 bg-[#12151a] shadow-sm">
              <tr className="text-[10px] uppercase text-slate-500 font-bold">
                <th className="px-5 py-3 border-b border-slate-800">Strategy ID</th>
                <th className="px-5 py-3 border-b border-slate-800">Operational Status</th>
                <th className="px-5 py-3 border-b border-slate-800">Timeframe</th>
                <th className="px-5 py-3 border-b border-slate-800 text-right">Market Price</th>
                <th className="px-5 py-3 border-b border-slate-800 text-right">Data Depth</th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {runningStrategies.map((s) => {
                const priceInfo = latestTickBySymbol.get(s.symbols?.[0]);
                const statusRaw = s?.status ?? s?.state ?? s?.lifecycle ?? s?.meta?.status;
                const status = String(statusRaw || '').toUpperCase();
                const displayId = s?.id || s?.name || s?.strategyId || 'unknown';
                return (
                  <tr key={displayId} className="hover:bg-white/5 transition-colors group">
                    <td className="px-5 py-3 border-b border-slate-800/50 font-mono text-blue-400">{displayId}</td>
                    <td className="px-5 py-3 border-b border-slate-800/50">
                      <span className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${status === 'ACTIVE' ? 'bg-emerald-500' : status ? 'bg-amber-500' : 'bg-slate-600'}`} />
                        {status || 'UNKNOWN'}
                      </span>
                    </td>
                    <td className="px-5 py-3 border-b border-slate-800/50 text-slate-400">{s.timeframe || '1m'}</td>
                    <td className={`px-5 py-3 border-b border-slate-800/50 text-right font-mono ${priceInfo?.change > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {priceInfo?.price?.toFixed(2) || '--'}
                    </td>
                    <td className="px-5 py-3 border-b border-slate-800/50 text-right text-slate-500">{s.dataPoints || 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION: SYSTEM LOGS (TERMINAL) */}
      <div className="shrink-0 bg-[#0d0f14] border border-slate-800 rounded-lg flex flex-col relative" style={{ height: logOpen ? logHeight : 42 }}>
        <div className="h-10 flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
            <div className="w-1 h-1 bg-slate-500 rounded-full" /> Event Log Console
          </span>
          <button onClick={() => setLogOpen(!logOpen)} className="text-[10px] text-slate-500 hover:text-white transition-colors uppercase">
            {logOpen ? '[ Minimize ]' : '[ Expand ]'}
          </button>
        </div>
        
        {logOpen && (
          <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] leading-relaxed">
            {wsEvents.filter(e => e.type !== 'DATA_TICK').slice(0, 100).map((evt, idx) => (
              <div key={idx} className="flex gap-3 py-0.5 border-b border-white/[0.02]">
                <span className="text-slate-600 shrink-0">[{new Date(evt.meta?.ts).toLocaleTimeString()}]</span>
                <span className={`shrink-0 w-24 ${getLogColor(evt.type)}`}>{evt.type}</span>
                <span className="text-slate-400 truncate">{evt.payload?.message || evt.payload?.symbol || 'System Notification'}</span>
              </div>
            ))}
            <div className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize" onMouseDown={onResizeStart} />
          </div>
        )}
      </div>
    </div>
  );
};

// --- Sub-Components for Cleanliness ---

const ResourceBar = ({ label, percent, color }) => (
  <div>
    <div className="flex justify-between text-[10px] mb-1 font-medium">
      <span className="text-slate-500 uppercase">{label}</span>
      <span className="text-slate-200">{percent}%</span>
    </div>
    <div className="w-full bg-slate-800 h-1 rounded-full">
      <div className={`${color} h-full rounded-full transition-all duration-500`} style={{ width: `${percent}%` }} />
    </div>
  </div>
);

const DataField = ({ label, value, highlight }) => (
  <div className="flex flex-col">
    <span className="text-[9px] text-slate-600 uppercase font-bold">{label}</span>
    <span className={`text-xs font-mono ${highlight ? 'text-blue-400' : 'text-slate-300'}`}>{value}</span>
  </div>
);

const getLogColor = (type) => {
  if (type === 'ORDER_FILLED') return 'text-emerald-400';
  if (type === 'PARAM_UPDATE') return 'text-amber-400';
  if (type.includes('ERROR')) return 'text-rose-400';
  return 'text-blue-500';
};

export default HomeView;
