import React, { useState } from 'react';
import client from "../../api/client";
import { Play, Square, Activity, Cpu, ShieldAlert, Timer, Radio, Settings } from "lucide-react";
import SettingsModal from './SettingsModal';

const StrategyRuntime = ({ strategy, onStatusChange, onNotify }) => {
  const [loading, setLoading] = useState(false);
  const [timeframe, setTimeframe] = useState(strategy.timeframe || '1m');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const targetId = strategy.id || strategy.name;
  const isRunning = ['ACTIVE', 'WARMING_UP', 'STOPPING'].includes(strategy.status);
  
  // Calculate Uptime (if provided by StrategyLoader)
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
        onNotify?.({ type: 'success', message: `${targetId} stopped.` });
      } else {
        await client.post(`/run/start/${targetId}`, { mode: 'PAPER', timeframe });
        onNotify?.({ type: 'success', message: `${targetId} deployed in paper mode.` });
      }
    } catch (err) {
      console.error("Execution Signal Failed", err);
      onNotify?.({ type: 'error', message: `Action failed for ${targetId}.` });
    } finally {
      setLoading(false);
      if (onStatusChange) onStatusChange();
    }
  };

  const handleSaveSettings = async (params) => {
    try {
      await client.patch(`/run/params/${targetId}`, { params });
      onNotify?.({ type: 'success', message: `Settings saved for ${targetId}.` });
    } catch (err) {
      console.error("Save settings failed", err);
      onNotify?.({ type: 'error', message: `Settings save failed for ${targetId}.` });
    } finally {
      if (onStatusChange) onStatusChange();
    }
  };

  const handleRestoreDefaults = async () => {
    try {
      const res = await client.post(`/run/params/${targetId}/reset`);
      onNotify?.({ type: 'success', message: `Defaults restored for ${targetId}.` });
      if (onStatusChange) onStatusChange();
      return res.payload;
    } catch (err) {
      console.error("Restore defaults failed", err);
      onNotify?.({ type: 'error', message: `Defaults restore failed for ${targetId}.` });
      if (onStatusChange) onStatusChange();
      return null;
    }
  };
  const handleReset = async () => {
    try {
      await client.post(`/run/stop/${targetId}`);
      onNotify?.({ type: 'success', message: `${targetId} reset.` });
    } catch (err) {
      console.error("Reset failed", err);
      onNotify?.({ type: 'error', message: `Reset failed for ${targetId}.` });
    } finally {
      if (onStatusChange) onStatusChange();
    }
  };

  return (
    <>
      <div className={`group relative bg-[#0B0F16] border ${isRunning ? 'border-blue-500/30' : 'border-slate-800'} rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_24px_rgba(0,0,0,0.55)]`}>
        
        {/* 1. STATUS GLOW HEADER */}
        <div className={`h-1 w-full rounded-t-lg ${isRunning ? 'bg-blue-500 shadow-[0_0_10px_#3b82f6]' : 'bg-slate-700'}`} />

        <div className="p-5">
          <div className="flex justify-between items-start mb-5">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-md ${isRunning ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-800 text-slate-500'}`}>
                <Cpu size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100 font-mono tracking-tight uppercase">{targetId}</h3>
                <div className="flex items-center gap-2">
                  <Radio size={10} className={isRunning ? "text-green-500" : "text-slate-600"} />
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                    {strategy.status || 'STAGED'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3">
                <div className="text-right">
                    <span className="text-[9px] text-slate-600 font-black uppercase block">Uptime</span>
                    <span className="text-xs font-mono text-slate-300">{formatUptime(strategy.uptime)}</span>
                </div>
                <button onClick={() => setIsModalOpen(true)} className="text-slate-600 hover:text-white transition-colors">
                    <Settings size={16} />
                </button>
            </div>
          </div>

          {/* 2. RUNTIME TELEMETRY GRID */}
          <div className="bg-black/40 border border-slate-800/50 px-3 py-2 rounded-lg flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Timer size={12} className="text-slate-600" />
              <span className="text-[10px] text-slate-500">Timeframe</span>
            </div>
            <span className="text-[10px] font-bold text-slate-300">{strategy.timeframe || timeframe}</span>
          </div>

          {/* 3. CONTROL ACTION */}
          <div className="flex items-stretch gap-2">
            {!isRunning && (
              <select 
                value={timeframe} 
                onChange={(e) => setTimeframe(e.target.value)}
                className="flex-1 h-9 bg-slate-900 border border-slate-700 text-slate-400 text-[10px] font-bold px-2 rounded-md hover:border-slate-500 transition-colors outline-none"
              >
                <option value="1m">1m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
                <option value="4h">4h</option>
                <option value="1d">1d</option>
              </select>
            )}

            <button
              onClick={toggleExecution}
              disabled={loading}
              className={`flex-[2] h-9 flex items-center justify-center gap-2 rounded-md font-black text-[11px] transition-all ${
                isRunning 
                ? "bg-red-500/10 text-red-500 border border-red-500/40 hover:bg-red-500 hover:text-white" 
                : "bg-blue-600 text-white hover:bg-blue-500"
              }`}
            >
              {loading ? (
                <Activity size={14} className="animate-spin" />
              ) : isRunning ? (
                <><Square size={12} fill="currentColor" /> STOP ENGINE</>
              ) : (
                <><Play size={12} fill="currentColor" /> DEPLOY LOGIC</>
              )}
            </button>
          </div>
        </div>

        {/* 4. ERROR OVERLAY */}
        {strategy.status === 'ERROR' && (
          <div className="absolute inset-0 bg-red-950/90 flex flex-col items-center justify-center p-4 rounded-lg text-center backdrop-blur-sm border border-red-500">
            <ShieldAlert size={24} className="text-red-500 mb-2" />
            <span className="text-xs font-bold text-white uppercase tracking-tighter">Engine Failure</span>
            <p className="text-[10px] text-red-200 mt-1 line-clamp-2">{strategy.reason || 'Handover Failed'}</p>
            <button 
              onClick={handleReset} 
              className="mt-3 text-[9px] font-bold underline text-white"
            >
              RESET PROCESS
            </button>
          </div>
        )}
      </div>
      <SettingsModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        strategy={strategy}
        onSave={handleSaveSettings}
        onRestoreDefaults={handleRestoreDefaults}
      />
    </>
  );
};

export default StrategyRuntime;
