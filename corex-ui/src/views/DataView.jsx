import React, { useState, useEffect } from 'react';
import client from "../api/client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const DataView = () => {
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);

  useEffect(() => {
    const fetchReports = async () => {
      const res = await client.get('/backtest');
      setReports(res.payload);
    };
    fetchReports();
  }, []);

  const loadReportDetails = async (id) => {
    const res = await client.get(`/backtest/${id}`);
    setSelectedReport(res.payload);
  };

  return (
    <div className="grid grid-cols-12 gap-6 h-[calc(100vh-150px)]">
      {/* Report List Sidebar */}
      <div className="col-span-3 bg-slate-800 rounded-lg border border-slate-700 overflow-y-auto">
        <h3 className="p-4 text-xs font-bold text-slate-500 uppercase border-b border-slate-700">Backtest History</h3>
        {reports.map(r => (
          <div 
            key={r.id} 
            onClick={() => loadReportDetails(r.id)}
            className={`p-4 cursor-pointer border-b border-slate-700 hover:bg-slate-700 transition-colors ${selectedReport?.metadata?.id === r.id ? 'bg-slate-700 border-l-4 border-l-blue-500' : ''}`}
          >
            <div className="text-sm font-medium truncate">{r.id}</div>
            <div className="text-[10px] text-slate-500">{new Date(r.timestamp).toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Report Analytics Dashboard */}
      <div className="col-span-9 bg-slate-900 rounded-lg border border-slate-700 p-6 overflow-y-auto">
        {selectedReport ? (
          <div>
            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-slate-800 p-4 rounded shadow-inner">
                <p className="text-[10px] text-slate-500 uppercase">Net Profit</p>
                <p className={`text-xl font-bold ${selectedReport.summary.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${selectedReport.summary.netProfit.toFixed(2)}
                </p>
              </div>
              <div className="bg-slate-800 p-4 rounded shadow-inner">
                <p className="text-[10px] text-slate-500 uppercase">Win Rate</p>
                <p className="text-xl font-bold">{(selectedReport.summary.winRate * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-slate-800 p-4 rounded shadow-inner">
                <p className="text-[10px] text-slate-500 uppercase">Total Trades</p>
                <p className="text-xl font-bold">{selectedReport.summary.totalTrades}</p>
              </div>
              <div className="bg-slate-800 p-4 rounded shadow-inner">
                <p className="text-[10px] text-slate-500 uppercase">Max Drawdown</p>
                <p className="text-xl font-bold text-red-400">{selectedReport.summary.maxDrawdown.toFixed(2)}%</p>
              </div>
            </div>

            <div className="h-80 w-full bg-slate-800/50 rounded-lg p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={selectedReport.equityCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" hide />
                  <YAxis stroke="#94a3b8" fontSize={12} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
                  <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-600">
            <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p>Select a backtest report to analyze performance</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DataView;