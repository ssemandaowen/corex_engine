import React from 'react';
import { Home, Code, Play, BarChart2, User, Settings } from "lucide-react";

const Sidebar = ({ activeTab, setActiveTab }) => {
  const menu = [
    { id: 'home', label: 'Pulse', icon: Home },
    { id: 'strategies', label: 'Library', icon: Code },
    { id: 'run', label: 'Execution', icon: Play },
    { id: 'data', label: 'Analytics', icon: BarChart2 },
    { id: 'account', label: 'Broker', icon: User },
    { id: 'settings', label: 'Config', icon: Settings },
  ];

  return (
    <aside className="w-64 border-r border-slate-800 flex flex-col bg-[#020617]">
      <div className="p-8">
        <h1 className="text-xl font-black tracking-tighter text-white">CORE<span className="text-blue-600">X</span></h1>
      </div>
      <nav className="flex-1 px-4 space-y-1">
        {menu.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all ${
              activeTab === item.id 
                ? 'bg-blue-600/10 text-blue-500 font-bold' 
                : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
            }`}
          >
            <item.icon size={18} />
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;