import useDataStore from '../store/dataStore';

export function useLogger() {
  const { activityLogs, addActivityLog, clearActivityLogs } = useDataStore();

  return {
    logs: activityLogs,
    logInfo: (msg: string) => addActivityLog('INFO', msg),
    logWarn: (msg: string) => addActivityLog('WARN', msg),
    logError: (msg: string) => addActivityLog('ERROR', msg),
    clear: clearActivityLogs,
  };
}
export default useLogger;
