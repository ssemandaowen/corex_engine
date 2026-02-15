import React, { useState, useEffect } from 'react';
import { X, Save, Loader, RotateCcw } from 'lucide-react';

const SettingsModal = ({ isOpen, onClose, strategy, onSave, onRestoreDefaults }) => {
    const [params, setParams] = useState({});
    const [loading, setLoading] = useState(false);
    const [defaults, setDefaults] = useState({});

    useEffect(() => {
        if (strategy?.params) setParams(strategy.params);
        if (strategy?.schema) {
            const nextDefaults = {};
            Object.entries(strategy.schema).forEach(([key, spec]) => {
                if (spec && 'default' in spec) nextDefaults[key] = spec.default;
            });
            setDefaults(nextDefaults);
        }
    }, [strategy]);

    if (!isOpen || !strategy) return null;

    const handleSave = async () => {
        setLoading(true);
        try { await onSave(params); } catch (e) { console.error(e); }
        setLoading(false);
        onClose();
    };

    const renderInput = (key, spec) => {
        const baseClass = "w-full bg-black/40 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:border-blue-500 outline-none transition-colors font-mono";
        const value = params[key] ?? '';

        if (spec.type === 'boolean') {
            return (
                <input
                    type="checkbox"
                    checked={!!value}
                    onChange={(e) => setParams({ ...params, [key]: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-0"
                />
            );
        }

        return (
            <input
                type={['integer', 'float', 'number'].includes(spec.type) ? "number" : "text"}
                value={value}
                step={spec.type === 'integer' ? 1 : 'any'}
                onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                className={baseClass}
            />
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-xs bg-[#0B0F16] border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-900/50">
                    <div className="flex flex-col">
                        <span className="text-[10px] text-blue-400 font-black uppercase tracking-widest">Configuration</span>
                        <h3 className="text-xs font-bold text-slate-100 font-mono truncate">{strategy.id}</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar">
                    {strategy.schema ? Object.entries(strategy.schema).map(([key, spec]) => (
                        <div key={key} className="space-y-1.5">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                                    {spec.label || key}
                                </label>
                                {spec.type === 'boolean' && renderInput(key, spec)}
                            </div>
                            {spec.type !== 'boolean' && renderInput(key, spec)}
                            {spec.description && (
                                <p className="text-[9px] text-slate-500 leading-tight italic">{spec.description}</p>
                            )}
                        </div>
                    )) : <p className="text-[10px] text-slate-600 italic">No parameters available.</p>}
                </div>

                {/* Footer */}
                <div className="p-3 bg-black/20 border-t border-slate-800 flex gap-2">
                    <button
                        onClick={onRestoreDefaults}
                        disabled={loading}
                        className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold transition-all disabled:opacity-50"
                    >
                        <RotateCcw size={12} /> Reset
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold transition-all disabled:opacity-50"
                    >
                        {loading ? <Loader size={12} className="animate-spin" /> : <Save size={12} />} Save
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;