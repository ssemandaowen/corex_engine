import React, { useState, useEffect } from 'react';
import client from "../api/client";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer 
} from 'recharts';

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
            {reports.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`
                  w-full px-5 py-4 text-left transition-all
                  hover:bg-slate-800/60 focus:outline-none focus:bg-slate-800/70
                  ${selectedId === r.id ? 'bg-slate-800/80 border-l-4 border-l-indigo-500' : 'border-l-4 border-transparent'}
                `}
              >
                <div className="font-medium text-slate-100 truncate text-sm">
                  {r.id}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {new Date(r.timestamp).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  })}
                </div>
              </button>
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
