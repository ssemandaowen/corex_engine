import React, { useState, useEffect } from 'react';
import client from '../api/client';

const AccountView = () => {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAccountData = async () => {
    try {
      const res = await client.get('/system/account/balance');
      setAccount(res.payload);
    } catch (err) {
      console.error("Broker sync failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccountData();
    const timer = setInterval(fetchAccountData, 10000); // Poll balance every 10s
    return () => clearInterval(timer);
  }, []);

  if (loading) return <div className="p-6 text-slate-500 italic">Syncing with MT5 Bridge...</div>;

  return (
    <div className="space-y-6">
      {/* 1. High-Level Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Balance" value={`$${account?.balance || '0.00'}`} color="text-white" />
        <MetricCard label="Equity" value={`$${account?.equity || '0.00'}`} color="text-blue-400" />
        <MetricCard label="Used Margin" value={`$${account?.margin || '0.00'}`} color="text-orange-400" />
        <MetricCard label="Free Margin" value={`$${account?.freeMargin || '0.00'}`} color="text-green-400" />
      </div>

      {/* 2. Connection Details & Open Positions */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
            <h3 className="text-sm font-bold uppercase text-slate-400 tracking-widest">Live Positions</h3>
            <span className="text-[10px] bg-slate-900 px-2 py-1 rounded text-slate-500">MT5 SPREAD SYNCED</span>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/50 text-slate-500 text-[10px] uppercase">
              <tr>
                <th className="px-6 py-3">Asset</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Size</th>
                <th className="px-6 py-3">Entry</th>
                <th className="px-6 py-3">P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {account?.positions?.length > 0 ? account.positions.map((pos, i) => (
                <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-6 py-4 font-bold">{pos.symbol}</td>
                  <td className={`px-6 py-4 ${pos.type === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>{pos.type}</td>
                  <td className="px-6 py-4 font-mono">{pos.volume}</td>
                  <td className="px-6 py-4 text-slate-400">{pos.entryPrice}</td>
                  <td className={`px-6 py-4 font-bold ${pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pos.pnl >= 0 ? `+${pos.pnl}` : pos.pnl}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan="5" className="px-6 py-10 text-center text-slate-600 italic">No open positions detected.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 3. Terminal Connectivity Status */}
        <div className="col-span-4 space-y-4">
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h3 className="text-xs font-bold text-slate-500 uppercase mb-4">Bridge Diagnostics</h3>
            <div className="space-y-3">
              <StatusItem label="MT5 Terminal" status={account?.bridgeStatus} />
              <StatusItem label="Broker Server" status={account?.brokerStatus} />
              <StatusItem label="Trading Allowed" status={account?.tradeAllowed ? "YES" : "NO"} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ label, value, color }) => (
  <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-sm">
    <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">{label}</p>
    <p className={`text-2xl font-mono ${color}`}>{value}</p>
  </div>
);

const StatusItem = ({ label, status }) => (
  <div className="flex justify-between items-center text-xs">
    <span className="text-slate-400">{label}</span>
    <span className={`font-bold ${status === 'CONNECTED' || status === 'YES' ? 'text-green-500' : 'text-red-500'}`}>
      {status || 'OFFLINE'}
    </span>
  </div>
);

export default AccountView;