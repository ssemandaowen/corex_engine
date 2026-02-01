import React, { useState } from "react";
import { Home, Code, Play, BarChart2, User, Settings } from "lucide-react";
import Sidebar from "./components/Sidebar";
import HomeView from "./views/HomeView";
import StrategyView from "./views/StrategyView";
import RunView from "./views/RunView";
import DataView from "./views/DataView";
import AccountView from "./views/AccountView";
import SettingsView from "./views/SettingsView";

function App() {
  const [activeTab, setActiveTab] = useState("home");

  const renderView = () => {
    switch (activeTab) {
      case "home": return <HomeView />;
      case "strategies": return <StrategyView />;
      case "run": return <RunView />;
      case "data": return <DataView />;
      case "account": return <AccountView />;
      case "settings": return <SettingsView />;
      default: return <HomeView />;
    }
  };

  return (
    <div className="flex h-screen bg-[#020617] text-slate-200">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 overflow-hidden flex flex-col">
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-[#020617]/50 backdrop-blur-md">
          <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-blue-500">{activeTab}</h2>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
            <span className="text-[10px] font-mono text-slate-500">ENGINE_STABLE_V2</span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
          {renderView()}
        </div>
      </main>
    </div>
  );
}

export default App;