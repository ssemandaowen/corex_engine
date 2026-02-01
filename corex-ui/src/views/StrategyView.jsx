import React, { useState, useEffect } from 'react';
import client from '../api/client';
import StrategyList from '../components/strategies/StrategyList';
import EditorPanel from '../components/strategies/EditorPanel';

const StrategyView = () => {
  const [strategies, setStrategies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);

  // 1. Fetch the list on mount
  const refreshList = async () => {
    try {
      const res = await client.get('/strategies');
      setStrategies(res.payload);
    } catch (err) {
      console.error("Failed to load library:", err);
    }
  };

  useEffect(() => { refreshList(); }, []);

  // 2. Delete Handler
  const handleDelete = async (id) => {
    if (!window.confirm(`Delete ${id}? This cannot be undone.`)) return;
    try {
      await client.delete(`/strategies/${id}`);
      refreshList();
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      alert("Delete failed");
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6 h-[calc(100vh-120px)]">
      {/* Left Column: The File Explorer */}
      <div className="col-span-3 bg-slate-800 rounded-lg p-4 border border-slate-700 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-bold text-slate-400 uppercase">Library</h2>
          <button 
            onClick={() => {/* Logic for New File Modal */}}
            className="text-blue-400 hover:text-white text-xl"
          >+</button>
        </div>
        <StrategyList 
          items={strategies} 
          activeId={selectedId} 
          onSelect={setSelectedId} 
          onDelete={handleDelete}
        />
      </div>

      {/* Right Column: The Editor Workspace */}
      <div className="col-span-9 bg-slate-900 rounded-lg border border-slate-700 relative">
        {selectedId ? (
          <EditorPanel 
            id={selectedId} 
            onSave={refreshList} 
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 italic">
            Select a strategy from the library to edit
          </div>
        )}
      </div>
    </div>
  );
};

export default StrategyView;