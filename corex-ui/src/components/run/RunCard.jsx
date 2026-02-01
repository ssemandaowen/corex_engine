import React, { useState } from 'react';
import client from "../../api/client";

const RunCard = ({ strategy }) => {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('PAPER'); // Default

  const handleStart = async () => {
    setLoading(true);
    try {
      // POST /api/run/start/:id
      const res = await client.post(`/run/start/${strategy.id}`, { mode });
      console.log(res.message);
    } catch (err) {
      alert(`Start Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await client.post(`/run/stop/${strategy.id}`);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 p-4 rounded-lg">
      <div className="flex justify-between mb-4">
        <h3 className="font-bold text-lg">{strategy.name}</h3>
        <span className={`px-2 py-1 rounded text-xs ${strategy.status === 'ACTIVE' ? 'bg-green-900 text-green-400' : 'bg-slate-700 text-slate-400'}`}>
          {strategy.status}
        </span>
      </div>

      <div className="flex gap-2 mb-4">
        <select 
          value={mode} 
          onChange={(e) => setMode(e.target.value)}
          className="bg-slate-900 border border-slate-600 text-sm p-1 rounded w-full"
          disabled={strategy.status === 'ACTIVE'}
        >
          <option value="PAPER">PAPER TRADING</option>
          <option value="LIVE">LIVE (MT4/5 BRIDGE)</option>
        </select>
      </div>

      {strategy.status === 'ACTIVE' ? (
        <button 
          onClick={handleStop} 
          disabled={loading}
          className="w-full bg-red-600 hover:bg-red-700 p-2 rounded font-bold transition-colors"
        >
          STOP ENGINE
        </button>
      ) : (
        <button 
          onClick={handleStart} 
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded font-bold transition-colors"
        >
          DEPLOY STRATEGY
        </button>
      )}
    </div>
  );
};

export default RunCard;