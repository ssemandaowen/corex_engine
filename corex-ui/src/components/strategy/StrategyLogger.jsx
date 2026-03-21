import React, { useMemo, useEffect, useRef, useState } from 'react';
import { AlertCircle, Info, CheckCircle2, Trash2, Copy, Download } from 'lucide-react';

const StrategyLogger = ({ strategyId, logs = [] }) => {
  const bodyRef = useRef(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState({ info: true, warn: true, error: true });

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs]);

  // Filter logs based on search and level
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Level filter
      if (!levelFilter[log.level]) return false;
      
      // Search filter (case-insensitive)
      if (searchFilter && !log.message.toLowerCase().includes(searchFilter.toLowerCase())) {
        return false;
      }
      
      return true;
    });
  }, [logs, searchFilter, levelFilter]);

  const getLogIcon = (level) => {
    switch (level) {
      case 'error':
        return <AlertCircle size={12} className="text-[var(--ui-negative)]" />;
      case 'warn':
        return <AlertCircle size={12} className="text-[var(--ui-warning)]" />;
      default:
        return <Info size={12} className="text-[var(--ui-accent)]" />;
    }
  };

  const getLogColor = (level) => {
    switch (level) {
      case 'error':
        return 'text-[var(--ui-negative)]';
      case 'warn':
        return 'text-[var(--ui-warning)]';
      default:
        return 'text-[var(--ui-accent)]';
    }
  };

  const exportLogs = () => {
    const text = filteredLogs
      .map(
        (log) =>
          `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.level.toUpperCase()}: ${log.message}`
      )
      .join('\n');
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `strategy-${strategyId}-logs-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyLogs = async () => {
    const text = filteredLogs
      .map(
        (log) =>
          `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.level.toUpperCase()}: ${log.message}`
      )
      .join('\n');
    
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  };

  if (!logs || logs.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 border-b border-[var(--ui-border)] bg-[var(--ui-panel)] flex items-center gap-2">
          <input
            type="text"
            placeholder="Search logs..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="flex-1 px-2 py-1 text-xs bg-[var(--ui-input-bg)] border border-[var(--ui-border)] rounded text-[var(--ui-text)] placeholder-[var(--ui-muted)]"
          />
          <div className="flex items-center gap-1">
            {['info', 'warn', 'error'].map((level) => (
              <button
                key={level}
                onClick={() => setLevelFilter((prev) => ({ ...prev, [level]: !prev[level] }))}
                className={`text-[10px] font-bold uppercase px-2 py-1 rounded border transition-all ${
                  levelFilter[level]
                    ? 'text-[var(--ui-text)] border-[var(--ui-border-strong)] bg-[var(--ui-row-hover)]'
                    : 'text-[var(--ui-muted)] border-[var(--ui-border)]'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          <button
            onClick={copyLogs}
            className="p-1 text-[var(--ui-muted)] hover:text-[var(--ui-text)] transition-colors"
            title="Copy logs"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={exportLogs}
            className="p-1 text-[var(--ui-muted)] hover:text-[var(--ui-text)] transition-colors"
            title="Export logs"
          >
            <Download size={14} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-[var(--ui-muted)] text-[12px]">
          No logs yet. Strategy logs will appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="px-4 py-2 border-b border-[var(--ui-border)] bg-[var(--ui-panel)] flex items-center gap-2 shrink-0">
        <input
          type="text"
          placeholder="Search logs..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          className="flex-1 px-2 py-1 text-xs bg-[var(--ui-input-bg)] border border-[var(--ui-border)] rounded text-[var(--ui-text)] placeholder-[var(--ui-muted)]"
        />
        <div className="flex items-center gap-1">
          {['info', 'warn', 'error'].map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter((prev) => ({ ...prev, [level]: !prev[level] }))}
              className={`text-[10px] font-bold uppercase px-2 py-1 rounded border transition-all ${
                levelFilter[level]
                  ? 'text-[var(--ui-text)] border-[var(--ui-border-strong)] bg-[var(--ui-row-hover)]'
                  : 'text-[var(--ui-muted)] border-[var(--ui-border)]'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
        <button
          onClick={copyLogs}
          className="p-1 text-[var(--ui-muted)] hover:text-[var(--ui-text)] transition-colors"
          title="Copy logs"
        >
          <Copy size={14} />
        </button>
        <button
          onClick={exportLogs}
          className="p-1 text-[var(--ui-muted)] hover:text-[var(--ui-text)] transition-colors"
          title="Export logs"
        >
          <Download size={14} />
        </button>
      </div>

      {/* Logs */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto p-3">
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--ui-muted)] text-[12px]">
            No logs matching filters
          </div>
        ) : (
          <div className="flex flex-col gap-1 font-mono text-[10px]">
            {filteredLogs.map((log, idx) => {
              const time = new Date(log.timestamp).toLocaleTimeString();
              return (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-1.5 rounded hover:bg-[var(--ui-row-hover)] transition-colors"
                >
                  <div className="pt-0.5 shrink-0">{getLogIcon(log.level)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[var(--ui-muted)]">[{time}]</span>
                      <span className={`font-bold uppercase ${getLogColor(log.level)}`}>
                        {log.level}
                      </span>
                    </div>
                    <div className="text-[var(--ui-text)] text-[9px] break-words">
                      {log.message}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default StrategyLogger;
