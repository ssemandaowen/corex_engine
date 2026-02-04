import React, { useState, useEffect } from 'react';
import { X, Save, Loader, RotateCcw } from 'lucide-react';

const SettingsModal = ({ isOpen, onClose, strategy, onSave, onRestoreDefaults }) => {
    const [params, setParams] = useState({});
    const [loading, setLoading] = useState(false);
    const [defaults, setDefaults] = useState({});

    useEffect(() => {
        if (strategy?.params) {
            setParams(strategy.params);
        } else {
            setParams({});
        }

        if (strategy?.schema) {
            const nextDefaults = {};
            Object.entries(strategy.schema).forEach(([key, spec]) => {
                if (spec && Object.prototype.hasOwnProperty.call(spec, 'default')) {
                    nextDefaults[key] = spec.default;
                }
            });
            setDefaults(nextDefaults);
        } else {
            setDefaults({});
        }
    }, [strategy]);

    if (!isOpen || !strategy) {
        return null;
    }

    const handleSave = async () => {
        setLoading(true);
        try {
            await onSave(params);
        } catch (error) {
            console.error("Failed to save settings", error);
        }
        setLoading(false);
        onClose();
    };

    const handleRestoreDefaults = async () => {
        if (onRestoreDefaults) {
            try {
                const next = await onRestoreDefaults();
                if (next && typeof next === 'object') {
                    setParams(next);
                    return;
                }
            } catch (e) {
                console.error("Failed to restore defaults", e);
            }
        }
        setParams((prev) => ({ ...prev, ...defaults }));
    };

    const renderInput = (key, spec) => {
        const value = params[key];

        switch (spec.type) {
            case 'integer':
            case 'float':
            case 'number':
                return (
                    <input
                        type="number"
                        value={value}
                        min={spec.min}
                        max={spec.max}
                        step={spec.type === 'integer' ? 1 : 'any'}
                        onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                        className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-sm"
                    />
                );
            case 'boolean':
                return (
                    <input
                        type="checkbox"
                        checked={value}
                        onChange={(e) => setParams({ ...params, [key]: e.target.checked })}
                        className="h-6 w-6 rounded text-blue-500 bg-slate-800 border-slate-700 focus:ring-blue-500"
                    />
                );
            default: // string and others
                return (
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                        className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-sm"
                    />
                );
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#0D1117] border border-slate-800 rounded-lg shadow-xl w-full max-w-md m-4">
                <div className="flex justify-between items-center p-4 border-b border-slate-800">
                    <h3 className="text-lg font-bold text-slate-100">{strategy.id} Settings</h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                    {strategy.schema && Object.keys(strategy.schema).length > 0 ? (
                        Object.entries(strategy.schema).map(([key, spec]) => (
                            <div key={key}>
                                <label className="text-sm text-slate-400 mb-1 block">{spec.label || key}</label>
                                {renderInput(key, spec)}
                                {spec.description && <p className="text-xs text-slate-500 mt-1">{spec.description}</p>}
                            </div>
                        ))
                    ) : (
                        <p className="text-slate-500">No configurable parameters for this strategy.</p>
                    )}
                </div>

                <div className="flex justify-between p-4 border-t border-slate-800">
                    <button
                        onClick={handleRestoreDefaults}
                        disabled={Object.keys(defaults).length === 0 || loading}
                        className="flex items-center justify-center gap-2 px-4 py-2 rounded font-bold text-sm bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 transition-all"
                    >
                        <RotateCcw size={16} />
                        Restore Defaults
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="flex items-center justify-center gap-2 px-4 py-2 rounded font-bold text-sm bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-700 transition-all"
                    >
                        {loading ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
