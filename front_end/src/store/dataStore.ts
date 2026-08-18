
import { create } from 'zustand';
import { systemApi } from '../api/system';
import { authApi } from '../api/auth';
import { API_BASE_URL } from '../api/client';

export interface Strategy {
  id: string;
  name: string;
  script_body: string;
  schema?: any;
  runtime_params?: any;
  symbols?: string[];
  status: 'running' | 'stopped' | 'error';
  updatedAt: string;
}

export interface LogLine {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
}

interface DataState {
  strategies: Strategy[];
  selectedStrategyId: string | null;
  stratTerminalById: Record<string, LogLine[]>;
  activityLogs: LogLine[];
  systemStatus: any;
  feedMetrics: any;
  mt5Status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';
  mt5Account: any | null;
  mt5Positions: any[];
  latestTicks: Record<string, { bid: number; ask: number }>;
  backtestProgress: Record<string, { stage: string; pct: number; message: string; status?: string; error?: string; reportId?: string | null }>;
  runtimes: Record<string, any>;
  orders: any[];
  positions: any[];
  portfolio: any;
  strategyMetrics: Record<string, any>;
  workerState: any;
  systemErrors: { id: string; timestamp: string; message: string }[];
  ws: WebSocket | null;
  reconnectTimer: number | null;
  reconnectAttempts: number;

  addActivityLog: (level: LogLine['level'], message: string) => void;
  addStrategyLog: (strategyId: string, level: LogLine['level'], message: string) => void;
  clearActivityLogs: () => void;
  clearStrategyLogs: (strategyId: string) => void;
  setStrategies: (strategies: Strategy[]) => void;
  setSelectedStrategyId: (id: string | null) => void;
  updateStrategyStatus: (id: string, status: Strategy['status']) => void;
  setRuntimes: (runtimes: any[]) => void;
  upsertRuntime: (runtime: any) => void;
  
  fetchMt5Status: () => Promise<void>;
  connectWebSocket: () => void;
  disconnectWebSocket: () => void;
  ingestWsEvent: (data: any) => void;
  scheduleReconnect: () => void;
  setReconnectTimer: (timer: number | null) => void;
  setReconnectAttempts: (attempts: number) => void;
}

export const useDataStore = create<DataState>((set) => ({
  strategies: [],
  selectedStrategyId: null,
  stratTerminalById: {},
  // FIX (Owen, Jul 2026): These two lines used to be hardcoded fake "success"
  // messages left over from the original AI Studio scaffold. They never got
  // replaced by real data, so they looked like live logs forever even when the
  // WebSocket was disconnected or no SYSTEM_LOG events were coming through.
  // Now this just reflects the actual (unconnected) state until connectWebSocket()
  // succeeds and real SYSTEM_LOG/SYSTEM_ERROR events start arriving.
  activityLogs: [
    { id: '1', timestamp: new Date().toLocaleTimeString(), level: 'INFO', message: 'Terminal initialized — waiting for WebSocket connection...' },
  ],
  systemStatus: {
    // Honest defaults: nothing is known to be "CONNECTED" until the first
    // STATUS_UPDATE arrives over the WebSocket. Previously this was seeded as
    // CONNECTED/ONLINE, which made the UI look "live" even when the socket was
    // dead or the server was unreachable — exactly the fake "everything online
    // but no data" symptom.
    db: 'DISCONNECTED',
    feed: 'OFFLINE',
    broker: 'DISCONNECTED',
    worker: 'OFFLINE',
    uptime: 0,
    memory: 0,
    resources: { cpuPct: 0, ramPct: 0 }
  },
  feedMetrics: { eventsPerSec: 0, latencyMs: 0 },
  mt5Status: 'DISCONNECTED',
  mt5Account: null,
  mt5Positions: [],
  latestTicks: {},
  backtestProgress: {},
  orders: [],
  positions: [],
  portfolio: null,
  strategyMetrics: {},
  runtimes: {},
  workerState: null,
  systemErrors: [],
  ws: null,
  reconnectTimer: null,
  reconnectAttempts: 0,

  addActivityLog: (level, message) => set((state) => {
    const timestamp = new Date().toLocaleTimeString();
    const newLine: LogLine = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp,
      level,
      message,
    };
    return { activityLogs: [...state.activityLogs.slice(-299), newLine] };
  }),
  addStrategyLog: (strategyId, level, message) => set((state) => {
    const timestamp = new Date().toLocaleTimeString();
    const newLine: LogLine = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp,
      level,
      message,
    };
    const currentLogs = state.stratTerminalById[strategyId] || [];
    return {
      stratTerminalById: {
        ...state.stratTerminalById,
        [strategyId]: [...currentLogs.slice(-299), newLine],
      },
    };
  }),
  clearActivityLogs: () => set({ activityLogs: [] }),
  clearStrategyLogs: (strategyId) => set((state) => ({
    stratTerminalById: {
      ...state.stratTerminalById,
      [strategyId]: [],
    },
  })),
  setStrategies: (strategies) => set({ strategies }),
  setSelectedStrategyId: (id) => set({ selectedStrategyId: id }),
  updateStrategyStatus: (id, status) => set((state) => ({
    strategies: state.strategies.map((s) => s.id === id ? { ...s, status } : s)
  })),

  // Real running-instance list keyed by the strategy's name (the id the engine
  // uses). Each entry is the full runtime record from /api/run/ops/telemetry
  // plus any WS-emitted lifecycle events. This is the single source of truth
  // for "is this strategy running" across Home / Strategy editor / Execution.
  setRuntimes: (runtimes) => set(() => {
    const map: Record<string, any> = {};
    for (const r of runtimes || []) {
      const key = r.strategyName || r.id || r.runtimeId;
      if (key) map[key] = r;
    }
    return { runtimes: map };
  }),

  upsertRuntime: (runtime) => set((state) => {
    const key = runtime?.strategyName || runtime?.id || runtime?.runtimeId;
    if (!key) return {};
    return { runtimes: { ...state.runtimes, [key]: { ...state.runtimes[key], ...runtime } } };
  }),

  fetchMt5Status: async () => {
    try {
      const res = await systemApi.getMt5Status();
      if (res && res.success && res.payload) {
        set({
          mt5Status: res.payload.status,
          mt5Account: res.payload.account,
          mt5Positions: res.payload.positions || [],
        });
      }
    } catch (e) {
      console.error('Failed to fetch MT5 status fallback', e);
    }
  },

  connectWebSocket: () => {
    const currentWs = useDataStore.getState().ws;
    if (currentWs && currentWs.readyState === WebSocket.OPEN) return;

    try {
      const apiUrl = new URL(API_BASE_URL);
      const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = localStorage.getItem('corex_token') || '';

      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1] || ''));
          if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            localStorage.removeItem('corex_token');
            window.dispatchEvent(new CustomEvent('corex:unauthorized'));
            return;
          }
        } catch {
          // ignore token parse errors
        }
      }

      const wsUrl = `${wsProtocol}//${apiUrl.host}/ws?token=${encodeURIComponent(token)}`;
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log('CoreX Live Bridge WebSocket established');
        useDataStore.getState().addActivityLog('INFO', 'WebSocket connected — subscribing to status/feed/system channels');
        try {
          socket.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { channels: ['status', 'feed', 'system'] } }));
        } catch (e) {
          console.warn('CoreX WebSocket subscribe failed', e);
          useDataStore.getState().addActivityLog('WARN', `Subscribe message failed to send: ${e}`);
        }
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          useDataStore.getState().ingestWsEvent(data);
        } catch (e) {
          // Ignore
        }
      };

      socket.onclose = (event) => {
        console.log('CoreX Live Bridge WebSocket disconnected', event.code, event.reason);
        useDataStore.getState().addActivityLog('WARN', `WebSocket disconnected (code ${event.code}${event.reason ? `: ${event.reason}` : ''})`);
        set({ ws: null });
        if (event.code !== 1000) {
          const token = localStorage.getItem('corex_token') || '';
          let expired = false;
          if (token) {
            try {
              const payload = JSON.parse(atob(token.split('.')[1] || ''));
              expired = payload.exp ? payload.exp < Math.floor(Date.now() / 1000) : false;
            } catch {
              // ignore
            }
          }
          if (!expired) {
            // The token may still "look" valid by expiry but be rejected by the
            // server (e.g. signed by a previous backend secret after a restart).
            // Verify it once so a dead token can't loop forever hiding the app
            // behind a silent WS reconnect — instead send the user back to login.
            authApi.me()
              .then(() => useDataStore.getState().scheduleReconnect())
              .catch((err: any) => {
                const status = err?.response?.status;
                if (status === 401) {
                  localStorage.removeItem('corex_token');
                  window.dispatchEvent(new CustomEvent('corex:unauthorized'));
                } else {
                  useDataStore.getState().scheduleReconnect();
                }
              });
          } else {
            localStorage.removeItem('corex_token');
            window.dispatchEvent(new CustomEvent('corex:unauthorized'));
          }
        }
      };

      socket.onerror = (err) => {
        console.error('CoreX WebSocket error:', err);
        // Surface the failure in the terminal instead of only logging to
        // console, so connection problems are visible (the "web socket error
        // at initialization" symptom). The onclose handler below explains the
        // most likely cause (auth/token/socket destroy at the server upgrade).
        useDataStore.getState().addActivityLog('ERROR', 'WebSocket connection error — live feed unavailable. Check that you are authenticated and the server is reachable.');
      };

      set({ ws: socket, reconnectAttempts: 0 });
    } catch (e) {
      console.error('Failed to initiate WebSocket connection:', e);
    }
  },

  disconnectWebSocket: () => {
    const socket = useDataStore.getState().ws;
    if (socket) {
      socket.close(1000);
      set({ ws: null });
    }
    const timer = useDataStore.getState().reconnectTimer;
    if (timer) {
      clearTimeout(timer);
      set({ reconnectTimer: null });
    }
  },

  scheduleReconnect: () => {
    const state = useDataStore.getState();
    if (state.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
    console.log(`CoreX WebSocket reconnecting in ${delay}ms (attempt ${state.reconnectAttempts + 1})`);
    const timer = window.setTimeout(() => {
      useDataStore.getState().setReconnectTimer(null);
      useDataStore.getState().setReconnectAttempts(state.reconnectAttempts + 1);
      useDataStore.getState().connectWebSocket();
    }, delay);
    set({ reconnectTimer: timer });
  },

  setReconnectTimer: (timer: number | null) => set({ reconnectTimer: timer }),
  setReconnectAttempts: (attempts: number) => set({ reconnectAttempts: attempts }),

  ingestWsEvent: (data: any) => {
    if (!data || !data.type) return;
    switch (data.type) {
      case 'STATUS_UPDATE':
        if (data.payload) {
          set((state) => {
            const incoming = data.payload.strategies || [];
            const merged = [...state.strategies];
            const existingIds = new Set(merged.map(s => s.id));
            for (const s of incoming) {
              if (!existingIds.has(s.id)) {
                merged.push(s);
              }
            }
            return {
              systemStatus: data.payload.systemStatus || data.payload.pulse || state.systemStatus,
              strategies: merged,
            };
          });
        }
        break;
      case 'FEED_METRICS':
        set({ feedMetrics: data.payload });
        break;
      case 'MT5_BRIDGE_STATUS':
        set({
          mt5Status: data.payload?.bridgeStatus || 'DISCONNECTED',
          mt5Account: data.payload?.account || null,
          mt5Positions: data.payload?.positions || [],
        });
        break;
      case 'MT5_CONNECTED':
        set({ mt5Status: 'CONNECTED' });
        break;
      case 'MT5_DISCONNECTED':
        set({ mt5Status: 'DISCONNECTED' });
        break;
      case 'MT5_AUTHORIZED':
        set({ mt5Status: 'CONNECTED' });
        break;
      case 'MT5_AUTH_FAILED':
        set({ mt5Status: 'DISCONNECTED' });
        break;
      case 'MT5_HEARTBEAT':
        break;
      case 'MT5_ACCOUNT_SYNC':
        if (data.payload) {
          set({ mt5Account: data.payload?.payload || data.payload });
        }
        break;
      case 'MT5_POSITIONS_SYNC':
        if (data.payload) {
          set({ mt5Positions: data.payload?.payload || data.payload });
        }
        break;
      case 'DATA_TICK':
        if (data.payload && data.payload.symbol) {
          set((state) => ({
            latestTicks: {
              ...state.latestTicks,
              [data.payload.symbol]: {
                bid: data.payload.bid,
                ask: data.payload.ask,
              },
            },
          }));
        }
        break;
      case 'DATA_CANDLE':
        if (data.payload && data.payload.symbol) {
          set((state) => ({
            latestTicks: {
              ...state.latestTicks,
              [data.payload.symbol]: {
                bid: data.payload.bid,
                ask: data.payload.ask,
              },
            },
          }));
        }
        break;
      case 'MARKET_LOST':
        break;
      case 'ORDER_CREATED':
      case 'ORDER_FILLED':
      case 'ORDER_CANCELLED':
      case 'ORDER_UPDATED':
        if (data.payload) {
          set((state) => {
            const idx = state.orders.findIndex(
              (p: any) => p.id === data.payload.id || p.orderId === data.payload.id
            );
            if (idx >= 0) {
              const next = [...state.orders];
              next[idx] = data.payload;
              return { orders: next };
            }
            return { orders: [data.payload, ...state.orders].slice(0, 500) };
          });
        }
        break;
      case 'POSITION_UPDATED':
        if (data.payload) {
          set((state) => {
            const idx = state.positions.findIndex(
              (p: any) => p.id === data.payload.id || p.positionId === data.payload.id
            );
            if (idx >= 0) {
              const next = [...state.positions];
              next[idx] = data.payload;
              return { positions: next };
            }
            return { positions: [data.payload, ...state.positions].slice(0, 500) };
          });
        }
        break;
      case 'PORTFOLIO_UPDATED':
        if (data.payload) {
          set({ portfolio: data.payload });
        }
        break;
      case 'STRATEGY_START':
      case 'STRATEGY_STOP':
      case 'STRATEGY_STATE': {
        const sid = data.payload
          ? String(data.payload.strategyId || data.payload.runtimeId || data.payload.id || '')
          : '';
        if (!sid) break;
        const status =
          data.type === 'STRATEGY_START'
            ? 'running'
            : data.type === 'STRATEGY_STOP'
            ? 'stopped'
            : (data.payload?.status as 'running' | 'stopped' | 'error') || 'stopped';
        set((state) => {
          // Update the per-strategy status (scoped id match) and the runtime map
          // (keyed by strategy name). The engine emits the composite
          // userId::strategyName as strategyId; match the trailing name too so
          // both the scoped and unscoped ids reflect the live state.
          const nameMatch = sid.includes('::') ? sid.split('::').slice(1).join('::') : sid;
          const strategies = state.strategies.map((s) =>
            (s.id === sid || s.id === nameMatch) ? { ...s, status } : s
          );
          const runtimeKey = state.runtimes[nameMatch] ? nameMatch
            : (state.runtimes[sid] ? sid : nameMatch);
          const runtimes = runtimeKey
            ? { ...state.runtimes, [runtimeKey]: { ...state.runtimes[runtimeKey], status, strategyName: runtimeKey } }
            : state.runtimes;
          return { strategies, runtimes };
        });
        break;
      }
      case 'STRATEGY_LOADED': {
        const sid = data.payload
          ? String(data.payload.strategyId || data.payload.id || data.payload.name || '')
          : '';
        if (!sid) break;
        set((state) => ({
          strategies: [
            ...state.strategies.filter((s) => s.id !== sid),
            {
              id: sid,
              name: sid,
              script_body: '',
              schema: data.payload?.schema || {},
              status: 'stopped' as const,
              updatedAt: new Date().toISOString(),
            },
          ],
        }));
        break;
      }
      case 'STRATEGY_UNLOADED': {
        const sid = data.payload
          ? String(data.payload.strategyId || data.payload.id || data.payload.name || '')
          : '';
        if (!sid) break;
        set((state) => ({
          strategies: state.strategies.filter((s) => s.id !== sid),
        }));
        break;
      }
      case 'STRATEGY_PARAMS_UPDATED': {
        const sid = data.payload
          ? String(data.payload.strategyId || data.payload.id || '')
          : '';
        if (!sid) break;
        set((state) => ({
          strategies: state.strategies.map((s) =>
            s.id === sid
              ? {
                  ...s,
                  runtime_params: data.payload?.params || data.payload?.runtime_params || s.runtime_params,
                }
              : s
          ),
        }));
        break;
      }
      case 'STRATEGY_METRICS_TICK': {
        const sid = data.payload
          ? String(data.payload.strategyId || data.payload.id || '')
          : '';
        if (!sid) break;
        set((state) => ({
          strategyMetrics: {
            ...state.strategyMetrics,
            [sid]: data.payload,
          },
        }));
        break;
      }
      case 'STRATEGY_SIGNAL':
        if (data.payload) {
          const sid = data.payload
            ? String(data.payload.strategyId || data.payload.id || '')
            : '';
          if (!sid) break;
          const timestamp = new Date().toLocaleTimeString();
          const logLine = {
            id: Math.random().toString(36).substr(2, 9),
            timestamp,
            level: 'INFO' as const,
            message: String(data.payload.signal || data.payload.message || 'Strategy signal'),
          };
          set((state) => ({
            stratTerminalById: {
              ...state.stratTerminalById,
              [sid]: [...(state.stratTerminalById[sid] || []).slice(-299), logLine],
            },
          }));
        }
        break;
      case 'WORKER_STATE':
        if (data.payload) {
          set({ workerState: data.payload });
        }
        break;
      case 'BACKTEST_PROGRESS':
        if (data.payload?.jobId) {
          const jobId = String(data.payload.jobId);
          // The worker nests live values under `payload.progress`
          // ({ stage, message, pct, steps }); top-level fields carry only
          // status/error/reportId. Normalize both shapes so the UI reflects
          // real progress instead of staying pinned at 0%.
          const prog = data.payload.progress || {};
          const pctVal = Number.isFinite(Number(prog.pct))
            ? Number(prog.pct)
            : (Number.isFinite(Number(data.payload.pct)) ? Number(data.payload.pct) : 0);
          const reportId = data.payload.resultMeta?.id
            ? String(data.payload.resultMeta.id)
            : (data.payload.reportId ? String(data.payload.reportId) : null);
          set((state) => ({
            backtestProgress: {
              ...state.backtestProgress,
              [jobId]: {
                stage: prog.stage || data.payload.currentStage || data.payload.status || 'RUNNING',
                pct: pctVal,
                message: prog.message || data.payload.currentMessage || '',
                status: data.payload.status,
                error: data.payload.error || null,
                reportId,
              },
            },
          }));
        }
        break;
      case 'SYSTEM_LOG':
        if (data.payload) {
          const timestamp = new Date().toLocaleTimeString();
          const logLine = {
            id: Math.random().toString(36).substr(2, 9),
            timestamp,
            level: (data.payload.level || 'INFO').toUpperCase() as any,
            message: String(data.payload.message || ''),
          };
          const sid = data.payload
            ? String(data.payload.strategyId || data.payload.runtimeId || '')
            : '';
          set((state) => ({
            activityLogs: [...state.activityLogs.slice(-299), logLine],
            ...(sid
              ? {
                  stratTerminalById: {
                    ...state.stratTerminalById,
                    [sid]: [...(state.stratTerminalById[sid] || []).slice(-299), logLine],
                  },
                }
              : {}),
          }));
        }
        break;
      case 'SYSTEM_ERROR':
        if (data.payload) {
          const timestamp = new Date().toLocaleTimeString();
          const logLine = {
            id: Math.random().toString(36).substr(2, 9),
            timestamp,
            level: 'ERROR' as const,
            message: String(data.payload.message || data.payload.error || 'Unknown system error'),
          };
          set((state) => ({
            activityLogs: [...state.activityLogs.slice(-299), logLine],
            systemErrors: [...state.systemErrors, { id: logLine.id, timestamp: logLine.timestamp, message: logLine.message }].slice(-299),
          }));
        }
        break;
      case 'RUNTIME_MEMORY_WARNING':
        if (data.payload) {
          const timestamp = new Date().toLocaleTimeString();
          const logLine = {
            id: Math.random().toString(36).substr(2, 9),
            timestamp,
            level: 'WARN' as const,
            message: String(data.payload.message || 'Runtime memory warning'),
          };
          set((state) => ({
            activityLogs: [...state.activityLogs.slice(-299), logLine],
          }));
        }
        break;
      case 'PARAM_UPDATE':
        break;
    }
  }
}));

export default useDataStore;
