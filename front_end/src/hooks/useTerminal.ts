import useDataStore from '../store/dataStore';

export function useTerminal(strategyId: string | null) {
  const { stratTerminalById, addStrategyLog, clearStrategyLogs } = useDataStore();
  const logs = strategyId ? (stratTerminalById[strategyId] || []) : [];

  return {
    logs,
    logInfo: (msg: string) => strategyId && addStrategyLog(strategyId, 'INFO', msg),
    logWarn: (msg: string) => strategyId && addStrategyLog(strategyId, 'WARN', msg),
    logError: (msg: string) => strategyId && addStrategyLog(strategyId, 'ERROR', msg),
    clear: () => strategyId && clearStrategyLogs(strategyId),
  };
}
export default useTerminal;
