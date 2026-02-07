import React, { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import HomeView from "./views/HomeView";
import StrategyView from "./views/StrategyView";
import RunView from "./views/RunView";
import DataView from "./views/DataView";
import AccountView from "./views/AccountView";
import SettingsView from "./views/SettingsView";
import { useStore } from "./store/useStore";

function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("corex.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const connectWebSocket = useStore((s) => s.connectWebSocket);
  const disconnectWebSocket = useStore((s) => s.disconnectWebSocket);
  const startPulse = useStore((s) => s.startPulse);
  const stopPulse = useStore((s) => s.stopPulse);
  const startLiveStrategies = useStore((s) => s.startLiveStrategies);
  const stopLiveStrategies = useStore((s) => s.stopLiveStrategies);

  useEffect(() => {
    connectWebSocket();
    startPulse();
    startLiveStrategies();
    return () => {
      disconnectWebSocket();
      stopPulse();
      stopLiveStrategies();
    };
  }, [connectWebSocket, disconnectWebSocket, startPulse, stopPulse, startLiveStrategies, stopLiveStrategies]);

  useEffect(() => {
    try {
      localStorage.setItem("corex.sidebar", sidebarCollapsed ? "collapsed" : "expanded");
    } catch {
      // ignore storage failures
    }
  }, [sidebarCollapsed]);

  const views = {
    home: <HomeView />,
    strategies: <StrategyView onNavigate={setActiveTab} />,
    run: <RunView />,
    data: <DataView />,
    account: <AccountView />,
    settings: <SettingsView />,
  };

  return (
    <div className="ui-shell">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
      />
      <main className="ui-main">
        <header className="ui-header">
          <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-blue-400">{activeTab}</h2>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <span className="text-[10px] mono text-slate-400">ENGINE_STABLE_V2</span>
          </div>
        </header>
        <div className="ui-content">
          {Object.entries(views).map(([key, view]) => (
            <div key={key} className={activeTab === key ? 'h-full overflow-y-auto pr-1' : 'hidden'}>
              {view}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;
