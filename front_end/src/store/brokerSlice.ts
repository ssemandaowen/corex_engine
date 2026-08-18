import { create } from 'zustand';

export interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT' | 'FLAT';
  qty: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
}

interface BrokerState {
  balance: number;
  equity: number;
  unrealizedPnl: number;
  margin: number;
  positions: Position[];
  setBrokerData: (data: { balance: number; equity: number; unrealizedPnl: number; margin: number }) => void;
  setPositions: (positions: Position[]) => void;
  resetPaperAccount: (initialCapital: number) => void;
}

export const useBrokerStore = create<BrokerState>((set) => ({
  balance: 100000,
  equity: 100000,
  unrealizedPnl: 0,
  margin: 0,
  positions: [],
  setBrokerData: (data) => set(data),
  setPositions: (positions) => set({ positions }),
  resetPaperAccount: (initialCapital) => set({ balance: initialCapital, equity: initialCapital, unrealizedPnl: 0, margin: 0, positions: [] }),
}));
export default useBrokerStore;
