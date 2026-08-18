
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import useUiStore from './store/uiStore';
import useDataStore from './store/dataStore';
import useUserRole from './hooks/useUserRole';
import { authApi } from './api/auth';
import { runApi } from './api/run';
import { useTerminalContext } from './context/TerminalContext';
import { useToast } from './context/ToastContext';

// Views
import HomeView from './views/HomeView';
import StrategyView from './views/StrategyView';
import RunView from './views/RunView';
import DataView from './views/DataView';
import DocsView from './views/DocsView';
import AccountView from './views/AccountView';
import SettingsView from './views/SettingsView';
import { ErrorBoundary } from './components/ErrorBoundary';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';

import { 
  User as UserIcon, 
  ShieldAlert, 
  Settings, 
  LogOut, 
  Lock, 
  Wifi, 
  WifiOff,
  Terminal,
  Play,
  Layers,
  Activity,
  Cpu,
  RefreshCw,
  Radio,
  Keyboard
} from 'lucide-react';

export default function App() {
  const { isTerminalVisible, setIsTerminalVisible } = useTerminalContext();
  const { showToast } = useToast();

  // Keep views mounted across tab switches so local UI state (selected
  // strategy/run, form inputs, sub-tab, in-progress backtest, etc.) is NOT
  // lost when you navigate away and come back. Each view is mounted the first
  // time it's visited and then kept in the tree, shown/hidden via CSS.
  // Declared before the early auth return so the hook order is stable.
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(['home']));

  const { 
    activeTab, 
    setActiveTab, 
    collapsed, 
    setCollapsed,
    authUser,
    setAuthUser,
    token,
    setToken,
    activeAccountMode,
    setActiveAccountMode,
    realtimeMode,
    setRealtimeMode,
    engineStatus,
    setEngineStatus
  } = useUiStore();

  // Keep views mounted across tab switches so local UI state (selected
  // strategy/run, form inputs, sub-tab, in-progress backtest, etc.) is NOT
  // lost when you navigate away and come back. Each view is mounted the first
  // time it's visited and then kept in the tree, shown/hidden via CSS.
  useEffect(() => {
    setVisitedTabs((prev) =>
      prev.has(activeTab) ? prev : new Set(prev).add(activeTab)
    );
  }, [activeTab]);

  const { isAdmin, role } = useUserRole();

  // Local state
  const [profileOpen, setProfileOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [securityPrefs, setSecurityPrefs] = useState({
    twoFA: true,
    passwordAlerts: false
  });
  const [signinForm, setSigninForm] = useState({ email: '', password: '' });
  const [signupForm, setSignupForm] = useState({ name: '', email: '', password: '' });
  const [isSignup, setIsSignup] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Global Keyboard Shortcuts Event Listener (with Event Capturing to prevent Monaco/modal event swallowing)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const target = e.target as HTMLElement;
      
      const checkIsInput = (el: Element | null): boolean => {
        if (!el) return false;
        const tagName = el.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
          return true;
        }
        if (el.hasAttribute('contenteditable') || el.getAttribute('contenteditable') === 'true') {
          return true;
        }
        if (el.getAttribute('role') === 'textbox') {
          return true;
        }
        if (el.classList.contains('monaco-editor') || el.closest('.monaco-editor') || el.closest('.monaco-editor-container')) {
          return true;
        }
        if (el.closest('form') || el.closest('.input-container') || el.closest('.search-box')) {
          return true;
        }
        return false;
      };

      const isInput = checkIsInput(activeEl) || checkIsInput(target);

      if (e.key === 'Escape') {
        setIsShortcutsOpen(false);
        return;
      }

      // If typing normally in any input element (and without command/alt/ctrl modifier), let it pass-through
      if (isInput && !e.altKey && !e.ctrlKey && !e.metaKey) {
        return;
      }

      // Standardize key codes universally using e.code first, fallback to e.key
      let key = '';
      if (e.code && e.code.startsWith('Key')) {
        key = e.code.slice(3).toUpperCase();
      } else if (e.code === 'Backquote') {
        key = '`';
      } else if (e.code === 'Slash') {
        key = '?';
      } else {
        key = e.key.toUpperCase();
      }

      // Toggle help modal on '?'
      if (key === '?' && !isInput) {
        e.preventDefault();
        e.stopPropagation();
        setIsShortcutsOpen(prev => !prev);
        return;
      }

      // Ctrl + key shortcuts (work even inside inputs)
      if (e.ctrlKey || e.metaKey) {
        switch (key) {
          case 'R': {
            e.preventDefault();
            e.stopPropagation();
            const selectedId = useDataStore.getState().selectedStrategyId;
            if (selectedId) {
              runApi.restart(selectedId).then((res: any) => {
                if (res?.success) {
                  useDataStore.getState().updateStrategyStatus(selectedId, 'running');
                  showToast('Strategy restarted successfully', 'success');
                } else {
                  showToast(res?.error || 'Failed to restart strategy', 'error');
                }
              }).catch(() => showToast('Failed to restart strategy', 'error'));
            } else {
              showToast('No strategy selected to restart', 'warning');
            }
            return;
          }
          case 'D': {
            e.preventDefault();
            e.stopPropagation();
            const selectedId = useDataStore.getState().selectedStrategyId;
            if (selectedId) {
              runApi.stop(selectedId).then((res: any) => {
                if (res?.success) {
                  useDataStore.getState().updateStrategyStatus(selectedId, 'stopped');
                  showToast('Strategy stopped', 'warning');
                } else {
                  showToast(res?.error || 'Failed to stop strategy', 'error');
                }
              }).catch(() => showToast('Failed to stop strategy', 'error'));
            } else {
              showToast('No strategy selected to stop', 'warning');
            }
            return;
          }
          case 'L': {
            e.preventDefault();
            e.stopPropagation();
            useDataStore.getState().clearActivityLogs();
            showToast('Terminal logs cleared', 'success');
            return;
          }
          case 'P': {
            e.preventDefault();
            e.stopPropagation();
            setActiveTab('docs');
            return;
          }
          default:
            break;
        }
      }

      // Command triggered (if alt key is pressed, or if not in an input and single key is pressed)
      if (e.altKey || !isInput) {
        switch (key) {
          case 'H':
            e.preventDefault();
            e.stopPropagation();
            setActiveTab('home');
            break;
          case 'L':
            e.preventDefault();
            e.stopPropagation();
            setActiveTab('strategies');
            break;
          case 'E':
            e.preventDefault();
            e.stopPropagation();
            setActiveTab('run');
            break;
          case 'A':
            e.preventDefault();
            e.stopPropagation();
            setActiveTab('data');
            break;
          case 'D':
            e.preventDefault();
            e.stopPropagation();
            setActiveTab('docs');
            break;
          case 'B':
            e.preventDefault();
            e.stopPropagation();
            setActiveTab('account');
            break;
          case 'S':
            e.preventDefault();
            e.stopPropagation();
            setActiveTab('settings');
            break;
          case 'T':
          case '`':
            e.preventDefault();
            e.stopPropagation();
            setIsTerminalVisible(!isTerminalVisible);
            break;
          case 'M':
            e.preventDefault();
            e.stopPropagation();
            setActiveAccountMode(activeAccountMode === 'PAPER' ? 'LIVE' : 'PAPER');
            break;
          case 'R':
            e.preventDefault();
            e.stopPropagation();
            setRealtimeMode(realtimeMode === 'WS' ? 'POLL' : 'WS');
            break;
          default:
            break;
        }
      }
    };

    // Register with capture=true so that we capture event before any child elements (like Monaco) can stopPropagation()
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [
    activeAccountMode,
    realtimeMode,
    isTerminalVisible,
    setActiveTab,
    setIsTerminalVisible,
    setActiveAccountMode,
    setRealtimeMode
  ]);

  // FIX (Owen, Jul 2026): the WebSocket used to be opened/closed inside
  // HomeView's own mount/unmount effect. Since views are conditionally
  // rendered (HomeView unmounts the moment you switch to Strategies/Run/etc),
  // that tore the live connection down every single time you navigated away
  // from Home — which is exactly the "disconnects and connects" cycling and
  // the missing terminal logs/backtest progress on every other tab. The
  // connection now lives here at the app root, tied to the auth token, so it
  // survives navigation and only tears down on logout.
  useEffect(() => {
    if (!token) {
      useDataStore.getState().disconnectWebSocket();
      return;
    }

    useDataStore.getState().setReconnectAttempts(0);
    useDataStore.getState().connectWebSocket();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const ws = useDataStore.getState().ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          useDataStore.getState().setReconnectAttempts(0);
          useDataStore.getState().connectWebSocket();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      useDataStore.getState().disconnectWebSocket();
    };
  }, [token]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto collapse sidebar on smaller screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setCollapsed(true);
      }
    };
    handleResize(); // Run once on mount
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setCollapsed]);

  // Listen to custom navigation and auth events
  useEffect(() => {
    const handleNavigate = (e: any) => {
      if (e.detail && e.detail.tab) {
        setActiveTab(e.detail.tab);
      }
    };
    const handleUnauthorized = () => {
      setToken(null);
      setAuthUser(null);
    };

    window.addEventListener('corex:navigate', handleNavigate);
    window.addEventListener('corex:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('corex:navigate', handleNavigate);
      window.removeEventListener('corex:unauthorized', handleUnauthorized);
    };
  }, [setActiveTab, setToken, setAuthUser]);

  const handleSignin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const data = await authApi.signin(signinForm);
      if (data.success) {
        setToken(data.payload.token);
        setAuthUser(data.payload.user);
      } else {
        setAuthError(data.error || 'Authentication failed');
      }
    } catch (err: any) {
      console.error('API authentication error', err);
      const errMsg = err?.response?.data?.error || err?.message || 'Authentication service offline';
      setAuthError(errMsg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const data = await authApi.signup(signupForm);
      if (data.success) {
        setToken(data.payload.token);
        setAuthUser(data.payload.user);
      } else {
        setAuthError(data.error || 'Registration failed');
      }
    } catch (err: any) {
      console.error('API error during signup', err);
      const errMsg = err?.response?.data?.error || err?.message || 'Registration service offline';
      setAuthError(errMsg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignout = async () => {
    try {
      await authApi.signout();
    } catch (e) {
      // Ignored
    }
    setToken(null);
    setAuthUser(null);
    setProfileOpen(false);
  };

  const toggle2FA = () => {
    setSecurityPrefs(prev => ({ ...prev, twoFA: !prev.twoFA }));
  };

  const togglePasswordAlerts = () => {
    setSecurityPrefs(prev => ({ ...prev, passwordAlerts: !prev.passwordAlerts }));
  };

  // Render Login/Signup view if not authenticated
  if (!authUser || !token) {
    return (
      <div 
        className="flex items-center justify-center min-h-screen font-mono p-4" 
        style={{ backgroundColor: 'var(--ui-bg)' }}
      >
        <div 
          className="w-full max-w-md rounded-lg border shadow-xl overflow-hidden p-6 relative"
          style={{ 
            backgroundColor: 'var(--ui-panel)', 
            borderColor: 'var(--ui-border)'
          }}
        >
          {/* Logo */}
          <div className="flex flex-col items-center mb-6 text-center">
            <img src="/corex.svg" alt="CoreX" className="w-14 h-14 mb-2 animate-pulse" />
            <h1 className="text-xl font-display font-bold tracking-widest text-[var(--ui-text)]">
              CORE<span className="text-[var(--ui-accent)]">X</span> // TERMINAL
            </h1>
            <p className="text-[10px] uppercase tracking-widest mt-1 text-[var(--ui-muted)]">
              Quantitative Algorithmic Console
            </p>
          </div>

          <form onSubmit={isSignup ? handleSignup : handleSignin} className="space-y-4">
            {isSignup && (
              <div>
                <label className="block text-[10px] uppercase font-bold tracking-wider mb-1 text-[var(--ui-muted)]">Full Name</label>
                <input 
                  type="text" 
                  value={signupForm.name}
                  onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })}
                  placeholder="e.g. John Doe"
                  className="w-full p-2.5 rounded border text-xs text-[var(--ui-text)] focus:outline-none"
                  style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)' }}
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider mb-1 text-[var(--ui-muted)]">Email Address</label>
              <input 
                type="email" 
                value={isSignup ? signupForm.email : signinForm.email}
                onChange={(e) => isSignup 
                  ? setSignupForm({ ...signupForm, email: e.target.value })
                  : setSigninForm({ ...signinForm, email: e.target.value })
                }
                placeholder="developer@corex.io (or admin@corex.io)"
                className="w-full p-2.5 rounded border text-xs text-[var(--ui-text)] focus:outline-none"
                style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)' }}
                required
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider mb-1 text-[var(--ui-muted)]">Password Key</label>
              <input 
                type="password" 
                value={isSignup ? signupForm.password : signinForm.password}
                onChange={(e) => isSignup
                  ? setSignupForm({ ...signupForm, password: e.target.value })
                  : setSigninForm({ ...signinForm, password: e.target.value })
                }
                placeholder="••••••••"
                className="w-full p-2.5 rounded border text-xs text-[var(--ui-text)] focus:outline-none"
                style={{ backgroundColor: 'var(--ui-input-bg)', borderColor: 'var(--ui-border)' }}
                required
              />
            </div>

            {authError && (
              <div 
                className="text-[11px] p-2 rounded border border-[var(--ui-negative)] text-[var(--ui-negative)]"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)' }}
              >
                {authError}
              </div>
            )}

            <button 
              type="submit" 
              disabled={authLoading}
              className="w-full py-2.5 text-xs font-bold uppercase tracking-widest rounded transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 text-white"
              style={{ backgroundColor: 'var(--ui-accent)' }}
            >
              {authLoading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Terminal size={14} />
                  {isSignup ? 'Create Account' : 'Authenticate Credentials'}
                </>
              )}
            </button>
          </form>

          <div className="mt-4 text-center text-xs">
            <button 
              type="button" 
              onClick={() => {
                setIsSignup(!isSignup);
                setAuthError('');
              }}
              className="text-[var(--ui-accent)] hover:underline cursor-pointer"
            >
              {isSignup ? 'Already registered? Login here' : 'Register new developer identity'}
            </button>
          </div>

          {/* Prompt info */}
          <div className="mt-6 pt-4 border-t text-center text-[10px]" style={{ borderColor: 'var(--ui-border)' }}>
            <p style={{ color: 'var(--ui-muted)' }}>
              Secure authentication gateway. Credentials are verified against the CoreX database.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const viewMap: Record<string, React.ReactNode> = {
    home: <HomeView />,
    strategies: <StrategyView />,
    run: <RunView />,
    data: <DataView />,
    docs: <DocsView />,
    account: <AccountView />,
    settings: <SettingsView />,
  };

  const renderViews = () => (
    <>
      {Object.entries(viewMap).map(([key, node]) => {
        const isActive = key === activeTab;
        if (!isActive && !visitedTabs.has(key)) return null;
        return (
          <div
            key={key}
            className="absolute inset-0 h-full w-full"
            style={{ display: isActive ? 'block' : 'none' }}
          >
            <ErrorBoundary>{node}</ErrorBoundary>
          </div>
        );
      })}
    </>
  );

  // Human readable view label
  const getViewLabel = () => {
    switch (activeTab) {
      case 'home': return 'ENGINE OVERVIEW';
      case 'strategies': return 'STRATEGY LIBRARY';
      case 'run': return 'WORKSPACE & EXECUTION';
      case 'data': return 'PORTFOLIO ANALYTICS';
      case 'docs': return 'CORE MANIFEST DOCS';
      case 'account': return 'BROKER CONNECTION';
      case 'settings': return 'SYSTEM CONFIG';
      default: return 'CONSOLE';
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden text-[var(--ui-text)]" style={{ backgroundColor: 'var(--ui-bg)' }}>
      {/* Sidebar Component */}
      <Sidebar 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        userName={authUser.name}
        userEmail={authUser.email}
        engineStatus={engineStatus}
      />

      {/* Main Panel */}
      <div className="flex-1 flex flex-col min-w-0 h-screen relative">
        {/* Topbar (h-14, fixed, border-bottom, glass blur bg) */}
        <header 
          className="h-14 border-b flex items-center justify-between px-4 z-40 select-none backdrop-blur-md shrink-0"
          style={{ 
            borderColor: 'var(--ui-border)',
            backgroundColor: 'var(--ui-panel)'
          }}
        >
          {/* LEFT SIDE: Breadcrumbs */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-[10px] tracking-widest font-black hidden xs:inline" style={{ color: 'var(--ui-accent)' }}>
              SYSTEM //
            </span>
            <span className="text-[10px] tracking-widest font-black" style={{ color: 'var(--ui-text)' }}>
              {getViewLabel()}
            </span>
          </div>

          {/* RIGHT SIDE: Chips and user dropdown */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            {/* Account mode chip */}
            <div 
              className="px-1.5 sm:px-2 py-0.5 rounded text-[9px] font-sans font-bold uppercase tracking-wider border cursor-pointer select-none flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all"
              style={{
                backgroundColor: activeAccountMode === 'LIVE' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(30, 144, 255, 0.12)',
                borderColor: activeAccountMode === 'LIVE' ? 'var(--ui-warning)' : 'var(--ui-accent)',
                color: activeAccountMode === 'LIVE' ? 'var(--ui-warning)' : 'var(--ui-accent)'
              }}
              onClick={() => setActiveAccountMode(activeAccountMode === 'PAPER' ? 'LIVE' : 'PAPER')}
              title={`Switch Mode (Current: ${activeAccountMode})`}
            >
              {activeAccountMode === 'LIVE' ? <Activity size={10} /> : <Layers size={10} />}
              <span className="hidden sm:inline">{activeAccountMode}</span>
            </div>

            {/* Realtime chip */}
            <div 
              className="px-1.5 sm:px-2 py-0.5 rounded text-[9px] font-sans font-bold uppercase tracking-wider border cursor-pointer select-none flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all"
              style={{
                backgroundColor: realtimeMode === 'WS' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                borderColor: realtimeMode === 'WS' ? 'var(--ui-positive)' : 'var(--ui-warning)',
                color: realtimeMode === 'WS' ? 'var(--ui-positive)' : 'var(--ui-warning)'
              }}
              onClick={() => setRealtimeMode(realtimeMode === 'WS' ? 'POLL' : 'WS')}
              title={`Stream Protocol (Current: ${realtimeMode})`}
            >
              {realtimeMode === 'WS' ? <Radio size={10} className="animate-pulse" /> : <RefreshCw size={10} />}
              <span className="hidden sm:inline">{realtimeMode}</span>
            </div>

            {/* Engine status pulse */}
            <div 
              className="flex items-center gap-1 sm:gap-1.5 border border-[var(--ui-border)] px-1.5 sm:px-2 py-0.5 rounded"
              title={`Engine Core: ${engineStatus}`}
            >
              <span 
                className="w-1.5 h-1.5 rounded-full inline-block animate-pulse"
                style={{ 
                  backgroundColor: engineStatus === 'STABLE' ? 'var(--ui-positive)' : 'var(--ui-warning)' 
                }}
              />
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-300 hidden sm:inline">
                {engineStatus}
              </span>
            </div>

            {/* Global Terminal toggle button */}
            <button 
              onClick={() => setIsTerminalVisible(!isTerminalVisible)}
              className="p-1 rounded border cursor-pointer select-none transition-all duration-150 flex items-center justify-center hover:opacity-90 active:scale-95"
              style={{
                backgroundColor: isTerminalVisible ? 'rgba(30, 144, 255, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                borderColor: isTerminalVisible ? 'var(--ui-accent)' : 'var(--ui-border)',
                color: isTerminalVisible ? 'var(--ui-text)' : 'var(--ui-muted)'
              }}
              title="Toggle Terminal Logs (Alt+T)"
            >
              <Terminal size={12} className={isTerminalVisible ? "text-[var(--ui-accent)]" : "text-[var(--ui-muted)]"} />
            </button>

            {/* Keyboard Shortcuts Trigger Button */}
            <button
              onClick={() => setIsShortcutsOpen(true)}
              className="p-1 rounded border cursor-pointer select-none transition-all duration-150 flex items-center justify-center hover:opacity-90 active:scale-95 text-[var(--ui-muted)] hover:text-white"
              style={{
                backgroundColor: isShortcutsOpen ? 'rgba(30, 144, 255, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                borderColor: isShortcutsOpen ? 'var(--ui-accent)' : 'var(--ui-border)'
              }}
              title="Keyboard Shortcuts Ledger (?)"
            >
              <Keyboard size={12} className={isShortcutsOpen ? "text-[var(--ui-accent)]" : ""} />
            </button>

            <div className="w-px h-4 bg-[var(--ui-border)] hidden md:block" />

            <span className="text-[9px] font-mono text-[var(--ui-muted)] select-none hidden md:inline">
              v2.6.0
            </span>

            {/* User avatar button */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer border transition-colors hover:border-[var(--ui-accent)] font-display font-bold text-[10px]"
                style={{
                  backgroundColor: 'var(--ui-panel-strong)',
                  borderColor: profileOpen ? 'var(--ui-accent)' : 'var(--ui-border)',
                  color: 'var(--ui-text)'
                }}
              >
                {authUser.name.charAt(0)}
              </button>

              {/* Avatar dropdown panel */}
              {profileOpen && (
                <div 
                  className="absolute right-0 mt-2 w-72 rounded-lg border shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
                  style={{
                    backgroundColor: 'var(--ui-panel-strong)',
                    borderColor: 'var(--ui-border-strong)',
                  }}
                >
                  {/* Header */}
                  <div className="p-4 border-b border-[var(--ui-border)]" style={{ backgroundColor: 'var(--ui-panel)' }}>
                    <div className="flex justify-between items-start">
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold truncate text-[var(--ui-text)]">
                          {authUser.name}
                        </span>
                        <span className="text-[10px] truncate text-[var(--ui-muted)] mt-0.5">
                          {authUser.email}
                        </span>
                      </div>
                      
                      {/* Role and Tier Badge */}
                      <div className="flex flex-col items-end gap-1">
                        <span 
                          className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
                          style={{
                            backgroundColor: 'rgba(30, 144, 255, 0.15)',
                            color: 'var(--ui-accent)'
                          }}
                        >
                          {role}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-1.5">
                      <span className="text-[9px] text-[var(--ui-muted)] uppercase tracking-wider font-bold">Tier:</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30 font-bold uppercase tracking-wider">
                        {authUser.subscriptionTier}
                      </span>
                      {isAdmin && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-bold uppercase tracking-wider">
                          Admin Panel
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Section: Security */}
                  <div className="p-4 border-b border-[var(--ui-border)] space-y-3">
                    <span className="text-[9px] text-[var(--ui-muted)] uppercase tracking-widest font-black block">
                      SECURITY
                    </span>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col leading-none">
                        <span className="text-xs font-medium text-[var(--ui-text)]">Two-Factor Auth</span>
                        <span className="text-[9px] text-[var(--ui-muted)] mt-0.5">Token authentication on signin</span>
                      </div>
                      <button 
                        onClick={toggle2FA}
                        className="w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer"
                        style={{
                          backgroundColor: securityPrefs.twoFA ? 'var(--ui-accent)' : 'var(--ui-border-strong)'
                        }}
                      >
                        <div 
                          className="w-3 h-3 rounded-full bg-white transition-transform duration-200"
                          style={{
                            transform: securityPrefs.twoFA ? 'translateX(16px)' : 'translateX(0)'
                          }}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex flex-col leading-none">
                        <span className="text-xs font-medium text-[var(--ui-text)]">Password Alerts</span>
                        <span className="text-[9px] text-[var(--ui-muted)] mt-0.5">Alerts on credentials mutation</span>
                      </div>
                      <button 
                        onClick={togglePasswordAlerts}
                        className="w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer"
                        style={{
                          backgroundColor: securityPrefs.passwordAlerts ? 'var(--ui-accent)' : 'var(--ui-border-strong)'
                        }}
                      >
                        <div 
                          className="w-3 h-3 rounded-full bg-white transition-transform duration-200"
                          style={{
                            transform: securityPrefs.passwordAlerts ? 'translateX(16px)' : 'translateX(0)'
                          }}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Settings and Actions */}
                  <div className="p-2 space-y-1" style={{ backgroundColor: 'var(--ui-panel-soft)' }}>
                    <button
                      onClick={() => {
                        setActiveTab('settings');
                        setProfileOpen(false);
                        window.dispatchEvent(new CustomEvent('corex:settings:focus'));
                      }}
                      className="w-full text-left p-2 rounded text-xs flex items-center gap-2 hover:bg-[var(--ui-border)] text-[var(--ui-text)] cursor-pointer"
                    >
                      <Settings size={13} style={{ color: 'var(--ui-accent)' }} />
                      MT5/MetaAPI Settings
                    </button>
                    
                    <button
                      onClick={handleSignout}
                      className="w-full text-left p-2 rounded text-xs flex items-center gap-2 hover:bg-red-500/10 text-red-500 cursor-pointer"
                    >
                      <LogOut size={13} />
                      Sign Out Session
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* VIEW CONTENT: Fills remaining height, absolute no outer scroll */}
        <main className="flex-1 relative overflow-hidden min-h-0 bg-[var(--ui-bg)]">
          <ErrorBoundary>
            {renderViews()}
          </ErrorBoundary>
        </main>
      </div>

      <KeyboardShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
    </div>
  );
}
