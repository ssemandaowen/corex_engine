import React, { useState, useEffect } from 'react';
import { FileCode, Plus, X, Box, Save, Play } from 'lucide-react';
import client from '../api/client';
import StrategyList from '../components/strategies/StrategyList';
import EditorPanel from '../components/strategies/EditorPanel';

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

  // --- Logic Registry & Tabs ---
  
  const refreshList = async () => {
    try {
      const res = await client.get('/strategies');
      setStrategies(Array.isArray(res?.payload) ? res.payload : []);
    } catch (err) {
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
    const fetchCode = async () => {
      setLoading(true);
      try {
        const res = await client.get(`/strategies/${selectedId}`);
        setCurrentCode(res.payload.code);
      } catch (err) { console.error("Fetch failed"); }
      finally { setLoading(false); }
    };
    fetchCode();
  }, [selectedId]);

  // --- Actions ---

  const handleSave = async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      await client.put(`/strategies/${selectedId}`, { code: currentCode });
      addToast({ type: 'success', message: `Deployed ${selectedId}` });
    } catch (err) {
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
    } catch (err) {
      addToast({ type: 'error', message: err?.message || 'Create failed' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0b0e14] overflow-hidden">
      
      {/* SIDEBAR: LOGIC REGISTRY */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-0'} transition-all duration-300 border-r border-slate-800 bg-[#0d1117] flex flex-col overflow-hidden`}>
        <div className="p-4 border-b border-slate-800 flex justify-between items-center shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Logic Registry</span>
          <button onClick={() => setShowCreate(true)} className="p-1 hover:bg-slate-800 rounded text-blue-400">
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
        <div className="h-10 bg-[#0d1117] border-b border-slate-800 flex items-center overflow-x-auto no-scrollbar">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="px-3 h-full border-r border-slate-800 hover:bg-slate-800 text-slate-500"
          >
            <Box size={14} />
          </button>
          
          {openTabs.map(tabId => (
            <div 
              key={tabId}
              onClick={() => setSelectedId(tabId)}
              className={`flex items-center h-full px-4 gap-3 border-r border-slate-800 cursor-pointer transition-colors min-w-[120px] max-w-[200px]
                ${selectedId === tabId ? 'bg-[#1e2227] text-blue-400 border-b border-b-blue-500' : 'text-slate-500 hover:bg-slate-800/50'}`}
            >
              <FileCode size={12} />
              <span className="text-[11px] font-medium truncate flex-1">{tabId}</span>
              <X size={12} className="hover:text-white" onClick={(e) => closeTab(e, tabId)} />
            </div>
          ))}
        </div>

        {/* EDITOR AREA */}
        <div className="flex-1 bg-[#12151a]">
          {selectedId ? (
            <div className="h-full flex flex-col">
              {/* Toolbar */}
              <div className="px-4 py-2 border-b border-slate-800 flex justify-between items-center bg-[#0d1117]/50">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-500 uppercase">Working on:</span>
                  <span className="text-[10px] font-mono text-blue-400">{selectedId}.js</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={loading} className="flex items-center gap-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-bold transition-all disabled:opacity-50">
                    <Save size={12} /> {loading ? 'SAVING...' : 'DEPLOY'}
                  </button>
                  <button onClick={() => onNavigate('run')} className="flex items-center gap-2 px-3 py-1 bg-emerald-600/20 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-600/30 rounded text-[10px] font-bold">
                    <Play size={12} /> RUN
                  </button>
                </div>
              </div>
              
              <div className="flex-1">
                <EditorPanel
                  id={selectedId}
                  code={currentCode}
                  setCode={setCurrentCode}
                  onSave={handleSave}
                  loading={loading}
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
              <div className="w-16 h-16 rounded-xl border-2 border-dashed border-slate-700 flex items-center justify-center mb-4">
                <FileCode size={32} className="text-slate-700" />
              </div>
              <p className="text-[10px] uppercase tracking-[0.4em] font-bold text-slate-500">
                System Awaiting Logic Selection
              </p>
            </div>
          )}
        </div>
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#161b22] border border-slate-800 rounded-lg shadow-2xl p-6">
            <h3 className="text-sm font-bold text-white mb-1 uppercase tracking-wider">Initialize Strategy</h3>
            <p className="text-[11px] text-slate-500 mb-4">Assign a unique identifier for the logic registry.</p>
            <input 
              autoFocus
              className="w-full bg-[#0d1117] border border-slate-700 rounded p-2 text-sm text-white focus:border-blue-500 outline-none mb-4"
              placeholder="e.g. scalp_v1"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-[10px] font-bold text-slate-400 hover:text-white uppercase">Cancel</button>
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
