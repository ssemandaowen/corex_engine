import React, { useState, useEffect } from 'react';
import { useDataStore } from '../../store/dataStore';
import { useToast } from '../../context/ToastContext';
import { 
  ShieldCheck, 
  Unplug, 
  Plug, 
  DollarSign, 
  TrendingUp, 
  Compass, 
  Layers, 
  Activity, 
  Briefcase,
  RefreshCw
} from 'lucide-react';

export default function LiveBridgeSubTab() {
  const { showToast } = useToast();
  const { 
    mt5Status, 
    mt5Account, 
    mt5Positions, 
    latestTicks, 
    fetchMt5Status 
  } = useDataStore();

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Poll MT5 bridge status on mount & set interval for robust fallback syncing
  useEffect(() => {
    fetchMt5Status();
    const interval = setInterval(fetchMt5Status, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchMt5Status();
      showToast('MT5 bridge status synchronized with backend server', 'success');
    } catch (e) {
      showToast('Failed to refresh MT5 status', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const defaultSymbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];

  return (
    <div id="live-bridge-container" className="flex-1 flex flex-col md:flex-row min-h-0 overflow-y-auto p-4 gap-4 bg-[var(--ui-bg)]">
      
      {/* LEFT COLUMN: Connection controller */}
      <div className="w-full md:w-[380px] space-y-4 shrink-0">
        <div className="p-4 rounded-xl border bg-[var(--ui-panel)] relative" style={{ borderColor: 'var(--ui-border)' }}>
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--ui-border)]/50">
            <div className="flex items-center gap-1.5">
              <Compass size={13} style={{ color: 'var(--ui-accent)' }} />
              <span className="text-[10px] uppercase font-black tracking-widest" style={{ color: 'var(--ui-muted)' }}>
                BRIDGE STATUS
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="p-1 rounded hover:bg-[var(--ui-panel-soft)] text-[var(--ui-muted)] hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh Status"
              >
                <RefreshCw size={12} className={isRefreshing ? 'animate-spin text-[var(--ui-accent)]' : ''} />
              </button>

              <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border leading-none ${
                mt5Status === 'CONNECTED' 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : mt5Status === 'CONNECTING' 
                    ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
              }`}>
                {mt5Status}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span style={{ color: 'var(--ui-muted)' }}>ACCOUNT ID:</span>
              <span className="font-mono text-white font-bold">{mt5Account?.accountId || 'Not Configured'}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span style={{ color: 'var(--ui-muted)' }}>PLATFORM:</span>
              <span className="font-mono text-white">{mt5Account?.platform || 'MT5'}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span style={{ color: 'var(--ui-muted)' }}>SERVER:</span>
              <span className="font-mono text-white">{mt5Account?.server || 'None'}</span>
            </div>
          </div>

          <div className="mt-5 pt-3 border-t border-[var(--ui-border)]/50 text-center text-[10px]" style={{ color: 'var(--ui-muted)' }}>
            Configure and synchronize bridge connector credentials inside the <span className="text-[var(--ui-accent)] font-bold">Account</span> tab.
          </div>
        </div>

        {/* Live Broker Balance Account info card */}
        <div className="p-4 rounded-xl border bg-[var(--ui-panel)]" style={{ borderColor: 'var(--ui-border)' }}>
          <span className="text-[10px] uppercase font-black tracking-widest text-[var(--ui-muted)] block mb-3 border-b border-[var(--ui-border)]/50 pb-1.5">
            Equity margin stats
          </span>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col">
              <span className="text-[9px] uppercase tracking-wider text-[var(--ui-muted)] mb-1 leading-none">Broker Balance</span>
              <span className="text-sm font-mono font-bold text-white">
                {mt5Account?.balance !== undefined ? `$${Number(mt5Account.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '---'}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] uppercase tracking-wider text-[var(--ui-muted)] mb-1 leading-none">Account Equity</span>
              <span className="text-sm font-mono font-bold text-emerald-400">
                {mt5Account?.equity !== undefined ? `$${Number(mt5Account.equity).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '---'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Realtime ticks feed list */}
      <div className="flex-1 space-y-4">
        
        {/* Price ticks panel */}
        <div className="p-4 rounded-xl border bg-[var(--ui-panel)]" style={{ borderColor: 'var(--ui-border)' }}>
          <div className="flex items-center justify-between mb-3 border-b border-[var(--ui-border)]/50 pb-2">
            <div className="flex items-center gap-1.5">
              <Activity size={13} style={{ color: 'var(--ui-accent)' }} />
              <span className="text-[10px] uppercase font-black tracking-widest" style={{ color: 'var(--ui-muted)' }}>
                REALTIME TICK SYMBOLS FEED
              </span>
            </div>
            <span className="text-[9px] font-mono text-[var(--ui-muted)] italic">
              Live updates via WebSocket
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {defaultSymbols.map((symbol) => {
              const tick = latestTicks[symbol];
              return (
                <div 
                  key={symbol}
                  className="p-3 rounded-lg border border-[var(--ui-border)]/60 bg-[var(--ui-panel-soft)] font-mono text-center flex flex-col justify-between"
                >
                  <span className="text-[10px] font-bold text-[var(--ui-text)] mb-2 block">{symbol}</span>
                  <div className="flex justify-between items-center text-[10px] text-[var(--ui-muted)] mb-1">
                    <span>BID</span>
                    <span className="text-white font-bold">{tick ? tick.bid.toFixed(symbol === 'XAUUSD' ? 2 : 5) : '---'}</span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-[var(--ui-muted)]">
                    <span>ASK</span>
                    <span className="text-white font-bold">{tick ? tick.ask.toFixed(symbol === 'XAUUSD' ? 2 : 5) : '---'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Broker Orders list */}
        <div className="p-4 rounded-xl border bg-[var(--ui-panel)]" style={{ borderColor: 'var(--ui-border)' }}>
          <div className="flex items-center justify-between mb-3 border-b border-[var(--ui-border)]/50 pb-2">
            <div className="flex items-center gap-1.5">
              <Briefcase size={13} style={{ color: 'var(--ui-accent)' }} />
              <span className="text-[10px] uppercase font-black tracking-widest" style={{ color: 'var(--ui-muted)' }}>
                ACTIVE DEPLOYED MT5 ORDERS
              </span>
            </div>
            {mt5Positions.length > 0 && (
              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 bg-[var(--ui-accent)]/10 text-[var(--ui-accent)] border border-[var(--ui-accent)]/20 rounded">
                {mt5Positions.length} Deployed
              </span>
            )}
          </div>

          <div className="overflow-x-auto text-[11px]">
            {mt5Status === 'CONNECTED' && mt5Positions.length > 0 ? (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[var(--ui-border)] text-[var(--ui-muted)]">
                    <th className="py-2">Ticket #</th>
                    <th className="py-2">Symbol</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Volume</th>
                    <th className="py-2">Price</th>
                    <th className="py-2 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {mt5Positions.map((pos: any) => (
                    <tr key={pos.id} className="border-b border-[var(--ui-border)]/40 hover:bg-white/2 transition-colors">
                      <td className="py-2 font-mono text-[var(--ui-muted)]">{pos.id || pos.ticket}</td>
                      <td className="py-2 font-mono font-bold text-white">{pos.symbol}</td>
                      <td className="py-2">
                        <span className={`text-[9px] px-1 border rounded ${
                          pos.type === 'BUY' || pos.type === 'LONG' || pos.direction === 'LONG'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                        }`}>
                          {pos.type || pos.direction}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-[var(--ui-muted)]">{pos.volume || pos.lots} Lots</td>
                      <td className="py-2 font-mono text-white">{pos.entryPrice || pos.price}</td>
                      <td className={`py-2 font-mono text-right font-bold ${
                        (pos.pnl || pos.profit) >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {(pos.pnl || pos.profit) >= 0 ? '+' : ''}${(pos.pnl || pos.profit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-[var(--ui-muted)] font-mono text-[10px]">
                {mt5Status === 'CONNECTED' 
                  ? 'No active deployed MT5 orders found.' 
                  : 'Broker offline. Connect live bridge to populate positions database.'}
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
