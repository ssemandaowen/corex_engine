import React, { useState } from 'react';
import { 
  Home, 
  Code2, 
  Play, 
  BarChart2, 
  BookOpen, 
  Wallet, 
  Settings2, 
  ChevronLeft, 
  ChevronRight,
  User as UserIcon,
  Cpu,
  Radio
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  userName?: string;
  userEmail?: string;
  engineStatus?: 'STABLE' | 'DEGRADED' | 'OFFLINE';
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  collapsed,
  onToggleCollapse,
  userName = 'Owen Ssemanda',
  userEmail = 'ssemandaowen245@gmail.com',
  engineStatus = 'OFFLINE'
}: SidebarProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);

  const getStatusColor = (status: string) => {
    const s = String(status || '').toUpperCase();
    if (['STABLE', 'CONNECTED', 'OK', 'RUNNING'].includes(s)) return 'var(--ui-positive)';
    if (['DEGRADED', 'PENDING', 'RECONNECTING'].includes(s)) return 'var(--ui-warning)';
    return 'var(--ui-negative)';
  };

  const navItems = [
    { id: 'home', icon: Home },
    { id: 'strategies', icon: Code2 },
    { id: 'run', icon: Play },
    { id: 'data', icon: BarChart2 },
    { id: 'account', icon: Wallet },
    { id: 'settings', icon: Settings2 },
  ];

  return (
    <aside 
      className="flex flex-col h-screen border-r shrink-0 transition-all duration-300 relative select-none"
      style={{
        width: collapsed ? '56px' : '160px',
        backgroundColor: 'var(--ui-sidebar-bg)',
        borderColor: 'var(--ui-border)'
      }}
    >
      {/* Sidebar Header */}
      <div 
        className="flex items-center h-12 border-b px-2.5 justify-between relative cursor-pointer select-none group/header" 
        style={{ borderColor: 'var(--ui-border)' }}
        onMouseEnter={() => setIsHeaderHovered(true)}
        onMouseLeave={() => setIsHeaderHovered(false)}
        onClick={onToggleCollapse}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {!collapsed ? (
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            <div className="relative w-5 h-5 flex items-center justify-center shrink-0">
              {isHeaderHovered ? (
                <ChevronLeft size={14} className="text-[var(--ui-accent)] transition-all duration-150" />
              ) : (
                <img src="/corex.svg" alt="CoreX Logo" className="w-5 h-5" />
              )}
            </div>
            <span className="font-display font-bold text-xs tracking-wide text-white truncate">
              CORE<span style={{ color: 'var(--ui-accent)' }}>X</span>
            </span>
          </div>
        ) : (
          <div className="flex justify-center w-full items-center">
            <div className="relative w-5 h-5 flex items-center justify-center shrink-0">
              {isHeaderHovered ? (
                <ChevronRight size={14} className="text-[var(--ui-accent)] transition-all duration-150" />
              ) : (
                <img src="/corex.svg" alt="CoreX" className="w-5 h-5" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Engine Status Indicator */}
      {!collapsed && (
        <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--ui-border)' }}>
          <span 
            className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
            style={{ backgroundColor: getStatusColor(engineStatus) }}
          />
          <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--ui-muted)' }}>
            {engineStatus}
          </span>
        </div>
      )}

      {/* Navigation Items */}
      <nav className="flex-1 py-3 flex flex-col gap-0.5 px-1.5 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <div
              key={item.id}
              className="relative"
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
            >
              <button
                onClick={() => setActiveTab(item.id)}
                className="w-full flex items-center justify-center py-2 rounded transition-all duration-200 cursor-pointer relative"
                style={{
                  backgroundColor: isActive ? 'var(--ui-panel-soft)' : 'transparent',
                  color: isActive ? 'var(--ui-accent)' : 'var(--ui-muted)',
                }}
                title={item.id}
              >
                {isActive && (
                  <span 
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-r"
                    style={{ backgroundColor: 'var(--ui-accent)' }}
                  />
                )}

                <Icon size={18} className={isActive ? 'stroke-[2.5px]' : 'stroke-[1.8px]'} />
              </button>

              {/* Tooltip for collapsed state */}
              {collapsed && hoveredItem === item.id && (
                <div 
                  className="absolute left-14 top-1/2 -translate-y-1/2 px-2 py-1 rounded text-[10px] font-sans font-bold uppercase tracking-wider whitespace-nowrap z-50 border shadow-md"
                  style={{
                    backgroundColor: 'var(--ui-panel-strong)',
                    borderColor: 'var(--ui-border-strong)',
                    color: 'var(--ui-text)'
                  }}
                >
                  {item.id}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User profile section at the bottom */}
      <div 
        className="p-2.5 border-t flex items-center gap-2 overflow-hidden"
        style={{ borderColor: 'var(--ui-border)' }}
      >
        <div 
          className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center border font-display font-bold text-[10px]"
          style={{
            backgroundColor: 'var(--ui-panel-strong)',
            borderColor: 'var(--ui-border)',
            color: 'var(--ui-accent)'
          }}
        >
          {userName.charAt(0)}
        </div>
        
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-bold truncate leading-none" style={{ color: 'var(--ui-text)' }}>
              {userName}
            </span>
            <span className="text-[8px] truncate mt-0.5 leading-none" style={{ color: 'var(--ui-muted)' }}>
              {userEmail}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
