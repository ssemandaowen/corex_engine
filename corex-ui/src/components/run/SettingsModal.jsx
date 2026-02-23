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

    const normalizeBySchema = (raw = {}, schema = {}) => {
        const out = {};
        Object.entries(raw || {}).forEach(([key, value]) => {
            const spec = schema?.[key] || {};
            const t = String(spec.type || '').toLowerCase();
            if (t === 'boolean') out[key] = value === true || value === 'true' || value === 1 || value === '1';
            else if (t === 'integer') out[key] = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : value;
            else if (t === 'float' || t === 'number') out[key] = Number.isFinite(Number(value)) ? Number(value) : value;
            else out[key] = value;
        });
        return out;
    };

    const handleSave = async () => {
        setLoading(true);
        try {
            const normalized = normalizeBySchema(params, strategy?.schema || {});
            await onSave(normalized);
        } catch (e) { console.error(e); }
        setLoading(false);
        onClose();
    };

    const renderInput = (key, spec) => {
        const baseClass = "w-full ui-input mono text-xs";
        const value = params[key] ?? '';

        if (spec.type === 'boolean') {
            return (
                <input
                    type="checkbox"
                    checked={!!value}
                    onChange={(e) => setParams({ ...params, [key]: e.target.checked })}
                    className="h-4 w-4 rounded border-[var(--ui-border)] bg-[var(--ui-panel)] accent-[var(--ui-accent)] focus:ring-0"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(2,6,23,0.72)] backdrop-blur-sm">
            <div className="w-full max-w-xs ui-modal-card overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b border-[var(--ui-border)] bg-[var(--ui-panel)]">
                    <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--ui-accent)] font-black uppercase tracking-widest">Configuration</span>
                        <h3 className="text-xs font-bold text-[var(--ui-text)] font-mono truncate">{strategy.id}</h3>
                    </div>
                    <button onClick={onClose} className="text-[var(--ui-muted)] hover:text-[var(--ui-text)] transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar">
                    {strategy.schema ? Object.entries(strategy.schema).map(([key, spec]) => (
                        <div key={key} className="space-y-1.5">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-[var(--ui-muted)] uppercase tracking-tight">
                                    {spec.label || key}
                                </label>
                                {spec.type === 'boolean' && renderInput(key, spec)}
                            </div>
                            {spec.type !== 'boolean' && renderInput(key, spec)}
                            {spec.description && (
                                <p className="text-[9px] text-[var(--ui-muted)] leading-tight italic">{spec.description}</p>
                            )}
                        </div>
                    )) : <p className="text-[10px] text-[var(--ui-muted)] italic">No parameters available.</p>}
                </div>

                {/* Footer */}
                <div className="p-3 bg-[var(--ui-panel)] border-t border-[var(--ui-border)] flex gap-2">
                    <button
                        onClick={onRestoreDefaults}
                        disabled={loading}
                        className="flex-1 h-8 ui-button ui-button-secondary text-[10px] disabled:opacity-50"
                    >
                        <RotateCcw size={12} /> Reset
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="flex-1 h-8 ui-button ui-button-primary text-[10px] disabled:opacity-50"
                    >
                        {loading ? <Loader size={12} className="animate-spin" /> : <Save size={12} />} Save
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
