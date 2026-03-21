import { useTerminal } from './useTerminalContext';

/**
 * useLogger Hook
 * Convenient wrapper around useTerminal for logging
 * 
 * Usage:
 * const log = useLogger('MyComponent');
 * log.info('Something happened');
 * log.error('An error occurred', { details: ... });
 * log.warn('Warning message');
 * log.strategy('Strategy executed trade');
 */

export const useLogger = (source = 'app') => {
  const { addLog } = useTerminal();

  return {
    info: (message, data) => addLog('info', message, data, source),
    error: (message, data) => addLog('error', message, data, source),
    warn: (message, data) => addLog('warn', message, data, source),
    strategy: (message, data) => addLog('strategy', message, data, source),
    debug: (message, data) => addLog('info', `[DEBUG] ${message}`, data, source),
  };
};

export default useLogger;
