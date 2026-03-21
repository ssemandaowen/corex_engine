import { useContext } from 'react';
import TerminalContext from '../context/terminalContextStore';

export const useTerminal = () => {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within TerminalProvider');
  }
  return context;
};

export default useTerminal;
