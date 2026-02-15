import React, { useState, useEffect } from 'react';
import client from "../api/client";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer,
  BarChart, Bar, Cell, AreaChart, Area
} from 'recharts';

const fmtMoney = (v) => {
  const n = Number(v || 0);
  return `$${n.toFixed(2)}`;
};

const calcDrawdownSeries = (equityCurve) => {
  let peak = -Infinity;
  return equityCurve.map((p) => {
    const equity = Number(p.equity || 0);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((equity / peak) - 1) * 100 : 0;
    return { time: Number(p.time), drawdown: dd };
  });
};

const calcReturns = (equityCurve) => {
  const returns = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const prev = Number(equityCurve[i - 1]?.equity || 0);
    const cur = Number(equityCurve[i]?.equity || 0);
    if (!prev) continue;
    returns.push({ time: Number(equityCurve[i].time), r: (cur / prev) - 1 });
  }
  return returns;
};

const calcRollingSharpe = (returns, window = 20) => {
  const out = [];
  for (let i = window - 1; i < returns.length; i += 1) {
    const slice = returns.slice(i - window + 1, i + 1).map(r => r.r);
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);
    const sharpe = std === 0 ? 0 : (mean / std) * Math.sqrt(window);
    out.push({ time: returns[i].time, sharpe });
  }
  return out;
};

const calcHistogram = (returns, bins = 20) => {
  if (returns.length === 0) return [];
  const values = returns.map(r => r.r);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ label: min.toFixed(3), count: returns.length, mid: min }];
  }
  const width = (max - min) / bins;
  const buckets = Array.from({ length: bins }, (_, i) => ({
    min: min + i * width,
    max: min + (i + 1) * width,
    count: 0
  }));
  values.forEach((v) => {
    const idx = Math.min(buckets.length - 1, Math.floor((v - min) / width));
    buckets[idx].count += 1;
  });
  return buckets.map(b => ({
    label: `${(b.min * 100).toFixed(1)}%`,
    count: b.count,
    mid: (b.min + b.max) / 2
  }));
};

const calcExpectancy = (trades) => {
  const wins = trades.filter(t => Number(t.profit || 0) > 0);
  const losses = trades.filter(t => Number(t.profit || 0) < 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + Number(t.profit || 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + Number(t.profit || 0), 0)) / losses.length : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
  return { winRate, avgWin, avgLoss, expectancy };
};

const isoWeek = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const calcHeatmap = (trades, mode = 'month') => {
  const map = new Map();
  trades.forEach((t) => {
    const ts = t.exitTime || t.entryTime;
    if (!ts) return;
    const d = new Date(ts);
    const key = mode === 'week'
      ? isoWeek(d)
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const prev = map.get(key) || 0;
    map.set(key, prev + Number(t.profit || 0));
  });
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
};

const DataView = () => {
  const [reports, setReports] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchList = async () => {
      try {
        const res = await client.get('/backtest');
        if (res.success) {
          setReports(
            [...(res.payload || [])].sort((a, b) => 
              new Date(b.timestamp) - new Date(a.timestamp)
            )
          );
        }
      } catch (err) {
        console.error("Load reports failed", err);
      }
    };
    fetchList();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setReportData(null);
      setError(null);
      return;
    }

    let canceled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await client.get(`/backtest/${selectedId}`);
        if (canceled) return;
        if (res.success) {
          setReportData(res.payload);
        } else {
          setError("Report not found");
        }
      } catch (err) {
        if (!canceled) setError("Failed to load report");
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => { canceled = true; };
  }, [selectedId]);

  return (
    <div className="ui-page ui-page-scroll">
    <div className="flex min-h-[640px] overflow-hidden ui-panel-soft">
      {/* Sidebar */}
      <aside 
        className={`
          w-72 bg-slate-900 border-r border-slate-800 flex-shrink-0 
          overflow-y-auto transition-all duration-300
          ${!selectedId ? 'shadow-2xl' : ''}
        `}
      >
        <div className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800 px-5 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            Backtest Reports
          </h3>
        </div>

        {reports.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No reports yet
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {Object.entries(
              reports.reduce((acc, r) => {
                const key = r.strategyName || r.strategyId || 'Unassigned';
                acc[key] = acc[key] || [];
                acc[key].push(r);
                return acc;
              }, {})
            ).map(([group, items]) => (
              <div key={group}>
                <div className="px-5 py-2 text-[10px] uppercase tracking-widest text-slate-500 bg-slate-900/70 border-b border-slate-800">
                  {group}
                </div>
                {items.map(r => (
                  <div
                    key={r.id}
                    className={`
                      px-5 py-4 text-left transition-all border-l-4
                      ${selectedId === r.id ? 'bg-slate-800/80 border-l-indigo-500' : 'border-l-transparent hover:bg-slate-800/60'}
                    `}
                  >
                    <button
                      onClick={() => setSelectedId(r.id)}
                      className="w-full text-left focus:outline-none"
                    >
                      <div className="font-medium text-slate-100 truncate text-sm">
                        {r.id}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        {r.symbol || '--'} • {r.timeframe || '--'}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {new Date(r.timestamp).toLocaleString('en-US', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </div>
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await client.delete(`/backtest/${r.id}`);
                        setReports((prev) => prev.filter(p => p.id !== r.id));
                        if (selectedId === r.id) setSelectedId(null);
                      }}
                      className="mt-2 text-[10px] uppercase tracking-widest text-rose-400 hover:text-rose-300"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6">
        {!selectedId ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500">
            <svg className="w-24 h-24 mb-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h2 className="text-2xl font-semibold text-slate-200 mb-3">
              Select a backtest
            </h2>
            <p className="text-slate-500 max-w-md text-center">
              Click any report on the left to view performance metrics, equity curve and trade list.
            </p>
          </div>
        ) : loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex items-center gap-3 text-slate-400">
              <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" className="opacity-25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8v8z" className="opacity-75" />
              </svg>
              <span className="text-lg">Loading report...</span>
            </div>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-rose-400">
            <div className="text-2xl font-medium mb-3">Error</div>
            <div className="text-slate-400">{error}</div>
          </div>
        ) : reportData ? (
          <ReportView report={reportData} />
        ) : null}
      </main>
    </div>
    </div>
  );
};

function ReportView({ report }) {
  const { meta, performance, trades = [], equityCurve = [] } = report;

  const hasEquity = equityCurve.length > 1;
  const pnlSeriesRaw = trades
    .map((t, i) => {
      const profit = Number(t.profit ?? t.pnl ?? 0);
      return { index: i + 1, profit };
    })
    .filter((p) => Number.isFinite(p.profit));
  const pnlSeries = pnlSeriesRaw.length > 200 ? pnlSeriesRaw.slice(-200) : pnlSeriesRaw;
  const hasPnL = pnlSeries.length > 0;
  const drawdownSeries = calcDrawdownSeries(equityCurve);
  const returns = calcReturns(equityCurve);
  const hist = calcHistogram(returns);
  const sharpeSeries = calcRollingSharpe(returns, 20);
  const monthly = calcHeatmap(trades, 'month');
  const weekly = calcHeatmap(trades, 'week');
  const maxHeat = Math.max(1, ...monthly.map(m => Math.abs(m.value)), ...weekly.map(w => Math.abs(w.value)));
  const expectancy = calcExpectancy(trades);

  return (
    <div className="space-y-8 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="pb-6 border-b border-slate-800">
        <h1 className="text-2xl font-bold text-white">
          {meta?.strategyName || 'Backtest Results'}
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-400">
          <div>{new Date(meta?.timestamp).toLocaleString()}</div>
          <div>ID: <span className="text-slate-300">{meta?.id}</span></div>
          <div>Duration: <span className="text-slate-300">{meta?.executionTime}</span></div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 lg:gap-5">
        <Stat label="Net Profit" 
          value={`$${Number(performance?.netProfit || 0).toFixed(2)}`}
          trend={Number(performance?.netProfit) >= 0 ? 'positive' : 'negative'}
        />
        <Stat label="ROI" value={`${Number(performance?.roiPercent || 0).toFixed(1)}%`} />
        <Stat label="Win Rate" value={`${Number(performance?.winRate || 0).toFixed(1)}%`} />
        <Stat label="Trades" value={performance?.totalTrades ?? 0} />
        <Stat label="Max Drawdown" 
          value={`${Number(performance?.maxDrawdownPercent || 0).toFixed(2)}%`} 
          trend="negative"
        />
        <Stat label="Sharpe" value={performance?.sharpeRatio ?? '--'} />
      </div>

      <div className="ui-panel">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Profit Factor & Expectancy</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Stat label="Profit Factor" value={performance?.profitFactor ?? '--'} />
          <Stat label="Gross Profit" value={fmtMoney(performance?.grossProfit)} trend="positive" />
          <Stat label="Gross Loss" value={fmtMoney(performance?.grossLoss)} trend="negative" />
          <Stat label="Avg Win" value={fmtMoney(expectancy.avgWin)} trend="positive" />
          <Stat label="Avg Loss" value={fmtMoney(expectancy.avgLoss)} trend="negative" />
          <Stat label="Expectancy" value={fmtMoney(expectancy.expectancy)} trend={expectancy.expectancy >= 0 ? 'positive' : 'negative'} />
        </div>
      </div>

      {/* Chart */}
      <div className="ui-panel">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Equity Curve</h3>
        <div className="h-[420px]">
          <ResponsiveContainer>
            <LineChart data={hasEquity ? equityCurve : [{ time: Date.now(), equity: 10000 }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis 
                dataKey="time" 
                type="number" 
                scale="time" 
                domain={['dataMin', 'dataMax']}
                tickFormatter={v => new Date(v).toLocaleDateString('en-US', { hour: '2-digit', minute: '2-digit'})}
                stroke="#475569"
                tick={{ fill: '#94a3b8', fontSize: 12 }}
              />
              <YAxis 
                tickFormatter={v => `$${Math.round(v).toLocaleString()}`}
                stroke="#475569"
                tick={{ fill: '#94a3b8', fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{ 
                  background: '#0f172a', 
                  border: '1px solid #334155', 
                  borderRadius: '8px', 
                  color: '#e2e8f0' 
                }}
                labelFormatter={v => new Date(v).toLocaleString()}
              />
              <Line 
                type="monotone" 
                dataKey="equity" 
                stroke="#6366f1" 
                strokeWidth={2.5} 
                dot={false} 
                activeDot={{ r: 6, strokeWidth: 3 }} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="ui-panel">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Drawdown Curve</h3>
        <div className="h-[260px]">
          <ResponsiveContainer>
            <AreaChart data={drawdownSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="time" hide />
              <YAxis tickFormatter={v => `${v.toFixed(1)}%`} stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }}
                labelFormatter={v => new Date(v).toLocaleString()}
              />
              <Area type="monotone" dataKey="drawdown" stroke="#f43f5e" fillOpacity={0.3} fill="#f43f5e" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="ui-panel">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Returns Histogram</h3>
        <div className="h-[260px]">
          <ResponsiveContainer>
            <BarChart data={hist.length ? hist : [{ label: '0', count: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="label" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }}
              />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="ui-panel">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Rolling Sharpe (20)</h3>
        <div className="h-[260px]">
          <ResponsiveContainer>
            <LineChart data={sharpeSeries.length ? sharpeSeries : [{ time: Date.now(), sharpe: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" hide />
              <YAxis stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }}
                labelFormatter={v => new Date(v).toLocaleString()}
              />
              <Line type="monotone" dataKey="sharpe" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="ui-panel">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Profit / Loss Bars</h3>
        <div className="h-[260px]">
          <ResponsiveContainer>
            <BarChart data={hasPnL ? pnlSeries : [{ index: 0, profit: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="index" hide />
              <YAxis 
                tickFormatter={v => `$${Math.round(v).toLocaleString()}`}
                stroke="#475569"
                tick={{ fill: '#94a3b8', fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{ 
                  background: '#0f172a', 
                  border: '1px solid #334155', 
                  borderRadius: '8px', 
                  color: '#e2e8f0' 
                }}
                labelFormatter={v => `Trade ${v}`}
              />
              <Bar dataKey="profit">
                {pnlSeries.map((entry, idx) => (
                  <Cell key={`cell-${idx}`} fill={entry.profit >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="ui-panel">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Monthly Performance Heatmap</h3>
        <div className="grid grid-cols-6 gap-2">
          {monthly.map((m) => {
            const intensity = Math.min(1, Math.abs(m.value) / maxHeat);
            const color = m.value >= 0
              ? `rgba(16, 185, 129, ${0.2 + 0.6 * intensity})`
              : `rgba(244, 63, 94, ${0.2 + 0.6 * intensity})`;
            return (
              <div key={m.key} className="rounded-lg p-2 text-xs text-slate-100" style={{ background: color }}>
                <div className="text-[10px] uppercase tracking-widest text-slate-200">{m.key}</div>
                <div className="font-mono">{fmtMoney(m.value)}</div>
              </div>
            );
          })}
          {monthly.length === 0 && (
            <div className="text-xs text-slate-500">No monthly data.</div>
          )}
        </div>
      </div>

      <div className="ui-panel">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Weekly Performance Heatmap</h3>
        <div className="grid grid-cols-6 gap-2">
          {weekly.map((w) => {
            const intensity = Math.min(1, Math.abs(w.value) / maxHeat);
            const color = w.value >= 0
              ? `rgba(34, 197, 94, ${0.2 + 0.6 * intensity})`
              : `rgba(248, 113, 113, ${0.2 + 0.6 * intensity})`;
            return (
              <div key={w.key} className="rounded-lg p-2 text-xs text-slate-100" style={{ background: color }}>
                <div className="text-[10px] uppercase tracking-widest text-slate-200">{w.key}</div>
                <div className="font-mono">{fmtMoney(w.value)}</div>
              </div>
            );
          })}
          {weekly.length === 0 && (
            <div className="text-xs text-slate-500">No weekly data.</div>
          )}
        </div>
      </div>

      {meta?.runtimeParams && Object.keys(meta.runtimeParams).length > 0 && (
        <div className="ui-panel">
          <h3 className="text-lg font-semibold text-slate-200 mb-4">Runtime Params</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            {Object.entries(meta.runtimeParams).map(([k, v]) => (
              <div key={k} className="bg-slate-900/50 border border-slate-800 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">{k}</div>
                <div className="font-mono text-slate-200">{String(v)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trades */}
      {trades.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-200 mb-4">
            Trades <span className="text-slate-500 font-normal">({trades.length})</span>
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
            <table className="ui-table min-w-full">
              <thead className="sticky top-0">
                <tr>
                  <th>Entry</th>
                  <th>Dir</th>
                  <th className="text-right">Entry $</th>
                  <th className="text-right">Exit $</th>
                  <th className="text-right">Profit</th>
                  <th className="text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap text-slate-300">
                      {new Date(t.entryTime).toLocaleString()}
                    </td>
                    <td>
                      <span className={
                        t.direction === 'long' 
                          ? 'text-emerald-400 font-medium' 
                          : 'text-rose-400 font-medium'
                      }>
                        {t.direction?.toUpperCase() || '?'}
                      </span>
                    </td>
                    <td className="text-right text-slate-300">
                      {t.entryPrice?.toFixed(2) ?? '--'}
                    </td>
                    <td className="text-right text-slate-300">
                      {t.exitPrice?.toFixed(2) ?? '--'}
                    </td>
                    <td className={`text-right font-medium ${
                      Number(t.profit) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      ${Number(t.profit || 0).toFixed(2)}
                    </td>
                    <td className={`text-right ${
                      Number(t.profitPct) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {Number(t.profitPct || 0).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, trend = 'neutral' }) {
  const color = trend === 'positive' ? 'text-emerald-400' :
                trend === 'negative' ? 'text-rose-400' : 
                'text-slate-100';
  
  return (
    <div className="ui-card">
      <div className="ui-panel-title mb-2">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export default DataView;
