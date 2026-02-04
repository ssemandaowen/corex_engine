import React, { useState, useEffect } from 'react';
import client from '../../api/client';
import { Upload, Play, Loader, FileText, ChevronRight, ChevronDown } from 'lucide-react';

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
                setStrategies(res.payload);
                if (res.payload.length > 0) {
                    setSelectedStrategy(res.payload[0].id);
                }
            } catch (err) {
                console.error("Failed to fetch strategies", err);
                setError("Failed to load strategies. Is the engine running?");
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

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Column 1: Configuration */}
            <div className="lg:col-span-1 bg-[#0D1117] border border-slate-800 rounded-lg p-6 h-fit">
                <h2 className="text-lg font-bold text-slate-100 mb-4">Run Backtest</h2>
                <form onSubmit={runBacktest} className="space-y-4">
                    <div>
                        <label className="text-xs text-slate-400 mb-1 block">Strategy</label>
                        <select
                            value={selectedStrategy}
                            onChange={(e) => setSelectedStrategy(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-300 text-sm p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {strategies.map(s => (
                                <option key={s.id} value={s.id}>{s.name || s.id}</option>
                            ))}
                        </select>
                    </div>

                    <div className="bg-black/30 border border-slate-800 rounded-lg overflow-hidden max-h-[55vh] overflow-auto">
                        <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 bg-slate-900/60">
                            Payload Builder
                        </div>
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
                                            className={`w-full border p-2 rounded text-xs ${enabled.symbol ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-slate-900/40 border-slate-800 text-slate-600'}`}
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
                                            className={`w-full border p-2 rounded text-xs ${enabled.interval ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-slate-900/40 border-slate-800 text-slate-600'}`}
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
                                            className={`w-full border p-2 rounded text-xs ${enabled.initialCapital ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-slate-900/40 border-slate-800 text-slate-600'}`}
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
                                            className={`w-full border p-2 rounded text-xs ${enabled.outputsize ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-slate-900/40 border-slate-800 text-slate-600'}`}
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
                    </div>

                    <div className="bg-black/30 border border-slate-800 rounded-lg overflow-hidden max-h-[55vh] overflow-auto">
                        <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 bg-slate-900/60">
                            Strategy Params
                        </div>
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
                                                            className={`w-full border p-2 rounded text-xs ${isOn ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-slate-900/40 border-slate-800 text-slate-600'}`}
                                                        />
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !selectedStrategy}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded font-bold text-sm bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed transition-all"
                    >
                        {loading ? <Loader size={16} className="animate-spin"/> : <Play size={14}/>}
                        Run Backtest
                    </button>
                </form>
            </div>

            {/* Column 2: Results */}
            <div className="lg:col-span-2 bg-[#0D1117] border border-slate-800 rounded-lg p-6 max-h-[80vh] overflow-auto">
                <div className="flex items-center gap-3 mb-4">
                    <FileText size={18} className="text-slate-500"/>
                    <h2 className="text-lg font-bold text-slate-100">Results</h2>
                </div>
                {loading && <p className="text-slate-400">Running backtest...</p>}
                {error && <div className="bg-red-900/50 border border-red-500/30 text-red-300 p-4 rounded text-sm">{error}</div>}
                {results && (
                    <TreeTable data={results} />
                )}
                 {!loading && !error && !results && <p className="text-slate-500 text-sm">Results will appear here after running a backtest.</p>}
            </div>
        </div>
    );
};

export default Backtest;
