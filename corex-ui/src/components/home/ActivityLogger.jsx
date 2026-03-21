import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { AlertCircle, Info, CheckCircle2, Clock, Search, WrapText, Copy, Download, Trash2, Pause, Play } from 'lucide-react';
import { useStore } from '../../store/useStore';

function fmtTs(ts) {
  const t = Number(ts || 0);
  if (!Number.isFinite(t) || t <= 0) return '--:--:--';
  return new Date(t).toLocaleTimeString([], { hour12: false });
}

function levelColor(level) {
  switch (String(level || '').toLowerCase()) {
    case 'error':   return 'text-[var(--ui-negative)]';
    case 'warn':
    case 'warning': return 'text-[var(--ui-warning)]';
    case 'success': return 'text-[var(--ui-positive)]';
    default:        return 'text-[var(--ui-accent)]';
  }
}

function LevelIcon({ level }) {
  const sz = 12;
  switch (String(level || '').toLowerCase()) {
    case 'error':   return <AlertCircle  size={sz} className="text-[var(--ui-negative)]" />;
    case 'warn':
    case 'warning': return <AlertCircle  size={sz} className="text-[var(--ui-warning)]"  />;
    case 'success': return <CheckCircle2 size={sz} className="text-[var(--ui-positive)]" />;
    default:        return <Info         size={sz} className="text-[var(--ui-accent)]"   />;
  }
}

function formatLine(evt) {
  if (!evt) return 'Unknown event';
  return String(evt.message || evt.error || evt.reason || '').trim() || 'Event';
}

const MODE_FILTERS = [
  { id: 'all',       label: 'ALL'  },
  { id: 'errors',    label: 'ERR'  },
  { id: 'warnings',  label: 'WARN' },
  { id: 'execution', label: 'EXEC' },
];

const isExec = (e) => {
  const cat = String(e?.category || '').toLowerCase();
  const mod = String(e?.module   || '').toLowerCase();
  return cat === 'execution' || mod.includes('exec') || mod.includes('backtest');
};

const ActivityLogger = () => {
  const appTerminal  = useStore((s) => s.appTerminal);
  const execTerminal = useStore((s) => s.execTerminal);

  const [mode,       setMode]       = useState('all');
  const [query,      setQuery]      = useState('');
  const [paused,     setPaused]     = useState(false);
  const [wrapLines,  setWrapLines]  = useState(true);
  const [showTime,   setShowTime]   = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  const bodyRef = useRef(null);

  /* ── merged + sorted logs ── */
  const mergedLogs = useMemo(() => {
    const app  = Array.isArray(appTerminal)  ? appTerminal  : [];
    const exec = Array.isArray(execTerminal) ? execTerminal : [];
    return [...app, ...exec]
      .sort((a, b) => Number(a?.ts || 0) - Number(b?.ts || 0)) // oldest first → newest at bottom
      .slice(-200);
  }, [appTerminal, execTerminal]);

  /* ── summary counts ── */
  const summary = useMemo(() => {
    const s = { total: mergedLogs.length, info: 0, warn: 0, error: 0, execution: 0 };
    mergedLogs.forEach((e) => {
      const lvl = String(e?.level || 'info').toLowerCase();
      if      (lvl === 'error')                  s.error += 1;
      else if (lvl === 'warn' || lvl === 'warning') s.warn += 1;
      else                                        s.info  += 1;
      if (isExec(e)) s.execution += 1;
    });
    return s;
  }, [mergedLogs]);

  /* ── filtered view ── */
  const activityLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mergedLogs.filter((e) => {
      const lvl = String(e?.level || '').toLowerCase();
      if (mode === 'errors'    && lvl !== 'error')                           return false;
      if (mode === 'warnings'  && !(lvl === 'warn' || lvl === 'warning'))    return false;
      if (mode === 'execution' && !isExec(e))                                return false;
      if (!q) return true;
      return (
        String(e?.message  || '').toLowerCase().includes(q) ||
        String(e?.module   || '').toLowerCase().includes(q) ||
        String(e?.category || '').toLowerCase().includes(q)
      );
    });
  }, [mergedLogs, mode, query]);

  /* ── export text ── */
  const exportText = useMemo(() =>
    activityLogs
      .map((e) => `[${fmtTs(e.ts)}] ${String(e.level || 'info').toUpperCase().padEnd(7)} ${e.module || e.category || 'APP'}: ${formatLine(e)}`)
      .join('\n'),
  [activityLogs]);

  /* ── auto-scroll ── */
  useEffect(() => {
    if (paused || !autoScroll || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [paused, autoScroll, mergedLogs.length]);

  const handleScroll = useCallback(() => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  /* ── empty state ── */
  if (!mergedLogs.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--ui-muted)] opacity-60 select-none">
        <Clock size={18} />
        <span className="text-[11px] uppercase tracking-widest font-bold">No activity yet</span>
        <span className="text-[11px] text-[var(--ui-subtle)]">System running normally</span>
      </div>
    );
  }

  return (
    <div className="ui-terminal flex flex-col h-full">

      {/* ── Header ── */}
      <div className="shrink-0 px-3 h-9 border-b border-[var(--ui-border)] bg-[var(--ui-panel-strong)] flex items-center justify-between gap-2">

        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-black tracking-widest text-[var(--ui-text)] uppercase whitespace-nowrap">
            Activity Log
          </span>
          <span className={`ui-log-chip shrink-0 ${paused ? 'ui-log-chip-active' : ''}`}>
            {paused ? 'PAUSED' : 'LIVE'}
          </span>
          {!autoScroll && !paused && (
            <button
              onClick={() => {
                setAutoScroll(true);
                if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
              }}
              className="ui-log-chip shrink-0 text-[var(--ui-accent)] border-[var(--ui-accent)]/40 hover:bg-[var(--ui-accent)]/10"
              title="Jump to bottom and re-enable auto-scroll"
            >
              ↓ follow
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => navigator.clipboard?.writeText(exportText)} title="Copy log" className="icon-btn">
            <Copy size={13} />
          </button>
          <button
            title="Download log"
            className="icon-btn"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([exportText], { type: 'text/plain' }));
              Object.assign(document.createElement('a'), { href: url, download: 'activity.log' }).click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={13} />
          </button>
          <button onClick={() => setPaused((v) => !v)} title={paused ? 'Resume' : 'Pause'} className="icon-btn">
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="shrink-0 px-3 h-8 border-b border-[var(--ui-border)] bg-[var(--ui-panel)] flex items-center gap-3">

        {/* count badges */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="ui-log-chip">T {summary.total}</span>
          <span className="ui-log-chip">I {summary.info}</span>
          <span className="ui-log-chip text-[var(--ui-warning)]">W {summary.warn}</span>
          <span className="ui-log-chip text-[var(--ui-negative)]">E {summary.error}</span>
        </div>

        <div className="w-px h-4 bg-[var(--ui-border)] shrink-0" />

        {/* mode filter chips */}
        <div className="flex items-center gap-1 shrink-0">
          {MODE_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`mini-chip px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                mode === id
                  ? 'text-[var(--ui-accent)] bg-[color:color-mix(in_srgb,var(--ui-accent)_14%,transparent)] border-[var(--ui-accent)]/30'
                  : 'text-[var(--ui-muted)] border-[var(--ui-border)] hover:text-[var(--ui-text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-[var(--ui-border)] shrink-0" />

        {/* search */}
        <div className="relative flex-1 min-w-0">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--ui-subtle)] pointer-events-none" />
          <input
            className="ui-input text-[11px] font-mono w-full pl-6 h-6"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search module / message…"
          />
        </div>

        {/* icon toggles */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setWrapLines((v) => !v)}
            title={wrapLines ? 'Disable line wrap' : 'Enable line wrap'}
            className={`icon-btn ${wrapLines ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-muted)]'}`}
          >
            <WrapText size={13} />
          </button>
          <button
            onClick={() => setShowTime((v) => !v)}
            title={showTime ? 'Hide timestamps' : 'Show timestamps'}
            className={`icon-btn ${showTime ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-muted)]'}`}
          >
            <Clock size={13} />
          </button>
        </div>

        {/* visible count */}
        <span className="text-[10px] text-[var(--ui-subtle)] shrink-0 tabular-nums">
          {activityLogs.length}/{mergedLogs.length}
        </span>
      </div>

      {/* ── Log body ── */}
      <div
        ref={bodyRef}
        onScroll={handleScroll}
        className={`ui-terminal-body flex-1 overflow-auto font-mono text-[11.5px] leading-5 px-3 py-2 ${wrapLines ? '' : 'whitespace-pre'}`}
      >
        {activityLogs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[var(--ui-subtle)] text-[11px] select-none opacity-60">
            No entries match the current filter
          </div>
        ) : (
          activityLogs.map((evt, idx) => {
            const moduleName = String(evt?.module || evt?.category || 'APP').toUpperCase();
            return (
              <div
                key={`${evt?.ts || 0}_${idx}`}
                className="ui-log-row flex items-start gap-2 py-0.5 hover:bg-[var(--ui-hover-light)]"
              >
                <span className="shrink-0 mt-0.5">
                  <LevelIcon level={evt?.level} />
                </span>
                {showTime && (
                  <span className="text-[var(--ui-subtle)] tabular-nums shrink-0 w-[5.5rem] text-right select-none">
                    {fmtTs(evt?.ts)}
                  </span>
                )}
                <span className={`font-bold w-10 shrink-0 ${levelColor(evt?.level)}`}>
                  {String(evt?.level || 'INFO').slice(0, 4).toUpperCase()}
                </span>
                <span className="text-[var(--ui-accent)]/90 w-24 shrink-0 truncate" title={moduleName}>
                  {moduleName}
                </span>
                <span className="text-[var(--ui-text)] flex-1 break-words min-w-0">
                  {formatLine(evt)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ActivityLogger;