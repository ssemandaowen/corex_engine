import React, { useMemo, useState, useRef, useEffect } from 'react';
import client from "../../api/client";
import { Cpu, ShieldAlert, Settings, Play, Pause, MoreVertical, RotateCw, ShieldX } from "lucide-react";
import SettingsModal from './SettingsModal';
import RunActions from './RunActions';
import DatasetInfo from './DatasetInfo';
import corexSwal from '../../utils/swal';

const RunCard = ({ strategy = {}, runConfig, onStatusChange, onNotify }) => {
  const [timeframe, setTimeframe] = useState(strategy.timeframe || '1m');
  const [mode, setMode] = useState((strategy.mode || 'PAPER').toUpperCase());
  const [runtimeParams, setRuntimeParams] = useState(() => ({ ...(strategy.params || {}) }));

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const menuRef = useRef(null);
  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMenuOpen]);

  const hasSchema = Boolean(strategy?.schema && Object.keys(strategy.schema).length > 0);
  const modeOptions = useMemo(() => {
    const list = Array.isArray(runConfig?.modes) && runConfig.modes.length > 0 ? runConfig.modes : ['PAPER', 'LIVE'];
    const normalized = list.map((m) => String(m).toUpperCase());
    return normalized.includes(mode) ? normalized : [...normalized, mode];
  }, [runConfig, mode]);
  const timeframeOptions = useMemo(() => {
    const list = Array.isArray(runConfig?.timeframes) && runConfig.timeframes.length > 0
      ? runConfig.timeframes
      : ['1m', '5m', '15m', '1h', '4h', '1d'];
    return list.includes(timeframe) ? list : [...list, timeframe];
  }, [runConfig, timeframe]);

  const targetId = strategy.id || strategy.name;
  const hasTargetId = Boolean(targetId);
  const isRunning = ['ACTIVE', 'WARMING_UP'].includes(strategy.status);
  const isStopping = strategy.status === 'STOPPING';

  const formatUptime = (ms) => {
    if (!ms) return '00:00:00';
    const sec = Math.floor((ms / 1000) % 60);
    const min = Math.floor((ms / (1000 * 60)) % 60);
    const hrs = Math.floor(ms / (1000 * 60 * 60));
    return `${hrs.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const handleAction = async (actionFn, successMsg, errorMsg) => {
    setIsLoading(true);
    try {
      const res = await actionFn();
      if (onNotify) onNotify({ type: 'success', message: res?.message || successMsg });
      onStatusChange?.();
    } catch (err) {
      console.error(err);
      if (onNotify) onNotify({ type: 'error', message: err?.message || err?.details || errorMsg });
    } finally {
      setIsLoading(false);
      setIsMenuOpen(false);
    }
  };

  const toggleExecution = async () => {
    if (!targetId) return;
    const normalizedMode = String(mode || 'PAPER').toUpperCase();
    if (!isRunning && normalizedMode === 'LIVE') {
      const confirmation = await corexSwal({
        title: 'Deploy Live Strategy?',
        text: `LIVE MODE: deploy ${targetId} to the live broker?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Deploy Live',
        cancelButtonText: 'Cancel'
      });
      if (!confirmation.isConfirmed) return;
    }
    const action = isRunning
      ? () => client.post(`/run/stop/${targetId}`)
      : () => client.post(`/run/start/${targetId}`, { mode, timeframe, params: runtimeParams });
    const success = isRunning ? `Stop signal sent to ${targetId}` : `${targetId} run initiated`;
    const error = `Kernel Fault: ${targetId}`;
    handleAction(action, success, error);
  };

  const restartEngine = () => {
    if (!targetId) return;
    handleAction(
      () => client.post(`/run/restart/${targetId}`),
      `SIGRST sent to ${targetId}`,
      `Restart failed for ${targetId}`
    );
  };

  const clearFault = () => {
    handleAction(
      () => client.post(`/run/stop/${targetId}`),
      `Fault cleared for ${targetId}`,
      `Failed to clear fault for ${targetId}`
    );
  };

  const actionStrategyProps = {
      ...strategy,
      id: targetId,
      mode,
      timeframe,
      params: runtimeParams
  };

  return (
    <>
      <div className={`group relative flex items-center gap-3 bg-[var(--ui-panel)] border transition-all duration-300 rounded-lg px-4 py-3 text-sm ${
        isRunning 
          ? 'border-[var(--ui-accent)]/50 shadow-[0_0_15px_rgba(79,140,255,0.08)]'
          : 'border-[var(--ui-border)] hover:border-[var(--ui-border-strong)]'
      }`}>
        
        {/* Col 1: Status + Name (200px min) */}
        <div className="flex items-center gap-2.5 min-w-[180px] flex-shrink-0">
          <div className={`p-1.5 rounded-lg shrink-0 ${
            isRunning 
              ? 'bg-[var(--ui-accent)]/15 text-[var(--ui-accent)]'
              : 'bg-[var(--ui-panel-strong)] text-[var(--ui-muted)]'
          }`}>
            <Cpu size={14} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-[var(--ui-text)] truncate text-xs font-mono">
              {targetId || 'UNASSIGNED'}
            </div>
            <div className="flex items-center gap-1">
              <span className={`relative flex h-1 w-1`}>
                {isRunning && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--ui-positive)] opacity-75"></span>
                )}
                <span className={`relative inline-flex rounded-full h-1 w-1 ${
                  isRunning ? 'bg-[var(--ui-positive)]' : 'bg-[var(--ui-subtle)]'
                }`}></span>
              </span>
              <span className={`text-[8px] font-bold uppercase tracking-wide font-mono ${
                isRunning ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-muted)]'
              }`}>
                {strategy.status || 'OFFLINE'}
              </span>
            </div>
          </div>
        </div>

        {/* Col 2: Metrics (Uptime, P&L, Equity, Symbols) */}
        <div className="flex items-center gap-4 flex-1 min-w-0 px-2">
          {/* Uptime */}
          <div className="text-center shrink-0">
            <div className="text-[8px] text-[var(--ui-muted)] font-bold uppercase mb-0.5">Uptime</div>
            <span className="text-[11px] font-mono text-[var(--ui-text)] font-semibold">
              {formatUptime(strategy.uptime)}
            </span>
          </div>

          {/* P&L */}
          {strategy.pnl !== undefined && (
            <div className="text-center shrink-0">
              <div className="text-[8px] text-[var(--ui-muted)] font-bold uppercase mb-0.5">P&L</div>
              <span className={`text-[11px] font-mono font-semibold ${
                Number(strategy.pnl) >= 0 ? 'text-[var(--ui-positive)]' : 'text-[var(--ui-negative)]'
              }`}>
                {Number(strategy.pnl).toFixed(1)}
              </span>
            </div>
          )}

          {/* Equity */}
          {strategy.equity !== undefined && (
            <div className="text-center shrink-0">
              <div className="text-[8px] text-[var(--ui-muted)] font-bold uppercase mb-0.5">EQ</div>
              <span className="text-[11px] font-mono text-[var(--ui-text)] font-semibold">
                ${Number(strategy.equity).toFixed(0)}
              </span>
            </div>
          )}

          {/* Symbols */}
          <div className="text-center shrink-0">
            <div className="text-[8px] text-[var(--ui-muted)] font-bold uppercase mb-0.5">SYM</div>
            <span className="text-[11px] font-mono text-[var(--ui-text)] font-semibold">
              {(strategy.symbols || []).length}
            </span>
          </div>
        </div>

        {/* Col 3: Mode */}
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          disabled={isRunning || !hasTargetId}
          className="h-7 px-2 bg-[var(--ui-input-bg)] border border-[var(--ui-border)] text-[var(--ui-text)] text-[10px] font-bold rounded transition-all outline-none cursor-pointer font-mono hover:border-[var(--ui-border-strong)] focus:border-[var(--ui-accent)] focus:ring-1 focus:ring-[var(--ui-accent)]/30 disabled:opacity-50 shrink-0"
        >
          {modeOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {/* Col 4: Timeframe */}
        <select 
          value={timeframe} 
          onChange={(e) => setTimeframe(e.target.value)}
          disabled={isRunning || !hasTargetId}
          className="h-7 px-2 bg-[var(--ui-input-bg)] border border-[var(--ui-border)] text-[var(--ui-text)] text-[10px] font-bold rounded transition-all outline-none cursor-pointer font-mono hover:border-[var(--ui-border-strong)] focus:border-[var(--ui-accent)] focus:ring-1 focus:ring-[var(--ui-accent)]/30 disabled:opacity-50 shrink-0"
        >
          {timeframeOptions.map(tf => (
            <option key={tf} value={tf}>{tf}</option>
          ))}
        </select>

        {/* Col 5: Controls */}
        <div className="flex items-center gap-2 shrink-0 relative" ref={menuRef}>
          {/* Play/Pause Icon - Primary Action */}
          {hasTargetId ? (
            <button
              onClick={toggleExecution}
              disabled={isLoading || isStopping}
              className={`p-1.5 rounded transition-all ${
                isRunning
                  ? 'text-[var(--ui-negative)] hover:text-[var(--ui-warning)] hover:bg-[var(--ui-warning)]/10'
                  : 'text-[var(--ui-muted)] hover:text-[var(--ui-accent)] hover:bg-[var(--ui-accent)]/10'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={isRunning ? 'Stop Strategy' : 'Start Strategy'}
            >
              {isRunning ? (
                <Pause size={14} fill="currentColor" />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
            </button>
          ) : (
            <div className="text-[8px] text-[var(--ui-negative)] font-bold">—</div>
          )}

          {/* Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            disabled={isLoading || !hasTargetId}
            className="p-1 text-[var(--ui-muted)] hover:text-[var(--ui-text)] hover:bg-[var(--ui-row-hover)] rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="More Options"
          >
            <MoreVertical size={14} />
          </button>

          {/* Vertical Popup Menu */}
          {isMenuOpen && hasTargetId && (
            <div className="absolute right-0 top-full mt-1 bg-[var(--ui-panel)] border border-[var(--ui-border)] rounded-lg shadow-lg z-50 min-w-[160px] overflow-hidden">
              {/* Settings Option */}
              {hasSchema && (
                <button
                  onClick={() => {
                    setIsModalOpen(true);
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-[11px] font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-row-hover)] transition-all flex items-center gap-2 border-b border-[var(--ui-border)]"
                >
                  <Settings size={12} />
                  Settings
                </button>
              )}

              {/* Start/Stop Option */}
              <button
                onClick={toggleExecution}
                disabled={isLoading || isStopping}
                className="w-full px-3 py-2 text-left text-[11px] font-semibold hover:bg-[var(--ui-row-hover)] transition-all flex items-center gap-2 border-b border-[var(--ui-border)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRunning ? (
                  <>
                    <Pause size={12} />
                    <span className="text-[var(--ui-negative)]">Stop</span>
                  </>
                ) : (
                  <>
                    <Play size={12} />
                    <span className="text-[var(--ui-accent)]">Start</span>
                  </>
                )}
              </button>

              {/* Restart Option */}
              {isRunning && (
                <button
                  onClick={restartEngine}
                  disabled={isLoading}
                  className="w-full px-3 py-2 text-left text-[11px] font-semibold text-[var(--ui-positive)] hover:bg-[var(--ui-row-hover)] transition-all flex items-center gap-2 border-b border-[var(--ui-border)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCw size={12} />
                  Restart
                </button>
              )}

              {/* Clear Fault Option (for error state) */}
              {strategy.status === 'ERROR' && (
                <button
                  onClick={clearFault}
                  disabled={isLoading}
                  className="w-full px-3 py-2 text-left text-[11px] font-semibold text-[var(--ui-negative)] hover:bg-[var(--ui-row-hover)] transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ShieldX size={12} />
                  Clear Fault
                </button>
              )}
            </div>
          )}
        </div>

        {/* Failure Overlay */}
        {strategy.status === 'ERROR' && (
          <div className="absolute inset-0 flex items-center justify-between px-4 backdrop-blur-lg z-10 bg-[var(--ui-negative)]/95 rounded-lg border-2 border-[var(--ui-negative)]">
            <div className="flex items-center gap-2">
              <ShieldAlert size={16} className="text-white shrink-0" />
              <div className="text-left">
                <span className="text-[9px] font-black text-white uppercase tracking-widest block">Error</span>
                <p className="text-[8px] text-white/90 font-mono max-w-[300px] line-clamp-1">
                  {strategy.reason || 'Execution Error'}
                </p>
              </div>
            </div>
            <RunActions
              strategy={actionStrategyProps}
              runConfig={runConfig}
              onStatusChange={onStatusChange}
              onNotify={onNotify}
            />
          </div>
        )}
      </div>

      <SettingsModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        strategy={{ ...strategy, params: runtimeParams }}
        onSave={async (params) => {
          if (!hasTargetId) {
            onNotify?.({ type: 'error', message: 'Missing strategy id' });
            return;
          }
          const nextParams = { ...(params || {}) };
          setRuntimeParams(nextParams);
          await client.patch(`/run/params/${targetId}`, { params: nextParams });
          onNotify?.({ type: 'success', message: 'Parameters committed' });
          onStatusChange?.();
        }}
        onRestoreDefaults={async () => {
          if (!hasTargetId) {
            onNotify?.({ type: 'error', message: 'Missing strategy id' });
            return {};
          }
          const res = await client.post(`/run/params/${targetId}/reset`);
          const nextParams = { ...(res.payload || {}) };
          setRuntimeParams(nextParams);
          onNotify?.({ type: 'success', message: 'Environment Reset' });
          onStatusChange?.();
          return nextParams;
        }}
      />
    </>
  );
};

export default RunCard;
