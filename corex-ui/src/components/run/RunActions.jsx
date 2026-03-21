import React, { useState } from 'react';
import client from '../../api/client';
import { Loader2, Play, Square, RotateCw, ShieldX } from 'lucide-react';
import corexSwal from '../../utils/swal';

const RunActions = ({ strategy, onStatusChange, onNotify }) => {
  const [loading, setLoading] = useState(false);
  const { status, id: targetId, mode, timeframe, params: runtimeParams } = strategy;

  const isRunning = ['ACTIVE', 'WARMING_UP'].includes(status);
  const isStopping = status === 'STOPPING';
  const isError = status === 'ERROR';

  const handleAction = async (actionFn, successMsg, errorMsg) => {
    setLoading(true);
    try {
      const res = await actionFn();
      if (onNotify) onNotify({ type: 'success', message: res?.message || successMsg });
    } catch (err) {
      console.error(err);
      if (onNotify) onNotify({ type: 'error', message: err?.message || err?.details || errorMsg });
    } finally {
      setLoading(false);
      if (onStatusChange) onStatusChange();
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

  if (isError) {
    return (
        <div className="flex gap-2 mt-4 w-full">
            <button
                onClick={restartEngine}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-[var(--ui-panel)] text-[var(--ui-positive)] text-[10px] font-black rounded-lg border border-[var(--ui-border-strong)] hover:brightness-95 transition-all uppercase tracking-wider shadow-lg flex items-center justify-center gap-2"
            >
                <RotateCw size={12} />
                Restart
            </button>
            <button
                onClick={clearFault}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-[var(--ui-panel)] text-[var(--ui-negative)] text-[10px] font-black rounded-lg border border-[var(--ui-border-strong)] hover:brightness-95 transition-all uppercase tracking-wider shadow-lg flex items-center justify-center gap-2"
            >
                <ShieldX size={12} />
                Clear Fault
            </button>
      </div>
    );
  }

  return (
    <button
      onClick={toggleExecution}
      disabled={loading || isStopping}
      data-action-start={!isRunning ? targetId : undefined}
      data-action-stop={isRunning ? targetId : undefined}
      className={`flex-1 h-10 flex items-center justify-center gap-2 rounded-lg font-bold text-[11px] tracking-wider transition-all ${
        isRunning
          ? 'bg-gradient-to-r from-[var(--ui-negative)]/20 to-[var(--ui-negative)]/10 text-[var(--ui-negative)] border-2 border-[var(--ui-negative)]/40 hover:brightness-110 hover:scale-[1.02]'
          : 'bg-gradient-to-r from-[var(--ui-accent-strong)] to-[var(--ui-accent)] text-white hover:brightness-110 hover:scale-[1.02] shadow-lg'
      } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100`}
    >
      {loading ? (
        <Loader2 size={16} className="animate-spin" />
      ) : isRunning ? (
        <><Square size={12} fill="currentColor" /> STOP</>
      ) : (
        <><Play size={12} fill="currentColor" /> RUN</>
      )}
    </button>
  );
};

export default RunActions;
