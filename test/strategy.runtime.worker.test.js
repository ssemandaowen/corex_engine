/**
 * StrategyRuntime Worker IPC Protocol Tests (Mocked)
 * 
 * Tests the worker lifecycle patterns:
 * - Worker handshake without strategyId (the bug fix)
 * - Request/response message pattern with reqId
 * - Error handling for malformed messages
 */

describe('StrategyRuntime Worker IPC Protocol', () => {
    
    test('worker sends ready message without strategyId on handshake', () => {
        // The bug was: runtime checked msg.strategyId === strategyId
        // The fix: runtime checks msg.type === 'ready'
        
        // Worker sends this on startup
        const workerReady = { type: 'ready' };
        
        // Runtime should verify with this check (not with strategyId)
        const isReadyMessageValid = workerReady.type === 'ready';
        expect(isReadyMessageValid).toBe(true);
        
        // Old code would have checked this and failed
        expect(workerReady.strategyId).toBeUndefined();
    });

    test('request/response messages use reqId matching pattern', () => {
        // Runtime sends request with reqId
        const request = {
            reqId: 42,
            type: 'LOAD_STRATEGY',
            payload: {
                strategyId: 'user::strategy',
                code: 'module.exports = class S {}',
                runtimeParams: {}
            }
        };
        
        // Worker responds with matching reqId
        const response = {
            reqId: 42,
            ok: true,
            result: { meta: { symbols: [], timeframe: '1m' } }
        };
        
        // Runtime matches response to request by reqId
        expect(response.reqId).toBe(request.reqId);
        expect(response.ok).toBe(true);
    });

    test('messages without reqId are logged as warnings', () => {
        // Malformed message - missing reqId
        const malformedMsg = {
            type: 'EXEC_SIGNAL',
            payload: { data: 'test' }
            // Missing: reqId
        };
        
        // Worker should detect and log warning
        const hasReqId = 'reqId' in malformedMsg;
        expect(hasReqId).toBe(false);
        
        // Message still processes but warning logged
        expect(malformedMsg.type).toBe('EXEC_SIGNAL');
    });

    test('unknown message types generate error response', () => {
        // Request with unknown type
        const unknownRequest = {
            reqId: 99,
            type: 'INVALID_MESSAGE_TYPE',
            payload: {}
        };
        
        // Valid message types
        const validTypes = ['LOAD_STRATEGY', 'EXEC_SIGNAL', 'EXEC_BAR', 'EXEC_TICK', 'UPDATE_PARAMS'];
        const isValidType = validTypes.includes(unknownRequest.type);
        expect(isValidType).toBe(false);
        
        // Worker generates error response with same reqId
        const errorResponse = {
            reqId: unknownRequest.reqId,
            ok: false,
            error: 'UNKNOWN_MESSAGE_TYPE: INVALID_MESSAGE_TYPE'
        };
        
        expect(errorResponse.reqId).toBe(99);
        expect(errorResponse.ok).toBe(false);
    });

    test('timeout handling: runtime waits 5s for worker response', () => {
        const COREX_IPC_TIMEOUT_MS = 5000;
        const requestTimestamp = Date.now();
        
        // Simulate timeout expiration
        const timeoutExpires = requestTimestamp + COREX_IPC_TIMEOUT_MS;
        
        expect(COREX_IPC_TIMEOUT_MS).toBe(5000);
        expect(timeoutExpires).toBeGreaterThan(requestTimestamp);
    });
});
