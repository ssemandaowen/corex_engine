import React, { useEffect, useState } from 'react';
import { Database, AlertCircle, Loader } from 'lucide-react';
import client from '../../api/client';

/**
 * DatasetInfo Component
 * Displays metadata about the dataset being used by a running strategy
 */
const DatasetInfo = ({ strategyId, isRunning = false }) => {
  const [dataset, setDataset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isRunning || !strategyId) {
      setDataset(null);
      return;
    }

    const fetchDataset = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await client.get(`/run/dataset/${strategyId}`);
        if (res.success && res.payload) {
          setDataset(res.payload);
        } else {
          setError(res.error || 'Failed to load dataset info');
        }
      } catch (err) {
        setError(err.message || 'Error fetching dataset');
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchDataset, 200); // Small delay to avoid hammering API
    return () => clearTimeout(timer);
  }, [strategyId, isRunning]);

  if (!isRunning || !dataset) {
    return null;
  }

  if (error) {
    return (
      <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-start gap-2 text-[10px] text-amber-300 font-mono">
        <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mb-3 rounded-lg border border-[var(--ui-border)] px-3 py-2 flex items-center gap-2 text-[10px] text-[var(--ui-muted)]">
        <Loader size={12} className="animate-spin flex-shrink-0" />
        <span>Loading dataset info...</span>
      </div>
    );
  }

  return (
    <div className="mb-3 p-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel-strong)]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Database size={12} className="text-[var(--ui-accent)]" />
        <span className="text-[9px] text-[var(--ui-muted)] font-bold uppercase tracking-wider">Dataset</span>
      </div>

      {/* Dataset Name */}
      <div className="mb-2">
        <div className="text-[10px] text-[var(--ui-text)] font-mono font-semibold truncate" title={dataset.datasetName}>
          {dataset.datasetName}
        </div>
        {dataset.uploadedAt && (
          <div className="text-[8px] text-[var(--ui-muted)] mt-0.5">
            Uploaded {new Date(dataset.uploadedAt).toLocaleDateString()} at {new Date(dataset.uploadedAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-2 mb-2 text-[9px]">
        {dataset.recordCount > 0 && (
          <div className="flex flex-col">
            <span className="text-[var(--ui-muted)] uppercase tracking-tight">Records</span>
            <span className="text-[var(--ui-text)] font-mono font-semibold">{dataset.recordCount.toLocaleString()}</span>
          </div>
        )}
        
        {dataset.symbols && dataset.symbols.length > 0 && (
          <div className="flex flex-col">
            <span className="text-[var(--ui-muted)] uppercase tracking-tight">Symbols</span>
            <span className="text-[var(--ui-text)] font-mono font-semibold">{dataset.symbols.length}</span>
          </div>
        )}

        {dataset.dateRange && dataset.dateRange.start && dataset.dateRange.end && (
          <div className="col-span-2 flex flex-col">
            <span className="text-[var(--ui-muted)] uppercase tracking-tight">Date Range</span>
            <span className="text-[var(--ui-text)] font-mono font-semibold text-[8px]">
              {new Date(dataset.dateRange.start).toLocaleDateString()} → {new Date(dataset.dateRange.end).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>

      {/* Symbols List (if available) */}
      {dataset.symbols && dataset.symbols.length > 0 && dataset.symbols.length <= 5 && (
        <div className="text-[8px]">
          <span className="text-[var(--ui-muted)] uppercase tracking-tight block mb-1">Symbols</span>
          <div className="flex flex-wrap gap-1">
            {dataset.symbols.map((sym) => (
              <span
                key={sym}
                className="px-2 py-0.5 rounded bg-[var(--ui-accent)]/10 text-[var(--ui-accent)] font-mono"
              >
                {sym}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Source */}
      {dataset.source && (
        <div className="mt-2 text-[8px] text-[var(--ui-muted)] uppercase tracking-tight">
          Source: {dataset.source}
        </div>
      )}
    </div>
  );
};

export default DatasetInfo;
