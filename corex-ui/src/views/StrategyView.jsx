import React, { useState, useEffect } from 'react';
import { FileCode, Plus, X, Box, Save, Play, Terminal } from 'lucide-react';
import client from '../api/client';
import StrategyList from '../components/strategies/StrategyList';
import EditorPanel from '../components/strategies/EditorPanel';
import StrategyTerminal from '../components/strategies/StrategyTerminal';
import { corexSwal } from '../utils/swal';
import { useStore } from '../store/useStore';

const normalizeStrategyKey = (strategyId) => {
  const raw = String(strategyId || '').trim();
  if (!raw) return '';
  const parts = raw.split('::');
  return parts.length >= 2 ? parts[parts.length - 1] : raw;
};

const StrategyView = ({ onNavigate }) => {
  const [strategies, setStrategies] = useState([]);
  const [openTabs, setOpenTabs] = useState([]); // Tracking open files
  const [selectedId, setSelectedId] = useState(null);
  const [currentCode, setCurrentCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const setStrategyTerminalOpen = useStore((s) => s.setStrategyTerminalOpen);
  const strategyTerminalOpen = useStore((s) => {
    const key = normalizeStrategyKey(selectedId);
    if (!key) return false;
    const map = s.strategyTerminalOpenById || {};
    return !!map[key];
  });

  // --- Logic Registry & Tabs ---
  
  const refreshList = async () => {
    try {
      const res = await client.get('/strategies');
      setStrategies(Array.isArray(res?.payload) ? res.payload : []);
    } catch {
      console.error("Registry sync failed");
    }
  };

  useEffect(() => { refreshList(); }, []);

  const selectTab = (id) => {
    if (!openTabs.includes(id)) {
      setOpenTabs(prev => [...prev, id]);
    }
    setSelectedId(id);
  };

  const closeTab = (e, id) => {
    e.stopPropagation();
    const nextTabs = openTabs.filter(t => t !== id);
    setOpenTabs(nextTabs);
    if (selectedId === id) {
      setSelectedId(nextTabs.length > 0 ? nextTabs[nextTabs.length - 1] : null);
    }
  };

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const requestedId = selectedId;
    const fetchCode = async () => {
      setLoading(true);
      try {
        const res = await client.get(`/strategies/${requestedId}`);
        if (!cancelled && requestedId === selectedId) {
          setCurrentCode(res?.payload?.code || "");
        }
      } catch { console.error("Fetch failed"); }
      finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCode();
    return () => { cancelled = true; };
  }, [selectedId]);

  // --- Actions ---

  const handleSave = async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      await client.put(`/strategies/${selectedId}`, { code: currentCode });
      addToast({ type: 'success', message: `Deployed ${selectedId}` });
    } catch {
      addToast({ type: 'error', message: "Push failed" });
    } finally { setLoading(false); }
  };

  const exportStrategy = async (id) => {
    let code = currentCode;
    if (selectedId !== id) {
      try {
        const res = await client.get(`/strategies/${id}`);
        code = res?.payload?.code || "";
      } catch {
        code = "";
      }
    }
    const blob = new Blob([code || ""], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.js`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleContextAction = async (cmd, id) => {
    switch (cmd) {
      case "OPEN":
      case "EDIT":
        selectTab(id);
        return;
      case "RENAME": {
        const next = window.prompt("Rename strategy:", id);
        if (!next || next.trim() === id) return;
        try {
          await client.patch(`/strategies/${id}/rename`, { newName: next.trim() });
          await refreshList();
          setSelectedId(next.trim());
          addToast({ type: "success", message: `Renamed to ${next.trim()}` });
        } catch {
          addToast({ type: "error", message: "Rename failed" });
        }
        return;
      }
      case "EXPORT":
        await exportStrategy(id);
        return;
      case "START":
        try {
          await client.post(`/run/start/${id}`, { mode: "PAPER" });
          addToast({ type: "success", message: `Started ${id}` });
          await refreshList();
        } catch {
          addToast({ type: "error", message: "Start failed" });
        }
        return;
      case "STOP":
        try {
          await client.post(`/run/stop/${id}`);
          addToast({ type: "success", message: `Stopped ${id}` });
          await refreshList();
        } catch {
          addToast({ type: "error", message: "Stop failed" });
        }
        return;
      case "DELETE":
        if (!window.confirm(`Delete strategy ${id}?`)) return;
        try {
          await client.delete(`/strategies/${id}`);
          if (selectedId === id) {
            setSelectedId(null);
            setCurrentCode("");
          }
          await refreshList();
          addToast({ type: "success", message: `Deleted ${id}` });
        } catch {
          addToast({ type: "error", message: "Delete failed" });
        }
        return;
      default:
        return;
    }
  };

  const addToast = (t) => {
    const id = Date.now();
    setToasts(p => [...p, { ...t, id }]);
    setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 3000);
  };

  const handleCreate = async () => {
    const rawName = newName.trim();
    if (!rawName || creating) return;

    setCreating(true);
    try {
      const res = await client.post('/strategies', { name: rawName });
      const createdId = res?.payload?.id || rawName.replace(/\s+/g, '_').replace(/\.js$/, '');

      await refreshList();
      selectTab(createdId);
      setShowCreate(false);
      setNewName('');
      addToast({ type: 'success', message: `Created ${createdId}` });
      await corexSwal({
        icon: 'success',
        title: 'Strategy Created',
        text: `${createdId} is ready in the registry.`,
        confirmButtonText: 'OK'
      });
    } catch (err) {
      addToast({ type: 'error', message: err?.message || 'Create failed' });
      await corexSwal({
        icon: 'error',
        title: 'Create Failed',
        text: err?.message || 'Create failed.',
        confirmButtonText: 'OK'
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-transparent">
      
      {/* SIDEBAR: LOGIC REGISTRY */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-0'} transition-all duration-300 border-r border-[var(--ui-border)] bg-[var(--ui-panel-strong)] flex flex-col overflow-hidden`}>
        <div className="p-4 border-b border-[var(--ui-border)] flex justify-between items-center shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-muted)]">Logic Registry</span>
          <button onClick={() => setShowCreate(true)} className="p-1 hover:bg-white/5 rounded text-blue-400">
            <Plus size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <StrategyList
            items={strategies}
            activeId={selectedId}
            onSelect={selectTab}
            onAction={handleContextAction}
          />
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        
        {/* VS TABS BAR */}
        <div className="h-10 bg-[var(--ui-panel-strong)] border-b border-[var(--ui-border)] flex items-center overflow-x-auto no-scrollbar">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="px-3 h-full border-r border-[var(--ui-border)] hover:bg-white/5 text-[var(--ui-muted)]"
          >
            <Box size={14} />
          </button>
          
          {openTabs.map(tabId => (
            <div 
              key={tabId}
              onClick={() => setSelectedId(tabId)}
              className={`flex items-center h-full px-4 gap-3 border-r border-[var(--ui-border)] cursor-pointer transition-colors min-w-[120px] max-w-[200px]
                ${selectedId === tabId ? 'bg-blue-500/10 text-blue-300 border-b border-b-blue-500' : 'text-[var(--ui-muted)] hover:bg-white/5'}`}
            >
              <FileCode size={12} />
              <span className="text-[11px] font-medium truncate flex-1">{tabId}</span>
              <X size={12} className="hover:text-[var(--ui-text)]" onClick={(e) => closeTab(e, tabId)} />
            </div>
          ))}
        </div>

        {/* EDITOR AREA */}
        <div className="flex-1 bg-[var(--ui-panel)] flex flex-col min-h-0">
          {selectedId ? (
            <div className="h-full flex flex-col min-h-0">
              {/* Toolbar */}
              <div className="px-4 py-2 border-b border-[var(--ui-border)] flex justify-between items-center bg-[rgba(15,23,42,0.3)]">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--ui-muted)] uppercase">Working on:</span>
                  <span className="text-[10px] font-mono text-blue-400">{selectedId}.js</span>
                </div>
                <div className="flex gap-1">
                  {/* Strategy Logs Button */}
                  <button
                    onClick={() => {
                      if (!selectedId) return;
                      setStrategyTerminalOpen(selectedId, !strategyTerminalOpen);
                    }}
                    className={`p-2 rounded transition-all ${
                      strategyTerminalOpen
                        ? "text-[var(--ui-accent)] bg-[var(--ui-row-hover)] border border-[var(--ui-border-strong)]"
                        : "text-[var(--ui-muted)] hover:text-[var(--ui-accent)] hover:bg-[var(--ui-row-hover)] border border-transparent"
                    }`}
                    title={strategyTerminalOpen ? "Hide Strategy Console" : "Show Strategy Console"}
                  >
                    <Terminal size={14} />
                  </button>
                  <div className="w-px bg-[var(--ui-border)] mx-1" />

                  {/* Save/Deploy Button */}
                  <button
                    onClick={handleSave}
                    disabled={loading}
                    className="p-2 text-[var(--ui-text)] hover:text-blue-300 hover:bg-blue-500/10 disabled:opacity-50 rounded transition-all disabled:cursor-not-allowed"
                    title={loading ? 'Saving...' : 'Save & Deploy'}
                  >
                    <Save size={14} />
                  </button>

                  {/* Run Button */}
                  <button
                    onClick={() => onNavigate('run')}
                    className="p-2 text-[var(--ui-muted)] hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-all"
                    title="Run Strategy"
                  >
                    <Play size={14} />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 min-h-0">
                <EditorPanel
                  id={selectedId}
                  code={currentCode}
                  setCode={setCurrentCode}
                />
              </div>

              {strategyTerminalOpen && (
                <div className="shrink-0 p-4 border-t border-[var(--ui-border)] bg-[var(--ui-panel-strong)]">
                  <StrategyTerminal strategyId={selectedId} />
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
              <div className="w-16 h-16 rounded-xl border-2 border-dashed border-[var(--ui-border)] flex items-center justify-center mb-4">
                <FileCode size={32} className="text-[var(--ui-muted)]" />
              </div>
              <p className="text-[10px] uppercase tracking-[0.4em] font-bold text-[var(--ui-muted)]">
                System Awaiting Logic Selection
              </p>
            </div>
          )}
        </div>
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm ui-modal-card p-6">
            <h3 className="text-sm font-bold text-[var(--ui-text)] mb-1 uppercase tracking-wider">Initialize Strategy</h3>
            <p className="text-[11px] text-[var(--ui-muted)] mb-4">Assign a unique identifier for the logic registry.</p>
            <input 
              autoFocus
              className="ui-input mb-4"
              placeholder="e.g. scalp_v1"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-[10px] font-bold text-[var(--ui-muted)] hover:text-[var(--ui-text)] uppercase">Cancel</button>
              <button onClick={handleCreate} disabled={creating} className="px-4 py-2 bg-blue-600 text-white rounded text-[10px] font-bold uppercase disabled:opacity-50">
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOASTS */}
      <div className="fixed bottom-6 right-6 z-[100] space-y-2">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-2 rounded-lg border text-[11px] font-bold shadow-lg animate-in slide-in-from-right-4 
            ${t.type === 'error' ? 'bg-rose-950 border-rose-500 text-rose-200' : 'bg-emerald-950 border-emerald-500 text-emerald-200'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StrategyView;
