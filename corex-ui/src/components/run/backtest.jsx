
import React, { useState, useEffect } from 'react';
import client from '../../api/client';
import {
    Upload,
    Play,
    Loader,
    ChevronRight,
    ChevronDown,
    BarChart3,
    Target,
    Zap,
    TrendingUp
} from 'lucide-react';
import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area
} from 'recharts';

const TreeRow = ({ label, value, level = 0 }) => {
    const [open, setOpen] = useState(level < 1);
    const isArray = Array.isArray(value);
    const isObject = value && typeof value === 'object' && !isArray;
    const hasChildren = isArray || isObject;

    const formatValue = (val) => {
        if (val === null || val === undefined) return 'null';
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        if (typeof val === 'number') return Number.isFinite(val) ? val.toLocaleString() : 'NaN';
        if (typeof val === 'string') return val;
        if (Array.isArray(val)) return `Array(${val.length})`;
        return `Object(${Object.keys(val).length})`;
    };

    return (
        <>
            <tr className="border-b border-slate-800/40 hover:bg-white/[0.02] transition-colors">
                <td className="py-2 pl-4 text-xs font-mono" style={{ paddingLeft: `${level * 16 + 16}px` }}>
                    <div className="flex items-center gap-2">
                        {hasChildren ? (
                            <button
                                type="button"
                                onClick={() => setOpen(!open)}
                                className="text-slate-500"
                                aria-label={open ? 'Collapse' : 'Expand'}
                            >
                                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                        ) : (
                            <span className="w-3" />
                        )}
                        <span className="text-slate-400">{label}</span>
                    </div>
                </td>
                <td className="py-2 text-xs font-mono text-blue-300">
                    {!hasChildren ? formatValue(value) : ''}
                </td>
                <td className="py-2 text-[10px] uppercase text-slate-600 font-bold">
                    {hasChildren ? (isArray ? 'array' : 'object') : typeof value}
                </td>
            </tr>

            {open && isArray && value.map((item, idx) => (
                <TreeRow key={`${label}-${idx}`} label={`[${idx}]`} value={item} level={level + 1} />
            ))}
            {open && isObject && Object.entries(value).map(([k, v]) => (
                <TreeRow key={`${label}-${k}`} label={k} value={v} level={level + 1} />
            ))}
        </>
    );
};

const TreeTable = ({ data }) => {
    if (!data || typeof data !== 'object') return null;
    return (
        <div className="bg-black/40 border border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-left">
                <thead className="bg-slate-900/60">
                    <tr>
                        <th className="py-2 px-3 text-[10px] uppercase text-slate-500">Key</th>
                        <th className="py-2 px-3 text-[10px] uppercase text-slate-500">Value</th>
                        <th className="py-2 px-3 text-[10px] uppercase text-slate-500">Type</th>
                    </tr>
                </thead>
                <tbody>
                    {Object.entries(data).map(([key, value]) => (
                        <TreeRow key={key} label={key} value={value} />
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const ConfigRow = ({ label, active, onToggle, children }) => (
    <div className="flex items-center gap-3">
        <input
            type="checkbox"
            checked={active}
            onChange={(e) => onToggle(e.target.checked)}
            className="accent-blue-500 h-3 w-3 bg-black border-slate-700 rounded"
        />
        <div className="flex-1 flex flex-col gap-1">
            <span className={`text-[9px] font-bold uppercase transition-colors ${active ? 'text-slate-400' : 'text-slate-600'}`}>
                {label}
            </span>
            {children}
        </div>
    </div>
);

const MetricCard = ({ label, value, color = 'text-emerald-400', trend = null }) => (
    <div className="bg-[#0d1117] border border-slate-800 p-4 rounded-xl shadow-sm">
        <span className="text-[9px] font-black uppercase text-slate-600 tracking-widest block mb-2">{label}</span>
        <div className={`text-xl font-mono font-bold ${trend === true ? 'text-emerald-400' : trend === false ? 'text-rose-400' : color}`}>
            {value}
        </div>
    </div>
);

const Backtest = () => {
    const [strategies, setStrategies] = useState([]);
    const [selectedStrategy, setSelectedStrategy] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    // Form state
    const [file, setFile] = useState(null);
    const [symbol, setSymbol] = useState('BTC/USD');
    const [interval, setInterval] = useState('1m');
    const [initialCapital, setInitialCapital] = useState('10000');
    const [outputsize, setOutputsize] = useState('1000');
    const [includeTrades, setIncludeTrades] = useState(true);
    const [paramSchema, setParamSchema] = useState({});
    const [paramValues, setParamValues] = useState({});
    const [paramEnabled, setParamEnabled] = useState({});

    // Field toggles (Postman-style enable/disable)
    const [enabled, setEnabled] = useState({
        dataset: false,
        symbol: true,
        interval: true,
        initialCapital: true,
        outputsize: true,
        includeTrades: true
    });

    useEffect(() => {
        const fetchStrategies = async () => {
            try {
                const res = await client.get('/strategies');
                const list = Array.isArray(res?.payload)
                    ? res.payload
                    : Array.isArray(res?.data)
                        ? res.data
                        : Array.isArray(res)
                            ? res
                            : [];
                setStrategies(list);
                if (list.length > 0) {
                    setSelectedStrategy(list[0].id);
                }
            } catch (err) {
                console.error('Failed to fetch strategies', err);
                const msg = err?.message || 'Failed to load strategies. Is the engine running?';
                setError(msg);
            }
        };
        fetchStrategies();
    }, []);

    useEffect(() => {
        const inferSchemaFromParams = (params) => {
            const schema = {};
            Object.entries(params || {}).forEach(([key, value]) => {
                const t = typeof value;
                if (t === 'number') {
                    schema[key] = { type: Number.isInteger(value) ? 'integer' : 'float', label: key, default: value };
                } else if (t === 'boolean') {
                    schema[key] = { type: 'boolean', label: key, default: value };
                } else {
                    schema[key] = { type: 'string', label: key, default: value };
                }
            });
            return schema;
        };

        const fetchStrategyMeta = async () => {
            if (!selectedStrategy) return;
            try {
                const res = await client.get('/run/status');
                const list = Array.isArray(res.payload) ? res.payload : Object.values(res.payload || {});
                const match = list.find((s) => s.id === selectedStrategy);
                const schema = (match && match.schema && Object.keys(match.schema).length > 0)
                    ? match.schema
                    : inferSchemaFromParams(match?.params || {});
                const values = match?.params || {};

                setParamSchema(schema || {});
                setParamValues(values || {});
                const enabledMap = {};
                Object.keys(schema || {}).forEach((k) => { enabledMap[k] = true; });
                setParamEnabled(enabledMap);
            } catch (err) {
                console.error('Failed to fetch strategy meta', err);
                setParamSchema({});
                setParamValues({});
                setParamEnabled({});
            }
        };

        fetchStrategyMeta();
    }, [selectedStrategy]);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
    };

    const runBacktest = async (e) => {
        e.preventDefault();
        if (!selectedStrategy) {
            setError('Please select a strategy.');
            return;
        }

        setLoading(true);
        setResults(null);
        setError(null);

        const formData = new FormData();
        if (enabled.dataset && file) {
            formData.append('dataset', file);
        }
        if (enabled.symbol) formData.append('symbol', symbol);
        if (enabled.interval) formData.append('interval', interval);
        if (enabled.initialCapital) formData.append('initialCapital', initialCapital);
        if (enabled.outputsize) formData.append('outputsize', outputsize);
        if (enabled.includeTrades) formData.append('includeTrades', includeTrades ? 'true' : 'false');

        const paramsPayload = {};
        Object.entries(paramEnabled).forEach(([key, isOn]) => {
            if (isOn && key in paramValues) {
                paramsPayload[key] = paramValues[key];
            }
        });
        if (Object.keys(paramsPayload).length > 0) {
            formData.append('params', JSON.stringify(paramsPayload));
        }

        try {
            const res = await client.post(`/backtest/${selectedStrategy}`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            setResults(res.payload);
        } catch (err) {
            console.error('Backtest failed', err);
            setError(err.message || 'Backtest failed. Check the console for details.');
        } finally {
            setLoading(false);
        }
    };

    const perf = results?.performance || null;
    const perfRaw = results?.performanceRaw || null;
    const trades = Array.isArray(results?.trades) ? results.trades : [];
    const equityCurve = Array.isArray(results?.equityCurve)
        ? results.equityCurve
            .map((p) => ({ time: Number(p.time), equity: Number(p.equity) }))
            .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.equity))
        : [];
    const hasEquity = equityCurve.length > 1;
    const header = results?.meta || null;

    return (
        <div className="flex h-full bg-[#0b0e14] overflow-hidden ui-view-frame">
            <aside className="w-80 border-r border-slate-800 flex flex-col bg-[#0d1117]">
                <div className="p-4 border-b border-slate-800 flex items-center gap-2">
                    <Zap size={16} className="text-blue-500" />
                    <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-200">Execution Config</h2>
                </div>

                <form id="backtest-form" onSubmit={runBacktest} className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Target Strategy</label>
                        <select
                            value={selectedStrategy}
                            onChange={(e) => setSelectedStrategy(e.target.value)}
                            className="ui-select w-full bg-slate-900 border-slate-700 text-xs"
                        >
                            {strategies.map((s) => (
                                <option key={s.id} value={s.id}>{s.name || s.id}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Payload Data</span>
                            <span className="text-[9px] text-slate-600 font-mono">POST /backtest/{selectedStrategy || 'id'}</span>
                        </div>

                        <ConfigRow label="Dataset" active={enabled.dataset} onToggle={(v) => setEnabled({ ...enabled, dataset: v })}>
                            <label className={`flex-1 flex items-center justify-center gap-2 h-8 border border-dashed rounded text-[10px] cursor-pointer transition-colors ${enabled.dataset ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-800 text-slate-600'}`}>
                                <Upload size={12} /> {file ? file.name : 'Select CSV'}
                                <input
                                    type="file"
                                    className="hidden"
                                    onChange={handleFileChange}
                                    accept=".csv"
                                    disabled={!enabled.dataset}
                                />
                            </label>
                        </ConfigRow>

                        <ConfigRow label="Symbol" active={enabled.symbol} onToggle={(v) => setEnabled({ ...enabled, symbol: v })}>
                            <input
                                type="text"
                                value={symbol}
                                onChange={(e) => setSymbol(e.target.value)}
                                disabled={!enabled.symbol}
                                className="ui-input text-xs"
                            />
                        </ConfigRow>

                        <ConfigRow label="Interval" active={enabled.interval} onToggle={(v) => setEnabled({ ...enabled, interval: v })}>
                            <input
                                type="text"
                                value={interval}
                                onChange={(e) => setInterval(e.target.value)}
                                disabled={!enabled.interval}
                                className="ui-input text-xs"
                            />
                        </ConfigRow>

                        <ConfigRow label="Capital" active={enabled.initialCapital} onToggle={(v) => setEnabled({ ...enabled, initialCapital: v })}>
                            <input
                                type="number"
                                value={initialCapital}
                                onChange={(e) => setInitialCapital(e.target.value)}
                                disabled={!enabled.initialCapital}
                                className="ui-input text-xs"
                            />
                        </ConfigRow>

                        <ConfigRow label="Output" active={enabled.outputsize} onToggle={(v) => setEnabled({ ...enabled, outputsize: v })}>
                            <input
                                type="number"
                                value={outputsize}
                                onChange={(e) => setOutputsize(e.target.value)}
                                disabled={!enabled.outputsize}
                                className="ui-input text-xs"
                            />
                        </ConfigRow>

                        <ConfigRow label="Trades" active={enabled.includeTrades} onToggle={(v) => setEnabled({ ...enabled, includeTrades: v })}>
                            <div className="flex items-center gap-2 text-[11px] text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={includeTrades}
                                    onChange={(e) => setIncludeTrades(e.target.checked)}
                                    disabled={!enabled.includeTrades}
                                    className="h-4 w-4 rounded text-blue-500 bg-slate-900 border-slate-700"
                                />
                                <span>{includeTrades ? 'true' : 'false'}</span>
                            </div>
                        </ConfigRow>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Strategy Params</span>
                            <span className="text-[9px] text-slate-600 font-mono">JSON</span>
                        </div>

                        {Object.keys(paramSchema).length === 0 ? (
                            <div className="text-xs text-slate-500">No configurable params found for this strategy.</div>
                        ) : (
                            <div className="space-y-3">
                                {Object.entries(paramSchema).map(([key, spec]) => {
                                    const isOn = !!paramEnabled[key];
                                    const type = (spec?.type || 'string').toLowerCase();
                                    const value = paramValues[key];

                                    return (
                                        <ConfigRow
                                            key={key}
                                            label={key}
                                            active={isOn}
                                            onToggle={(v) => setParamEnabled({ ...paramEnabled, [key]: v })}
                                        >
                                            {type === 'boolean' ? (
                                                <div className="flex items-center gap-2 text-[11px] text-slate-300">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!value}
                                                        onChange={(e) => setParamValues({ ...paramValues, [key]: e.target.checked })}
                                                        disabled={!isOn}
                                                        className="h-4 w-4 rounded text-blue-500 bg-slate-900 border-slate-700"
                                                    />
                                                    <span>{value ? 'true' : 'false'}</span>
                                                </div>
                                            ) : (
                                                <input
                                                    type={type === 'integer' || type === 'number' || type === 'float' ? 'number' : 'text'}
                                                    value={value ?? ''}
                                                    onChange={(e) => setParamValues({ ...paramValues, [key]: e.target.value })}
                                                    disabled={!isOn}
                                                    className="ui-input text-xs"
                                                />
                                            )}
                                        </ConfigRow>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </form>

                <div className="p-4 bg-slate-900/40 border-t border-slate-800">
                    <button
                        type="submit"
                        form="backtest-form"
                        disabled={loading || !selectedStrategy}
                        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-2.5 rounded text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 transition-all"
                    >
                        {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
                        Execute Sequence
                    </button>
                </div>
            </aside>

            <main className="flex-1 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-black/20">
                    <div className="flex items-center gap-2 text-slate-400">
                        <BarChart3 size={16} />
                        <span className="text-xs font-bold uppercase tracking-widest">Backtest Intelligence</span>
                    </div>
                    {header?.id && (
                        <span className="text-[10px] font-mono text-slate-500">JOB_ID: {header.id}</span>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                    {loading && (
                        <div className="h-full flex flex-col items-center justify-center opacity-40">
                            <Loader size={48} className="animate-spin text-blue-500 mb-4" />
                            <p className="text-xs font-black uppercase tracking-[0.5em]">Processing Dataset</p>
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-900/40 border border-red-500/30 text-red-300 p-4 rounded text-sm mb-6">
                            {error}
                        </div>
                    )}

                    {results && (
                        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {header && (
                                <div className="bg-[#0d1117] border border-slate-800 rounded-xl p-4">
                                    <div className="text-[10px] uppercase tracking-widest text-slate-500">Strategy Report</div>
                                    <div className="text-lg font-semibold text-slate-100">{header.strategyName || header.strategyId}</div>
                                    <div className="text-xs text-slate-500 font-mono">
                                        ID: <span className="text-slate-300">{header.id}</span> | Symbol:{' '}
                                        <span className="text-slate-300">{header.symbol}</span> | TF:{' '}
                                        <span className="text-slate-300">{header.timeframe}</span> | Duration:{' '}
                                        <span className="text-slate-300">{header.executionTime}</span>
                                    </div>
                                    <div className="text-[11px] text-slate-500">{new Date(header.timestamp).toLocaleString()}</div>
                                </div>
                            )}

                            {perf && (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                    <MetricCard
                                        label="Net Profit"
                                        value={`$${perf.netProfit}`}
                                        trend={Number(perfRaw?.netProfit ?? perf.netProfit) >= 0}
                                    />
                                    <MetricCard
                                        label="ROI"
                                        value={`${perf.roiPercent}%`}
                                        trend={Number(perfRaw?.roiPercent ?? perf.roiPercent) >= 0}
                                    />
                                    <MetricCard label="Win Rate" value={`${perf.winRate}%`} color="text-blue-400" />
                                    <MetricCard label="Trades" value={perf.totalTrades} color="text-slate-300" />
                                    <MetricCard label="Max DD" value={`${perf.maxDrawdownPercent}%`} trend={false} />
                                    <MetricCard label="Sharpe" value={perf.sharpeRatio} color="text-slate-300" />
                                </div>
                            )}

                            <section className="bg-slate-900/30 border border-slate-800 rounded-xl p-5 shadow-inner">
                                <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-6">Equity Growth Sequence</h3>
                                <div className="h-[300px] w-full">
                                    <ResponsiveContainer>
                                        <AreaChart data={hasEquity ? equityCurve : [{ time: Date.now(), equity: 0 }]}>
                                            <defs>
                                                <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                            <XAxis dataKey="time" hide />
                                            <YAxis
                                                orientation="right"
                                                tick={{ fill: '#475569', fontSize: 10 }}
                                                axisLine={false}
                                                tickLine={false}
                                                tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
                                            />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                                                labelStyle={{ display: 'none' }}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="equity"
                                                stroke="#3b82f6"
                                                strokeWidth={2}
                                                fillOpacity={1}
                                                fill="url(#colorEquity)"
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </section>

                            <section className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <Target size={14} className="text-slate-500" />
                                    <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Trade Log</h3>
                                </div>
                                <div className="bg-[#0d1117] border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
                                    {trades.length === 0 ? (
                                        <div className="p-4 text-xs text-slate-500">No trades available.</div>
                                    ) : (
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-slate-900/80 border-b border-slate-800">
                                                <tr>
                                                    <th className="p-4 text-[9px] font-bold text-slate-500 uppercase">Timestamp</th>
                                                    <th className="p-4 text-[9px] font-bold text-slate-500 uppercase">Direction</th>
                                                    <th className="p-4 text-[9px] font-bold text-slate-500 uppercase text-right">Entry</th>
                                                    <th className="p-4 text-[9px] font-bold text-slate-500 uppercase text-right">Exit</th>
                                                    <th className="p-4 text-[9px] font-bold text-slate-500 uppercase text-right">PnL</th>
                                                    <th className="p-4 text-[9px] font-bold text-slate-500 uppercase text-right">Pct</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800/40">
                                                {trades.map((t, i) => {
                                                    const dirRaw = t.direction ?? t.side ?? t.position;
                                                    const dir = String(dirRaw || '').toLowerCase();
                                                    const isLong = dir.includes('long') || dir === 'buy';
                                                    const isShort = dir.includes('short') || dir === 'sell';
                                                    const label = isLong ? 'LONG' : isShort ? 'SHORT' : (dirRaw || '?');

                                                    return (
                                                        <tr key={i} className="hover:bg-white/[0.02] transition-colors font-mono">
                                                            <td className="p-4 text-[10px] text-slate-400">
                                                                {new Date(t.entryTime).toLocaleString([], { hour12: false })}
                                                            </td>
                                                            <td className="p-4 text-[10px]">
                                                                <span className={`px-2 py-0.5 rounded ${isLong ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                                                    {String(label).toUpperCase()}
                                                                </span>
                                                            </td>
                                                            <td className="p-4 text-[11px] text-slate-300 text-right">
                                                                {t.entryPrice?.toFixed(2) ?? '--'}
                                                            </td>
                                                            <td className="p-4 text-[11px] text-slate-300 text-right">
                                                                {t.exitPrice?.toFixed(2) ?? '--'}
                                                            </td>
                                                            <td className={`p-4 text-[11px] text-right font-bold ${Number(t.profit) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                                {Number(t.profit) >= 0 ? '+' : ''}{Number(t.profit || 0).toFixed(2)}
                                                            </td>
                                                            <td className={`p-4 text-[11px] text-right font-bold ${Number(t.profitPct) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                                {Number(t.profitPct || 0).toFixed(2)}%
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </section>

                            <details className="bg-slate-900/30 border border-slate-800 rounded-xl overflow-hidden">
                                <summary className="px-4 py-3 text-[10px] uppercase tracking-widest text-slate-500 cursor-pointer select-none border-b border-slate-800">
                                    Raw Report JSON
                                </summary>
                                <div className="p-4">
                                    <TreeTable data={results} />
                                </div>
                            </details>
                        </div>
                    )}

                    {!loading && !error && !results && (
                        <div className="h-full flex flex-col items-center justify-center opacity-20">
                            <TrendingUp size={64} className="mb-4" />
                            <p className="text-xs font-black uppercase tracking-[0.4em]">Initialize engine to generate report</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default Backtest;
