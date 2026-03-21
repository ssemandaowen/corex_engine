import React, { useState, useEffect, useCallback, useMemo } from 'react';
import client from "../api/client";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
  BarChart, Bar, Cell, AreaChart, Area
} from 'recharts';
import {
  fmtMoney,
  calcDrawdownSeries,
  calcReturns,
  calcRollingSharpe,
  calcHistogram,
  calcExpectancy,
  calcHeatmap
} from '../utils/backtestAnalytics';

const DataView = () => {
  const [source, setSource] = useState('BACKTEST');
  const [reports, setReports] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [allSnapshots, setAllSnapshots] = useState([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [historyFilters, setHistoryFilters] = useState({
    strategyId: '',
    symbol: '',
    from: '',
    to: '',
    limit: 2000
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const historyStrategyOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    (allSnapshots || []).forEach((s) => {
      const id = String(s?.strategyId || "").trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    });
    return out.sort((a, b) => a.localeCompare(b));
  }, [allSnapshots]);

  const fetchList = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (source !== 'BACKTEST') return;
    fetchList();
  }, [source, fetchList]);

  useEffect(() => {
    if (source !== 'BACKTEST') return;
    const onBacktestCreated = (event) => {
      fetchList();
      const createdId = event?.detail?.id;
      if (createdId) {
        setSelectedId(createdId);
      }
    };
    window.addEventListener('corex:backtest:created', onBacktestCreated);
    return () => window.removeEventListener('corex:backtest:created', onBacktestCreated);
  }, [source, fetchList]);

  const fetchHistoryReport = useCallback(async (envOverride = null, overrideFilters = null) => {
    const environment = (envOverride || source).toUpperCase();
    const f = overrideFilters || historyFilters;
    const params = new URLSearchParams();
    params.set('environment', environment);
    if (f.strategyId) params.set('strategyId', f.strategyId);
    if (f.symbol) params.set('symbol', f.symbol);
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    if (f.limit) params.set('limit', String(f.limit));
    setLoading(true);
    setError(null);
    try {
      const res = await client.get(`/run/history?${params.toString()}`);
      if (res?.success) {
        const payload = res.payload || {};
        setReportData({
          meta: payload.meta || {},
          performance: payload.performance || {},
          trades: Array.isArray(payload.trades) ? payload.trades : [],
          equityCurve: Array.isArray(payload.equityCurve) ? payload.equityCurve : [],
          analytics: payload.analytics || {}
        });
      } else {
        setReportData(null);
        setError('No history available');
      }
    } catch {
      setReportData(null);
      setError('Failed to load execution history');
    } finally {
      setLoading(false);
    }
  }, [source, historyFilters]);

  const fetchHistorySnapshots = useCallback(async (envOverride = null, overrideFilters = null) => {
    const environment = (envOverride || source).toUpperCase();
    const f = overrideFilters || historyFilters;
    const params = new URLSearchParams();
    params.set('environment', environment);
    if (f.strategyId) params.set('strategyId', f.strategyId);
    if (f.symbol) params.set('symbol', f.symbol);
    params.set('limit', '200');
    try {
      const res = await client.get(`/run/history/snapshots?${params.toString()}`);
      setSnapshots(Array.isArray(res?.payload) ? res.payload : []);
    } catch {
      setSnapshots([]);
    }
  }, [source, historyFilters]);

  const fetchAllHistorySnapshots = useCallback(async (envOverride = null) => {
    const environment = (envOverride || source).toUpperCase();
    const params = new URLSearchParams();
    params.set('environment', environment);
    params.set('limit', '500');
    try {
      const res = await client.get(`/run/history/snapshots?${params.toString()}`);
      setAllSnapshots(Array.isArray(res?.payload) ? res.payload : []);
    } catch {
      setAllSnapshots([]);
    }
  }, [source]);

  useEffect(() => {
    if (source === 'BACKTEST') return;
    setSelectedId(null);
    setSelectedSnapshotId(null);
    fetchHistoryReport(source);
    fetchHistorySnapshots(source);
    fetchAllHistorySnapshots(source);
  }, [source, fetchHistoryReport, fetchHistorySnapshots, fetchAllHistorySnapshots]);

  useEffect(() => {
    if (source !== 'BACKTEST') return;
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
  }, [source, selectedId]);

  return (
    <div className="ui-page ui-page-scroll">
      <div className="mb-3 flex items-center gap-2">
        {['BACKTEST', 'PAPER', 'LIVE'].map((s) => (
          <button
            key={s}
            className={`px-3 py-1 rounded border text-[11px] font-bold tracking-wider ${source === s ? 'bg-blue-500/15 text-blue-300 border-blue-500/40' : 'border-[var(--ui-border)] text-[var(--ui-muted)]'}`}
            onClick={() => setSource(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex min-h-[640px] overflow-hidden ui-panel-soft">
        {/* Sidebar */}
        <aside
          className={`
          w-72 bg-[var(--ui-panel-strong)] border-r border-[var(--ui-border)] flex-shrink-0 
          overflow-y-auto transition-all duration-300
          ${!selectedId ? 'shadow-2xl' : ''}
        `}
        >
          <div className="sticky top-0 z-10 bg-[var(--ui-panel-strong)] border-b border-[var(--ui-border)] px-5 py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ui-muted)]">
              {source === 'BACKTEST' ? 'Backtest Reports' : `${source} History`}
            </h3>
          </div>

          {source === 'BACKTEST' && reports.length === 0 ? (
            <div className="p-8 text-center text-[var(--ui-muted)] text-sm">
              No reports yet
            </div>
          ) : source === 'BACKTEST' ? (
            <div className="divide-y divide-[var(--ui-border)]">
              {Object.entries(
                reports.reduce((acc, r) => {
                  const key = r.strategyName || r.strategyId || 'Unassigned';
                  acc[key] = acc[key] || [];
                  acc[key].push(r);
                  return acc;
                }, {})
              ).map(([group, items]) => (
                <div key={group}>
                  <div className="px-5 py-2 text-[10px] uppercase tracking-widest text-[var(--ui-muted)] bg-[rgba(15,23,42,0.45)] border-b border-[var(--ui-border)]">
                    {group}
                  </div>
                  {items.map(r => (
                    <div
                      key={r.id}
                      className={`
                      px-5 py-4 text-left transition-all border-l-4
                      ${selectedId === r.id ? 'bg-blue-500/10 border-l-indigo-500' : 'border-l-transparent hover:bg-white/5'}
                    `}
                    >
                      <button
                        onClick={() => setSelectedId(r.id)}
                        className="w-full text-left focus:outline-none"
                      >
                        <div className="font-medium text-[var(--ui-text)] truncate text-sm">
                          {r.id}
                        </div>
                        <div className="text-[11px] text-[var(--ui-muted)] mt-1">
                          {r.symbol || '--'} | {r.timeframe || '--'}
                        </div>
                        <div className="text-xs text-[var(--ui-muted)] mt-1">
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
          ) : (
            <div className="p-4 space-y-3">
              <label className="block text-[10px] uppercase tracking-widest text-[var(--ui-muted)]">Strategy</label>
              <select
                className="ui-select w-full"
                value={historyFilters.strategyId}
                onChange={(e) => setHistoryFilters((p) => ({ ...p, strategyId: e.target.value }))}
              >
                <option value="">All</option>
                {historyStrategyOptions.map((sid) => (
                  <option key={sid} value={sid}>{sid}</option>
                ))}
              </select>
              {historyStrategyOptions.length === 0 && (
                <div className="text-[11px] text-[var(--ui-muted)]">No strategy run history found for {source}.</div>
              )}

              <label className="block text-[10px] uppercase tracking-widest text-[var(--ui-muted)]">Symbol</label>
              <input
                className="ui-input w-full"
                placeholder="e.g. EURUSD"
                value={historyFilters.symbol}
                onChange={(e) => setHistoryFilters((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))}
              />

              <label className="block text-[10px] uppercase tracking-widest text-[var(--ui-muted)]">Limit</label>
              <input
                type="number"
                min={100}
                max={10000}
                className="ui-input w-full"
                value={historyFilters.limit}
                onChange={(e) => setHistoryFilters((p) => ({ ...p, limit: Number(e.target.value || 2000) }))}
              />

              <div className="flex gap-2 pt-2">
                <button
                  className="ui-button ui-button-primary flex-1"
                  onClick={async () => {
                    await fetchHistoryReport(source);
                    await fetchHistorySnapshots(source);
                    await fetchAllHistorySnapshots(source);
                  }}
                >
                  Refresh
                </button>
                <button
                  className="ui-button ui-button-danger flex-1"
                  onClick={async () => {
                    await client.delete(`/run/history?environment=${source}${historyFilters.strategyId ? `&strategyId=${encodeURIComponent(historyFilters.strategyId)}` : ''}${historyFilters.symbol ? `&symbol=${encodeURIComponent(historyFilters.symbol)}` : ''}${historyFilters.from ? `&from=${encodeURIComponent(historyFilters.from)}` : ''}${historyFilters.to ? `&to=${encodeURIComponent(historyFilters.to)}` : ''}`);
                    await fetchHistoryReport(source);
                    await fetchHistorySnapshots(source);
                    await fetchAllHistorySnapshots(source);
                  }}
                >
                  Clear
                </button>
              </div>

              <div className="pt-2 border-t border-[var(--ui-border)]">
                <div className="text-[10px] uppercase tracking-widest text-[var(--ui-muted)] mb-2">History Snapshots</div>
                <div className="max-h-[340px] overflow-y-auto space-y-1">
                  {snapshots.length === 0 ? (
                    <div className="text-[11px] text-[var(--ui-muted)]">No snapshots found.</div>
                  ) : snapshots.map((snap) => (
                    <button
                      key={snap.id}
                      onClick={async () => {
                        setSelectedSnapshotId(snap.id);
                        const nextFilters = {
                          ...historyFilters,
                          strategyId: snap.strategyId || '',
                          symbol: snap.symbol || '',
                          from: snap.from || '',
                          to: snap.to || ''
                        };
                        setHistoryFilters(nextFilters);
                        await fetchHistoryReport(source, nextFilters);
                      }}
                      className={`w-full text-left rounded border px-2 py-2 transition ${selectedSnapshotId === snap.id ? 'border-blue-500/50 bg-blue-500/10' : 'border-[var(--ui-border)] hover:bg-white/5'}`}
                    >
                      <div className="text-[11px] font-semibold text-[var(--ui-text)] truncate">{snap.strategyId || 'UNKNOWN'} | {snap.symbol || '--'}</div>
                      <div className="text-[10px] text-[var(--ui-muted)]">{snap.day} | fills: {snap.fillsCount}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {source === 'BACKTEST' && !selectedId ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--ui-muted)]">
              <svg className="w-24 h-24 mb-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <h2 className="text-2xl font-semibold text-[var(--ui-text)] mb-3">
                Select a backtest
              </h2>
              <p className="text-[var(--ui-muted)] max-w-md text-center">
                Click any report on the left to view performance metrics, equity curve and trade list.
              </p>
            </div>
          ) : loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex items-center gap-3 text-[var(--ui-muted)]">
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
              <div className="text-[var(--ui-muted)]">{error}</div>
            </div>
          ) : source !== 'BACKTEST' && historyFilters.strategyId && (!reportData || (Array.isArray(reportData?.trades) && reportData.trades.length === 0)) ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--ui-muted)]">
              <h2 className="text-xl font-semibold text-[var(--ui-text)] mb-2">No Data For Strategy</h2>
              <p className="text-[var(--ui-muted)] max-w-md text-center">
                {historyFilters.strategyId} has no {source} trade history in the selected filters.
              </p>
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
  const drawdownSeries = Array.isArray(report?.analytics?.drawdownCurve) && report.analytics.drawdownCurve.length > 0
    ? report.analytics.drawdownCurve
    : calcDrawdownSeries(equityCurve);
  const returns = Array.isArray(report?.analytics?.returns) && report.analytics.returns.length > 0
    ? report.analytics.returns.map((r) => ({ time: Number(r.time), r: Number(r.value || r.r || 0) }))
    : calcReturns(equityCurve);
  const hist = calcHistogram(returns);
  const sharpeSeries = Array.isArray(report?.analytics?.rollingSharpe) && report.analytics.rollingSharpe.length > 0
    ? report.analytics.rollingSharpe
    : calcRollingSharpe(returns, 20);
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
          {meta?.environment ? <div>Env: <span className="text-slate-300">{meta.environment}</span></div> : null}
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
                tickFormatter={v => new Date(v).toLocaleDateString('en-US', { hour: '2-digit', minute: '2-digit' })}
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
        <div className="ui-panel">
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
                {trades.map((t, i) => {
                  const profit = Number(t.profit || 0);
                  const profitPct = Number(t.profitPct || 0);
                  const dirRaw = String(t.direction || '').toLowerCase();
                  const isLong = dirRaw.includes('long') || dirRaw === 'buy';
                  return (
                    <tr
                      key={i}
                      className={`
                      hover:bg-white/[0.03] transition-colors border-l-4
                      ${profit >= 0 ? 'border-emerald-500' : 'border-rose-500'}
                    `}
                      style={{ backgroundColor: profit >= 0 ? 'rgba(16, 185, 129, 0.06)' : 'rgba(244, 63, 94, 0.06)' }}
                    >
                      <td className="whitespace-nowrap text-slate-300">
                        {new Date(t.entryTime).toLocaleString()}
                      </td>
                      <td>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isLong ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                          {isLong ? 'LONG' : (dirRaw ? dirRaw.toUpperCase() : '?')}
                        </span>
                      </td>
                      <td className="text-right text-slate-300 font-mono">
                        {(Number(t.entryPrice) || 0).toFixed(4)}
                      </td>
                      <td className="text-right text-slate-300 font-mono">
                        {(Number(t.exitPrice) || 0).toFixed(4)}
                      </td>
                      <td className={`p-4 text-[11px] text-right font-bold ${Number(t.profit) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {Number(t.profit) >= 0 ? '+' : ''}{Number(t.profit || 0).toFixed(2)}
                      </td>
                      <td className={`p-4 text-[11px] text-right font-bold ${Number(profitPct) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {Number(profitPct).toFixed(2)}%
                      </td>
                    </tr>
                  )
                })}
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
      'text-[var(--ui-text)]';

  return (
    <div className="bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-widest text-[var(--ui-muted)] mb-2">{label}</div>
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export default DataView;
