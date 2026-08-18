import React, { useState, useMemo } from 'react';
import { 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Layers, 
  Cpu, 
  Zap, 
  Activity,
  Sparkles
} from 'lucide-react';

interface Strategy {
  id: string;
  name: string;
  status: string;
  updatedAt?: string;
}

interface Runtime {
  id: string;
  strategyId?: string;
  strategyName?: string;
  name?: string;
  status?: string;
  mode?: string;
}

interface StrategyExplorerProps {
  strategies: Strategy[];
  selectedStrategyId: string | null;
  onSelectStrategy: (id: string | null) => void;
  activeRuntimes: Runtime[];
  collapsed: boolean;
  onToggleCollapse: (collapsed: boolean) => void;
}

export default function StrategyExplorer({
  strategies,
  selectedStrategyId,
  onSelectStrategy,
  activeRuntimes,
  collapsed,
  onToggleCollapse,
}: StrategyExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  
  // Dynamic categories
  const { activeCores, inactiveCores } = useMemo(() => {
    const active: Strategy[] = [];
    const inactive: Strategy[] = [];

    strategies.forEach(strat => {
      const isStratActive = activeRuntimes.some(
        r => r.strategyId === strat.id || 
             r.name?.toLowerCase() === strat.name?.toLowerCase() || 
             r.strategyName?.toLowerCase() === strat.name?.toLowerCase()
      );

      if (isStratActive) {
        active.push(strat);
      } else {
        inactive.push(strat);
      }
    });

    return { activeCores: active, inactiveCores: inactive };
  }, [strategies, activeRuntimes]);

  // Filtered lists based on search query
  const filteredActiveCores = useMemo(() => {
    return activeCores.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [activeCores, searchQuery]);

  const filteredInactiveCores = useMemo(() => {
    return inactiveCores.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [inactiveCores, searchQuery]);

  if (collapsed) {
    return (
      <div 
        onClick={() => onToggleCollapse(false)}
        className="w-11 border-r border-[var(--ui-border)] bg-[var(--ui-sidebar-bg)] hover:bg-[var(--ui-panel-soft)]/20 transition-all duration-200 cursor-pointer flex flex-col items-center py-4 gap-6 shrink-0 group select-none"
        title="Expand Strategy Explorer"
      >
        <button className="text-[var(--ui-accent)] hover:text-white transition-all cursor-pointer">
          <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
        </button>
        <div className="h-px w-6 bg-[var(--ui-border)]/40" />
        <div className="flex flex-col gap-5 items-center">
          <span title="All System Cores">
            <Layers 
              size={16} 
              className={selectedStrategyId === null ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-muted)]'} 
            />
          </span>
          {activeRuntimes.length > 0 && (
            <div className="relative" title="Active Thread Running">
              <Zap size={14} className="text-emerald-400 animate-pulse" />
              <span className="absolute -top-1.5 -right-1.5 text-[7px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-1 py-0.2 leading-none">
                {activeRuntimes.length}
              </span>
            </div>
          )}
          <span title="Assemblies">
            <Cpu size={15} className="text-[var(--ui-muted)]" />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="w-60 border-r flex flex-col shrink-0 bg-[var(--ui-sidebar-bg)] transition-all duration-300 relative select-none"
      style={{ borderColor: 'var(--ui-border)' }}
    >
      {/* Header section */}
      <div className="p-3 border-b border-[var(--ui-border)] shrink-0 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Cpu size={13} className="text-[var(--ui-accent)]" />
            <span className="text-[9px] font-black text-[var(--ui-muted)] uppercase tracking-widest block leading-none font-mono">
              Strategy Explorer
            </span>
          </div>
          <button
            onClick={() => onToggleCollapse(true)}
            className="text-[var(--ui-muted)] hover:text-white p-0.5 rounded cursor-pointer transition-colors"
            title="Collapse Sidebar"
          >
            <ChevronLeft size={13} />
          </button>
        </div>
        
        <div className="relative">
          <Search className="absolute left-2.5 top-2 text-[var(--ui-muted)]" size={11} />
          <input 
            type="text"
            placeholder="Search strategy cores..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-[10px] py-1.5 pl-7 pr-2 rounded border focus:outline-none font-mono"
            style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)', color: 'var(--ui-text)' }}
          />
        </div>
      </div>

      {/* Strategies List View */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3.5 scrollbar-none">
        
        {/* ALL CORES MASTER SELECTION */}
        <div className="space-y-1">
          <div
            onClick={() => onSelectStrategy(null)}
            className={`w-full text-left px-2.5 py-2 rounded border transition-all cursor-pointer flex items-center justify-between group font-mono ${
              selectedStrategyId === null 
                ? 'bg-[var(--ui-panel-soft)] border-[var(--ui-accent)] text-white font-black shadow' 
                : 'bg-transparent border-transparent text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)]/10'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Layers size={11} className={selectedStrategyId === null ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-muted)]'} />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                ALL SYSTEM CORES
              </span>
            </div>
            <span className="text-[8px] font-bold bg-[var(--ui-panel-strong)] px-1.5 py-0.5 rounded text-[var(--ui-muted)] border border-[var(--ui-border)] group-hover:text-white">
              {strategies.length}
            </span>
          </div>
        </div>

        {/* ACTIVE STRATEGIES CATEGORY */}
        <div className="space-y-1.5">
          <div className="px-2 flex items-center justify-between">
            <span className="text-[8px] font-black text-[var(--ui-muted)] uppercase tracking-wider font-mono flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Active Cores ({filteredActiveCores.length})
            </span>
          </div>

          <div className="space-y-1">
            {filteredActiveCores.length === 0 ? (
              <div className="px-2 py-2 text-[9px] text-[var(--ui-subtle)] font-mono italic">
                No active runs
              </div>
            ) : (
              filteredActiveCores.map(strat => {
                const isSelected = selectedStrategyId === strat.id;
                const matchRuntimes = activeRuntimes.filter(
                  r => r.strategyId === strat.id || 
                       r.name?.toLowerCase() === strat.name?.toLowerCase() || 
                       r.strategyName?.toLowerCase() === strat.name?.toLowerCase()
                );

                return (
                  <div
                    key={strat.id}
                    onClick={() => onSelectStrategy(strat.id)}
                    className={`p-2 rounded border transition-all cursor-pointer flex flex-col gap-1 font-mono group ${
                      isSelected 
                        ? 'bg-[var(--ui-panel-soft)] border-[var(--ui-accent)] text-white shadow-md' 
                        : 'bg-transparent border-transparent text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)]/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-[11px] font-bold truncate group-hover:text-white">
                        {strat.name}
                      </span>
                      <span className="flex gap-1 shrink-0">
                        {matchRuntimes.map((r, i) => (
                          <span 
                            key={r.id || i}
                            className={`px-1 py-0.2 text-[7px] font-black rounded uppercase border ${
                              r.mode?.toLowerCase() === 'live' 
                                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' 
                                : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                            }`}
                          >
                            {(r.mode || 'PAPER').slice(0, 1)}
                          </span>
                        ))}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[8.5px] text-[var(--ui-muted)] leading-none mt-0.5">
                      <span>ID: {strat.id.slice(0, 6)}</span>
                      <span className="text-emerald-400 flex items-center gap-1 font-bold">
                        <Activity size={8} className="animate-pulse" />
                        RUNNING
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* INACTIVE ASSEMBLIES CATEGORY */}
        <div className="space-y-1.5">
          <div className="px-2">
            <span className="text-[8px] font-black text-[var(--ui-muted)] uppercase tracking-wider font-mono">
              Inactive Assemblies ({filteredInactiveCores.length})
            </span>
          </div>

          <div className="space-y-1">
            {filteredInactiveCores.length === 0 ? (
              <div className="px-2 py-2 text-[9px] text-[var(--ui-subtle)] font-mono italic">
                No offline assemblies
              </div>
            ) : (
              filteredInactiveCores.map(strat => {
                const isSelected = selectedStrategyId === strat.id;
                return (
                  <div
                    key={strat.id}
                    onClick={() => onSelectStrategy(strat.id)}
                    className={`p-2 rounded border transition-all cursor-pointer flex flex-col gap-1 font-mono group ${
                      isSelected 
                        ? 'bg-[var(--ui-panel-soft)] border-[var(--ui-accent)] text-white shadow-md' 
                        : 'bg-transparent border-transparent text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)]/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-[11px] font-semibold truncate group-hover:text-white">
                        {strat.name}
                      </span>
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-600 shrink-0" />
                    </div>

                    <div className="flex items-center justify-between text-[8.5px] text-[var(--ui-muted)] leading-none mt-0.5">
                      <span>ID: {strat.id.slice(0, 6)}</span>
                      <span className="uppercase text-[8px] font-semibold tracking-wider text-[var(--ui-subtle)]">
                        {strat.status}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Footer statistics badge */}
      <div className="p-2.5 border-t border-[var(--ui-border)] shrink-0 text-[8.5px] font-mono text-[var(--ui-muted)] flex items-center justify-between bg-[var(--ui-panel-strong)]/20">
        <span>CORES ENABLED: {strategies.length}</span>
        <span className="text-[var(--ui-accent)] font-bold">SYSTEM ACTIVE</span>
      </div>
    </div>
  );
}
