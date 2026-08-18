import React, { createContext, useContext, ReactNode, useState } from 'react';
import useDataStore from '../store/dataStore';

interface TerminalContextType {
  addLog: (strategyId: string, level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', msg: string) => void;
  isTerminalVisible: boolean;
  setIsTerminalVisible: (visible: boolean) => void;
}

const TerminalContext = createContext<TerminalContextType | undefined>(undefined);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const addStrategyLog = useDataStore((state) => state.addStrategyLog);
  const [isTerminalVisible, setIsTerminalVisible] = useState(true);

  const addLog = (strategyId: string, level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', msg: string) => {
    addStrategyLog(strategyId, level, msg);
  };

  return (
    <TerminalContext.Provider value={{ addLog, isTerminalVisible, setIsTerminalVisible }}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminalContext() {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminalContext must be used within a TerminalProvider');
  }
  return context;
}
