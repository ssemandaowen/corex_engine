import React, { useState, useEffect, useMemo } from 'react';
import client from "../api/client";
import StatusRing from '../components/home/StatusRing';
import { useStore } from '../store/useStore';

const HomeView = () => {
  const [pulse, setPulse] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [feedMode, setFeedMode] = useState('all'); // all | errors | hidden
  const wsEvents = useStore((s) => s.wsEvents);
  const wsStatus = useStore((s) => s.wsStatus);

  useEffect(() => {
    const fetchPulse = async () => {
      try {
        const res = await client.get('/system/heartbeat');
        setPulse(res.payload);
      } catch (err) {
        console.error("Heartbeat lost");
      }
    };

    fetchPulse();
    const timer = setInterval(fetchPulse, 5000); // Poll every 5s
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchRunStatus = async () => {
      try {
        const res = await client.get('/run/status');
        const list = Array.isArray(res.payload) ? res.payload : Object.values(res.payload || {});
        setStrategies(list);
      } catch (err) {
        console.error("Run status lost");
      }
    };

    fetchRunStatus();
    const timer = setInterval(fetchRunStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  const liveStats = useMemo(() => {
    const summary = {
      ticks: 0,
      orders: 0,
      paramUpdates: 0,
      lastTickTs: null,
      lastOrderTs: null
    };
    for (const evt of wsEvents) {
      if (evt?.type === 'DATA_TICK') {
        summary.ticks += 1;
        if (!summary.lastTickTs) summary.lastTickTs = evt?.meta?.ts;
      } else if (evt?.type === 'ORDER_FILLED') {
        summary.orders += 1;
        if (!summary.lastOrderTs) summary.lastOrderTs = evt?.meta?.ts;
      } else if (evt?.type === 'PARAM_UPDATE') {
        summary.paramUpdates += 1;
      }
    }
    return summary;
  }, [wsEvents]);

  const running = strategies.filter(s => ['ACTIVE', 'WARMING_UP', 'STOPPING'].includes(s.status));
  const dataHeld = strategies.reduce((acc, s) => acc + (s.dataPoints || 0), 0);
  const errorEvents = wsEvents.filter((evt) => {
    const type = evt?.type || '';
    const level = evt?.payload?.level || '';
    const message = evt?.payload?.message || '';
    return type.includes('ERROR') || level === 'error' || message.toLowerCase().includes('error');
  });

  const latency = Number(pulse?.connectivity?.latency || 0);
  const strength = wsStatus === 'CONNECTED'
    ? Math.max(0, Math.min(100, 100 - Math.min(latency, 1000) / 10))
    : 0;

  const lastOrder = wsEvents.find((evt) => evt?.type === 'ORDER_FILLED') || null;
  const lastOrderTime = lastOrder?.meta?.ts ? new Date(lastOrder.meta.ts).toLocaleTimeString() : '—';
  const lastOrderSymbol = lastOrder?.payload?.symbol || lastOrder?.payload?.instrument || '—';
  const lastOrderSide = lastOrder?.payload?.side || lastOrder?.payload?.direction || '—';
  const lastOrderPrice = lastOrder?.payload?.price ?? lastOrder?.payload?.fillPrice ?? null;
  const lastOrderQty = lastOrder?.payload?.qty ?? lastOrder?.payload?.quantity ?? null;

  if (!pulse) return <div className="text-slate-500 animate-pulse">Connecting to CoreX...</div>;

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-[10px] uppercase text-slate-500 tracking-widest">Running Strategies</div>
          <div className="mt-2 text-2xl font-bold text-slate-100">{running.length}</div>
          <div className="mt-3 text-[10px] text-slate-400 space-y-2 max-h-24 overflow-y-auto pr-1">
            {running.length === 0 && <span>No active runs</span>}
            {running.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-slate-800/60 border border-slate-700 rounded-md px-2 py-1">
                <div className="flex flex-col">
                  <span className="text-slate-200 font-mono">{s.id}</span>
                  <span className="text-slate-500">{(s.symbols || []).join(', ') || 'No symbols'}</span>
                </div>
                <div className="text-right">
                  <div className="text-slate-300">{s.timeframe || '1m'}</div>
                  <div className="text-slate-500">{s.dataPoints || 0} bars</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-[10px] uppercase text-slate-500 tracking-widest">Data Held</div>
          <div className="mt-2 text-2xl font-bold text-slate-100">{dataHeld}</div>
          <div className="mt-2 text-xs text-slate-500">Total candles across active stores</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-[10px] uppercase text-slate-500 tracking-widest">Network Strength</div>
          <div className="mt-2 text-2xl font-bold text-slate-100">
            {wsStatus === 'CONNECTED' ? 'LIVE' : wsStatus}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            WS: {wsStatus} · Latency: {latency}ms
          </div>
          <div className="mt-3 w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full ${strength > 66 ? 'bg-emerald-500' : strength > 33 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${strength}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-[10px] uppercase text-slate-500 tracking-widest">Last Trade</div>
          <div className="mt-2 text-2xl font-bold text-slate-100">{lastOrderSymbol}</div>
          <div className="mt-2 text-xs text-slate-500">
            {lastOrderSide !== '—' ? `${lastOrderSide}` : 'No fills yet'}
          </div>
          <div className="mt-3 text-[10px] text-slate-400 space-y-1">
            <div className="flex justify-between">
              <span>Price</span>
              <span className="font-mono text-slate-200">
                {lastOrderPrice != null ? lastOrderPrice : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Qty</span>
              <span className="font-mono text-slate-200">
                {lastOrderQty != null ? lastOrderQty : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Time</span>
              <span className="font-mono text-slate-200">{lastOrderTime}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="col-span-12 md:col-span-4 bg-slate-800 p-6 rounded-xl border border-slate-700">
        <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest">System Load</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span>CPU Load</span>
              <span className="text-blue-400">{pulse.resources.cpuPct}%</span>
            </div>
            <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
              <div className="bg-blue-500 h-full" style={{ width: `${pulse.resources.cpuPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span>RAM Used</span>
              <span className="text-emerald-400">{pulse.resources.ramPct}%</span>
            </div>
            <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full" style={{ width: `${pulse.resources.ramPct}%` }} />
            </div>
          </div>
          <div className="flex justify-between items-center py-2 border-t border-slate-700">
            <span className="text-sm text-slate-400">RAM (System)</span>
            <span className="font-mono text-sm">{pulse.resources.ramUsedMb} / {pulse.resources.ramTotalMb} MB</span>
          </div>
          <div className="flex justify-between items-center py-2 border-t border-slate-700">
            <span className="text-sm text-slate-400">Uptime</span>
            <span className="font-mono text-sm">{pulse.uptime}</span>
          </div>
        </div>
      </div>

      {/* 3. Global Activity Feed (Internal Bus Events) */}
      <div className="col-span-12 md:col-span-8 bg-slate-900 border border-slate-800 rounded-lg p-4 h-72 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase">Live System Events</h3>
          <div className="flex items-center gap-4 text-[10px] text-slate-500">
            <span>Ticks: <span className="text-slate-300">{liveStats.ticks}</span></span>
            <span>Orders: <span className="text-slate-300">{liveStats.orders}</span></span>
            <span>Params: <span className="text-slate-300">{liveStats.paramUpdates}</span></span>
            <span>Errors: <span className="text-slate-300">{errorEvents.length}</span></span>
            <button
              onClick={() => setFeedMode((v) => v === 'hidden' ? 'all' : 'hidden')}
              className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
            >
              {feedMode === 'hidden' ? 'Show' : 'Hide'}
            </button>
            <button
              onClick={() => setFeedMode('all')}
              className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
            >
              All
            </button>
            <button
              onClick={() => setFeedMode('errors')}
              className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
            >
              Errors
            </button>
          </div>
        </div>
        {feedMode !== 'hidden' ? (
          <div className="flex-1 font-mono text-[10px] text-slate-400 overflow-y-auto space-y-1">
            {(feedMode === 'errors' ? errorEvents.length === 0 : wsEvents.length === 0) && (
              <p className="text-slate-600">Waiting for live events...</p>
            )}
            {(feedMode === 'errors' ? errorEvents : wsEvents).map((evt, idx) => {
              const ts = evt?.meta?.ts ? new Date(evt.meta.ts).toLocaleTimeString() : '--:--:--';
              const type = evt?.type || 'UNKNOWN';
              const color =
                type === 'DATA_TICK' ? 'text-blue-400' :
                type === 'ORDER_FILLED' ? 'text-emerald-400' :
                type === 'PARAM_UPDATE' ? 'text-amber-400' :
                'text-slate-400';
              const summary = evt?.payload?.symbol
                ? `${evt.payload.symbol}`
                : evt?.payload?.id
                  ? `id=${evt.payload.id}`
                  : evt?.payload?.message
                    ? evt.payload.message
                    : 'event';

              return (
                <p key={`${evt.meta?.ts || idx}-${type}`} className="truncate">
                  <span className="text-slate-600">[{ts}]</span>{' '}
                  <span className={color}>{type}</span>{' '}
                  <span className="text-slate-500">{summary}</span>
                </p>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-600">
            Feed hidden
          </div>
        )}
      </div>
    </div>
  );
};

export default HomeView;
