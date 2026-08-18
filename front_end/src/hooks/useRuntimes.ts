import { useEffect } from 'react';
import { useDataStore } from '../store/dataStore';
import { runApi } from '../api/run';

/**
 * Single shared source of truth for live strategy runtime instances.
 *
 * Polls GET /api/run/ops/telemetry every 4s and writes the real running
 * instance list into the data store's `runtimes` map (keyed by strategy name).
 * Every view that needs to know "is this strategy running / what's its P&L /
 * position" reads from that one map instead of each inventing its own polling
 * loop and its own id-matching scheme (which is exactly what diverged before).
 */
let globalTimer: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;

export function useRuntimes(pollMs = 4000) {
  const setRuntimes = useDataStore((s) => s.setRuntimes);

  useEffect(() => {
    subscriberCount += 1;

    const fetchOnce = async () => {
      if (document.hidden) return;
      try {
        const res = await runApi.getOpsTelemetry();
        if (res && res.success && res.payload) {
          setRuntimes(res.payload.runtimes || []);
        }
      } catch (e) {
        // Non-fatal: keep last known runtimes until the next successful poll.
      }
    };

    // First paint should reflect reality immediately, not after one interval.
    fetchOnce();
    if (!globalTimer) {
      globalTimer = setInterval(() => {
        // The timer fires for everyone; each subscriber re-fetches via closure.
        fetchOnce();
      }, pollMs);
    }

    return () => {
      subscriberCount -= 1;
      if (subscriberCount <= 0 && globalTimer) {
        clearInterval(globalTimer);
        globalTimer = null;
        subscriberCount = 0;
      }
    };
  }, [pollMs, setRuntimes]);
}
