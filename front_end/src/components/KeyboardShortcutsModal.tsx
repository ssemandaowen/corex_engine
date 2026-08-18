import React, { useState, useMemo } from 'react';
import { X, Search, Keyboard } from 'lucide-react';

interface ShortcutItem {
  keyCombo: string;
  altCombo?: string;
  description: string;
  category: 'Navigation' | 'Core System' | 'Interface';
}

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUT_LIST: ShortcutItem[] = [
  // Navigation
  { keyCombo: 'H', altCombo: 'Alt + H', description: 'Navigate to Engine Overview', category: 'Navigation' },
  { keyCombo: 'L', altCombo: 'Alt + L', description: 'Navigate to Strategy Library', category: 'Navigation' },
  { keyCombo: 'E', altCombo: 'Alt + E', description: 'Navigate to Workspace & Execution (Run)', category: 'Navigation' },
  { keyCombo: 'A', altCombo: 'Alt + A', description: 'Navigate to Portfolio Analytics', category: 'Navigation' },
  { keyCombo: 'D', altCombo: 'Alt + D', description: 'Navigate to Core Manifest Docs', category: 'Navigation' },
  { keyCombo: 'B', altCombo: 'Alt + B', description: 'Navigate to Broker Connection (Account)', category: 'Navigation' },
  { keyCombo: 'S', altCombo: 'Alt + S', description: 'Navigate to System Config', category: 'Navigation' },
  
  // Core system operations
  { keyCombo: 'M', altCombo: 'Alt + M', description: 'Toggle Active Account Mode (LIVE / PAPER)', category: 'Core System' },
  { keyCombo: 'R', altCombo: 'Alt + R', description: 'Toggle Realtime Streaming Mode (WS / POLL)', category: 'Core System' },
  
  // Terminal controls
  { keyCombo: 'Ctrl + R', altCombo: '', description: 'Restart selected strategy', category: 'Core System' },
  { keyCombo: 'Ctrl + D', altCombo: '', description: 'Stop selected strategy', category: 'Core System' },
  { keyCombo: 'Ctrl + L', altCombo: '', description: 'Clear terminal logs', category: 'Core System' },
  { keyCombo: 'Ctrl + P', altCombo: '', description: 'Open docs / routes', category: 'Navigation' },
  
  // Interface
  { keyCombo: '` or T', altCombo: 'Alt + T', description: 'Toggle Bottom Terminal Log Drawer', category: 'Interface' },
  { keyCombo: '?', altCombo: '', description: 'Toggle Keyboard Shortcuts Guide', category: 'Interface' },
  { keyCombo: 'ESC', altCombo: '', description: 'Close Dialogs & Popups', category: 'Interface' },
];

export default function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'Navigation' | 'Core System' | 'Interface'>('ALL');

  const filteredShortcuts = useMemo(() => {
    return SHORTCUT_LIST.filter(item => {
      const matchesCategory = activeFilter === 'ALL' || item.category === activeFilter;
      const matchesSearch = item.description.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            item.keyCombo.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (item.altCombo && item.altCombo.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, activeFilter]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-lg bg-[var(--ui-panel-strong)] border border-[var(--ui-accent)]/30 rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh] font-mono"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 0 30px rgba(30, 144, 255, 0.15)' }}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ui-border)] bg-[var(--ui-panel)]">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-[var(--ui-accent)] animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest text-white">
              COREX HOTKEYS LEDGER
            </span>
          </div>
          <button 
            onClick={onClose}
            className="text-[var(--ui-muted)] hover:text-white p-1 rounded hover:bg-[var(--ui-panel-soft)] transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Filters and Search Bar */}
        <div className="p-3 border-b border-[var(--ui-border)]/50 bg-[var(--ui-panel-soft)]/40 space-y-2.5">
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 text-[var(--ui-muted)]" size={12} />
            <input 
              type="text" 
              placeholder="Search shortcuts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs py-1.5 pl-8 pr-3 rounded border focus:outline-none font-mono bg-[var(--ui-input-bg)] text-white"
              style={{ borderColor: 'var(--ui-border)' }}
              autoFocus
            />
          </div>

          {/* Categories Tab Pill Controls */}
          <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
            {(['ALL', 'Navigation', 'Core System', 'Interface'] as const).map(cat => (
              <button
                key={cat}
                onClick={() => setActiveFilter(cat)}
                className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded transition-all cursor-pointer ${
                  activeFilter === cat
                    ? 'bg-[var(--ui-accent)] text-white shadow'
                    : 'text-[var(--ui-muted)] hover:text-white hover:bg-[var(--ui-panel-soft)]/35'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Hotkeys Chronological Listing */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredShortcuts.length === 0 ? (
            <div className="text-center py-12 text-[10px] text-[var(--ui-muted)] uppercase tracking-wider">
              No shortcuts found matching search terms
            </div>
          ) : (
            <div className="space-y-2">
              {filteredShortcuts.map((item, idx) => (
                <div 
                  key={idx}
                  className="flex items-center justify-between p-2 rounded border border-[var(--ui-border)]/30 hover:border-[var(--ui-accent)]/20 hover:bg-[var(--ui-panel-soft)]/20 transition-all group"
                >
                  <span className="text-[11px] text-[var(--ui-text)] group-hover:text-white transition-colors max-w-[280px] truncate">
                    {item.description}
                  </span>

                  <div className="flex items-center gap-1.5 shrink-0 select-none">
                    <span className="text-[8px] uppercase tracking-wider font-bold text-[var(--ui-subtle)] px-1 border border-[var(--ui-border)] rounded-sm bg-[var(--ui-input-bg)] hidden md:inline">
                      {item.category}
                    </span>
                    
                    <div className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 text-[9px] font-bold text-white bg-[var(--ui-panel-soft)] border border-[var(--ui-border-strong)] rounded shadow-sm leading-none min-w-[20px] text-center">
                        {item.keyCombo}
                      </kbd>
                      {item.altCombo && (
                        <>
                          <span className="text-[9px] text-[var(--ui-muted)]">or</span>
                          <kbd className="px-1.5 py-0.5 text-[9px] font-bold text-[var(--ui-accent-strong)] bg-[var(--ui-panel-soft)] border border-[var(--ui-border-strong)] rounded shadow-sm leading-none min-w-[30px] text-center">
                            {item.altCombo}
                          </kbd>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Interactive Tips Footer */}
        <div className="p-3 bg-[var(--ui-panel-soft)] border-t border-[var(--ui-border)] flex items-center justify-between text-[9px] text-[var(--ui-muted)]">
          <span>TIPS: Alt combos work everywhere inside Monaco Editor.</span>
          <span className="font-bold text-[var(--ui-accent-strong)]">ESC to Dismiss</span>
        </div>
      </div>
    </div>
  );
}
