import React from 'react';
import { Home, Code, Play, BarChart2, User, Settings, ChevronLeft, ChevronRight } from "lucide-react";

const Sidebar = ({ activeTab, setActiveTab, collapsed, onToggleCollapse }) => {
  const menu = [
    { id: 'home', label: 'Pulse', icon: Home },
    { id: 'strategies', label: 'Library', icon: Code },
    { id: 'run', label: 'Execution', icon: Play },
    { id: 'data', label: 'Analytics', icon: BarChart2 },
    { id: 'account', label: 'Broker', icon: User },
    { id: 'settings', label: 'Config', icon: Settings },
  ];

  return (
    <aside className={`ui-sidebar flex flex-col ${collapsed ? 'collapsed' : ''}`}>
      <div className="p-6">
        <div className="flex items-center justify-between relative">
          {collapsed ? (
            <button
              onClick={onToggleCollapse}
              className="ui-sidebar-toggle ui-sidebar-toggle-logo"
              aria-label="Expand sidebar"
            >
              <img src="/corex.svg" alt="CoreX" className="h-6 w-6" />
            </button>
          ) : (
            <>
              <button
                type="button"
                className="sidebar-logo-button flex items-center gap-2"
                aria-label="CoreX"
              >
                <img src="/corex.svg" alt="CoreX" className="h-6 w-6" />
                <h1 className="text-xl font-semibold tracking-tight text-[var(--ui-text)] brand-text">
                  CORE<span className="text-[var(--ui-accent)]">X</span>
                </h1>
              </button>
              <button
                onClick={onToggleCollapse}
                className="ui-sidebar-toggle"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft size={16} />
              </button>
            </>
          )}
        </div>
        <div className="mt-3 text-[11px] text-[var(--ui-muted)] brand-text">Strategy engine console</div>
      </div>
      <nav className="flex-1 px-4 space-y-1">
        {menu.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm transition-all ${
              activeTab === item.id 
                ? 'bg-[var(--ui-row-hover)] text-[var(--ui-accent)] font-semibold shadow-[0_0_20px_rgba(59,130,246,0.15)]' 
                : 'text-[var(--ui-muted)] hover:bg-[var(--ui-row-hover)] hover:text-[var(--ui-text)]'
            }`}
          >
            <item.icon size={18} />
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;
