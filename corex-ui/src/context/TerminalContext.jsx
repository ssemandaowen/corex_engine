import React, { useState, useCallback } from 'react';
import TerminalContext from './terminalContextStore';

/**
 * TerminalContext
 * Global logging and terminal management system
 * Replaces scattered console.log with centralized, filterable log stream
 */

export const TerminalProvider = ({ children }) => {
  const [logs, setLogs] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | 'error' | 'warn' | 'info' | 'strategy'
  const [unreadCount, setUnreadCount] = useState(0);

  // Add log entry (keep max 500 logs to prevent memory leak)
  const addLog = useCallback((level, message, data = null, source = 'system') => {
    const newLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      level: String(level).toLowerCase(), // 'error', 'warn', 'info', 'strategy'
      message: String(message),
      data,
      source, // 'system', 'strategy', 'backtest', etc.
    };

    setLogs((prev) => {
      const updated = [...prev, newLog];
      // Keep only last 500 logs
      return updated.length > 500 ? updated.slice(-500) : updated;
    });

    // Increment unread when not viewing terminal
    if (!isOpen) {
      setUnreadCount((prev) => prev + 1);
    }
  }, [isOpen]);

  // Filter logs based on current filter
  const filteredLogs = logs.filter((log) => {
    if (filter === 'all') return true;
    return log.level === filter;
  });

  // Clear all logs
  const clearLogs = useCallback(() => {
    setLogs([]);
    setUnreadCount(0);
  }, []);

  // Export logs to JSON
  const exportLogs = useCallback(() => {
    const dataStr = JSON.stringify(logs, null, 2);
    const element = document.createElement('a');
    element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(dataStr)}`);
    element.setAttribute('download', `corex-logs-${Date.now()}.json`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }, [logs]);

  // Open terminal and reset unread count
  const openTerminal = useCallback(() => {
    setIsOpen(true);
    setUnreadCount(0);
  }, []);

  // Close terminal
  const closeTerminal = useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = {
    // State
    logs,
    filteredLogs,
    isOpen,
    filter,
    unreadCount,

    // Actions
    addLog,
    clearLogs,
    exportLogs,
    setFilter,
    openTerminal,
    closeTerminal,
    setIsOpen,
  };

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
};

export default TerminalProvider;
