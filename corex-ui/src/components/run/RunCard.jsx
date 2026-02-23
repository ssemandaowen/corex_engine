import React, { useEffect, useMemo, useState } from 'react';
import client from "../../api/client";
import { Play, Square, Activity, Cpu, ShieldAlert, Timer, Radio, Settings, Zap } from "lucide-react";
import SettingsModal from './SettingsModal';

const StrategyRuntime = ({ strategy, runConfig, onStatusChange, onNotify }) => {
  const [loading, setLoading] = useState(false);
  const [timeframe, setTimeframe] = useState(strategy.timeframe || '1m');
  const [mode, setMode] = useState((strategy.mode || 'PAPER').toUpperCase());
  const [runtimeParams, setRuntimeParams] = useState(strategy.params || {});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const hasSchema = strategy?.schema && Object.keys(strategy.schema).length > 0;
  const modeOptions = useMemo(() => {
    const list = Array.isArray(runConfig?.modes) && runConfig.modes.length > 0 ? runConfig.modes : ['PAPER', 'LIVE'];
    return list.map((m) => String(m).toUpperCase());
  }, [runConfig]);
  const timeframeOptions = useMemo(() => {
    return Array.isArray(runConfig?.timeframes) && runConfig.timeframes.length > 0
      ? runConfig.timeframes
      : ['1m', '5m', '15m', '1h', '4h', '1d'];
  }, [runConfig]);

  const targetId = strategy.id || strategy.name;
  const isRunning = ['ACTIVE', 'WARMING_UP'].includes(strategy.status);
  const isStopping = strategy.status === 'STOPPING';

  useEffect(() => {
    setTimeframe(strategy.timeframe || '1m');
    setMode((strategy.mode || 'PAPER').toUpperCase());
    setRuntimeParams(strategy.params || {});
  }, [strategy.timeframe, strategy.mode, strategy.params]);

  const formatUptime = (ms) => {
    if (!ms) return '00:00:00';
    const sec = Math.floor((ms / 1000) % 60);
    const min = Math.floor((ms / (1000 * 60)) % 60);
    const hrs = Math.floor((ms / (1000 * 60 * 60)) % 24);
    return `${hrs.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const toggleExecution = async () => {
    setLoading(true);
    try {
      if (isRunning) {
        await client.post(`/run/stop/${targetId}`);
        onNotify?.({ type: 'success', message: `SIGTERM sent to ${targetId}` });
      } else {
        await client.post(`/run/start/${targetId}`, {
          mode,
          timeframe,
          params: runtimeParams
        });
        onNotify?.({ type: 'success', message: `${targetId} lifecycle: START` });
      }
    } catch (err) {
      onNotify?.({ type: 'error', message: `Kernel Fault: ${targetId}` });
    } finally {
      setLoading(false);
      onStatusChange?.();
    }
  };

  return (
    <>
      <div className={`group relative bg-[var(--ui-panel-strong)] border transition-all duration-300 rounded-xl overflow-hidden ${
        isRunning ? 'border-[var(--ui-border-strong)] shadow-[0_0_20px_rgba(59,130,246,0.1)]' : 'border-[var(--ui-border)]'
      }`}>
        
        {/* Status Line Indicator */}
        <div className={`h-0.5 w-full transition-colors duration-500 ${
          isRunning ? 'bg-[var(--ui-accent)] animate-pulse' : 'bg-[var(--ui-border)]'
        }`} />

        <div className="p-4">
          {/* Header Area */}
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg transition-colors ${
                isRunning ? 'text-[var(--ui-accent)]' : 'bg-white/5 text-[var(--ui-muted)]'
              }`}>
                <Cpu size={18} />
              </div>
              <div>
                <h3 className="text-[11px] font-black text-[var(--ui-text)] font-mono tracking-wider uppercase leading-none mb-1">
                  {targetId}
                </h3>
                <div className="flex items-center gap-1.5">
                  <span className={`relative flex h-1.5 w-1.5`}>
                    {isRunning && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--ui-positive)] opacity-75"></span>}
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isRunning ? 'bg-[var(--ui-positive)]' : 'bg-[var(--ui-subtle)]'}`}></span>
                  </span>
                  <span className="text-[9px] text-[var(--ui-muted)] font-bold uppercase tracking-widest font-mono">
                    {strategy.status || 'OFFLINE'}
                  </span>
                </div>
              </div>
            </div>

            {hasSchema && (
              <button 
                onClick={() => setIsModalOpen(true)}
                className="p-1.5 text-[var(--ui-muted)] hover:text-[var(--ui-text)] hover:bg-[var(--ui-row-hover)] rounded-md transition-all"
              >
                <Settings size={14} />
              </button>
            )}
          </div>

          {/* Telemetry Grid */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-[var(--ui-panel)] border border-[var(--ui-border)] p-2 rounded-md">
              <span className="text-[8px] text-[var(--ui-muted)] font-black uppercase block mb-1 tracking-tighter">Uptime</span>
              <span className="text-[10px] font-mono text-[var(--ui-text)] tabular-nums">
                {formatUptime(strategy.uptime)}
              </span>
            </div>
            <div className="bg-[var(--ui-panel)] border border-[var(--ui-border)] p-2 rounded-md">
              <span className="text-[8px] text-[var(--ui-muted)] font-black uppercase block mb-1 tracking-tighter">Resolution</span>
              <div className="flex items-center gap-1">
                <Timer size={10} className="text-[var(--ui-accent)]" />
                <span className="text-[10px] font-mono text-[var(--ui-text)] uppercase">
                  {strategy.timeframe || timeframe}
                </span>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex gap-2">
            {!isRunning && (
              <>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="w-20 h-8 bg-[var(--ui-panel)] border border-[var(--ui-border)] text-[var(--ui-text)] text-[10px] font-bold px-1 rounded transition-colors outline-none cursor-pointer font-mono"
                >
                  {modeOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select 
                  value={timeframe} 
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-16 h-8 bg-[var(--ui-panel)] border border-[var(--ui-border)] text-[var(--ui-text)] text-[10px] font-bold px-1 rounded transition-colors outline-none cursor-pointer font-mono"
                >
                  {timeframeOptions.map(tf => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </>
            )}

            <button
              onClick={toggleExecution}
              disabled={loading || isStopping}
              className={`flex-1 h-8 flex items-center justify-center gap-2 rounded font-black text-[10px] tracking-widest transition-all ${
                isRunning 
                ? "bg-[color:color-mix(in_srgb,var(--ui-negative)_16%,transparent)] text-[var(--ui-negative)] border border-[color:color-mix(in_srgb,var(--ui-negative)_40%,transparent)] hover:brightness-110" 
                : "bg-[var(--ui-accent-strong)] text-white hover:brightness-110 shadow-[0_4px_12px_rgba(37,99,235,0.2)]"
              } disabled:opacity-50`}
            >
              {loading ? (
                <Activity size={14} className="animate-spin" />
              ) : isRunning ? (
                <><Square size={10} fill="currentColor" /> TERMINATE</>
              ) : (
                <><Zap size={10} fill="currentColor" /> DEPLOY</>
              )}
            </button>
          </div>
          <div className="mt-2 text-[9px] text-[var(--ui-muted)] font-mono">
            params:{Object.keys(strategy.params || {}).length} | symbols:{(strategy.symbols || []).length} | mode:{strategy.mode || mode}
          </div>
        </div>

        {/* Failure Overlay */}
        {strategy.status === 'ERROR' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center backdrop-blur-md z-10 border" style={{ backgroundColor: 'color-mix(in srgb, var(--ui-negative) 60%, #000)', borderColor: 'color-mix(in srgb, var(--ui-negative) 55%, transparent)' }}>
            <ShieldAlert size={20} className="text-[var(--ui-negative)] mb-2" />
            <span className="text-[10px] font-black text-white uppercase tracking-widest">Logic Failure</span>
            <p className="text-[9px] text-white/90 mt-1 font-mono leading-tight max-w-[80%] uppercase">
              {strategy.reason || 'SIGABRT: Execution Error'}
            </p>
            <button 
              onClick={() => client.post(`/run/stop/${targetId}`).then(onStatusChange)} 
              className="mt-4 px-3 py-1 bg-white text-[var(--ui-negative)] text-[9px] font-black rounded hover:brightness-95 transition-colors"
            >
              RESET ENGINE
            </button>
          </div>
        )}
      </div>

      <SettingsModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        strategy={{ ...strategy, params: runtimeParams }}
        onSave={async (params) => {
          setRuntimeParams(params || {});
          await client.patch(`/run/params/${targetId}`, { params });
          onNotify?.({ type: 'success', message: 'Parameters committed' });
          onStatusChange?.();
        }}
        onRestoreDefaults={async () => {
          const res = await client.post(`/run/params/${targetId}/reset`);
          setRuntimeParams(res.payload || {});
          onNotify?.({ type: 'success', message: 'Environment Reset' });
          onStatusChange?.();
          return res.payload;
        }}
      />
    </>
  );
};

export default StrategyRuntime;
