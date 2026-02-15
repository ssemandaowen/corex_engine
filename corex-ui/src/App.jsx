import React, { useEffect, useState, useMemo } from "react";
import Sidebar from "./components/Sidebar";
import HomeView from "./views/HomeView";
import StrategyView from "./views/StrategyView";
import RunView from "./views/RunView";
import DataView from "./views/DataView";
import AccountView from "./views/AccountView";
import SettingsView from "./views/SettingsView";
import SignInView from "./views/SignInView";
import { useStore } from "./store/useStore";
import client, { getSessionToken, setSessionToken } from "./api/client";

function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [authToken, setAuthToken] = useState(() => getSessionToken());
  const [authUser, setAuthUser] = useState(() => null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("corex.sidebar") === "collapsed";
  });

  // Simplified Store Access
  const {
    connectWebSocket, disconnectWebSocket,
    startPulse, stopPulse,
    startLiveStrategies, stopLiveStrategies,
    realtimeMode, wsStatus, fetchSystemSettings
  } = useStore();

  useEffect(() => {
    if (!authToken) return;
    fetchSystemSettings();
  }, [authToken, fetchSystemSettings]);

  // Unified System Handshake
  useEffect(() => {
    if (!authToken) return;
    if (realtimeMode === 'ws') connectWebSocket();
    startPulse();
    startLiveStrategies();

    return () => {
      disconnectWebSocket();
      stopPulse();
      stopLiveStrategies();
    };
  }, [authToken, realtimeMode]); // Logic remains stable across renders

  useEffect(() => {
    if (!authToken) return;
    if (realtimeMode !== 'ws') return;
    if (wsStatus !== 'CONNECTED') {
      connectWebSocket();
    }
  }, [authToken, realtimeMode, wsStatus, connectWebSocket]);

  // Sync Sidebar State
  useEffect(() => {
    localStorage.setItem("corex.sidebar", sidebarCollapsed ? "collapsed" : "expanded");
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!authToken) return;
    client.get("/auth/me")
      .then((res) => setAuthUser(res?.payload || null))
      .catch(() => setAuthUser(null));
  }, [authToken]);

  useEffect(() => {
    const handleExpired = () => {
      setAuthToken("");
      setAuthUser(null);
    };
    window.addEventListener("corex:auth:expired", handleExpired);
    return () => window.removeEventListener("corex:auth:expired", handleExpired);
  }, []);

  // View mapping - memoized to prevent unnecessary re-renders of the object
  const views = useMemo(() => ({
    home: <HomeView />,
    strategies: <StrategyView onNavigate={setActiveTab} />,
    run: <RunView />,
    data: <DataView />,
    account: <AccountView />,
    settings: <SettingsView />,
  }), []);

  if (!authToken) {
    return (
      <SignInView
        onSignedIn={(token, user) => {
          setAuthToken(token);
          setAuthUser(user || null);
        }}
      />
    );
  }

  return (
    <div className={`ui-shell flex h-screen w-screen overflow-hidden bg-[#0b0e14]`}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
      />

      {/* THE FIX: flex-1 and overflow-hidden ensures the main area doesn't grow 
         beyond the viewport, forcing children to handle their own scrolling.
      */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">

        {/* HEADER: Sharp & Fixed */}
        <header className="h-14 shrink-0 border-b border-slate-800 flex items-center justify-between px-6 bg-[#0d1117]/50 backdrop-blur-md z-20">
          <div className="flex items-center gap-4">
            <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500">
              System // <span className="text-white">{activeTab}</span>
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-500 font-mono hidden md:block">
              {authUser?.email || "Authenticated"}
            </span>
            <button
              onClick={() => {
                setSessionToken("");
                setAuthToken("");
                setAuthUser(null);
              }}
              className="text-[9px] px-2 py-1 border border-slate-700 rounded text-slate-400 hover:text-white hover:border-slate-500 uppercase font-bold tracking-wider"
            >
              Sign Out
            </button>
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
              <span className="text-[9px] font-bold text-emerald-400 tracking-tighter uppercase">Engine Stable</span>
            </div>
            <div className="h-4 w-px bg-slate-800" />
            <span className="text-[10px] font-mono text-slate-500">v2.6.0_PRO</span>
          </div>
        </header>

        {/* THE CONTENT: Use h-full and w-full with relative positioning.
           Removed extra padding here so individual Views can manage their 
           own layout (e.g., StrategyView needs to be edge-to-edge).
        */}
        <div className="flex-1 relative overflow-hidden">
          {Object.entries(views).map(([key, view]) => (
            <div
              key={key}
              className={`absolute inset-0 w-full h-full transition-opacity duration-200 ${activeTab === key ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                }`}
            >
              {view}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;
