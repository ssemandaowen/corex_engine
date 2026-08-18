import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Trash2, 
  Copy, 
  Download,
  Terminal,
  Clock
} from 'lucide-react';
import { LogLine } from '../../store/dataStore';

interface StrategyTerminalProps {
  logs: LogLine[];
  onClear: () => void;
  strategyName: string;
}

export default function StrategyTerminal({
  logs,
  onClear,
  strategyName
}: StrategyTerminalProps) {
  const [filter, setFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [isPaused, setIsPaused] = useState(false);
  const [showTimestamp, setShowTimestamp] = useState(true);
  const [isCopied, setIsCopied] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const activeLogsRef = useRef<LogLine[]>([]);

  // Capture logs snapshot when paused
  useEffect(() => {
    if (!isPaused) {
      activeLogsRef.current = logs;
    }
  }, [logs, isPaused]);

  // Scroll to bottom on logs update
  useEffect(() => {
    if (!isPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isPaused]);

  const displayedLogs = isPaused ? activeLogsRef.current : logs;

  const filteredLogs = displayedLogs.filter(log => {
    if (filter === 'ALL') return true;
    return log.level === filter;
  });

  const handleCopy = () => {
    const text = filteredLogs.map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const text = filteredLogs.map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${strategyName.toLowerCase().replace(/\s+/g, '_')}_logs.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getLogBadgeStyle = (level: string) => {
    switch (level) {
      case 'ERROR': return 'text-[var(--ui-negative)] border-[var(--ui-negative)]/20 bg-[var(--ui-negative)]/10';
      case 'WARN': return 'text-[var(--ui-warning)] border-[var(--ui-warning)]/20 bg-[var(--ui-warning)]/10';
      default: return 'text-[var(--ui-accent)] border-[var(--ui-accent)]/20 bg-[var(--ui-accent)]/10';
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0 relative select-none" style={{ backgroundColor: 'var(--ui-terminal-bg)' }}>
      {/* Resizable header bar */}
      <div 
        className="flex items-center justify-between px-3 h-9 border-b shrink-0"
        style={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border)' }}
      >
        <div className="flex items-center gap-2">
          <Terminal size={12} style={{ color: 'var(--ui-muted)' }} />
          <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: 'var(--ui-muted)' }}>
            STRATEGY TERMINAL LOGS
          </span>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-1.5">
          {/* Pause/Resume */}
          <button 
            onClick={() => setIsPaused(!isPaused)}
            className={`p-1 rounded hover:bg-[var(--ui-panel-soft)] transition-colors cursor-pointer text-xs font-mono font-bold flex items-center gap-1 ${isPaused ? 'text-[var(--ui-warning)]' : 'text-[var(--ui-muted)]'}`}
            title={isPaused ? "Resume Stream" : "Pause Stream"}
          >
            {isPaused ? <Play size={11} /> : <Pause size={11} />}
            <span className="text-[9px] uppercase tracking-wider">{isPaused ? 'RESUME' : 'PAUSE'}</span>
          </button>

          <div className="w-px h-3 bg-[var(--ui-border)] mx-0.5" />

          {/* Copy logs */}
          <button 
            onClick={handleCopy}
            className="p-1 rounded text-[var(--ui-muted)] hover:text-[var(--ui-accent)] transition-colors hover:bg-[var(--ui-panel-soft)] cursor-pointer"
            title="Copy Filtered Logs"
          >
            <Copy size={11} />
          </button>

          {/* Download logs */}
          <button 
            onClick={handleDownload}
            className="p-1 rounded text-[var(--ui-muted)] hover:text-emerald-400 transition-colors hover:bg-[var(--ui-panel-soft)] cursor-pointer"
            title="Download Logs"
          >
            <Download size={11} />
          </button>

          {/* Timestamp Toggle */}
          <button 
            onClick={() => setShowTimestamp(!showTimestamp)}
            className={`p-1 rounded transition-colors hover:bg-[var(--ui-panel-soft)] cursor-pointer ${showTimestamp ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-muted)]'}`}
            title="Toggle Timestamps"
          >
            <Clock size={11} />
          </button>

          {/* Clear logs */}
          <button 
            onClick={onClear}
            className="p-1 rounded text-[var(--ui-muted)] hover:text-red-500 transition-colors hover:bg-[var(--ui-panel-soft)] cursor-pointer"
            title="Clear Logs"
          >
            <Trash2 size={11} />
          </button>

          <div className="w-px h-3 bg-[var(--ui-border)] mx-0.5" />

          {/* Filter Chips */}
          {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[8px] px-1.5 py-0.5 rounded font-mono font-bold border transition-colors cursor-pointer ${
                filter === f 
                  ? 'bg-[var(--ui-accent)] text-white border-[var(--ui-accent)]' 
                  : 'bg-transparent text-[var(--ui-muted)] border-[var(--ui-border)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Log list area */}
      <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] leading-relaxed flex flex-col space-y-1">
        {filteredLogs.length > 0 ? (
          <>
            {filteredLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 hover:bg-white/5 p-0.5 rounded transition-colors">
                {showTimestamp && (
                  <span className="text-[var(--ui-muted)] select-none shrink-0">
                    [{log.timestamp}]
                  </span>
                )}
                <span className={`px-1 rounded border text-[8px] font-black leading-none py-0.5 mt-0.5 shrink-0 ${getLogBadgeStyle(log.level)}`}>
                  {log.level}
                </span>
                <span className="text-[var(--ui-text)] break-all flex-1 font-mono tracking-tight font-medium">
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-[var(--ui-muted)]">
            <span className="animate-ping mb-1">_</span>
            <p className="text-[10px] uppercase tracking-wider">
              {isPaused ? 'Log stream paused' : 'Terminal output stream listening for transactions...'}
            </p>
          </div>
        )}
      </div>

      {/* Toast alert indicator on copy */}
      {isCopied && (
        <div 
          className="absolute right-4 bottom-4 px-2 py-1 rounded text-[10px] font-sans border font-bold uppercase tracking-wider text-emerald-400"
          style={{ backgroundColor: 'var(--ui-panel-strong)', borderColor: 'var(--ui-border-strong)' }}
        >
          Copied to clipboard!
        </div>
      )}
    </div>
  );
}
