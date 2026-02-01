import React, { useState, useEffect } from 'react';
import client from "../api/client";
import StatusRing from '../components/home/StatusRing';

const HomeView = () => {
  const [pulse, setPulse] = useState(null);

  useEffect(() => {
    const fetchPulse = async () => {
      try {
        const res = await client.get('/system/heartbeat');
        setPulse(res.payload);
      } catch (err) {
        console.error("Heartbeat lost");
      }
    };

    fetchPulse();
    const timer = setInterval(fetchPulse, 5000); // Poll every 5s
    return () => clearInterval(timer);
  }, []);

  if (!pulse) return <div className="text-slate-500 animate-pulse">Connecting to CoreX...</div>;

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* 1. Connection Traffic Lights */}
      <div className="col-span-8 grid grid-cols-3 gap-4">
        <StatusRing 
          label="Market Feed" 
          subLabel="TwelveData"
          status={pulse.connectivity.marketData} 
        />
        <StatusRing 
          label="Execution Bridge" 
          subLabel="MT4/5 Socket"
          status={pulse.connectivity.bridge} 
        />
        <StatusRing 
          label="Engine Core" 
          subLabel="Node.js Process"
          status={pulse.status === "OPERATIONAL" ? "CONNECTED" : "DISCONNECTED"} 
        />
      </div>

      {/* 2. Resource Monitor */}
      <div className="col-span-4 bg-slate-800 p-6 rounded-xl border border-slate-700">
        <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest">System Load</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span>CPU Usage</span>
              <span className="text-blue-400">{pulse.resources.cpu}%</span>
            </div>
            <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
              <div className="bg-blue-500 h-full" style={{ width: `${pulse.resources.cpu}%` }} />
            </div>
          </div>
          <div className="flex justify-between items-center py-2 border-t border-slate-700">
            <span className="text-sm text-slate-400">RAM (Heap)</span>
            <span className="font-mono text-sm">{pulse.resources.ram}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-t border-slate-700">
            <span className="text-sm text-slate-400">Uptime</span>
            <span className="font-mono text-sm">{pulse.uptime}</span>
          </div>
        </div>
      </div>

      {/* 3. Global Activity Feed (Internal Bus Events) */}
      <div className="col-span-12 bg-slate-900 border border-slate-800 rounded-lg p-4 h-64 overflow-hidden flex flex-col">
        <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Live System Events</h3>
        <div className="flex-1 font-mono text-[10px] text-slate-400 overflow-y-auto space-y-1">
          {/* This would be populated by your WebSocket Broadcaster */}
          <p><span className="text-slate-600">[03:42:01]</span> <span className="text-green-500">SYSTEM:</span> StrategyLoader initialized 12 files.</p>
          <p><span className="text-slate-600">[03:42:05]</span> <span className="text-blue-500">MARKET:</span> Subscribed to BTC/USD @ 1min.</p>
          <p className="animate-pulse"><span className="text-blue-400">_</span></p>
        </div>
      </div>
    </div>
  );
};

export default HomeView;