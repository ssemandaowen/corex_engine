import { create } from 'zustand';

/**
 * useTerminal Hook
 * Global terminal state management with support for multiple log streams
 * Automatically captures logs from all sources
 */
const useTerminal = create((set, get) => ({
  // State
  isOpen: false,
  isPinned: false,
  height: 240,
  logs: {}, // { [sourceId]: [logEntry, ...] }
  activeSource: null,
  logLevelFilter: { info: true, warn: true, error: true },
  searchQuery: '',

  // Actions
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setHeight: (height) => set({ height: Math.max(160, Math.min(height, 600)) }),
  setIsPinned: (pinned) => set({ isPinned: pinned }),
  setActiveSource: (sourceId) => set({ activeSource: sourceId }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setLogLevelFilter: (filter) => set({ logLevelFilter: filter }),
  
  // Add log entry from any source
  addLog: (sourceId, level, message, module = 'SYSTEM', metadata = {}) => {
    set((state) => {
      const logs = { ...state.logs };
      if (!logs[sourceId]) logs[sourceId] = [];
      
      const entry = {
        ts: Date.now(),
        level: level || 'info',
        message: String(message || ''),
        module: String(module || 'SYSTEM'),
        ...metadata
      };

      // Keep last 1000 logs per source
      logs[sourceId] = [...logs[sourceId], entry].slice(-1000);
      
      // Auto-switch to new source if none active
      if (!state.activeSource) {
        return { logs, activeSource: sourceId };
      }
      
      return { logs };
    });
  },

  // Clear logs from specific source
  clearSource: (sourceId) => {
    set((state) => {
      const logs = { ...state.logs };
      delete logs[sourceId];
      return { 
        logs,
        activeSource: state.activeSource === sourceId ? null : state.activeSource
      };
    });
  },

  // Clear all logs
  clearAll: () => set({ logs: {}, activeSource: null }),

  // Get current visible logs
  getVisibleLogs: () => {
    const state = get();
    const sourceId = state.activeSource;
    if (!sourceId || !state.logs[sourceId]) return [];

    const logs = state.logs[sourceId];
    const query = state.searchQuery.toLowerCase();
    const filter = state.logLevelFilter;

    return logs.filter((log) => {
      const hasLevel = filter[log.level.toLowerCase()];
      const matchesQuery = !query || 
        log.message.toLowerCase().includes(query) ||
        log.module.toLowerCase().includes(query);
      return hasLevel && matchesQuery;
    });
  },

  // Export logs as text
  exportLogs: (sourceId) => {
    const state = get();
    const logs = state.logs[sourceId] || [];
    return logs
      .map((e) => {
        const ts = new Date(e.ts).toLocaleTimeString([], { hour12: false });
        return `[${ts}] ${String(e.level).toUpperCase().padEnd(5)} ${e.module}: ${e.message}`;
      })
      .join('\n');
  }
}));

export default useTerminal;
