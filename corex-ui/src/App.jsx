import React, { useEffect, useState, useMemo, useRef } from "react";
import Sidebar from "./components/Sidebar";
import HomeView from "./views/HomeView";
import StrategyView from "./views/StrategyView";
import RunView from "./views/RunView";
import DataView from "./views/DataView";
import AccountView from "./views/AccountView";
import SettingsView from "./views/SettingsView";
import SignInView from "./views/SignInView";
import SignOutView from "./views/SignOutView";
import { useStore } from "./store/useStore";
import client, { getSessionToken, setSessionToken } from "./api/client";
import UserAvatar from "./components/common/UserAvatar";
import { ChevronDown, Lock, Monitor, Radio, ShieldCheck, UserCircle2, Wallet, Wifi } from "lucide-react";

function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [authToken, setAuthToken] = useState(() => getSessionToken());
  const [authUser, setAuthUser] = useState(() => null);
  const [showSignOutView, setShowSignOutView] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [securityPrefs, setSecurityPrefs] = useState(() => {
    try {
      const raw = localStorage.getItem("corex.securityPrefs");
      return raw ? JSON.parse(raw) : { twoFactor: false, passwordAlerts: true };
    } catch {
      return { twoFactor: false, passwordAlerts: true };
    }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("corex.sidebar") === "collapsed";
  });
  const profileRef = useRef(null);

  // Simplified Store Access
  const {
    connectWebSocket, disconnectWebSocket,
    startPulse, stopPulse,
    startLiveStrategies, stopLiveStrategies,
    realtimeMode, wsStatus, fetchSystemSettings, uiTheme, activeAccountMode
  } = useStore();

  useEffect(() => {
    if (!authToken) return;
    fetchSystemSettings();
  }, [authToken, fetchSystemSettings]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", uiTheme || "dark");
  }, [uiTheme]);

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
    localStorage.setItem("corex.securityPrefs", JSON.stringify(securityPrefs));
  }, [securityPrefs]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!profileRef.current) return;
      if (!profileRef.current.contains(e.target)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

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
      setShowSignOutView(false);
    };
    window.addEventListener("corex:auth:expired", handleExpired);
    return () => window.removeEventListener("corex:auth:expired", handleExpired);
  }, []);

  const handleSignOutConfirmed = () => {
    setSessionToken("");
    setAuthToken("");
    setAuthUser(null);
    setShowSignOutView(false);
  };

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
          setShowSignOutView(false);
        }}
      />
    );
  }

  return (
    <div className={`ui-shell flex h-screen w-screen overflow-hidden`}>
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
        <header className="h-14 shrink-0 border-b border-[var(--ui-border)] flex items-center justify-between px-6 bg-[var(--ui-header-glass)] backdrop-blur-md z-20">
          <div className="flex items-center gap-4">
            <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-[var(--ui-accent)]">
              System // <span className="text-[var(--ui-text)]">{activeTab}</span>
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[10px] text-[var(--ui-muted)] font-mono hidden md:block">
              {authUser?.email || "Authenticated"}
            </span>
            <div className="hidden lg:flex items-center gap-2">
              <span className="ui-chip"><Wallet size={11} /> {String(activeAccountMode || "paper").toUpperCase()}</span>
              <span className="ui-chip"><Radio size={11} /> {String(realtimeMode || "ws").toUpperCase()}</span>
              <span className="ui-chip"><Monitor size={11} /> {String(uiTheme || "dark").toUpperCase()}</span>
            </div>
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel)] hover:bg-[var(--ui-row-hover)]"
              >
                <UserAvatar name={authUser?.name || authUser?.username} email={authUser?.email} size={28} />
                <ChevronDown size={12} className="text-[var(--ui-muted)]" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-11 w-80 border border-[var(--ui-border)] rounded-xl bg-[var(--ui-panel-strong)] shadow-2xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--ui-border)]">
                    <div className="flex items-center gap-2 text-[var(--ui-text)] font-semibold">
                      <UserCircle2 size={14} />
                      {authUser?.name || authUser?.username || "Trader"}
                    </div>
                    <div className="text-[11px] text-[var(--ui-muted)]">{authUser?.email || "--"}</div>
                    <div className="mt-2 flex gap-2 text-[10px]">
                      <span className="ui-chip">Status: ACTIVE</span>
                      <span className="ui-chip">Tier: {String(authUser?.subscriptionTier || "PRO").toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="p-3 space-y-3 text-[12px]">
                    <div className="text-[10px] uppercase tracking-widest text-[var(--ui-muted)] font-bold">Security</div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--ui-text)] inline-flex items-center gap-2"><ShieldCheck size={12} /> 2FA</span>
                      <button
                        className={`ui-switch ${securityPrefs.twoFactor ? "ui-switch-on" : ""}`}
                        onClick={() => setSecurityPrefs((s) => ({ ...s, twoFactor: !s.twoFactor }))}
                        aria-label="Toggle 2FA"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--ui-text)] inline-flex items-center gap-2"><Lock size={12} /> Password Alerts</span>
                      <button
                        className={`ui-switch ${securityPrefs.passwordAlerts ? "ui-switch-on" : ""}`}
                        onClick={() => setSecurityPrefs((s) => ({ ...s, passwordAlerts: !s.passwordAlerts }))}
                        aria-label="Toggle password alerts"
                      />
                    </div>
                    <button
                      onClick={() => {
                        setActiveTab("settings");
                        setProfileOpen(false);
                        window.dispatchEvent(new CustomEvent("corex:settings:focus", { detail: { tab: "connectivity", subTab: "mt5" } }));
                      }}
                      className="w-full ui-button ui-button-secondary text-[10px] justify-start"
                    >
                      <Wifi size={12} /> Portal Settings: MT5/MetaApi
                    </button>
                    <button
                      onClick={() => {
                        setProfileOpen(false);
                        setShowSignOutView(true);
                      }}
                      className="w-full ui-button ui-button-danger text-[10px]"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--ui-border-strong)] bg-[var(--ui-row-hover)]">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--ui-positive)] animate-pulse"></div>
              <span className="text-[9px] font-bold text-[var(--ui-positive)] tracking-tighter uppercase">Engine Stable</span>
            </div>
            <div className="h-4 w-px bg-[var(--ui-border)]" />
            <span className="text-[10px] font-mono text-[var(--ui-muted)]">v2.6.0_PRO</span>
          </div>
        </header>

        {/* THE CONTENT: Use h-full and w-full with relative positioning.
           Removed extra padding here so individual Views can manage their 
           own layout (e.g., StrategyView needs to be edge-to-edge).
        */}
        <div className="flex-1 relative overflow-hidden">
          {showSignOutView ? (
            <SignOutView
              user={authUser}
              onCancel={() => setShowSignOutView(false)}
              onConfirm={handleSignOutConfirmed}
            />
          ) : (
            <>
              {Object.entries(views).map(([key, view]) => (
                <div
                  key={key}
                  className={`absolute inset-0 w-full h-full transition-opacity duration-200 ${activeTab === key ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                    }`}
                >
                  {view}
                </div>
              ))}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
