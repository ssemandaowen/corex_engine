import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useStore } from "../../store/useStore";
import { X, Trash2, Pause, Play, Copy, Download, Search, WrapText, Clock, ChevronDown } from "lucide-react";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function fmtTs(ts) {
  const t = Number(ts || 0);
  if (!Number.isFinite(t) || t <= 0) return "--:--:--";
  return new Date(t).toLocaleTimeString([], { hour12: false });
}

function levelColor(level) {
  const l = String(level || "").toLowerCase();
  if (l === "error") return "text-[var(--ui-negative)]";
  if (l === "warn" || l === "warning") return "text-[var(--ui-warning)]";
  return "text-[var(--ui-muted)]";
}

function normalizeStrategyKey(strategyId) {
  const raw = String(strategyId || "").trim();
  if (!raw) return "";
  const parts = raw.split("::");
  return parts.length >= 2 ? parts[parts.length - 1] : raw;
}

const LEVEL_META = {
  info:  { label: "INFO",  activeClass: "text-[var(--ui-accent)]  bg-[color:color-mix(in_srgb,var(--ui-accent)_14%,transparent)]  border-[var(--ui-accent)]/30"  },
  warn:  { label: "WARN",  activeClass: "text-[var(--ui-warning)] bg-[color:color-mix(in_srgb,var(--ui-warning)_14%,transparent)] border-[var(--ui-warning)]/30" },
  error: { label: "ERR",   activeClass: "text-[var(--ui-negative)] bg-[color:color-mix(in_srgb,var(--ui-negative)_12%,transparent)] border-[var(--ui-negative)]/30" },
};

export default function StrategyTerminal({ strategyId }) {
  const stratTerminalById   = useStore((s) => s.stratTerminalById);
  const clearTerminal        = useStore((s) => s.clearTerminal);
  const setStrategyTerminalOpen = useStore((s) => s.setStrategyTerminalOpen);

  const key = normalizeStrategyKey(strategyId);

  const entries = useMemo(() => {
    const byId = stratTerminalById && typeof stratTerminalById === "object" ? stratTerminalById : {};
    return Array.isArray(byId[key]) ? byId[key] : [];
  }, [stratTerminalById, key]);

  /* ── ui state ── */
  const [paused,    setPaused]    = useState(false);
  const [height,    setHeight]    = useState(280);
  const [search,    setSearch]    = useState("");
  const [levels,    setLevels]    = useState({ info: true, warn: true, error: true });
  const [wrapLines, setWrapLines] = useState(true);
  const [showTime,  setShowTime]  = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  /* ── refs ── */
  const bodyRef  = useRef(null);
  const dragRef  = useRef({ active: false, startY: 0, startH: 280 });
 // const userScrollRef = useRef(false); // true while user is manually scrolling

  /* ── filtered entries ── */
  const filtered = useMemo(() => {
    const q    = String(search || "").trim().toLowerCase();
    const want = new Set(Object.entries(levels).filter(([, on]) => on).map(([k]) => k));
    return entries.filter((e) => {
      const lvl = String(e?.level || "info").toLowerCase();
      if (!want.has(lvl)) return false;
      if (!q) return true;
      return (
        String(e?.message || "").toLowerCase().includes(q) ||
        String(e?.module  || "").toLowerCase().includes(q)
      );
    });
  }, [entries, search, levels]);

  /* ── export text ── */
  const exportText = useMemo(() =>
    filtered.slice(0, 800)
      .map((e) => `[${fmtTs(e.ts)}] ${String(e.level || "info").toUpperCase().padEnd(5)} ${e.module || "STRATEGY"}: ${e.message}`)
      .join("\n"),
  [filtered]);

  /* ── summary counts ── */
  const summary = useMemo(() => {
    const s = { total: entries.length, info: 0, warn: 0, error: 0 };
    entries.forEach((e) => {
      const l = String(e?.level || "info").toLowerCase();
      if      (l === "error")                s.error += 1;
      else if (l === "warn" || l === "warning") s.warn += 1;
      else                                    s.info  += 1;
    });
    return s;
  }, [entries]);

  /* ── auto-scroll: scroll to bottom when new entries arrive ── */
  useEffect(() => {
    if (paused || !autoScroll || !bodyRef.current) return;
    const el = bodyRef.current;
    // newest entries are appended at bottom
    el.scrollTop = el.scrollHeight;
  }, [paused, autoScroll, entries.length]);

  /* ── detect manual scroll → disable auto-scroll; re-enable at bottom ── */
  const handleScroll = useCallback(() => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  /* ── drag-to-resize (drag handle sits at the TOP of the panel) ── */
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.active) return;
      const dy = dragRef.current.startY - e.clientY; // drag up = bigger
      setHeight(clamp(dragRef.current.startH + dy, 160, 700));
    };
    const onUp = () => { dragRef.current.active = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []);

  if (!key) return null;

  return (
    <div className="ui-terminal flex flex-col" style={{ height }}>

      {/* ── Drag handle (top edge) ── */}
      <div
        className="h-1.5 shrink-0 cursor-row-resize relative group bg-[var(--ui-border)] hover:bg-[var(--ui-accent)]/40 transition-colors"
        onMouseDown={(e) => {
          dragRef.current.active  = true;
          dragRef.current.startY  = e.clientY;
          dragRef.current.startH  = height;
        }}
      >
        <div className="absolute inset-x-1/2 -translate-x-1/2 top-0 w-10 h-full flex items-center justify-center pointer-events-none">
          <div className="w-8 h-0.5 rounded-full bg-[var(--ui-accent)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      {/* ── Header row ── */}
      <div className="shrink-0 px-3 h-9 border-b border-[var(--ui-border)] bg-[var(--ui-panel-strong)] flex items-center justify-between gap-2">

        {/* left: title + key badge + live/paused pill */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-black tracking-widest text-[var(--ui-text)] uppercase whitespace-nowrap">
            Strategy Console
          </span>
          <span className="text-[10px] font-mono text-[var(--ui-subtle)] truncate max-w-[120px]" title={key}>
            {key}
          </span>
          <span className={`ui-log-chip shrink-0 ${paused ? "ui-log-chip-active" : ""}`}>
            {paused ? "PAUSED" : "LIVE"}
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

        {/* right: action buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => navigator.clipboard?.writeText(exportText)} title="Copy log" className="icon-btn">
            <Copy size={13} />
          </button>
          <button
            title="Download log"
            className="icon-btn"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([exportText], { type: "text/plain" }));
              Object.assign(document.createElement("a"), { href: url, download: `${key}.log` }).click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={13} />
          </button>
          <button onClick={() => setPaused((v) => !v)} title={paused ? "Resume" : "Pause"} className="icon-btn">
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button
            onClick={() => clearTerminal({ tab: "strategy", strategyId: key })}
            title="Clear"
            className="icon-btn text-[var(--ui-negative)] hover:text-[var(--ui-negative)]"
          >
            <Trash2 size={13} />
          </button>
          <button onClick={() => setStrategyTerminalOpen(key, false)} title="Close" className="icon-btn">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Toolbar: counts + level filters + search + toggles (one line) ── */}
      <div className="shrink-0 px-3 h-8 border-b border-[var(--ui-border)] bg-[var(--ui-panel)] flex items-center gap-3">

        {/* count badges */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="ui-log-chip">T {summary.total}</span>
          <span className="ui-log-chip">I {summary.info}</span>
          <span className="ui-log-chip text-[var(--ui-warning)]">W {summary.warn}</span>
          <span className="ui-log-chip text-[var(--ui-negative)]">E {summary.error}</span>
        </div>

        <div className="w-px h-4 bg-[var(--ui-border)] shrink-0" />

        {/* level toggles */}
        <div className="flex items-center gap-1 shrink-0">
          {(["info", "warn", "error"] ).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevels((s) => ({ ...s, [lvl]: !s[lvl] }))}
              className={`mini-chip px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                levels[lvl]
                  ? LEVEL_META[lvl].activeClass
                  : "text-[var(--ui-muted)] border-[var(--ui-border)] hover:text-[var(--ui-text)]"
              }`}
            >
              {LEVEL_META[lvl].label}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-[var(--ui-border)] shrink-0" />

        {/* search */}
        <div className="relative flex-1 min-w-0">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--ui-subtle)] pointer-events-none" />
          <input
            className="ui-input text-[11px] font-mono w-full pl-6 h-6"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search module / message…"
          />
        </div>

        {/* icon toggles */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setWrapLines((v) => !v)}
            title={wrapLines ? "Disable line wrap" : "Enable line wrap"}
            className={`icon-btn ${wrapLines ? "text-[var(--ui-accent)]" : "text-[var(--ui-muted)]"}`}
          >
            <WrapText size={13} />
          </button>
          <button
            onClick={() => setShowTime((v) => !v)}
            title={showTime ? "Hide timestamps" : "Show timestamps"}
            className={`icon-btn ${showTime ? "text-[var(--ui-accent)]" : "text-[var(--ui-muted)]"}`}
          >
            <Clock size={13} />
          </button>
        </div>

        {/* visible count */}
        <span className="text-[10px] text-[var(--ui-subtle)] shrink-0 tabular-nums">
          {filtered.length}/{entries.length}
        </span>
      </div>

      {/* ── Log body ── */}
      <div
        ref={bodyRef}
        onScroll={handleScroll}
        className="ui-terminal-body flex-1 overflow-auto font-mono text-[11.5px] leading-5 px-3 py-2"
      >
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-60 select-none">
            <div className="text-[10px] uppercase tracking-[0.4em] font-bold mb-1 text-[var(--ui-muted)]">No logs yet</div>
            <div className="text-[11px] text-[var(--ui-subtle)]">Waiting for {key}…</div>
          </div>
        ) : (
          <div className={wrapLines ? "" : "whitespace-pre"}>
            {filtered.slice(0, 500).map((e, idx) => (
              <div
                key={`${e.ts || 0}_${idx}`}
                className="ui-log-row flex gap-2 py-0.5 hover:bg-[var(--ui-hover-light)]"
              >
                {showTime && (
                  <span className="text-[var(--ui-subtle)] tabular-nums shrink-0 w-[5.5rem] text-right select-none">
                    {fmtTs(e.ts)}
                  </span>
                )}
                <span className={`font-bold w-10 shrink-0 ${levelColor(e.level)}`}>
                  {String(e.level || "INFO").slice(0, 4).toUpperCase()}
                </span>
                <span className="text-[var(--ui-accent)]/90 w-24 shrink-0 truncate" title={e.module}>
                  {e.module || "STRATEGY"}
                </span>
                <span className="text-[var(--ui-text)] flex-1 break-words min-w-0">
                  {e.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}