import React, { useState, useEffect } from 'react';
import { Terminal, Cpu, Activity, Play, Square, Settings, Code } from 'lucide-react';
import { corexApi } from './api/client';
import { StrategyChart } from './components/Chart';
import { StateLog } from './components/StateLog';

export default function App() {
  const [strategies, setStrategies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  // Poll for strategy status (Sync with loader.listStrategies)
  useEffect(() => {
    const fetch = async () => {
      const { data } = await corexApi.get('/strategies');
      setStrategies(data.data);
    };
    fetch();
    const inv = setInterval(fetch, 2000); // 2s sync
    return () => clearInterval(inv);
  }, []);

  return (
    <div className="flex h-screen bg-[#050505] text-gray-300 overflow-hidden font-sans">
      {/* LEFT RAIL: CONTROL */}
      <aside className="w-72 border-r border-gray-900 bg-[#0a0a0a] flex flex-col">
        <div className="p-6 border-b border-gray-900 flex items-center gap-2">
          <div className="w-3 h-3 bg-brand rounded-full animate-pulse" />
          <h1 className="font-black tracking-tighter text-xl text-white">COREX<span className="text-brand">PRO</span></h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <p className="text-[10px] font-bold text-gray-600 uppercase mb-4 px-2">Active Strategies</p>
          {strategies.map(s => (
            <button 
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`w-full p-3 rounded-lg flex items-center justify-between transition-all ${selectedId === s.id ? 'bg-brand/10 border border-brand/50' : 'hover:bg-white/5 border border-transparent'}`}
            >
              <div className="flex flex-col items-start">
                <span className="text-sm font-bold text-gray-200">{s.name}</span>
                <span className="text-[10px] font-mono text-gray-500 uppercase">{s.status}</span>
              </div>
              <Cpu size={14} className={s.status === 'ACTIVE' ? 'text-brand' : 'text-gray-700'} />
            </button>
          ))}
        </nav>
        
        {/* BRIDGE STATUS (MT4/MT5 Placeholder) */}
        <div className="p-4 bg-black/40 m-4 rounded-lg border border-gray-800">
          <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-2">
            <Terminal size={12} /> BRIDGE TERMINAL
          </div>
          <div className="text-xs font-bold text-yellow-600 uppercase">Awaiting MT5 Link...</div>
        </div>
      </aside>

      {/* CENTER: INTELLIGENCE */}
      <main className="flex-1 flex flex-col relative">
        <header className="h-16 border-b border-gray-900 flex items-center justify-between px-8 bg-[#0a0a0a]/50 backdrop-blur-md">
          <div className="flex items-center gap-6">
             <div className="flex flex-col">
               <span className="text-[10px] text-gray-500">SYSTEM UPTIME</span>
               <span className="text-xs font-mono text-brand">02:45:12</span>
             </div>
             <div className="flex flex-col">
               <span className="text-[10px] text-gray-500">API LATENCY</span>
               <span className="text-xs font-mono text-blue-400">42ms</span>
             </div>
          </div>
          <div className="flex gap-2">
            <button className="bg-brand text-black px-4 py-1.5 rounded text-xs font-bold flex items-center gap-2 hover:bg-brand/80 transition-all">
              <Play size={14} fill="currentColor" /> START ENGINE
            </button>
          </div>
        </header>

        <section className="flex-1 p-6 space-y-6 overflow-y-auto">
            {/* Charting Area */}
            <div className="h-2/3">
               <StrategyChart symbol="BTC/USD" data={[]} />
            </div>

            {/* Persistence Ledger (The DLL View) */}
            <div className="h-1/3 grid grid-cols-2 gap-6">
                <StateLog logs={[]} /> {/* We will feed this from the broadaster */}
                <div className="bg-[#0a0a0a] border border-gray-900 rounded-xl p-4">
                   <div className="flex items-center gap-2 text-xs font-bold text-gray-500 mb-4 uppercase">
                      <Code size={14} /> Execution Matrix
                   </div>
                   <div className="text-[10px] text-gray-600 font-mono">
                      No active trades in pool...
                   </div>
                </div>
            </div>
        </section>
      </main>
    </div>
  );
}