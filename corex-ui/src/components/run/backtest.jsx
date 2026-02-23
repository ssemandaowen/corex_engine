
import React, { useState, useEffect, useMemo } from 'react';
import client from '../../api/client';
import { corexSwal } from '../../utils/swal';
import {
    Upload,
    Play,
    Loader,
    ChevronRight,
    ChevronDown,
    BarChart3,
    Target,
    Zap,
    TrendingUp,
    Trash2,
    AlertTriangle
} from 'lucide-react';
import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ComposedChart,
    BarChart,
    Bar,
    Cell,
    Line,
    ReferenceLine
} from 'recharts';
import {
    fmtMoney,
    calcDrawdownSeries,
    calcReturns,
    calcRollingSharpe,
    calcHistogram,
    mergeAnalysisSeries,
    calcExpectancy
} from '../../utils/backtestAnalytics';

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
            <tr className="border-b border-[var(--ui-border)] hover:bg-[var(--ui-row-hover)] transition-colors">
                <td className="py-2 pl-4 text-xs font-mono" style={{ paddingLeft: `${level * 16 + 16}px` }}>
                    <div className="flex items-center gap-2">
                        {hasChildren ? (
                            <button
                                type="button"
                                onClick={() => setOpen(!open)}
                                className="text-[var(--ui-muted)]"
                                aria-label={open ? 'Collapse' : 'Expand'}
                            >
                                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                        ) : (
                            <span className="w-3" />
                        )}
                        <span className="text-[var(--ui-muted)]">{label}</span>
                    </div>
                </td>
                <td className="py-2 text-xs font-mono text-[var(--ui-accent)]">
                    {!hasChildren ? formatValue(value) : ''}
                </td>
                <td className="py-2 text-[10px] uppercase text-[var(--ui-subtle)] font-bold">
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
        <div className="ui-panel-soft rounded-lg overflow-hidden">
            <table className="ui-table">
                <thead>
                    <tr>
                        <th className="py-2 px-3 text-[10px] uppercase text-[var(--ui-muted)]">Key</th>
                        <th className="py-2 px-3 text-[10px] uppercase text-[var(--ui-muted)]">Value</th>
                        <th className="py-2 px-3 text-[10px] uppercase text-[var(--ui-muted)]">Type</th>
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
            className="h-3 w-3 rounded accent-[var(--ui-accent)] border border-[var(--ui-border)]"
        />
        <div className="flex-1 flex flex-col gap-1">
            <span className={`text-[9px] font-bold uppercase transition-colors ${active ? 'text-[var(--ui-muted)]' : 'text-[var(--ui-subtle)]'}`}>
                {label}
            </span>
            {children}
        </div>
    </div>
);

const MetricCard = ({ label, value, color = 'text-[var(--ui-positive)]', trend = null, tooltip = '' }) => (
    <div className="bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] p-4 rounded-xl shadow-sm" title={tooltip || undefined}>
        <span className="text-[9px] font-black uppercase text-[var(--ui-muted)] tracking-widest block mb-2">{label}</span>
        <div className={`text-xl font-mono font-bold ${trend === true ? 'text-[var(--ui-positive)]' : trend === false ? 'text-[var(--ui-negative)]' : color}`}>
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
    const [warnings, setWarnings] = useState([]);

    // Form state
    const [file, setFile] = useState(null);
    const [symbol, setSymbol] = useState('BTC/USD');
    const [interval, setInterval] = useState('1m');
    const [initialCapital, setInitialCapital] = useState('10000');
    const [rangeMode, setRangeMode] = useState('points');
    const [rangePoints, setRangePoints] = useState('5000');
    const [rangeStart, setRangeStart] = useState('');
    const [rangeEnd, setRangeEnd] = useState('');
    const [includeTrades, setIncludeTrades] = useState(true);
    const [backtestSettings, setBacktestSettings] = useState(null);
    const [uploads, setUploads] = useState([]);
    const [selectedUploadId, setSelectedUploadId] = useState('');
    const [uploading, setUploading] = useState(false);
    const [dataMode, setDataMode] = useState('offline');
    const [paramSchema, setParamSchema] = useState({});
    const [paramValues, setParamValues] = useState({});
    const [paramEnabled, setParamEnabled] = useState({});

    // Field toggles (Postman-style enable/disable)
    const [enabled, setEnabled] = useState({
        dataset: false,
        symbol: true,
        interval: true,
        initialCapital: true,
        includeTrades: true,
        range: true
    });

    useEffect(() => {
        const fetchBacktestSettings = async () => {
            try {
                const res = await client.get('/backtest/settings');
                const cfg = res?.payload || null;
                setBacktestSettings(cfg);
                if (cfg?.defaultSymbol) setSymbol(String(cfg.defaultSymbol));
                if (cfg?.defaultInterval) setInterval(String(cfg.defaultInterval));
                if (cfg?.defaultInitialCapital != null) setInitialCapital(String(cfg.defaultInitialCapital));
                if (cfg?.includeTrades != null) setIncludeTrades(!!cfg.includeTrades);
                if (cfg?.defaultOutputsize != null) setRangePoints(String(cfg.defaultOutputsize));
            } catch (err) {
                console.error('Failed to fetch backtest settings', err);
            }
        };
        const fetchUploads = async () => {
            try {
                const res = await client.get('/backtest/uploads');
                const list = Array.isArray(res?.payload) ? res.payload : [];
                setUploads(list);
                if (list.length > 0 && !selectedUploadId) setSelectedUploadId(list[0].id);
            } catch (err) {
                console.error('Failed to fetch upload library', err);
            }
        };

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
        fetchBacktestSettings();
        fetchUploads();
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

    const refreshUploads = async () => {
        const res = await client.get('/backtest/uploads');
        const list = Array.isArray(res?.payload) ? res.payload : [];
        setUploads(list);
        if (list.length > 0 && !selectedUploadId) setSelectedUploadId(list[0].id);
    };

    const handleFileChange = async (e) => {
        const nextFile = e.target.files?.[0] || null;
        setFile(nextFile);
        if (!nextFile) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('dataset', nextFile);
            fd.append('symbol', symbol || 'UNASSIGNED');
            const res = await client.post('/backtest/uploads', fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const created = res?.payload || null;
            await refreshUploads();
            if (created?.id) setSelectedUploadId(created.id);
            setWarnings((prev) => [`Upload saved for offline reuse: ${created?.id || nextFile.name}`, ...prev].slice(0, 6));
            setEnabled((prev) => ({ ...prev, dataset: false }));
        } catch (err) {
            setError(err.message || 'Failed to store upload.');
        } finally {
            setUploading(false);
        }
    };

    const buildBacktestFormData = () => {
        const formData = new FormData();
        if (dataMode === 'offline') {
            if (enabled.dataset && file && !selectedUploadId) {
                formData.append('dataset', file);
            }
            if (selectedUploadId) formData.append('uploadId', selectedUploadId);
        } else {
            if (enabled.symbol) formData.append('symbol', symbol);
            if (enabled.interval) formData.append('interval', interval);
        }
        if (enabled.initialCapital) formData.append('initialCapital', initialCapital);

        const points = Number(rangePoints || 0);
        const effectiveOutput = (rangeMode === 'points' && Number.isFinite(points) && points > 0)
            ? String(Math.floor(points))
            : String(Math.floor(points || 0));
        if (effectiveOutput !== '0') formData.append('outputsize', effectiveOutput);
        if (enabled.includeTrades) formData.append('includeTrades', includeTrades ? 'true' : 'false');
        if (enabled.range) {
            formData.append('rangeMode', rangeMode);
            if (rangeMode === 'points') {
                formData.append('rangePoints', effectiveOutput);
            } else {
                if (rangeStart) formData.append('rangeStart', rangeStart);
                if (rangeEnd) formData.append('rangeEnd', rangeEnd);
            }
        }

        const paramsPayload = {};
        Object.entries(paramEnabled).forEach(([key, isOn]) => {
            if (isOn && key in paramValues) {
                paramsPayload[key] = paramValues[key];
            }
        });
        if (Object.keys(paramsPayload).length > 0) {
            formData.append('params', JSON.stringify(paramsPayload));
        }
        return formData;
    };

    const runBacktest = async (e) => {
        e.preventDefault();
        if (!selectedStrategy) {
            setError('Please select a strategy.');
            return;
        }
        if (dataMode === 'offline' && !selectedUploadId && !file) {
            setError('Offline mode requires an upload or stored dataset.');
            setWarnings((prev) => ['Offline mode requires uploadId or dataset file.', ...prev].slice(0, 6));
            return;
        }
        if (dataMode === 'online' && (!symbol || !interval)) {
            setError('Online mode requires symbol + interval.');
            setWarnings((prev) => ['Online mode requires symbol + interval.', ...prev].slice(0, 6));
            return;
        }

        setLoading(true);
        setResults(null);
        setError(null);
        setWarnings([]);

        const formData = buildBacktestFormData();

        try {
            const res = await client.post(`/backtest/${selectedStrategy}`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            setResults(res.payload);
            setWarnings(Array.isArray(res?.meta?.warnings) ? res.meta.warnings : []);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('corex:backtest:created', {
                    detail: { id: res?.payload?.meta?.id || null, ts: Date.now() }
                }));
            }
        } catch (err) {
            console.error('Backtest failed', err);
            setError(err.message || 'Backtest failed. Check the console for details.');
            await corexSwal({
                icon: 'error',
                title: 'Backtest Failed',
                text: err?.message || 'Backtest failed. Check the console for details.',
                confirmButtonText: 'OK'
            });
        } finally {
            setLoading(false);
        }
    };

    const perf = results?.performance || null;
    const perfRaw = results?.performanceRaw || null;
    const fallbackTime = useMemo(() => Date.now(), []);
    const trades = Array.isArray(results?.trades) ? results.trades : [];
    const equityCurve = Array.isArray(results?.equityCurve)
        ? results.equityCurve
            .map((p) => ({ time: Number(p.time), equity: Number(p.equity) }))
            .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.equity))
        : [];
    const drawdownSeries = Array.isArray(results?.analytics?.drawdownCurve)
        ? results.analytics.drawdownCurve.map((p) => ({ time: Number(p.time), drawdown: Number(p.drawdown || 0) }))
        : calcDrawdownSeries(equityCurve);
    const returnsSeries = Array.isArray(results?.analytics?.returns)
        ? results.analytics.returns.map((p) => ({ time: Number(p.time), value: Number(p.value || 0) }))
        : calcReturns(equityCurve).map((p) => ({ time: p.time, value: Number(p.r || 0) }));
    const hist = calcHistogram(returnsSeries.map((p) => ({ r: p.value })));
    const sharpeSeries = Array.isArray(results?.analytics?.rollingSharpe)
        ? results.analytics.rollingSharpe.map((p) => ({ time: Number(p.time), sharpe: Number(p.sharpe || 0) }))
        : calcRollingSharpe(returnsSeries.map((p) => ({ r: p.value })), 20);
    const expectancy = calcExpectancy(trades);
    const analysisSeries = mergeAnalysisSeries(equityCurve, drawdownSeries, sharpeSeries);
    const grossProfit = Number(perfRaw?.grossProfit ?? perf?.grossProfit ?? 0);
    const grossLoss = Math.abs(Number(perfRaw?.grossLoss ?? perf?.grossLoss ?? 0));
    const pnlSummaryBars = [
        { key: 'Profit', amount: grossProfit, fill: 'var(--ui-positive)' },
        { key: 'Loss', amount: grossLoss, fill: 'var(--ui-negative)' }
    ];
    const wins = trades.filter((t) => Number(t.profit || 0) > 0).length;
    const losses = trades.filter((t) => Number(t.profit || 0) < 0).length;
    const header = results?.meta || null;

    return (
        <div className="flex flex-col xl:flex-row h-full bg-transparent overflow-hidden">
            <aside className="w-full xl:w-[22rem] border-b xl:border-b-0 xl:border-r border-[var(--ui-border)] flex flex-col bg-[var(--ui-panel-strong)] max-h-[48vh] xl:max-h-full">
                <div className="p-4 border-b border-[var(--ui-border)] flex items-center gap-2">
                    <Zap size={16} className="text-[var(--ui-accent)]" />
                    <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--ui-text)]">Execution Config</h2>
                </div>

                <form id="backtest-form" onSubmit={runBacktest} className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-[var(--ui-muted)] uppercase tracking-tighter">Target Strategy</label>
                        <select
                            value={selectedStrategy}
                            onChange={(e) => setSelectedStrategy(e.target.value)}
                            className="ui-select w-full text-xs"
                        >
                            {strategies.map((s) => (
                                <option key={s.id} value={s.id}>{s.name || s.id}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-2">
                            <span className="text-[10px] font-bold text-[var(--ui-muted)] uppercase">Payload Data</span>
                            <span className="text-[9px] text-[var(--ui-subtle)] font-mono">POST /backtest/{selectedStrategy || 'id'}</span>
                        </div>
                        <ConfigRow label="Mode" active onToggle={() => {}}>
                            <select
                                value={dataMode}
                                onChange={(e) => setDataMode(e.target.value)}
                                className="ui-select w-full text-xs"
                            >
                                <option value="offline">Offline (Upload Library)</option>
                                <option value="online">Online (Symbol Fetch)</option>
                            </select>
                        </ConfigRow>

                        <ConfigRow label="Dataset" active={enabled.dataset && dataMode === 'offline'} onToggle={(v) => setEnabled({ ...enabled, dataset: v })}>
                            <label className={`flex-1 flex items-center justify-center gap-2 h-8 border border-dashed rounded text-[10px] cursor-pointer transition-colors ${enabled.dataset ? 'border-[var(--ui-border)] hover:bg-[var(--ui-row-hover)]' : 'border-[var(--ui-border)] text-[var(--ui-subtle)]'}`}>
                                <Upload size={12} /> {uploading ? 'Storing...' : file ? file.name : 'Select CSV'}
                                <input
                                    type="file"
                                    className="hidden"
                                    onChange={handleFileChange}
                                    accept=".csv"
                                    disabled={dataMode !== 'offline' || !enabled.dataset || uploading}
                                />
                            </label>
                        </ConfigRow>
                        <div className="space-y-1">
                            <div className="text-[9px] uppercase tracking-widest text-[var(--ui-muted)]">Upload Library (Offline)</div>
                            <div className="flex gap-2">
                                <select
                                    value={selectedUploadId}
                                    onChange={(e) => setSelectedUploadId(e.target.value)}
                                    className="ui-select w-full text-xs"
                                    disabled={dataMode !== 'offline'}
                                >
                                    <option value="">No saved upload</option>
                                    {uploads.map((u) => (
                                        <option key={u.id} value={u.id}>
                                            {u.symbol} :: {u.originalname}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (!selectedUploadId) return;
                                        await client.delete(`/backtest/uploads/${selectedUploadId}`);
                                        setSelectedUploadId('');
                                        await refreshUploads();
                                    }}
                                    className="h-8 px-2 rounded border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-[var(--ui-negative)] hover:border-[var(--ui-border-strong)]"
                                    disabled={dataMode !== 'offline'}
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>

                        <ConfigRow label="Symbol" active={enabled.symbol && dataMode === 'online'} onToggle={(v) => setEnabled({ ...enabled, symbol: v })}>
                            <input
                                type="text"
                                value={symbol}
                                onChange={(e) => setSymbol(e.target.value)}
                                disabled={dataMode !== 'online' || !enabled.symbol}
                                className="ui-input text-xs"
                            />
                        </ConfigRow>

                        <ConfigRow label="Interval" active={enabled.interval && dataMode === 'online'} onToggle={(v) => setEnabled({ ...enabled, interval: v })}>
                            <select
                                value={interval}
                                onChange={(e) => setInterval(e.target.value)}
                                disabled={dataMode !== 'online' || !enabled.interval}
                                className="ui-select w-full text-xs"
                            >
                                {(Array.isArray(backtestSettings?.allowedIntervals) ? backtestSettings.allowedIntervals : ['1m', '5m', '15m', '1h', '4h', '1d']).map((tf) => (
                                    <option key={tf} value={tf}>{tf}</option>
                                ))}
                            </select>
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

                        <ConfigRow label="Data Range" active={enabled.range} onToggle={(v) => setEnabled({ ...enabled, range: v })}>
                            <div className="space-y-2">
                                <select
                                    value={rangeMode}
                                    onChange={(e) => setRangeMode(e.target.value)}
                                    disabled={!enabled.range}
                                    className="ui-select w-full text-xs"
                                >
                                    <option value="points">Points (latest N bars)</option>
                                    <option value="dates">Date Range</option>
                                </select>
                                {rangeMode === 'points' ? (
                                    <input
                                        type="number"
                                        value={rangePoints}
                                        onChange={(e) => setRangePoints(e.target.value)}
                                        disabled={!enabled.range}
                                        className="ui-input text-xs"
                                        placeholder="Bars to include"
                                    />
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        <input
                                            type="datetime-local"
                                            value={rangeStart}
                                            onChange={(e) => setRangeStart(e.target.value)}
                                            disabled={!enabled.range}
                                            className="ui-input text-xs"
                                        />
                                        <input
                                            type="datetime-local"
                                            value={rangeEnd}
                                            onChange={(e) => setRangeEnd(e.target.value)}
                                            disabled={!enabled.range}
                                            className="ui-input text-xs"
                                        />
                                    </div>
                                )}
                                <p className="text-[10px] text-[var(--ui-subtle)]">Filters dataset after load. Points mode slices latest N bars.</p>
                            </div>
                        </ConfigRow>

                        <ConfigRow label="Trades" active={enabled.includeTrades} onToggle={(v) => setEnabled({ ...enabled, includeTrades: v })}>
                            <div className="flex items-center gap-2 text-[11px] text-[var(--ui-text)]">
                                <input
                                    type="checkbox"
                                    checked={includeTrades}
                                    onChange={(e) => setIncludeTrades(e.target.checked)}
                                    disabled={!enabled.includeTrades}
                                    className="h-4 w-4 rounded accent-[var(--ui-accent)] border border-[var(--ui-border)]"
                                />
                                <span>{includeTrades ? 'true' : 'false'}</span>
                            </div>
                        </ConfigRow>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-2">
                            <span className="text-[10px] font-bold text-[var(--ui-muted)] uppercase">Strategy Params</span>
                            <span className="text-[9px] text-[var(--ui-subtle)] font-mono">JSON</span>
                        </div>

                        {Object.keys(paramSchema).length === 0 ? (
                            <div className="text-xs text-[var(--ui-muted)]">No configurable params found for this strategy.</div>
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
                                                <div className="flex items-center gap-2 text-[11px] text-[var(--ui-text)]">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!value}
                                                        onChange={(e) => setParamValues({ ...paramValues, [key]: e.target.checked })}
                                                        disabled={!isOn}
                                                        className="h-4 w-4 rounded accent-[var(--ui-accent)] border border-[var(--ui-border)]"
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

                <div className="p-4 bg-[rgba(15,23,42,0.45)] border-t border-[var(--ui-border)]">
                    <button
                        type="submit"
                        form="backtest-form"
                        disabled={loading || !selectedStrategy}
                        className="w-full ui-button ui-button-primary disabled:opacity-50 font-bold py-2.5 rounded text-[11px] uppercase tracking-widest flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
                        Execute Sequence
                    </button>
                </div>
            </aside>

            <main className="flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="p-4 border-b border-[var(--ui-border)] flex items-center justify-between bg-[var(--ui-panel)]">
                    <div className="flex items-center gap-2 text-[var(--ui-muted)]">
                        <BarChart3 size={16} />
                        <span className="text-xs font-bold uppercase tracking-widest">Backtest Intelligence</span>
                    </div>
                    {header?.id && (
                        <span className="text-[10px] font-mono text-[var(--ui-muted)]">JOB_ID: {header.id}</span>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-0 scrollbar-thin">
                    {loading && (
                        <div className="h-full flex flex-col items-center justify-center opacity-40">
                            <Loader size={48} className="animate-spin text-[var(--ui-accent)] mb-4" />
                            <p className="text-xs font-black uppercase tracking-[0.5em]">Processing Dataset</p>
                        </div>
                    )}

                    {error && (
                        <div
                            className="border text-[var(--ui-negative)] p-4 rounded text-sm mb-6"
                            style={{
                                backgroundColor: 'color-mix(in srgb, var(--ui-negative) 18%, transparent)',
                                borderColor: 'color-mix(in srgb, var(--ui-negative) 50%, transparent)'
                            }}
                        >
                            {error}
                        </div>
                    )}
                    {warnings.length > 0 && (
                        <div
                            className="border text-[var(--ui-warning)] p-4 rounded text-sm mb-6 space-y-1"
                            style={{
                                backgroundColor: 'color-mix(in srgb, var(--ui-warning) 16%, transparent)',
                                borderColor: 'color-mix(in srgb, var(--ui-warning) 42%, transparent)'
                            }}
                        >
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold">
                                <AlertTriangle size={12} /> Notices
                            </div>
                            {warnings.map((w, i) => (
                                <div key={`${w}_${i}`} className="text-[12px]">{w}</div>
                            ))}
                        </div>
                    )}

                    {results && (
                        <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 p-3 md:p-4 xl:p-5">
                            {header && (
                                <div className="bg-[var(--ui-panel)] border border-[var(--ui-border)] rounded-xl p-4">
                                    <div className="text-[10px] uppercase tracking-widest text-[var(--ui-muted)]">Strategy Report</div>
                                    <div className="text-lg font-semibold text-[var(--ui-text)]">{header.strategyName || header.strategyId}</div>
                                    <div className="text-xs text-[var(--ui-muted)] font-mono">
                                        ID: <span className="text-[var(--ui-text)]">{header.id}</span> | Symbol:{' '}
                                        <span className="text-[var(--ui-text)]">{header.symbol}</span> | TF:{' '}
                                        <span className="text-[var(--ui-text)]">{header.timeframe}</span> | Duration:{' '}
                                        <span className="text-[var(--ui-text)]">{header.executionTime}</span>
                                    </div>
                                    <div className="text-[11px] text-[var(--ui-muted)]">{new Date(header.timestamp).toLocaleString()}</div>
                                </div>
                            )}

                            {perf && (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                    <MetricCard
                                        label="Net Profit"
                                        value={`$${perf.netProfit}`}
                                        trend={Number(perfRaw?.netProfit ?? perf.netProfit) >= 0}
                                        tooltip="Net PnL after all wins/losses and costs."
                                    />
                                    <MetricCard
                                        label="ROI"
                                        value={`${perf.roiPercent}%`}
                                        trend={Number(perfRaw?.roiPercent ?? perf.roiPercent) >= 0}
                                    />
                                    <MetricCard label="Win Rate" value={`${perf.winRate}%`} color="text-[var(--ui-accent)]" />
                                    <MetricCard label="Trades" value={perf.totalTrades} color="text-[var(--ui-text)]" />
                                    <MetricCard label="Max DD" value={`${perf.maxDrawdownPercent}%`} trend={false} />
                                    <MetricCard label="Sharpe" value={perf.sharpeRatio} color="text-[var(--ui-text)]" tooltip="Risk-adjusted return (higher is generally better)." />
                                </div>
                            )}

                            {perf && (
                                <div className="bg-[var(--ui-panel)] border border-[var(--ui-border)] rounded-xl p-4">
                                    <div className="text-[10px] uppercase tracking-widest text-[var(--ui-muted)] mb-4">Profit Factor & Expectancy</div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                        <MetricCard label="Profit Factor" value={perf.profitFactor ?? '--'} color="text-[var(--ui-text)]" tooltip="Gross profit divided by gross loss." />
                                        <MetricCard label="Gross Profit" value={fmtMoney(perf.grossProfit)} color="text-[var(--ui-positive)]" />
                                        <MetricCard label="Gross Loss" value={fmtMoney(perf.grossLoss)} color="text-[var(--ui-negative)]" />
                                        <MetricCard label="Avg Win" value={fmtMoney(expectancy.avgWin)} color="text-[var(--ui-positive)]" />
                                        <MetricCard label="Avg Loss" value={fmtMoney(expectancy.avgLoss)} color="text-[var(--ui-negative)]" />
                                        <MetricCard label="Expectancy" value={fmtMoney(expectancy.expectancy)} trend={expectancy.expectancy >= 0} />
                                    </div>
                                </div>
                            )}

                            <section className="bg-[var(--ui-panel)] border border-[var(--ui-border)] rounded-xl p-5 ">
                                <h3 className="text-[10px] font-black uppercase text-[var(--ui-muted)] tracking-widest mb-6">Trade Analysis (Equity / Drawdown / Sharpe)</h3>
                                <div className="h-[320px] w-full">
                                    <ResponsiveContainer>
                                        <ComposedChart data={analysisSeries.length ? analysisSeries : [{ time: fallbackTime, equity: Number(initialCapital), drawdown: 0, sharpe: 0 }]}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-border)" vertical={false} />
                                            <XAxis dataKey="time" hide />
                                            <YAxis
                                                yAxisId="equity"
                                                orientation="left"
                                                tick={{ fill: 'var(--ui-subtle)', fontSize: 10 }}
                                                tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
                                            />
                                            <YAxis
                                                yAxisId="ratio"
                                                orientation="right"
                                                tick={{ fill: 'var(--ui-subtle)', fontSize: 10 }}
                                                tickFormatter={(v) => `${Number(v).toFixed(2)}`}
                                            />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: 'var(--ui-panel)', border: '1px solid var(--ui-border)' }}
                                                labelFormatter={(v) => new Date(v).toLocaleString()}
                                            />
                                            <Line yAxisId="equity" type="monotone" dataKey="equity" name="Equity" stroke="var(--ui-accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                                            <Line yAxisId="ratio" type="monotone" dataKey="drawdown" name="Drawdown %" stroke="var(--ui-negative)" strokeWidth={2} dot={false} isAnimationActive={false} />
                                            <Line yAxisId="ratio" type="monotone" dataKey="sharpe" name="Sharpe (20)" stroke="var(--ui-positive)" strokeWidth={2} dot={false} isAnimationActive={false} />
                                            <ReferenceLine yAxisId="ratio" y={0} stroke="var(--ui-border-strong)" />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </section>

                            <section className="bg-[var(--ui-panel)] border border-[var(--ui-border)] rounded-xl p-5 ">
                                <h3 className="text-[10px] font-black uppercase text-[var(--ui-muted)] tracking-widest mb-6">Return Histogram + PnL Totals</h3>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <div className="h-[220px] w-full">
                                        <ResponsiveContainer>
                                            <BarChart data={hist.length ? hist : [{ label: '0%', count: 0 }]}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-border)" vertical={false} />
                                                <XAxis dataKey="label" stroke="var(--ui-subtle)" tick={{ fill: 'var(--ui-muted)', fontSize: 10 }} />
                                                <YAxis stroke="var(--ui-subtle)" tick={{ fill: 'var(--ui-muted)', fontSize: 10 }} />
                                                <Tooltip contentStyle={{ backgroundColor: 'var(--ui-panel)', border: '1px solid var(--ui-border)' }} />
                                                <Bar dataKey="count" fill="var(--ui-accent-strong)" name="Return Frequency" isAnimationActive={false} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="h-[220px] w-full">
                                        <ResponsiveContainer>
                                            <BarChart data={pnlSummaryBars}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-border)" vertical={false} />
                                                <XAxis dataKey="key" stroke="var(--ui-subtle)" tick={{ fill: 'var(--ui-muted)', fontSize: 10 }} />
                                                <YAxis
                                                    stroke="var(--ui-subtle)"
                                                    tick={{ fill: 'var(--ui-muted)', fontSize: 10 }}
                                                    tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
                                                />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: 'var(--ui-panel)', border: '1px solid var(--ui-border)' }}
                                                    formatter={(v) => fmtMoney(v)}
                                                />
                                                <Bar dataKey="amount" name="PnL" isAnimationActive={false}>
                                                    {pnlSummaryBars.map((entry, idx) => (
                                                        <Cell key={`pnl-total-${idx}`} fill={entry.fill} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                                    <MetricCard label="Total Profit" value={fmtMoney(grossProfit)} color="text-[var(--ui-positive)]" />
                                    <MetricCard label="Total Loss" value={fmtMoney(grossLoss)} color="text-[var(--ui-negative)]" />
                                    <MetricCard label="Winning Trades" value={wins} color="text-[var(--ui-positive)]" />
                                    <MetricCard label="Losing Trades" value={losses} color="text-[var(--ui-negative)]" />
                                </div>
                            </section>

                            {header?.runtimeParams && Object.keys(header.runtimeParams).length > 0 && (
                                <section className="bg-[var(--ui-panel)] border border-[var(--ui-border)] rounded-xl p-5 ">
                                    <h3 className="text-[10px] font-black uppercase text-[var(--ui-muted)] tracking-widest mb-6">Runtime Params</h3>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                                        {Object.entries(header.runtimeParams).map(([k, v]) => (
                                            <div key={k} className="bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] rounded-lg p-3">
                                                <div className="text-[10px] uppercase tracking-widest text-[var(--ui-muted)]">{k}</div>
                                                <div className="font-mono text-[var(--ui-text)]">{String(v)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            <section className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <Target size={14} className="text-[var(--ui-muted)]" />
                                    <h3 className="text-[10px] font-black uppercase text-[var(--ui-muted)] tracking-widest">Trade Log</h3>
                                </div>
                                <div className="bg-[var(--ui-panel)] border border-[var(--ui-border)] rounded-xl overflow-hidden ">
                                    {trades.length === 0 ? (
                                        <div className="p-4 text-xs text-[var(--ui-muted)]">No trades available.</div>
                                    ) : (
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-[var(--ui-tab-strip-bg)] border-b border-[var(--ui-border)]">
                                                <tr>
                                                    <th className="p-4 text-[9px] font-bold text-[var(--ui-muted)] uppercase">Timestamp</th>
                                                    <th className="p-4 text-[9px] font-bold text-[var(--ui-muted)] uppercase">Direction</th>
                                                    <th className="p-4 text-[9px] font-bold text-[var(--ui-muted)] uppercase text-right">Entry</th>
                                                    <th className="p-4 text-[9px] font-bold text-[var(--ui-muted)] uppercase text-right">Exit</th>
                                                    <th className="p-4 text-[9px] font-bold text-[var(--ui-muted)] uppercase text-right">PnL</th>
                                                    <th className="p-4 text-[9px] font-bold text-[var(--ui-muted)] uppercase text-right">Pct</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--ui-border)]">
                                                {trades.map((t, i) => {
                                                    const dirRaw = t.direction ?? t.side ?? t.position;
                                                    const dir = String(dirRaw || '').toLowerCase();
                                                    const isLong = dir.includes('long') || dir === 'buy';
                                                    const isShort = dir.includes('short') || dir === 'sell';
                                                    const label = isLong ? 'LONG' : isShort ? 'SHORT' : (dirRaw || '?');

                                                    return (
                                                        <tr key={i} className="hover:bg-white/[0.02] transition-colors font-mono">
                                                            <td className="p-4 text-[10px] text-[var(--ui-muted)]">
                                                                {new Date(t.entryTime).toLocaleString([], { hour12: false })}
                                                            </td>
                                                            <td className="p-4 text-[10px]">
                                                                <span
                                                                    className={`px-2 py-0.5 rounded ${isLong ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-negative)]'}`}
                                                                    style={{
                                                                        backgroundColor: isLong
                                                                            ? 'color-mix(in srgb, var(--ui-positive) 20%, transparent)'
                                                                            : 'color-mix(in srgb, var(--ui-negative) 20%, transparent)'
                                                                    }}
                                                                >
                                                                    {String(label).toUpperCase()}
                                                                </span>
                                                            </td>
                                                            <td className="p-4 text-[11px] text-[var(--ui-text)] text-right">
                                                                {t.entryPrice?.toFixed(2) ?? '--'}
                                                            </td>
                                                            <td className="p-4 text-[11px] text-[var(--ui-text)] text-right">
                                                                {t.exitPrice?.toFixed(2) ?? '--'}
                                                            </td>
                                                            <td className={`p-4 text-[11px] text-right font-bold ${Number(t.profit) >= 0 ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-negative)]'}`}>
                                                                {Number(t.profit) >= 0 ? '+' : ''}{Number(t.profit || 0).toFixed(2)}
                                                            </td>
                                                            <td className={`p-4 text-[11px] text-right font-bold ${Number(t.profitPct) >= 0 ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-negative)]'}`}>
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

                            <details className="bg-[var(--ui-panel)] border border-[var(--ui-border)] rounded-xl overflow-hidden">
                                <summary className="px-4 py-3 text-[10px] uppercase tracking-widest text-[var(--ui-muted)] cursor-pointer select-none border-b border-[var(--ui-border)]">
                                    Raw Report JSON
                                </summary>
                                <div className="p-4">
                                    <TreeTable data={results} />
                                </div>
                            </details>
                        </div>
                    )}

                    {!loading && !error && !results && (
                        <div className="h-full flex flex-col items-center justify-center opacity-70 text-[var(--ui-muted)]">
                            <TrendingUp size={64} className="mb-4" />
                            <p className="text-xs font-black uppercase tracking-[0.2em] text-center">No backtest instance running yet. Configure payload and execute to generate report.</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default Backtest;





