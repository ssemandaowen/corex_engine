import React, { useEffect, useState } from 'react';
import client from "../../api/client";
import { Play, Square, Activity, Cpu, ShieldAlert, Timer, Radio, Settings, Zap } from "lucide-react";
import SettingsModal from './SettingsModal';

const StrategyRuntime = ({ strategy, onStatusChange, onNotify }) => {
  const [loading, setLoading] = useState(false);
  const [timeframe, setTimeframe] = useState(strategy.timeframe || '1m');
  const [mode, setMode] = useState((strategy.mode || 'PAPER').toUpperCase());
  const [runtimeParams, setRuntimeParams] = useState(strategy.params || {});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const hasSchema = strategy?.schema && Object.keys(strategy.schema).length > 0;

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
      <div className={`group relative bg-[#0B0F16] border transition-all duration-300 rounded-xl overflow-hidden ${
        isRunning ? 'border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.1)]' : 'border-slate-800'
      }`}>
        
        {/* Status Line Indicator */}
        <div className={`h-0.5 w-full transition-colors duration-500 ${
          isRunning ? 'bg-blue-500 animate-pulse' : 'bg-slate-700'
        }`} />

        <div className="p-4">
          {/* Header Area */}
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg transition-colors ${
                isRunning ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-800/50 text-slate-500'
              }`}>
                <Cpu size={18} />
              </div>
              <div>
                <h3 className="text-[11px] font-black text-slate-100 font-mono tracking-wider uppercase leading-none mb-1">
                  {targetId}
                </h3>
                <div className="flex items-center gap-1.5">
                  <span className={`relative flex h-1.5 w-1.5`}>
                    {isRunning && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isRunning ? 'bg-green-500' : 'bg-slate-600'}`}></span>
                  </span>
                  <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono">
                    {strategy.status || 'OFFLINE'}
                  </span>
                </div>
              </div>
            </div>

            {hasSchema && (
              <button 
                onClick={() => setIsModalOpen(true)}
                className="p-1.5 text-slate-600 hover:text-white hover:bg-white/5 rounded-md transition-all"
              >
                <Settings size={14} />
              </button>
            )}
          </div>

          {/* Telemetry Grid */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-black/40 border border-slate-800/50 p-2 rounded-md">
              <span className="text-[8px] text-slate-600 font-black uppercase block mb-1 tracking-tighter">Uptime</span>
              <span className="text-[10px] font-mono text-slate-300 tabular-nums">
                {formatUptime(strategy.uptime)}
              </span>
            </div>
            <div className="bg-black/40 border border-slate-800/50 p-2 rounded-md">
              <span className="text-[8px] text-slate-600 font-black uppercase block mb-1 tracking-tighter">Resolution</span>
              <div className="flex items-center gap-1">
                <Timer size={10} className="text-blue-500/50" />
                <span className="text-[10px] font-mono text-slate-300 uppercase">
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
                  className="w-20 h-8 bg-slate-900 border border-slate-700 text-slate-400 text-[10px] font-bold px-1 rounded hover:border-slate-500 transition-colors outline-none cursor-pointer font-mono"
                >
                  {['PAPER', 'LIVE'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select 
                  value={timeframe} 
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-16 h-8 bg-slate-900 border border-slate-700 text-slate-400 text-[10px] font-bold px-1 rounded hover:border-slate-500 transition-colors outline-none cursor-pointer font-mono"
                >
                  {['1m', '5m', '15m', '1h', '4h', '1d'].map(tf => (
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
                ? "bg-rose-500/10 text-rose-500 border border-rose-500/30 hover:bg-rose-500 hover:text-white" 
                : "bg-blue-600 text-white hover:bg-blue-500 shadow-[0_4px_12px_rgba(37,99,235,0.2)]"
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
        </div>

        {/* Failure Overlay */}
        {strategy.status === 'ERROR' && (
          <div className="absolute inset-0 bg-rose-950/95 flex flex-col items-center justify-center p-4 text-center backdrop-blur-md z-10 border border-rose-500">
            <ShieldAlert size={20} className="text-rose-500 mb-2" />
            <span className="text-[10px] font-black text-white uppercase tracking-widest">Logic Failure</span>
            <p className="text-[9px] text-rose-200 mt-1 font-mono leading-tight max-w-[80%] uppercase">
              {strategy.reason || 'SIGABRT: Execution Error'}
            </p>
            <button 
              onClick={() => client.post(`/run/stop/${targetId}`).then(onStatusChange)} 
              className="mt-4 px-3 py-1 bg-white text-rose-950 text-[9px] font-black rounded hover:bg-rose-100 transition-colors"
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
