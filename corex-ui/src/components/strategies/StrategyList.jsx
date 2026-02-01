import React from 'react';
import { FileCode, Trash2 } from 'lucide-react';

const StrategyList = ({ items, activeId, onSelect, onDelete }) => {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all ${
            activeId === item.id 
            ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' 
            : 'hover:bg-slate-800 text-slate-400'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            <FileCode size={14} className={activeId === item.id ? 'text-blue-400' : 'text-slate-500'} />
            <span className="text-xs font-mono truncate">{item.id}.js</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 hover:text-red-500 rounded transition-all"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default StrategyList;