import React, { useState, useEffect } from 'react';
import client from '../../api/client';
import { Upload, Play, Loader, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';

const TreeRow = ({ label, value, level = 0 }) => {
    const [open, setOpen] = useState(level < 1);
    const isArray = Array.isArray(value);
    const isObject = value && typeof value === 'object' && !isArray;
    const hasChildren = isArray || isObject;

    const formatValue = (val) => {
        if (val === null || val === undefined) return 'null';
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        if (typeof val === 'number') return Number.isFinite(val) ? val.toString() : 'NaN';
        if (typeof val === 'string') return val;
        if (Array.isArray(val)) return `Array(${val.length})`;
        return `Object(${Object.keys(val).length})`;
    };

    return (
        <>
            <tr className="border-b border-slate-800/60">
                <td className="py-2 pr-3 text-xs text-slate-300">
                    <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 12}px` }}>
                        {hasChildren ? (
                            <button
                                type="button"
                                onClick={() => setOpen(!open)}
                                className="text-slate-500 hover:text-slate-300"
                                aria-label={open ? 'Collapse' : 'Expand'}
                            >
                                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                        ) : (
                            <span className="w-3" />
                        )}
                        <span className="font-mono text-[11px] text-slate-400">{label}</span>
                    </div>
                </td>
                <td className="py-2 text-xs text-slate-200">
                    <span className="font-mono">{formatValue(value)}</span>
                </td>
                <td className="py-2 text-[10px] uppercase text-slate-500">
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
                console.error("Failed to fetch strategies", err);
                const msg = err?.message || "Failed to load strategies. Is the engine running?";
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
                const match = list.find(s => s.id === selectedStrategy);
                const schema = (match && match.schema && Object.keys(match.schema).length > 0)
                    ? match.schema
                    : inferSchemaFromParams(match?.params || {});
                const values = match?.params || {};

                setParamSchema(schema || {});
                setParamValues(values || {});
                const enabledMap = {};
                Object.keys(schema || {}).forEach(k => { enabledMap[k] = true; });
                setParamEnabled(enabledMap);
            } catch (err) {
                console.error("Failed to fetch strategy meta", err);
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
            setError("Please select a strategy.");
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
            console.error("Backtest failed", err);
            setError(err.message || "Backtest failed. Check the console for details.");
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 ui-view-frame h-full">
            {/* Column 1: Configuration */}
        <div className="lg:col-span-1 ui-panel ui-panel-fixed flex flex-col h-full">
            <h2 className="text-lg font-bold text-slate-100 mb-4">Run Backtest</h2>
            <form onSubmit={runBacktest} className="space-y-4 flex-1 ui-panel-scroll">
                <div>
                    <label className="text-xs text-slate-400 mb-1 block">Strategy</label>
                    <select
                        value={selectedStrategy}
                        onChange={(e) => setSelectedStrategy(e.target.value)}
                        className="ui-select"
                    >
                        {strategies.map(s => (
                            <option key={s.id} value={s.id}>{s.name || s.id}</option>
                        ))}
                    </select>
                    </div>

                    <details className="bg-black/30 border border-slate-800 rounded-lg overflow-hidden ui-panel-scroll" open>
                        <summary className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 bg-slate-900/60 cursor-pointer select-none">
                            Payload Builder
                        </summary>
                        <table className="w-full text-left">
                            <thead className="bg-slate-900/40">
                                <tr>
                                    <th className="py-2 px-3 text-[10px] uppercase text-slate-500">Use</th>
                                    <th className="py-2 px-3 text-[10px] uppercase text-slate-500">Key</th>
                                    <th className="py-2 px-3 text-[10px] uppercase text-slate-500">Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="border-b border-slate-800/60">
                                    <td className="py-2 px-3">
                                        <input
                                            type="checkbox"
                                            checked={enabled.dataset}
                                            onChange={(e) => setEnabled({ ...enabled, dataset: e.target.checked })}
                                            className="h-4 w-4 rounded text-blue-500 bg-slate-900 border-slate-700"
                                        />
                                    </td>
                                    <td className="py-2 px-3 text-xs text-slate-400 font-mono">dataset</td>
                                    <td className="py-2 px-3">
                                        <label className={`w-full flex items-center justify-center px-3 py-2 border rounded cursor-pointer ${enabled.dataset ? 'bg-slate-900 border-slate-700 hover:bg-slate-800' : 'bg-slate-900/40 border-slate-800 text-slate-600'}`}>
                                            <Upload size={14} className="mr-2 text-slate-500"/>
                                            <span className="text-xs text-slate-400">{file ? file.name : 'Upload CSV'}</span>
                                            <input type="file" onChange={handleFileChange} className="hidden" accept=".csv" disabled={!enabled.dataset}/>
                                        </label>
                                    </td>
                                </tr>
                                <tr className="border-b border-slate-800/60">
                                    <td className="py-2 px-3">
                                        <input
                                            type="checkbox"
                                            checked={enabled.symbol}
                                            onChange={(e) => setEnabled({ ...enabled, symbol: e.target.checked })}
                                            className="h-4 w-4 rounded text-blue-500 bg-slate-900 border-slate-700"
                                        />
                                    </td>
                                    <td className="py-2 px-3 text-xs text-slate-400 font-mono">symbol</td>
                                    <td className="py-2 px-3">
                                        <input
                                            type="text"
                                            value={symbol}
                                            onChange={e => setSymbol(e.target.value)}
                                            disabled={!enabled.symbol}
                                            className={`ui-input text-xs ${enabled.symbol ? '' : 'opacity-60'}`}
                                        />
                                    </td>
                                </tr>
                                <tr className="border-b border-slate-800/60">
                                    <td className="py-2 px-3">
                                        <input
                                            type="checkbox"
                                            checked={enabled.interval}
                                            onChange={(e) => setEnabled({ ...enabled, interval: e.target.checked })}
                                            className="h-4 w-4 rounded text-blue-500 bg-slate-900 border-slate-700"
                                        />
                                    </td>
                                    <td className="py-2 px-3 text-xs text-slate-400 font-mono">interval</td>
                                    <td className="py-2 px-3">
                                        <input
                                            type="text"
                                            value={interval}
                                            onChange={e => setInterval(e.target.value)}
                                            disabled={!enabled.interval}
                                            className={`ui-input text-xs ${enabled.interval ? '' : 'opacity-60'}`}
                                        />
                                    </td>
                                </tr>
                                <tr className="border-b border-slate-800/60">
                                    <td className="py-2 px-3">
                                        <input
                                            type="checkbox"
                                            checked={enabled.initialCapital}
                                            onChange={(e) => setEnabled({ ...enabled, initialCapital: e.target.checked })}
                                            className="h-4 w-4 rounded text-blue-500 bg-slate-900 border-slate-700"
                                        />
                                    </td>
                                    <td className="py-2 px-3 text-xs text-slate-400 font-mono">initialCapital</td>
                                    <td className="py-2 px-3">
                                        <input
                                            type="number"
                                            value={initialCapital}
                                            onChange={e => setInitialCapital(e.target.value)}
                                            disabled={!enabled.initialCapital}
                                            className={`ui-input text-xs ${enabled.initialCapital ? '' : 'opacity-60'}`}
                                        />
                                    </td>
                                </tr>
                                <tr className="border-b border-slate-800/60">
                                    <td className="py-2 px-3">
                                        <input
                                            type="checkbox"
                                            checked={enabled.outputsize}
                                            onChange={(e) => setEnabled({ ...enabled, outputsize: e.target.checked })}
                                            className="h-4 w-4 rounded text-blue-500 bg-slate-900 border-slate-700"
                                        />
                                    </td>
                                    <td className="py-2 px-3 text-xs text-slate-400 font-mono">outputsize</td>
                                    <td className="py-2 px-3">
                                        <input
                                            type="number"
                                            value={outputsize}
                                            onChange={e => setOutputsize(e.target.value)}
                                            disabled={!enabled.outputsize}
                                            className={`ui-input text-xs ${enabled.outputsize ? '' : 'opacity-60'}`}
                                        />
                                    </td>
                                </tr>
                                <tr>
                                    <td className="py-2 px-3">
                                        <input
                                            type="checkbox"
                                            checked={enabled.includeTrades}
                                            onChange={(e) => setEnabled({ ...enabled, includeTrades: e.target.checked })}
                                            className="h-4 w-4 rounded text-blue-500 bg-slate-900 border-slate-700"
                                        />
                                    </td>
                                    <td className="py-2 px-3 text-xs text-slate-400 font-mono">includeTrades</td>
                                    <td className="py-2 px-3">
                                        <div className="flex items-center gap-2 text-xs text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={includeTrades}
                                                onChange={(e) => setIncludeTrades(e.target.checked)}
                                                disabled={!enabled.includeTrades}
                                                className="h-4 w-4 rounded text-blue-500 bg-slate-900 border-slate-700"
                                            />
                                            <span>{includeTrades ? 'true' : 'false'}</span>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </details>

                    <details className="bg-black/30 border border-slate-800 rounded-lg overflow-hidden ui-panel-scroll" open>
                        <summary className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 bg-slate-900/60 cursor-pointer select-none">
                            Strategy Params
                        </summary>
                        {Object.keys(paramSchema).length === 0 ? (
                            <div className="p-4 text-xs text-slate-500">No configurable params found for this strategy.</div>
                        ) : (
                            <table className="w-full text-left">
                                <thead className="bg-slate-900/40">
                                    <tr>
                                        <th className="py-2 px-3 text-[10px] uppercase text-slate-500">Use</th>
                                        <th className="py-2 px-3 text-[10px] uppercase text-slate-500">Key</th>
                                        <th className="py-2 px-3 text-[10px] uppercase text-slate-500">Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(paramSchema).map(([key, spec]) => {
                                        const isOn = !!paramEnabled[key];
                                        const type = (spec?.type || 'string').toLowerCase();
                                        const value = paramValues[key];

                                        return (
                                            <tr key={key} className="border-b border-slate-800/60">
                                                <td className="py-2 px-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={isOn}
                                                        onChange={(e) => setParamEnabled({ ...paramEnabled, [key]: e.target.checked })}
                                                        className="h-4 w-4 rounded text-blue-500 bg-slate-900 border-slate-700"
                                                    />
                                                </td>
                                                <td className="py-2 px-3 text-xs text-slate-400 font-mono">{key}</td>
                                                <td className="py-2 px-3">
                                                    {type === 'boolean' ? (
                                                        <div className="flex items-center gap-2 text-xs text-slate-300">
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
                                                            className={`ui-input text-xs ${isOn ? '' : 'opacity-60'}`}
                                                        />
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </details>

                    <button
                        type="submit"
                        disabled={loading || !selectedStrategy}
                        className="ui-button ui-button-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {loading ? <Loader size={16} className="animate-spin"/> : <Play size={14}/>}
                        Run Backtest
                    </button>
                </form>
            </div>

            {/* Column 2: Results */}
            <div className="lg:col-span-2 ui-panel ui-panel-fixed flex flex-col h-full">
                <div className="flex items-center gap-3 mb-4">
                    <FileText size={18} className="text-slate-500"/>
                    <h2 className="text-lg font-bold text-slate-100">Results</h2>
                </div>
                <div className="flex-1 ui-panel-scroll">
                    {loading && <p className="text-slate-400">Running backtest...</p>}
                    {error && <div className="bg-red-900/50 border border-red-500/30 text-red-300 p-4 rounded text-sm">{error}</div>}

                    {results && (
                        <div className="space-y-6">
                        {header && (
                            <div className="ui-card flex flex-col gap-2">
                                <div className="text-xs uppercase tracking-widest text-slate-500">Strategy Report</div>
                                <div className="text-lg font-semibold text-slate-100">{header.strategyName || header.strategyId}</div>
                                <div className="text-xs text-slate-500">
                                    ID: <span className="text-slate-300">{header.id}</span> ·
                                    Symbol: <span className="text-slate-300">{header.symbol}</span> ·
                                    TF: <span className="text-slate-300">{header.timeframe}</span> ·
                                    Duration: <span className="text-slate-300">{header.executionTime}</span>
                                </div>
                                <div className="text-[11px] text-slate-500">{new Date(header.timestamp).toLocaleString()}</div>
                            </div>
                        )}
                        {perf && (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                <div className="ui-card">
                                    <div className="ui-panel-title mb-1">Net Profit</div>
                                    <div className={`text-lg font-semibold ${Number(perfRaw?.netProfit ?? perf.netProfit) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>${perf.netProfit}</div>
                                </div>
                                <div className="ui-card">
                                    <div className="ui-panel-title mb-1">ROI</div>
                                    <div className={`text-lg font-semibold ${Number(perfRaw?.roiPercent ?? perf.roiPercent) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{perf.roiPercent}%</div>
                                </div>
                                <div className="ui-card">
                                    <div className="ui-panel-title mb-1">Win Rate</div>
                                    <div className="text-lg font-semibold text-slate-100">{perf.winRate}%</div>
                                </div>
                                <div className="ui-card">
                                    <div className="ui-panel-title mb-1">Trades</div>
                                    <div className="text-lg font-semibold text-slate-100">{perf.totalTrades}</div>
                                </div>
                                <div className="ui-card">
                                    <div className="ui-panel-title mb-1">Max DD</div>
                                    <div className="text-lg font-semibold text-rose-300">{perf.maxDrawdownPercent}%</div>
                                </div>
                                <div className="ui-card">
                                    <div className="ui-panel-title mb-1">Sharpe</div>
                                    <div className="text-lg font-semibold text-slate-100">{perf.sharpeRatio}</div>
                                </div>
                            </div>
                        )}

                        <details className="ui-panel-soft" open>
                            <summary className="px-4 py-3 text-[10px] uppercase tracking-widest text-slate-500 cursor-pointer select-none border-b border-slate-800">
                                Equity Curve
                            </summary>
                            <div className="p-4 h-[320px]">
                                <ResponsiveContainer>
                                    <LineChart data={hasEquity ? equityCurve : [{ time: Date.now(), equity: 0 }]}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                        <XAxis
                                            dataKey="time"
                                            type="number"
                                            scale="time"
                                            domain={['dataMin', 'dataMax']}
                                            tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                            stroke="#475569"
                                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                                        />
                                        <YAxis
                                            tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
                                            stroke="#475569"
                                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                background: '#0f172a',
                                                border: '1px solid #334155',
                                                borderRadius: '8px',
                                                color: '#e2e8f0'
                                            }}
                                            labelFormatter={(v) => new Date(v).toLocaleString()}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="equity"
                                            stroke="#22d3ee"
                                            strokeWidth={2.5}
                                            dot={{ r: 2, strokeWidth: 0 }}
                                            activeDot={{ r: 5, strokeWidth: 2 }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </details>

                        <details className="ui-panel-soft" open>
                            <summary className="px-4 py-3 text-[10px] uppercase tracking-widest text-slate-500 cursor-pointer select-none border-b border-slate-800">
                                Trades ({trades.length})
                            </summary>
                            <div className="overflow-x-auto">
                                {trades.length === 0 ? (
                                    <div className="p-4 text-xs text-slate-500">No trades available.</div>
                                ) : (
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
                                                const dirRaw = t.direction ?? t.side ?? t.position;
                                                const dir = String(dirRaw || '').toLowerCase();
                                                const isLong = dir.includes('long') || dir === 'buy';
                                                const isShort = dir.includes('short') || dir === 'sell';
                                                const label = isLong ? 'LONG' : isShort ? 'SHORT' : (dirRaw || '?');
                                                return (
                                                <tr key={i}>
                                                    <td className="whitespace-nowrap text-slate-300">
                                                        {new Date(t.entryTime).toLocaleString()}
                                                    </td>
                                                    <td>
                                                        <span className={
                                                            isLong
                                                                ? 'text-emerald-400 font-medium'
                                                                : 'text-rose-400 font-medium'
                                                        }>
                                                            {String(label).toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td className="text-right text-slate-300">
                                                        {t.entryPrice?.toFixed(2) ?? '--'}
                                                    </td>
                                                    <td className="text-right text-slate-300">
                                                        {t.exitPrice?.toFixed(2) ?? '--'}
                                                    </td>
                                                    <td className={`text-right font-medium ${Number(t.profit) >= 0 ? '!text-emerald-400' : '!text-rose-400'}`}>
                                                        ${Number(t.profit || 0).toFixed(2)}
                                                    </td>
                                                    <td className={`text-right ${Number(t.profitPct) >= 0 ? '!text-emerald-400' : '!text-rose-400'}`}>
                                                        {Number(t.profitPct || 0).toFixed(2)}%
                                                    </td>
                                                </tr>
                                            )})}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </details>

                        <details className="ui-panel-soft">
                            <summary className="px-4 py-3 text-[10px] uppercase tracking-widest text-slate-500 cursor-pointer select-none border-b border-slate-800">
                                Raw Report JSON
                            </summary>
                            <div className="p-4">
                                <TreeTable data={results} />
                            </div>
                        </details>
                        </div>
                    )}

                    {!loading && !error && !results && <p className="text-slate-500 text-sm">Results will appear here after running a backtest.</p>}
                </div>
            </div>
        </div>
    );
};

export default Backtest;
