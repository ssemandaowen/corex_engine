import React, { useState, useEffect } from 'react';
import client from '../api/client';
import StrategyList from '../components/strategies/StrategyList';
import EditorPanel from '../components/strategies/EditorPanel';

const StrategyView = ({ onNavigate }) => {
  const [strategies, setStrategies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [currentCode, setCurrentCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const addToast = (toast) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const next = { id, type: toast?.type || 'info', message: toast?.message || 'Saved.' };
    setToasts((prev) => [...prev, next]);
    setTimeout(() => {
      setToasts((prev) => prev.filter(t => t.id !== id));
    }, 2800);
  };

  const refreshList = async () => {
    try {
      const res = await client.get('/strategies');
      setStrategies(res.payload);
    } catch (err) {
      console.error("Registry sync failed");
    }
  };

  useEffect(() => {
    if (!selectedId) return;
    const fetchCode = async () => {
      setLoading(true);
      try {
        const res = await client.get(`/strategies/${selectedId}`);
        setCurrentCode(res.payload.code);
      } catch (err) {
        console.error("Code fetch failed");
      } finally {
        setLoading(false);
      }
    };
    fetchCode();
  }, [selectedId]);

  useEffect(() => { refreshList(); }, []);
  const doSave = async () => {
    if (!selectedId) return;
    setLoading(true);
    setSaveError(null);
    try {
      await client.put(`/strategies/${selectedId}`, { code: currentCode });
      addToast({ type: 'success', message: `${selectedId} saved and hot-swapped.` });
      refreshList();
    } catch (err) {
      const msg = err?.message || "NETWORK_ERROR";
      const details = err?.details ? ` (${err.details})` : "";
      setSaveError(`Runtime Push Failed: ${msg}${details}`);
      addToast({ type: 'error', message: `Save failed for ${selectedId}.` });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    await doSave();
  };

  const handleDelete = async (id) => {
    if (!window.confirm(`Purge strategy: ${id}?`)) return;
    try {
      await client.delete(`/strategies/${id}`);
      if (selectedId === id) setSelectedId(null);
      refreshList();
    } catch (err) {
      alert(err.message);
    }
  };
  
  const handleAction = (cmd, id) => {
    if (cmd === 'DELETE') {
      handleDelete(id);
      return;
    }
    if (cmd === 'RUN') {
      if (onNavigate) onNavigate('run');
      return;
    }
    setSelectedId(id);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setLoading(true);
    try {
      const res = await client.post('/strategies', { name });
      const id = res.payload?.id || name.replace(/\s+/g, '_');
      setStrategies((prev) => ([...prev, { id, name: id, status: 'OFFLINE' }]));
      await refreshList();
      setSelectedId(id);
      try {
        const codeRes = await client.get(`/strategies/${id}`);
        setCurrentCode(codeRes.payload?.code || "");
      } catch (e) {
        // ignore
      }
      setShowCreate(false);
      setNewName('');
      addToast({ type: 'success', message: `Created ${id}.` });
    } catch (err) {
      const msg = err?.message || "NETWORK_ERROR";
      const details = err?.details ? ` (${err.details})` : "";
      setSaveError(`Create Failed: ${msg}${details}`);
      addToast({ type: 'error', message: `Create failed.` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6 h-[calc(100vh-120px)] bg-[#020617] p-2">
      <div className="col-span-3 bg-[#0B0F1A] rounded-xl border border-slate-800 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/20">
          <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Logic Registry</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="text-blue-500 hover:text-white transition-colors"
            aria-label="Create strategy"
          >
            +
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <StrategyList
            items={strategies}
            activeId={selectedId}
            onSelect={setSelectedId}
            onAction={handleAction}
          />
        </div>
      </div>
      <div className="col-span-9 bg-[#0B0F1A] rounded-xl border border-slate-800 overflow-hidden relative">
        {saveError && (
          <div className="absolute top-3 right-3 z-20 bg-red-950/80 border border-red-500/50 text-red-200 text-[10px] px-3 py-2 rounded-lg">
            {saveError}
          </div>
        )}
        {selectedId ? (
          <EditorPanel
            id={selectedId}
            code={currentCode}
            setCode={setCurrentCode}
            onSave={handleSave}
            loading={loading}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-4">
            <div className="w-12 h-12 rounded-full border-2 border-slate-800 flex items-center justify-center animate-pulse">
               <div className="w-2 h-2 rounded-full bg-slate-700" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest">Select logic to initialize editor</span>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#0B0F1A] border border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-100">Create Strategy</h3>
                <p className="text-[10px] text-slate-500">New strategy file will be created.</p>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="text-slate-500 hover:text-white transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-slate-400">Strategy Name</span>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200"
                  placeholder="e.g. mean_reversion"
                />
              </label>
            </div>
            <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-[10px] font-bold bg-slate-900 border border-slate-700 text-slate-200 rounded hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="px-4 py-2 text-[10px] font-bold bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 space-y-2">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`px-4 py-3 rounded-lg border text-xs font-semibold shadow-lg backdrop-blur ${
                t.type === 'error'
                  ? 'bg-red-950/80 border-red-500/50 text-red-200'
                  : 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200'
              }`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StrategyView;
