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
  const [listError, setListError] = useState(null);
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
      const list = Array.isArray(res?.payload)
        ? res.payload
        : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res)
            ? res
            : [];
      setStrategies(list);
      setListError(null);
    } catch (err) {
      console.error("Registry sync failed");
      const msg = err?.message || "Failed to load strategies. Is the engine running?";
      setListError(msg);
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
    <div className="ui-page ui-page-scroll">
      <div className="grid grid-cols-12 gap-6 ui-view-frame">
        <div className="col-span-12 lg:col-span-4 ui-panel-soft flex flex-col ui-panel-fixed">
          <div className="ui-panel-header px-5 pt-5 pb-4">
            <h2 className="ui-panel-title">Logic Registry</h2>
            <button
              onClick={() => setShowCreate(true)}
              className="ui-button ui-button-secondary !px-3 !py-2 !text-[10px]"
              aria-label="Create strategy"
            >
              New
            </button>
          </div>
          {listError && (
            <div className="mx-4 mb-3 rounded-lg border border-red-500/30 bg-red-950/60 px-3 py-2 text-[11px] text-red-200">
              {listError}
            </div>
          )}
          <div className="flex-1 ui-panel-scroll p-3">
            {strategies.length === 0 ? (
              <div className="text-[11px] text-slate-500 px-2 py-3">
                No strategies found. If the engine is running, check `ADMIN_SECRET` or refresh.
              </div>
            ) : (
              <StrategyList
                items={strategies}
                activeId={selectedId}
                onSelect={setSelectedId}
                onAction={handleAction}
              />
            )}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-8 ui-panel-soft ui-panel-fixed relative">
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
            <div className="ui-empty h-full gap-3">
              <div className="w-12 h-12 rounded-full border-2 border-slate-800 flex items-center justify-center animate-pulse">
                 <div className="w-2 h-2 rounded-full bg-slate-700" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                Select logic to initialize editor
              </span>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="ui-modal">
          <div className="ui-modal-card">
            <div className="ui-modal-header">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Create Strategy</h3>
                <p className="text-[11px] text-slate-500">New strategy file will be created.</p>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="ui-button ui-button-secondary !px-3 !py-2 !text-[10px]"
                aria-label="Close"
              >
                Close
              </button>
            </div>
            <div className="ui-modal-body">
              <label className="ui-field">
                <span className="ui-label">Strategy Name</span>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="ui-input"
                  placeholder="e.g. mean_reversion"
                />
              </label>
            </div>
            <div className="ui-modal-footer">
              <button
                onClick={() => setShowCreate(false)}
                className="ui-button ui-button-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="ui-button ui-button-primary disabled:opacity-60 disabled:cursor-not-allowed"
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
              className={`ui-toast ${
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
