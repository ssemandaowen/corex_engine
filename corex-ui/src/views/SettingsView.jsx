import React, { useEffect, useMemo, useState } from 'react';
import { 
  Shield, 
  Cpu, 
  Database, 
  AlertTriangle, 
  Save, 
  RefreshCcw, 
  Settings as SettingsIcon, // Renamed to avoid confusion
  Activity
} from 'lucide-react'; 
import client from "../api/client";
import { useStore } from "../store/useStore";

const SettingsView = () => {
  const [adminKey] = useState(import.meta.env.VITE_ADMIN_SECRET || '••••••••••••••••');
  
  const {
    systemSettings,
    settingsLoading,
    fetchSystemSettings,
    updateSystemSettings,
    realtimeMode,
    setRealtimeMode
  } = useStore();

  const [form, setForm] = useState({
    tickQueueMax: 5000,
    tickFlushMax: 10000,
    stratQueueMax: 1000,
    stratSliceMs: 5,
    logLevel: "info",
    storage: {
      backtests: { keepN: 20, halfLifeDays: 14, maxAgeDays: 90 },
      cache: { maxSizeMb: 500, maxAgeDays: 30 },
      uploads: { maxSizeMb: 500, maxAgeDays: 30 }
    }
  });

  useEffect(() => { 
    fetchSystemSettings(); 
  }, [fetchSystemSettings]);


  useEffect(() => {
    if (systemSettings) setForm(systemSettings);
  }, [systemSettings]);

  // --- Helpers ---
  const toInt = (v) => {
    const n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  };

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const setStorageField = (section, key, value) => {
    setForm(prev => ({
      ...prev,
      storage: {
        ...prev.storage,
        [section]: { ...prev.storage[section], [key]: value }
      }
    }));
  };

  // --- Logic ---
  const handleSave = async () => {
    const payload = {
      ...form,
      tickQueueMax: toInt(form.tickQueueMax),
      tickFlushMax: toInt(form.tickFlushMax),
      stratQueueMax: toInt(form.stratQueueMax),
      stratSliceMs: toInt(form.stratSliceMs),
      storage: {
        backtests: {
          keepN: toInt(form.storage.backtests.keepN),
          maxAgeDays: toInt(form.storage.backtests.maxAgeDays),
          halfLifeDays: toInt(form.storage.backtests.halfLifeDays)
        },
        cache: {
          maxSizeMb: toInt(form.storage.cache.maxSizeMb),
          maxAgeDays: toInt(form.storage.cache.maxAgeDays)
        },
        uploads: {
          maxSizeMb: toInt(form.storage.uploads.maxSizeMb),
          maxAgeDays: toInt(form.storage.uploads.maxAgeDays)
        }
      }
    };

    const res = await updateSystemSettings(payload, true);
    if (res) alert("CoreX Engine Updated Successfully.");
  };

  const handleMaintenanceReset = async () => {
    if (!window.confirm("CRITICAL: Force kill all strategy lifecycles?")) return;
    try {
      const res = await client.post('/system/maintenance/reset-states');
      alert(res.payload?.message || "Reset Complete.");
    } catch (e) { 
      alert("Reset Failed."); 
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0b0e14] overflow-hidden">
      {/* View Header */}
      <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-[#0d1117]/50">
        <div className="flex items-center gap-3">
          <SettingsIcon size={18} className="text-blue-500" />
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-200">System Configuration</h2>
        </div>
        <button 
          onClick={handleSave}
          disabled={settingsLoading}
          className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-bold transition-all disabled:opacity-50"
        >
          <Save size={14} /> {settingsLoading ? 'SAVING...' : 'PERSIST CHANGES'}
        </button>
      </div>

      {/* Main Content: Scrollable Grid */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-slate-800">
        <div className="grid grid-cols-12 gap-6 max-w-6xl mx-auto">
          
          {/* Engine Parameters */}
          <div className="col-span-12 lg:col-span-7 space-y-6">
            <section className="bg-[#12161f] border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-6 border-b border-slate-800 pb-3">
                <Cpu size={16} className="text-blue-400" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Engine Runtime</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <InputGroup label="Tick Queue Max" value={form.tickQueueMax} onChange={v => setField("tickQueueMax", v)} />
                <InputGroup label="Tick Flush Max" value={form.tickFlushMax} onChange={v => setField("tickFlushMax", v)} />
                <InputGroup label="Strategy Queue" value={form.stratQueueMax} onChange={v => setField("stratQueueMax", v)} />
                <InputGroup label="Slice (ms)" value={form.stratSliceMs} onChange={v => setField("stratSliceMs", v)} />
                <div className="col-span-2 mt-2">
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block tracking-tighter">Log Level Output</label>
                  <select 
                    className="w-full bg-[#0d1117] border border-slate-800 rounded p-2 text-xs text-slate-300 outline-none focus:border-blue-500 transition-all"
                    value={form.logLevel} 
                    onChange={e => setField("logLevel", e.target.value)}
                  >
                    <option value="error">ERROR</option>
                    <option value="warn">WARN</option>
                    <option value="info">INFO</option>
                    <option value="debug">DEBUG</option>
                  </select>
                </div>
                <div className="col-span-2 mt-2">
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block tracking-tighter">Realtime Updates</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRealtimeMode("ws")}
                      className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-wide border transition-all ${
                        realtimeMode === "ws"
                          ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/40"
                          : "bg-[#0d1117] text-slate-400 border-slate-800 hover:border-slate-600"
                      }`}
                    >
                      WebSocket
                    </button>
                    <button
                      onClick={() => setRealtimeMode("polling")}
                      className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-wide border transition-all ${
                        realtimeMode === "polling"
                          ? "bg-amber-600/20 text-amber-300 border-amber-500/40"
                          : "bg-[#0d1117] text-slate-400 border-slate-800 hover:border-slate-600"
                      }`}
                    >
                      Polling
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-600 mt-2 font-medium italic">
                    WebSocket reduces CPU by avoiding intervals. Polling can be used as fallback.
                  </p>
                </div>
              </div>
            </section>

            <section className="bg-[#12161f] border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-6 border-b border-slate-800 pb-3">
                <Shield size={16} className="text-emerald-400" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Security & API</h3>
              </div>
              <div className="space-y-4">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 tracking-tighter">Admin Secret Key</span>
                  <input type="text" readOnly value={adminKey} className="w-full bg-[#0d1117]/50 border border-slate-800/50 rounded p-2 text-xs font-mono text-slate-600 outline-none cursor-not-allowed" />
                  <p className="text-[9px] text-slate-600 mt-2 font-medium italic">Handled via server-side environment variables.</p>
                </div>
              </div>
            </section>
          </div>

          {/* Storage & Danger Zone */}
          <div className="col-span-12 lg:col-span-5 space-y-6">
            <section className="bg-[#12161f] border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-6 border-b border-slate-800 pb-3">
                <Database size={16} className="text-indigo-400" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Storage Policies</h3>
              </div>
              <div className="space-y-6">
                <StorageSubSection title="Backtesting Data" 
                  fields={[
                    { label: "Keep Count", val: form.storage.backtests.keepN, fn: v => setStorageField("backtests", "keepN", v) },
                    { label: "Max Age (D)", val: form.storage.backtests.maxAgeDays, fn: v => setStorageField("backtests", "maxAgeDays", v) }
                  ]} 
                />
                <StorageSubSection title="System Cache" 
                  fields={[
                    { label: "Size (MB)", val: form.storage.cache.maxSizeMb, fn: v => setStorageField("cache", "maxSizeMb", v) },
                    { label: "Expiration", val: form.storage.cache.maxAgeDays, fn: v => setStorageField("cache", "maxAgeDays", v) }
                  ]} 
                />
              </div>
            </section>

            <section className="bg-rose-950/10 border border-rose-500/20 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle size={16} className="text-rose-500" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-rose-500">Danger Zone</h3>
              </div>
              <div className="bg-rose-500/5 border border-rose-500/10 rounded-lg p-4">
                <p className="text-[11px] text-rose-200/70 mb-4 leading-relaxed">
                  The <span className="font-bold text-rose-400">Emergency State Reset</span> kills all strategy threads and resets the engine bus. Use only in case of execution deadlock.
                </p>
                <button 
                  onClick={handleMaintenanceReset}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 rounded text-[10px] font-black transition-all"
                >
                  <RefreshCcw size={12} /> INITIALIZE HARD RESET
                </button>
              </div>
            </section>
          </div>

        </div>
      </div>
    </div>
  );
};

// --- View Sub-Components ---

const InputGroup = ({ label, value, onChange }) => (
  <div className="flex flex-col">
    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 tracking-tighter">{label}</label>
    <input 
      type="number" 
      className="bg-[#0d1117] border border-slate-800 rounded p-2 text-xs font-mono text-blue-400 outline-none focus:border-blue-500 transition-colors"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  </div>
);

const StorageSubSection = ({ title, fields }) => (
  <div>
    <p className="text-[9px] font-bold text-slate-600 uppercase mb-3 tracking-widest">{title}</p>
    <div className="grid grid-cols-2 gap-3">
      {fields.map((f, i) => (
        <div key={i} className="flex flex-col">
          <span className="text-[9px] text-slate-500 mb-1 font-medium">{f.label}</span>
          <input 
            type="number" 
            className="bg-transparent border-b border-slate-800 p-1 text-xs font-mono text-slate-300 outline-none focus:border-blue-500 transition-all"
            value={f.val}
            onChange={e => f.fn(e.target.value)}
          />
        </div>
      ))}
    </div>
  </div>
);

export default SettingsView;
