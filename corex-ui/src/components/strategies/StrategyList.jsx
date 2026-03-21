import React, { useState } from 'react';
import { MoreVertical, Play, Square, Edit3, Trash2, Download, Pencil } from 'lucide-react';

const StrategyItem = ({ item, isActive, onSelect, onAction }) => {
  const [showMenu, setShowMenu] = useState(false);
  const id = item.id || item.name;
  const isRunning = ['ACTIVE', 'WARMING_UP'].includes(item.status);

  const actions = [
    { label: 'Edit', icon: <Edit3 size={14}/>, cmd: 'OPEN', color: 'text-slate-300' },
    { label: 'Rename', icon: <Pencil size={14}/>, cmd: 'RENAME', color: 'text-slate-300' },
    { label: 'Export Script', icon: <Download size={14}/>, cmd: 'EXPORT', color: 'text-slate-300' },
    isRunning
      ? { label: 'Stop', icon: <Square size={14}/>, cmd: 'STOP', color: 'text-rose-400' }
      : { label: 'Start', icon: <Play size={14}/>, cmd: 'START', color: 'text-emerald-400' },
    { label: 'Delete', icon: <Trash2 size={14}/>, cmd: 'DELETE', color: 'text-red-500' },
  ];

  return (
    <div
      className={`group relative flex items-center justify-between p-3 rounded-lg mb-1 cursor-pointer transition-all border ${
        isActive ? 'bg-blue-600/10 border-blue-500/30' : 'hover:bg-white/5 border-transparent'
      }`}
      onClick={() => onSelect(id)}
    >
      <div className="flex flex-col overflow-hidden">
        <span className={`text-[11px] font-mono font-bold truncate ${isActive ? 'text-blue-400' : 'text-[var(--ui-text)]'}`}>
          {item.name}.js
        </span>
      </div>
      <div className="relative">
        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
          className="p-1 text-[var(--ui-muted)] hover:text-[var(--ui-text)] transition-colors"
        >
          <MoreVertical size={16} />
        </button>
        {showMenu && (
          <div className="absolute right-0 mt-2 w-48 bg-[var(--ui-panel-strong)] border border-[var(--ui-border)] rounded-lg shadow-2xl z-50 py-1 overflow-hidden">
            {actions.map((act) => (
              <button
                key={act.label}
                className={`w-full flex items-center gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-tight hover:bg-white/5 transition-colors ${act.color}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(act.cmd, id);
                  setShowMenu(false);
                }}
              >
                {act.icon} {act.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const StrategyList = ({ items, activeId, onSelect, onAction }) => {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <StrategyItem
          key={item.id || item.name}
          item={item}
          isActive={activeId === (item.id || item.name)}
          onSelect={onSelect}
          onAction={(cmd, id) => onAction ? onAction(cmd, id) : onSelect(id)}
        />
      ))}
    </div>
  );
};

export default StrategyList;
