import React, { useState, useEffect, useRef } from 'react';
import useDataStore, { Strategy } from '../store/dataStore';
import { strategiesApi } from '../api/strategies';
import { runApi } from '../api/run';
import EditorPanel from '../components/strategies/EditorPanel';
import StrategyTerminal from '../components/strategies/StrategyTerminal';
import { useToast } from '../context/ToastContext';
import { useTerminalContext } from '../context/TerminalContext';
import useUiStore from '../store/uiStore';
import { useRuntimes } from '../hooks/useRuntimes';
import Swal from 'sweetalert2';
import { 
  Search, 
  Plus, 
  Save, 
  Play, 
  Square, 
  Settings2, 
  ChevronsRight, 
  ChevronsLeft,
  ChevronDown,
  ChevronUp,
  Sliders,
  Terminal,
  Activity,
  Trash2,
  GitCompare,
  BookOpen,
  Copy,
  Code,
  Check
} from 'lucide-react';

export default function StrategyView() {
  const { showToast } = useToast();
  const { 
    strategies, 
    setStrategies, 
    selectedStrategyId, 
    setSelectedStrategyId,
    stratTerminalById,
    addStrategyLog,
    clearStrategyLogs,
    updateStrategyStatus,
    runtimes,
    upsertRuntime
  } = useDataStore();

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [activeRightTab, setActiveRightTab] = useState<'params' | 'help'>('params');
  const [helpSearch, setHelpSearch] = useState('');
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [localParams, setLocalParams] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(window.innerWidth >= 1024);
  const [isParamsOpen, setIsParamsOpen] = useState(window.innerWidth >= 1280);

  // Shared, real running-instance list (keyed by strategy name in the store).
  useRuntimes(4000);

  // Resolve the live runtime for a strategy id (unscoped public id). The store
  // runtimes map is keyed by the engine's scoped strategy name, so match on the
  // trailing segment too.
  const runtimeFor = (stratId: string) => {
    if (runtimes[stratId]) return runtimes[stratId];
    const found = Object.values(runtimes).find(
      (r: any) => r.strategyName === stratId || r.strategyName?.endsWith(`::${stratId}`)
    );
    return found || null;
  };
  
  // Collapse panels on small screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsLibraryOpen(false);
        setIsParamsOpen(false);
      }
    };
    handleResize(); // run on mount
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const { 
    terminalCollapsed, 
    setTerminalCollapsed,
    editorFontSize,
    editorTabSize,
    editorWordWrap,
    editorMinimap,
    editorTheme,
    editorLineNumbers,
    editorAutoClosingBrackets,
    setEditorFontSize,
    setEditorTabSize,
    setEditorWordWrap,
    setEditorMinimap,
    setEditorTheme,
    setEditorLineNumbers,
    setEditorAutoClosingBrackets
  } = useUiStore();
  const { isTerminalVisible } = useTerminalContext();
  const isTerminalOpen = isTerminalVisible && !terminalCollapsed;
  const setIsTerminalOpen = (open: boolean) => setTerminalCollapsed(!open);

  const [isEditorConfigOpen, setIsEditorConfigOpen] = useState(false);
  const isResizingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Live Monaco editor + monaco namespaces (set when EditorPanel mounts),
  // used to surface backend compile errors as inline editor diagnostics.
  const editorRef = useRef<{ editor: any; monaco: any } | null>(null);
  const handleEditorReady = (editor: any, monaco: any) => {
    editorRef.current = { editor, monaco };
  };

  const clearCompileMarkers = () => {
    const ref = editorRef.current;
    if (!ref || !ref.editor || !ref.monaco) return;
    const model = ref.editor.getModel();
    if (model) ref.monaco.editor.setModelMarkers(model, 'corex-compile', []);
  };

  const setCompileMarkers = (line: number, column: number, message: string) => {
    const ref = editorRef.current;
    if (!ref || !ref.editor || !ref.monaco) return;
    const model = ref.editor.getModel();
    if (!model) return;
    ref.monaco.editor.setModelMarkers(model, 'corex-compile', [{
      startLineNumber: line,
      startColumn: column > 0 ? column : 1,
      endLineNumber: line,
      endColumn: column > 0 ? column + 1 : 1000,
      message,
      severity: ref.monaco.MarkerSeverity.Error
    }]);
  };

  // Parse a backend compile-error payload into a { line, column, message }.
  // Prefers the structured `details` field the engine attaches (line/column
  // derived from the V8 stack), then falls back to message patterns.
  const parseCompileError = (data: any, fallbackMsg: string) => {
    const message = (data && data.error) ? String(data.error) : String(fallbackMsg || 'Compilation failed');
    let line = 1;
    let column = 0;
    if (data && data.details && Number.isFinite(data.details.line)) {
      line = Math.max(1, Number(data.details.line));
      column = Number.isFinite(data.details.column) ? Number(data.details.column) : 0;
    } else {
      const lineMatch = message.match(/(?:line|Ln)\s*[:#]?\s*(\d+)/i)
        || message.match(/:(\d+):(\d+)/)
        || message.match(/at line (\d+)/i)
        || message.match(/(\d+):(\d+)/);
      if (lineMatch) {
        line = Math.max(1, parseInt(lineMatch[1], 10));
        if (lineMatch[2]) column = parseInt(lineMatch[2], 10);
      }
    }
    return { line, column, message };
  };

  // Fetch strategies on load
  const loadStrategies = async () => {
    setLoading(true);
    try {
      const res = await strategiesApi.list();
      if (res.success) {
        setStrategies(res.payload);
        if (res.payload.length > 0 && !selectedStrategyId) {
          setSelectedStrategyId(res.payload[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to load strategies', e);
      showToast('Error fetching strategy scripts', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStrategies();
  }, []);

  // Sync selected strategy code and schema parameter values
  const activeStrat = strategies.find(s => s.id === selectedStrategyId);

  useEffect(() => {
    const loadCode = async () => {
      if (!selectedStrategyId) {
        setCurrentCode('');
        setLocalParams({});
        return;
      }
      try {
        const res = await strategiesApi.get(selectedStrategyId);
        if (res.success && res.payload) {
          setCurrentCode(res.payload.code || '');
          setLocalParams(res.payload.params || {});
        } else {
          setCurrentCode('');
          setLocalParams({});
        }
      } catch (e) {
        console.error('Failed to load strategy code', e);
        setCurrentCode('');
        setLocalParams({});
      }
    };
    loadCode();
  }, [selectedStrategyId]);

  // Handle saving strategy script
  const handleSave = async () => {
    if (!selectedStrategyId || !activeStrat) return;
    try {
      const res = await strategiesApi.update(selectedStrategyId, {
        code: currentCode
      } as any);
      if (res.success) {
        clearCompileMarkers();
        showToast(`Strategy '${activeStrat.name}' compiled and saved successfully`, 'success');
        try {
          const updated = await strategiesApi.get(selectedStrategyId);
          if (updated.success && updated.payload) {
            setStrategies(strategies.map(s => s.id === selectedStrategyId ? { ...s, ...updated.payload } : s));
          }
        } catch (e) {
          console.error('Failed to refresh strategy after save', e);
        }
      }
    } catch (e: any) {
      console.error('Failed to save strategy', e);
      const errData = e?.response?.data;
      const { line, column, message } = parseCompileError(errData, e?.message);
      setCompileMarkers(line, column, message);
      addStrategyLog(selectedStrategyId, 'ERROR', `Assembly compilation failed: ${message}`);
      showToast(`Compile error (line ${line}): ${message}`, 'error');
    }
  };

  // Create strategy
  const handleCreate = async () => {
    const { value: name } = await Swal.fire({
      title: 'NEW QUANT STRATEGY',
      input: 'text',
      inputLabel: 'Strategy Name',
      inputPlaceholder: 'e.g. MACD Momentum H4',
      showCancelButton: true,
      confirmButtonText: 'CREATE',
      cancelButtonText: 'CANCEL',
      background: 'var(--ui-panel-strong)',
      color: 'var(--ui-text)',
      confirmButtonColor: 'var(--ui-accent)',
      inputValidator: (value) => {
        if (!value) return 'A strategy name is required!';
        return null;
      }
    });

    if (name) {
      try {
        const res = await strategiesApi.create({
          name
        } as any);
        if (res.success) {
          setStrategies([...strategies, res.payload]);
          setSelectedStrategyId(res.payload.id);
          showToast(`Created strategy '${name}'`, 'success');
        }
      } catch (e) {
        console.error(e);
        showToast('Error creating script', 'error');
      }
    }
  };

  // Delete strategy
  const handleDelete = async (id: string, name: string) => {
    const confirm = await Swal.fire({
      title: 'DELETE ASSEMBLY',
      text: `Are you sure you want to permanently delete '${name}'? This cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'DELETE',
      cancelButtonText: 'CANCEL',
      confirmButtonColor: 'var(--ui-negative)',
      background: 'var(--ui-panel-strong)',
      color: 'var(--ui-text)'
    });

    if (confirm.isConfirmed) {
      try {
        const res = await strategiesApi.delete(id);
        if (res.success) {
          const nextStrats = strategies.filter(s => s.id !== id);
          setStrategies(nextStrats);
          if (selectedStrategyId === id) {
            setSelectedStrategyId(nextStrats.length > 0 ? nextStrats[0].id : null);
          }
          showToast(`Deleted strategy '${name}'`, 'success');
        }
      } catch (e) {
        console.error(e);
        showToast('Failed to delete strategy', 'error');
      }
    }
  };

  // Start execution (PAPER/LIVE)
  const handleStart = async (mode: 'PAPER' | 'LIVE') => {
    if (!selectedStrategyId || !activeStrat) return;
    try {
      const res = await runApi.start(selectedStrategyId, {
        mode,
        symbol: localParams.symbol || activeStrat.symbols?.[0] || 'EURUSD',
        params: localParams
      });

      if (res.success) {
        updateStrategyStatus(selectedStrategyId, 'running');
        if (res.payload?.runtimeId) {
          upsertRuntime({
            runtimeId: res.payload.runtimeId,
            strategyName: selectedStrategyId,
            symbol: res.payload.symbol,
            mode: res.payload.mode,
            status: 'running',
            userId: res.payload.userId
          });
        }
        showToast(`Running strategy '${activeStrat.name}' in ${mode} mode`, 'success');
      } else {
        showToast(res.error || 'Failed to dispatch start signal', 'error');
      }
    } catch (e: any) {
      console.error(e);
      showToast(e?.response?.data?.message || e?.response?.data?.error || 'Failed to connect to engine', 'error');
    }
  };

  // Stop execution
  const handleStop = async () => {
    if (!selectedStrategyId || !activeStrat) return;
    try {
      const res = await runApi.stop(selectedStrategyId);
      if (res.success) {
        updateStrategyStatus(selectedStrategyId, 'stopped');
        const live = runtimeFor(selectedStrategyId);
        if (live?.runtimeId) {
          upsertRuntime({ strategyName: selectedStrategyId, runtimeId: live.runtimeId, status: 'stopped' });
        }
        showToast(`Strategy '${activeStrat.name}' halted`, 'warning');
      } else {
        showToast(res.error || 'Stop failed', 'error');
      }
    } catch (e: any) {
      console.error(e);
      showToast(e?.response?.data?.message || 'Error sending halt interrupt', 'error');
    }
  };

  // Resizing strategy terminal handler
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizingRef.current || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newHeight = containerRect.bottom - e.clientY;
    if (newHeight > 100 && newHeight < containerRect.height - 150) {
      setTerminalHeight(newHeight);
    }
  };

  const handleMouseUp = () => {
    isResizingRef.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // Filter strategy list
  const filteredStrategies = strategies.filter(s => 
    s?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleParamChange = (key: string, value: any) => {
    setLocalParams(prev => ({ ...prev, [key]: value }));
  };

  const activeLogs = activeStrat ? (stratTerminalById[activeStrat.id] || []) : [];

  return (
    <div 
      className="flex h-full w-full overflow-hidden select-none" 
      ref={containerRef}
      style={{ backgroundColor: 'var(--ui-bg)' }}
    >
      {/* 1. LEFT PANE: Strategy list */}
      <div 
        className="shrink-0 border-r flex flex-col h-full bg-[var(--ui-sidebar-bg)] overflow-hidden transition-all duration-300"
        style={{ 
          width: isLibraryOpen ? '240px' : '0px',
          borderColor: isLibraryOpen ? 'var(--ui-border)' : 'transparent',
          borderRightWidth: isLibraryOpen ? '1px' : '0px'
        }}
      >
        <div className="p-3 border-b border-[var(--ui-border)] flex flex-col gap-2 shrink-0">
          <button 
            onClick={handleCreate}
            className="w-full py-1.5 rounded text-xs font-bold uppercase tracking-widest text-white flex items-center justify-center gap-1 cursor-pointer hover:opacity-95"
            style={{ backgroundColor: 'var(--ui-accent)' }}
          >
            <Plus size={14} />
            New Assembly
          </button>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 text-[var(--ui-muted)]" size={12} />
            <input 
              type="text"
              placeholder="Filter by keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs py-1.5 pl-8 pr-2.5 rounded border text-[var(--ui-text)] focus:outline-none"
              style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)' }}
            />
          </div>
        </div>

        {/* Strategy list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredStrategies.length > 0 ? (
            filteredStrategies.map((strat) => {
              const isSelected = strat.id === selectedStrategyId;
              const isRunning = strat.status === 'running';

              return (
                <div
                  key={strat.id}
                  className="group relative p-2.5 rounded border transition-colors cursor-pointer"
                  onClick={() => setSelectedStrategyId(strat.id)}
                  style={{
                    backgroundColor: isSelected ? 'var(--ui-panel-soft)' : 'transparent',
                    borderColor: isSelected ? 'var(--ui-accent)' : 'transparent'
                  }}
                >
                  <div className="flex justify-between items-start pr-4 min-w-0">
                    <span className="text-xs font-bold truncate text-[var(--ui-text)] pr-1 font-display">
                      {strat.name}
                    </span>
                    {/* Status badge pill */}
                    <span 
                      className={`text-[8px] font-black uppercase px-1 py-0.2 rounded border shrink-0 ${
                        isRunning 
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 animate-pulse' 
                          : 'bg-slate-500/10 text-slate-400 border-slate-500/25'
                      }`}
                    >
                      {strat.status}
                    </span>
                  </div>

                  <span className="text-[10px] text-[var(--ui-muted)] block mt-1 leading-none font-mono">
                    Updated: {new Date(strat.updatedAt).toLocaleDateString()}
                  </span>

                  {/* Compact Quick Actions Row */}
                  <div className={`mt-2 flex items-center gap-1.5 transition-all overflow-hidden ${
                    isSelected ? 'max-h-8 opacity-100' : 'max-h-0 opacity-0 group-hover:max-h-8 group-hover:opacity-100'
                  }`}>
                    {isRunning ? (
                      <>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await runApi.stop(strat.id);
                               if (res.success) {
                                 updateStrategyStatus(strat.id, 'stopped');
                                 showToast(`Halted active sandbox thread for '${strat.name}'`, 'warning');
                               }
                            } catch (e) {
                              showToast('Error sending halt interrupt', 'error');
                            }
                          }}
                          className="flex-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400 hover:bg-red-500 hover:text-white transition-all cursor-pointer border border-red-500/20 text-center"
                          title="Halt active thread"
                        >
                          Halt
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const matchingRun = runtimeFor(strat.id);
                            const runtimeId = matchingRun?.runtimeId || `run_${strat.id}`;
                            window.dispatchEvent(new CustomEvent('corex:navigate', { 
                              detail: { tab: 'run', subTab: 'monitor', runtimeId } 
                            }));
                          }}
                          className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-500/15 text-blue-400 hover:bg-blue-500 hover:text-white transition-all cursor-pointer border border-blue-500/20 text-center"
                          title="View Live Performance Monitor"
                        >
                          Monitor
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const res = await runApi.start(strat.id, {
                              mode: 'PAPER',
                              symbol: strat.runtime_params?.symbol || 'EURUSD',
                              params: strat.runtime_params || {}
                            });
                             if (res.success) {
                              updateStrategyStatus(strat.id, 'running');
                              showToast(`Successfully initialized and launched paper sandbox for '${strat.name}'`, 'success');
                            } else {
                              showToast(res.error || 'Failed to dispatch start signal', 'error');
                            }
                          } catch (err: any) {
                            showToast(err.response?.data?.error || 'Failed to connect to engine', 'error');
                          }
                        }}
                        className="flex-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all cursor-pointer border border-emerald-500/20 text-center"
                        title="Spin up paper sandbox container"
                      >
                        Start Sandbox
                      </button>
                    )}
                  </div>

                  {/* Delete hovering action button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(strat.id, strat.name);
                    }}
                    className="absolute right-1 top-2.5 p-1 rounded hover:bg-red-500/10 hover:text-red-500 text-[var(--ui-muted)] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete assembly"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })
          ) : (
            <div className="text-center py-8 text-xs text-[var(--ui-muted)]">
              No strategy assemblies.
            </div>
          )}
        </div>
      </div>

      {/* 2. CENTER PANE: Monaco + Terminal below */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        
        {/* Editor Toolbar Header */}
        <div 
          className="h-11 border-b px-3 flex items-center justify-between shrink-0"
          style={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border)' }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsLibraryOpen(!isLibraryOpen)}
              className="p-1 rounded text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)] transition-colors cursor-pointer mr-1"
              title={isLibraryOpen ? "Collapse Strategy Library" : "Expand Strategy Library"}
            >
              {isLibraryOpen ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
            </button>
            {activeStrat ? (
              <>
                <span className="text-xs font-display font-bold text-[var(--ui-text)]">
                  {activeStrat.name}
                </span>
                <span className="text-[9px] font-mono text-[var(--ui-muted)] pt-0.5">
                  ({localParams.symbol || 'No symbol selected'})
                </span>
              </>
            ) : (
              <span className="text-xs text-[var(--ui-muted)]">No strategy active</span>
            )}
          </div>

          {activeStrat && (
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Terminal collapse/expand toggle */}
              <button
                onClick={() => setIsTerminalOpen(!isTerminalOpen)}
                className={`px-2 py-1 rounded border transition-colors cursor-pointer flex items-center gap-1.5 text-[10px] font-bold ${
                  isTerminalOpen 
                    ? 'text-[var(--ui-accent)] border-[var(--ui-accent)]/30 bg-[var(--ui-panel-soft)]' 
                    : 'text-[var(--ui-muted)] border-[var(--ui-border)] hover:text-white hover:bg-[var(--ui-panel-soft)]'
                }`}
                title={isTerminalOpen ? "Collapse Logs Terminal" : "Expand Logs Terminal"}
              >
                <Terminal size={11} />
                <span className="text-[9px] uppercase tracking-wider hidden md:inline">{isTerminalOpen ? 'HIDE LOGS' : 'SHOW LOGS'}</span>
              </button>

              <button
                onClick={handleSave}
                className="px-2 py-1 text-[10px] font-bold rounded border cursor-pointer flex items-center gap-1 transition-colors hover:bg-[var(--ui-panel-soft)] text-emerald-400 border-emerald-500/30"
                title="Compile and Save Code (Ctrl + S)"
              >
                <Save size={12} />
                <span className="hidden sm:inline">Compile</span>
              </button>

              <button
                onClick={() => setIsEditorConfigOpen(!isEditorConfigOpen)}
                className={`px-2 py-1 text-[10px] font-bold rounded border cursor-pointer flex items-center gap-1 transition-colors ${
                  isEditorConfigOpen 
                    ? 'text-[var(--ui-accent)] border-[var(--ui-accent)]/40 bg-[var(--ui-panel-soft)]' 
                    : 'text-[var(--ui-muted)] border-[var(--ui-border)] hover:text-white hover:bg-[var(--ui-panel-soft)]'
                }`}
                title="Code Editor Quick Preferences"
              >
                <Settings2 size={12} />
                <span className="hidden sm:inline">Settings</span>
              </button>

              <div className="w-px h-3 bg-[var(--ui-border)] hidden sm:block" />

              {activeStrat.status === 'running' ? (
                <button
                  onClick={handleStop}
                  className="px-2 py-1 text-[10px] font-bold rounded border cursor-pointer flex items-center gap-1 transition-colors hover:bg-[var(--ui-panel-soft)] text-red-500 border-red-500/30"
                  title="Stop Sandbox runtime"
                >
                  <Square size={12} />
                  <span className="hidden sm:inline">Stop</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleStart('PAPER')}
                    className="px-2 py-1 text-[10px] font-bold rounded border cursor-pointer flex items-center gap-1 transition-colors hover:bg-[var(--ui-panel-soft)] text-blue-400 border-blue-500/30"
                    title="Start Paper testing"
                  >
                    <Play size={11} />
                    <span className="hidden sm:inline">Paper</span>
                  </button>
                  <button
                    onClick={() => handleStart('LIVE')}
                    className="px-2 py-1 text-[10px] font-bold rounded border cursor-pointer flex items-center gap-1 transition-colors hover:bg-[var(--ui-panel-soft)] text-amber-500 border-amber-500/30 font-black"
                    title="Execute live connection!"
                  >
                    <Play size={11} />
                    <span className="hidden sm:inline">Live Run</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Editor container */}
        <div className="flex-1 min-h-0 relative">
          {isEditorConfigOpen && (
            <div 
              className="absolute right-4 top-2 z-40 w-64 p-3.5 rounded border shadow-2xl flex flex-col gap-3 select-none text-left"
              style={{ 
                backgroundColor: 'var(--ui-panel)', 
                borderColor: 'var(--ui-border)',
                boxShadow: 'var(--ui-shadow)',
                color: 'var(--ui-text)'
              }}
            >
              <div className="flex items-center justify-between border-b border-[var(--ui-border)]/50 pb-1.5 mb-0.5">
                <span className="text-[9px] uppercase tracking-wider font-black text-[var(--ui-muted)]">QUICK PROGRAMMING SETTINGS</span>
                <button 
                  onClick={() => setIsEditorConfigOpen(false)}
                  className="text-xs hover:text-white text-[var(--ui-muted)] cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Theme selection */}
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold uppercase text-[var(--ui-muted)]">Color Theme</label>
                <select
                  value={editorTheme}
                  onChange={(e) => setEditorTheme(e.target.value as any)}
                  className="text-[10px] p-1.5 rounded border focus:outline-none cursor-pointer bg-[var(--ui-input-bg)] text-[var(--ui-text)]"
                  style={{ borderColor: 'var(--ui-border)' }}
                >
                  <option value="corex-dark">CoreX Twilight (Dark)</option>
                  <option value="vs-light">CoreX Twilight (Light)</option>
                  <option value="godot-dark-editor">Godot Engine Dark</option>
                  <option value="godot-light-editor">Godot Engine Light</option>
                  <option value="vs-dark">Standard Monaco Dark</option>
                </select>
              </div>

              {/* Font Size slider */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center text-[10px] font-bold text-[var(--ui-muted)] uppercase">
                  <span>Font Size</span>
                  <span className="font-mono text-[var(--ui-accent)]">{editorFontSize}px</span>
                </div>
                <input 
                  type="range" 
                  min="12" 
                  max="20" 
                  value={editorFontSize}
                  onChange={(e) => setEditorFontSize(parseInt(e.target.value))}
                  className="w-full accent-[var(--ui-accent)] cursor-pointer h-1 rounded"
                  style={{ backgroundColor: 'var(--ui-border)' }}
                />
              </div>

              {/* Tab Size */}
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold uppercase text-[var(--ui-muted)]">Tab Spaces</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[2, 4].map((size) => (
                    <button
                      key={size}
                      onClick={() => setEditorTabSize(size)}
                      className={`py-1 text-[10px] font-bold rounded border cursor-pointer transition-colors ${
                        editorTabSize === size
                          ? 'border-[var(--ui-accent)] text-[var(--ui-accent)] bg-[var(--ui-accent)]/10 font-black'
                          : 'border-transparent text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)]'
                      }`}
                    >
                      {size} Spaces
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div className="flex flex-col gap-2 pt-1 border-t border-[var(--ui-border)]/50">
                {/* Word Wrap */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[var(--ui-muted)] uppercase">Word Wrap</span>
                  <button
                    onClick={() => setEditorWordWrap(!editorWordWrap)}
                    className="w-7 h-4 rounded-full p-0.5 transition-colors relative cursor-pointer"
                    style={{ backgroundColor: editorWordWrap ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                  >
                    <div className={`w-3 h-3 rounded-full bg-white transition-transform ${editorWordWrap ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Minimap */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[var(--ui-muted)] uppercase">Minimap</span>
                  <button
                    onClick={() => setEditorMinimap(!editorMinimap)}
                    className="w-7 h-4 rounded-full p-0.5 transition-colors relative cursor-pointer"
                    style={{ backgroundColor: editorMinimap ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                  >
                    <div className={`w-3 h-3 rounded-full bg-white transition-transform ${editorMinimap ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Line Gutter */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[var(--ui-muted)] uppercase">Line numbers</span>
                  <button
                    onClick={() => setEditorLineNumbers(!editorLineNumbers)}
                    className="w-7 h-4 rounded-full p-0.5 transition-colors relative cursor-pointer"
                    style={{ backgroundColor: editorLineNumbers ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                  >
                    <div className={`w-3 h-3 rounded-full bg-white transition-transform ${editorLineNumbers ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Auto Close Brackets */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[var(--ui-muted)] uppercase">Auto Brackets</span>
                  <button
                    onClick={() => setEditorAutoClosingBrackets(!editorAutoClosingBrackets)}
                    className="w-7 h-4 rounded-full p-0.5 transition-colors relative cursor-pointer"
                    style={{ backgroundColor: editorAutoClosingBrackets ? 'var(--ui-accent)' : 'var(--ui-border-strong)' }}
                  >
                    <div className={`w-3 h-3 rounded-full bg-white transition-transform ${editorAutoClosingBrackets ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeStrat ? (
            <EditorPanel 
              code={currentCode}
              onChange={(v) => setCurrentCode(v || '')}
              onReady={handleEditorReady}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-[var(--ui-muted)] bg-[var(--ui-terminal-bg)]">
              <Plus size={48} className="stroke-[1px] animate-pulse mb-2 text-[var(--ui-border-strong)]" />
              <p className="text-xs uppercase tracking-wider">Select or create an assembly script</p>
            </div>
          )}
        </div>

        {/* Drag handle resize line */}
        {activeStrat && isTerminalOpen && (
          <div 
            className="h-1 hover:bg-[var(--ui-accent)] cursor-row-resize z-30 transition-colors shrink-0"
            style={{ backgroundColor: 'var(--ui-border)' }}
            onMouseDown={handleMouseDown}
          />
        )}

        {/* Terminal logs pane */}
        {activeStrat && isTerminalOpen && (
          <div 
            className="shrink-0 overflow-hidden"
            style={{ height: `${terminalHeight}px` }}
          >
            <StrategyTerminal 
              logs={activeLogs}
              onClear={() => clearStrategyLogs(activeStrat.id)}
              strategyName={activeStrat.name}
            />
          </div>
        )}
      </div>

      {/* 3. RIGHT PANE: Parameter custom controls schema */}
      {activeStrat && (
        <div 
          className="shrink-0 border-l flex flex-col h-full bg-[var(--ui-sidebar-bg)] overflow-hidden transition-all duration-300"
          style={{ 
            width: isParamsOpen ? '280px' : '36px',
            borderColor: 'var(--ui-border)' 
          }}
        >
          {/* Header */}
          <div 
            className="h-11 border-b px-2.5 flex items-center justify-between shrink-0"
            style={{ borderColor: 'var(--ui-border)', backgroundColor: 'var(--ui-panel-strong)' }}
          >
            {isParamsOpen ? (
              <>
                <div className="flex gap-1.5 items-center">
                  <button
                    onClick={() => setActiveRightTab('params')}
                    className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 border cursor-pointer ${
                      activeRightTab === 'params'
                        ? 'bg-[var(--ui-accent)]/10 text-[var(--ui-accent)] border-[var(--ui-accent)]/20 font-black'
                        : 'border-transparent text-[var(--ui-muted)] hover:text-white'
                    }`}
                  >
                    <Sliders size={10} />
                    PARAMS
                  </button>
                  <button
                    onClick={() => setActiveRightTab('help')}
                    className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 border cursor-pointer ${
                      activeRightTab === 'help'
                        ? 'bg-[var(--ui-accent)]/10 text-[var(--ui-accent)] border-[var(--ui-accent)]/20 font-black'
                        : 'border-transparent text-[var(--ui-muted)] hover:text-white'
                    }`}
                  >
                    <BookOpen size={10} />
                    API DOCS
                  </button>
                </div>
                <button 
                  onClick={() => setIsParamsOpen(false)}
                  className="p-1 rounded text-[var(--ui-muted)] hover:text-[var(--ui-accent)] transition-colors cursor-pointer"
                  title="Collapse Parameter Pane"
                >
                  <ChevronsRight size={14} />
                </button>
              </>
            ) : (
              <button 
                onClick={() => setIsParamsOpen(true)}
                className="w-full flex items-center justify-center p-1 rounded text-[var(--ui-muted)] hover:text-[var(--ui-accent)] transition-colors cursor-pointer"
                title="Expand Parameter Pane"
              >
                <ChevronsLeft size={14} />
              </button>
            )}
          </div>

          {/* Schema contents */}
          {isParamsOpen ? (
            activeRightTab === 'help' ? (
              <div className="flex-1 p-3.5 overflow-y-auto flex flex-col gap-3.5 select-text">
                {/* Search */}
                <div className="relative shrink-0">
                  <Search className="absolute left-2.5 top-2 text-[var(--ui-muted)]" size={12} />
                  <input
                    type="text"
                    value={helpSearch}
                    onChange={(e) => setHelpSearch(e.target.value)}
                    placeholder="Search API Help..."
                    className="w-full text-[11px] py-1 pl-8 pr-2 rounded border focus:outline-none bg-[var(--ui-input-bg)] font-sans"
                    style={{ borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
                  />
                </div>

                {/* Docs list */}
                <div className="flex-1 space-y-3.5">
                  {[
                    { name: 'buy(qty)', type: 'Execution', desc: 'Dispatches a market BUY order immediately for the configured symbol.', code: 'buy(1.0);' },
                    { name: 'sell(qty)', type: 'Execution', desc: 'Dispatches a market SELL order immediately to close long positions or enter short.', code: 'sell(1.0);' },
                    { name: 'log(message)', type: 'Utility', desc: 'Outputs custom logs to the strategy console in real-time.', code: 'log("Position opened at: " + bar.close);' },
                    { name: 'isLong()', type: 'State', desc: 'Returns true if active container holds a long margin position.', code: 'if (isLong()) {\n  log("Active position: LONG");\n}' },
                    { name: 'isShort()', type: 'State', desc: 'Returns true if active container holds a short margin position.', code: 'if (isShort()) {\n  log("Active position: SHORT");\n}' },
                    { name: 'ema(bar, period)', type: 'Indicator', desc: 'Calculates the Exponential Moving Average value for the current bar.', code: 'const ma = ema(bar, 20);' },
                    { name: 'rsi(bar, period)', type: 'Indicator', desc: 'Calculates the Relative Strength Index (0 to 100) for the current bar.', code: 'const osc = rsi(bar, 14);' },
                    { name: 'macd(bar, fast, slow, signal)', type: 'Indicator', desc: 'Calculates MACD properties. Returns object { macd, signal, hist }.', code: 'const { macd: val, signal: sig } = macd(bar, 12, 26, 9);' },
                  ]
                    .filter(doc => 
                      doc.name.toLowerCase().includes(helpSearch.toLowerCase()) || 
                      doc.desc.toLowerCase().includes(helpSearch.toLowerCase()) ||
                      doc.type.toLowerCase().includes(helpSearch.toLowerCase())
                    )
                    .map(doc => {
                      const handleCopy = () => {
                        navigator.clipboard.writeText(doc.code);
                        showToast(`Copied snippet: ${doc.name}`, 'success');
                      };

                      return (
                        <div key={doc.name} className="p-2.5 rounded border border-[var(--ui-border)]/50 bg-[var(--ui-panel-strong)] flex flex-col gap-1.5 transition-all hover:border-[var(--ui-accent)]/30">
                          <div className="flex items-center justify-between leading-none">
                            <span className="font-mono text-[10px] text-white font-black">{doc.name}</span>
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[var(--ui-panel-soft)] text-[var(--ui-muted)] border border-[var(--ui-border)]/20">
                              {doc.type}
                            </span>
                          </div>
                          <p className="text-[10px] text-[var(--ui-muted)] leading-relaxed font-sans">{doc.desc}</p>
                          <div className="relative group mt-0.5">
                            <pre className="p-2 rounded bg-[var(--ui-terminal-bg)] font-mono text-[9px] text-emerald-400 overflow-x-auto whitespace-pre leading-normal border border-black/20 select-all">
                              {doc.code}
                            </pre>
                            <button
                              onClick={handleCopy}
                              className="absolute right-1 top-1 p-1 rounded bg-[var(--ui-panel-soft)] border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-white transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
                              title="Copy code snippet"
                            >
                              <Copy size={10} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div className="flex-1 p-4 overflow-y-auto space-y-5">
              {/* Core Engine Diagnostic Stats widget */}
              <div className="border border-[var(--ui-border)]/60 rounded-lg p-3 bg-[var(--ui-panel-strong)] flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-muted)]">QUANT TELEMETRY</span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full relative flex">
                      <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${
                        activeStrat.status === 'running' ? 'bg-emerald-400' : 'bg-slate-400'
                      }`} />
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        activeStrat.status === 'running' ? 'bg-emerald-500' : 'bg-slate-500'
                      }`} />
                    </span>
                    <span className="text-[8px] font-bold uppercase font-mono text-white">
                      {activeStrat.status === 'running' ? 'LIVE FEED' : 'STANDBY'}
                    </span>
                  </span>
                </div>

                {(() => {
                  const matchedRun = runtimeFor(activeStrat.id);
                  if (activeStrat.status === 'running' && matchedRun) {
                    const positionStr = typeof matchedRun.position === 'object' && matchedRun.position !== null
                      ? (matchedRun.position.side || 'FLAT')
                      : (matchedRun.position || 'FLAT');
                    const unrealizedPnlVal = matchedRun.unrealizedPnl !== undefined
                      ? (typeof matchedRun.unrealizedPnl === 'object' && matchedRun.unrealizedPnl !== null ? 0 : matchedRun.unrealizedPnl)
                      : (matchedRun.pnl !== undefined ? matchedRun.pnl : (matchedRun.position?.unrealizedPnl || 0));
                    const isPositive = unrealizedPnlVal >= 0;
                    return (
                      <div className="space-y-1.5 pt-1.5 border-t border-[var(--ui-border)]/40 text-[10px]">
                        <div className="flex justify-between items-center leading-none">
                          <span style={{ color: 'var(--ui-muted)' }}>RUN ID:</span>
                          <span className="font-mono text-white text-[9px]">{matchedRun.id}</span>
                        </div>
                        <div className="flex justify-between items-center leading-none font-sans">
                          <span style={{ color: 'var(--ui-muted)' }}>SYMBOL FEED:</span>
                          <span className="font-bold text-[var(--ui-accent)]">{matchedRun.symbol}</span>
                        </div>
                        <div className="flex justify-between items-center leading-none">
                          <span style={{ color: 'var(--ui-muted)' }}>POSITION:</span>
                          <span className={`font-black uppercase px-1 rounded text-[8px] ${
                            positionStr === 'LONG' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            positionStr === 'SHORT' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                            'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                          }`}>
                            {positionStr}
                          </span>
                        </div>
                        <div className="flex justify-between items-center leading-none">
                          <span style={{ color: 'var(--ui-muted)' }}>UNREALIZED P&L:</span>
                          <span className={`font-mono font-black ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isPositive ? '+' : ''}${(unrealizedPnlVal ?? 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center leading-none font-sans">
                          <span style={{ color: 'var(--ui-muted)' }}>EQUITY BALANCE:</span>
                          <span className="font-mono text-white">${(matchedRun.equity ?? 100000).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center leading-none">
                          <span style={{ color: 'var(--ui-muted)' }}>UPTIME COUNTER:</span>
                          <span className="font-mono text-[var(--ui-muted)]">{matchedRun.uptime}</span>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div className="text-[10px] text-[var(--ui-muted)] pt-1.5 border-t border-[var(--ui-border)]/40 flex flex-col gap-1.5">
                        <p className="leading-normal font-sans text-[10px]">
                          No active sandbox threads executing this script template. Core assembly cold.
                        </p>
                        <div className="mt-1 p-1.5 rounded bg-[var(--ui-panel-soft)] text-[9px] font-mono flex flex-col gap-0.5 border border-[var(--ui-border)]/30">
                          <div className="flex justify-between">
                            <span>LAST MODIFIED:</span>
                            <span className="text-white">{new Date(activeStrat.updatedAt).toLocaleTimeString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>FILE STATUS:</span>
                            <span className="text-emerald-400 font-bold">SAVED & COMPILED</span>
                          </div>
                        </div>
                      </div>
                    );
                  }
                })()}
              </div>

              {/* Title parameter splitter */}
              <div className="flex items-center gap-1.5 pt-1.5">
                <Sliders size={11} className="text-[var(--ui-accent)]" />
                <span className="text-[9px] uppercase font-bold tracking-widest text-[var(--ui-muted)]">
                  CONFIGURABLE PARAMETERS
                </span>
              </div>

              {activeStrat.schema ? (
                <>
                  {Object.entries(activeStrat.schema).map(([key, config]: [string, any]) => {
                    const currentVal = localParams[key] !== undefined ? localParams[key] : config.default;

                    return (
                      <div key={key} className="flex flex-col gap-1.5 pb-2 border-b border-[var(--ui-border)]/50">
                        <div className="flex justify-between items-center leading-none">
                          <span className="text-xs font-bold text-[var(--ui-text)] font-sans">
                            {key}
                          </span>
                          <span className="text-[10px] font-mono text-[var(--ui-accent)] font-bold">
                            {String(currentVal)}
                          </span>
                        </div>

                        {/* Config helper tags */}
                        <span className="text-[9px] text-[var(--ui-muted)] uppercase tracking-wider mb-1 font-semibold leading-none">
                          Type: {config.type} {config.min !== undefined && `· Min: ${config.min}`} {config.max !== undefined && `· Max: ${config.max}`}
                        </span>

                        {/* Slider for Integer / Numbers */}
                        {(config.type === 'integer' || config.type === 'number') && (
                          <div className="flex items-center gap-2 mt-1">
                            <input 
                              type="range"
                              min={config.min !== undefined ? config.min : 0}
                              max={config.max !== undefined ? config.max : 100}
                              step={config.type === 'number' ? 0.1 : 1}
                              value={currentVal}
                              onChange={(e) => handleParamChange(key, config.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value))}
                              className="w-full accent-[var(--ui-accent)] cursor-pointer h-1 rounded"
                              style={{ backgroundColor: 'var(--ui-border)' }}
                            />
                            <input 
                              type="number"
                              min={config.min}
                              max={config.max}
                              step={config.type === 'number' ? 0.1 : 1}
                              value={currentVal}
                              onChange={(e) => handleParamChange(key, config.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value))}
                              className="w-14 p-1 rounded border text-[10px] font-mono focus:outline-none text-center"
                              style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)' }}
                            />
                          </div>
                        )}

                        {/* Toggle switch for Boolean */}
                        {config.type === 'boolean' && (
                          <div className="flex items-center mt-1">
                            <button
                              onClick={() => handleParamChange(key, !currentVal)}
                              className="w-9 h-5 rounded-full p-0.5 transition-all cursor-pointer relative"
                              style={{
                                backgroundColor: currentVal ? 'var(--ui-accent)' : 'var(--ui-border-strong)'
                              }}
                            >
                              <div 
                                className="w-4 h-4 rounded-full bg-white transition-transform duration-200"
                                style={{
                                  transform: currentVal ? 'translateX(16px)' : 'translateX(0)'
                                }}
                              />
                            </button>
                          </div>
                        )}

                        {/* Select box for dropdowns */}
                        {config.type === 'string' && config.enum && (
                          <div className="relative mt-1">
                            <select
                              value={currentVal}
                              onChange={(e) => handleParamChange(key, e.target.value)}
                              className="w-full text-xs p-1.5 rounded border text-[var(--ui-text)] focus:outline-none cursor-pointer pr-8"
                              style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)' }}
                            >
                              {config.enum.map((opt: string) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* General Text inputs */}
                        {config.type === 'string' && !config.enum && (
                          <input 
                            type="text"
                            value={currentVal}
                            onChange={(e) => handleParamChange(key, e.target.value)}
                            className="w-full text-xs p-1.5 rounded border text-[var(--ui-text)] focus:outline-none mt-1"
                            style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)' }}
                          />
                        )}
                      </div>
                    );
                  })}

                  <button
                    onClick={handleSave}
                    className="w-full py-2 bg-[var(--ui-accent-strong)] text-white font-bold text-xs uppercase tracking-widest rounded cursor-pointer transition-opacity hover:opacity-95 mt-4"
                  >
                    Apply Parameters
                  </button>
                </>
              ) : (
                <div className="text-center py-10 text-xs text-[var(--ui-muted)]">
                  No editable parameters schema found in script assembly.
                </div>
              )}
            </div>
          )) : (
            <div className="flex-1 flex flex-col items-center justify-center py-8 gap-6 text-[var(--ui-muted)]">
              <Sliders size={14} className="rotate-90" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
