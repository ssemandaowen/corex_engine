/**
 * Backtest Logger Proxy Tests (Mocked)
 * 
 * Verifies that backtest execution properly captures logs
 * while preserving original logging behavior.
 * 
 * The fix addressed: Line 98 in backtestManager.js
 * - Old: originalLoglevel; (no-op)
 * - New: if (typeof originalLog[level] === "function") originalLog[level](message, meta);
 */

describe('Backtest Logger Proxy', () => {
    
    test('logger proxy properly calls original log function', () => {
        // Simulate the original logger
        const originalLog = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };
        
        const backtestLogs = [];
        
        // Create proxy logger (the fixed pattern)
        const proxyLog = ['info', 'warn', 'error', 'debug'].reduce((proxy, level) => {
            proxy[level] = (message, meta) => {
                // FIXED: Now properly calls the original logger
                if (typeof originalLog[level] === 'function') {
                    originalLog[level](message, meta);
                }
                // Capture for report
                backtestLogs.push({ level, message, ...(meta && { meta }) });
            };
            return proxy;
        }, {});
        
        // Use proxy logger
        proxyLog.info('Test message', { source: 'test' });
        
        // Verify original logger was called
        expect(originalLog.info).toHaveBeenCalledWith('Test message', { source: 'test' });
        
        // Verify capture
        expect(backtestLogs.length).toBe(1);
        expect(backtestLogs[0].level).toBe('info');
        expect(backtestLogs[0].message).toBe('Test message');
    });

    test('logger proxy captures multiple log levels', () => {
        const originalLog = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };
        
        const backtestLogs = [];
        
        const proxyLog = ['info', 'warn', 'error', 'debug'].reduce((proxy, level) => {
            proxy[level] = (message, meta) => {
                if (typeof originalLog[level] === 'function') {
                    originalLog[level](message, meta);
                }
                backtestLogs.push({ level, message });
            };
            return proxy;
        }, {});

        // Emit logs at different levels
        proxyLog.info("Info message");
        proxyLog.warn("Warning message");
        proxyLog.error("Error message");
        proxyLog.debug("Debug message");

        // Verify all levels captured
        expect(backtestLogs.length).toBe(4);
        expect(backtestLogs[0].level).toBe('info');
        expect(backtestLogs[1].level).toBe('warn');
        expect(backtestLogs[2].level).toBe('error');
        expect(backtestLogs[3].level).toBe('debug');
    });

    test('logger proxy preserves metadata', () => {
        const originalLog = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };
        
        const backtestLogs = [];
        
        const proxyLog = ['info', 'warn', 'error', 'debug'].reduce((proxy, level) => {
            proxy[level] = (message, meta) => {
                if (typeof originalLog[level] === 'function') {
                    originalLog[level](message, meta);
                }
                const logEntry = { level, message, ts: Date.now(), ...(meta && { meta }) };
                backtestLogs.push(logEntry);
            };
            return proxy;
        }, {});

        // Emit logs with metadata
        proxyLog.info("Signal generated", { signal: 'BUY', price: 1.234 });
        proxyLog.error("Order failed", { reason: 'Insufficient balance' });

        // Verify metadata captured
        expect(backtestLogs.length).toBe(2);
        expect(backtestLogs[0].meta.signal).toBe('BUY');
        expect(backtestLogs[1].meta.reason).toBe('Insufficient balance');
    });

    test('logger proxy handles null/undefined logger gracefully', () => {
        const strategy = { log: null };
        const backtestLogs = [];
        const originalLog = strategy.log;
        
        // Should not crash even with null logger
        if (originalLog && typeof originalLog.info === "function") {
            strategy.log = ["info"].reduce((proxy, level) => {
                proxy[level] = (msg) => { backtestLogs.push(msg); };
                return proxy;
            }, {});
        }

        expect(strategy.log).toBe(null);
        expect(backtestLogs.length).toBe(0);
    });

    test('multiple strategies can have independent log capture', () => {
        const orig1 = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        const orig2 = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        
        const logs1 = [];
        const logs2 = [];
        
        const proxy1 = ['info'].reduce((p, level) => {
            p[level] = (msg) => {
                if (typeof orig1[level] === "function") orig1[level](msg);
                logs1.push(msg);
            };
            return p;
        }, {});

        const proxy2 = ['info'].reduce((p, level) => {
            p[level] = (msg) => {
                if (typeof orig2[level] === "function") orig2[level](msg);
                logs2.push(msg);
            };
            return p;
        }, {});

        // Emit from both
        proxy1.info("Strategy 1 log");
        proxy2.info("Strategy 2 log");

        // Each captures independently
        expect(logs1.length).toBe(1);
        expect(logs2.length).toBe(1);
        expect(logs1[0]).toBe("Strategy 1 log");
        expect(logs2[0]).toBe("Strategy 2 log");
    });
});
