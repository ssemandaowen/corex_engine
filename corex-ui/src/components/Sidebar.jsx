import React from 'react';
import { Home, Code, Play, BarChart2, User, Settings, ChevronLeft } from "lucide-react";

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
      <div className="p-6 border-b border-[var(--ui-border)]">
        <div className="flex items-center justify-between relative">
          {collapsed ? (
            <div className="w-full flex justify-center">
              <button
                onClick={onToggleCollapse}
                className="ui-sidebar-toggle ui-sidebar-toggle-logo hover:scale-110 transition-transform"
                aria-label="Expand sidebar"
              >
                <img src="/corex.svg" alt="CoreX" className="h-7 w-7" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <img src="/corex.svg" alt="CoreX" className="h-7 w-7" />
                <h1 className="text-xl font-bold tracking-tight brand-text">
                  CORE<span className="text-[var(--ui-accent)]">X</span>
                </h1>
              </div>
              <button
                onClick={onToggleCollapse}
                className="ui-sidebar-toggle hover:scale-110"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft size={16} />
              </button>
            </>
          )}
        </div>
        {!collapsed && (
          <div className="mt-3 text-[10px] text-[var(--ui-muted)] uppercase tracking-wider font-semibold brand-text">
            Strategy Engine Console
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
        {menu.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
              activeTab === item.id
                ? 'bg-gradient-to-r from-[var(--ui-accent)]/20 to-[var(--ui-accent)]/10 text-[var(--ui-accent)] border border-[var(--ui-accent)]/30 shadow-lg'
                : 'text-[var(--ui-muted)] hover:bg-[var(--ui-row-hover)] hover:text-[var(--ui-text)] border border-transparent'
            }`}
            title={collapsed ? item.label : undefined}
          >
            <item.icon size={20} strokeWidth={activeTab === item.id ? 2.5 : 2} />
            <span className="nav-label font-semibold">{item.label}</span>
          </button>
        ))}
      </nav>

      {!collapsed && (
        <div className="p-4 border-t border-[var(--ui-border)]">
          <div className="text-[9px] text-[var(--ui-subtle)] uppercase tracking-widest font-mono">
            v2.0.0 | Engine Ready
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
