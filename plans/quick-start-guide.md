# Corex Recovery & Standardization - Quick Start Guide

## For Developers: Getting Started

### 1. Using Runtime Commands

#### In Terminal (Node.js Process)
Once the system is running, you can use keyboard shortcuts:

```
CTRL + R         → Restart Corex server
CTRL + SHIFT + R → Reload all strategies
CTRL + E         → Clear all error states
CTRL + G         → Force garbage collection
CTRL + S         → Save system snapshot
CTRL + SHIFT + S → Restore from snapshot
CTRL + P         → Pause strategy execution
CTRL + SHIFT + P → Resume strategies
CTRL + H         → Run health check
CTRL + L         → Toggle log level
CTRL + ?         → Show help
```

#### In Web UI
Same shortcuts work in the browser, plus:

```
CTRL + K         → Open command palette
ESC              → Close command palette
```

#### Via API
```javascript
// Execute a command
const response = await fetch('http://localhost:3000/api/commands/execute', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_TOKEN'
    },
    body: JSON.stringify({
        command: 'restart',
        args: {}
    })
});
```

---

### 2. Creating a New Component

#### Backend Service

```javascript
// engine/services/myService.js
const { BaseService } = require('@core/core/base/BaseService');

class MyService extends BaseService {
    constructor() {
        super('MY_SERVICE', {
            category: 'service',
            circuit: {
                failureThreshold: 5,
                timeout: 60000
            }
        });
    }
    
    async initialize() {
        // Setup logic
        this.data = new Map();
        this.lifecycle.transition(STATES.READY);
    }
    
    async start() {
        // Start logic
        this.lifecycle.transition(STATES.RUNNING);
    }
    
    async stop() {
        // Cleanup logic
        this.lifecycle.transition(STATES.STOPPED);
    }
    
    async cleanup() {
        // Final cleanup
        this.data.clear();
    }
    
    // Your methods with automatic error handling
    async doSomething(param) {
        return this.safeExecute(async () => {
            // Your logic here
            this.recordMetric('operations', 1);
            return result;
        }, null); // fallback value
    }
}

module.exports = new MyService();
```

#### Frontend View

```javascript
// corex-ui/src/views/MyView.jsx
import { useBaseView } from '../components/base/useBaseView';
import { BaseViewLayout } from '../components/base/BaseViewLayout';

const MyView = () => {
    const { loading, error, data, safeExecute } = useBaseView();
    
    useEffect(() => {
        safeExecute(async () => {
            const response = await client.get('/api/my-endpoint');
            return response.payload;
        });
    }, []);
    
    return (
        <BaseViewLayout
            loading={loading}
            error={error}
            title="My View"
            onRefresh={() => safeExecute(fetchData)}
        >
            {data && (
                <div>
                    {/* Your content */}
                </div>
            )}
        </BaseViewLayout>
    );
};
```

---

### 3. Handling Errors Properly

#### ❌ Bad - Silent Failure
```javascript
try {
    await operation();
} catch {
    // ignore
}
```

#### ✅ Good - Logged and Handled
```javascript
try {
    await operation();
} catch (err) {
    this.logger.warn('Operation failed, using fallback', {
        error: err.message,
        context: { /* relevant data */ }
    });
    return fallback();
}
```

#### ✅ Better - Using BaseComponent
```javascript
async myMethod() {
    return this.safeExecute(async () => {
        // Your logic
    }, fallbackValue);
}
```

---

### 4. Using Object Pools

#### Creating a Pool
```javascript
const { ObjectPool } = require('@utils/pools/ObjectPool');

const tickPool = new ObjectPool(
    // Factory function
    () => ({
        symbol: '',
        price: 0,
        volume: 0,
        timestamp: 0
    }),
    // Reset function
    (obj) => {
        obj.symbol = '';
        obj.price = 0;
        obj.volume = 0;
        obj.timestamp = 0;
    },
    { maxSize: 10000 }
);
```

#### Using the Pool
```javascript
// Acquire object
const tick = tickPool.acquire();
tick.symbol = 'BTC-USD';
tick.price = 50000;
tick.volume = 1.5;
tick.timestamp = Date.now();

// Use the object
processTick(tick);

// Release back to pool
tickPool.release(tick);
```

---

### 5. Using Circular Buffers

#### For Indicator Windows
```javascript
const { CircularBuffer } = require('@utils/structures/CircularBuffer');

class MyIndicator {
    constructor(period = 20) {
        this.prices = new CircularBuffer(period);
    }
    
    update(price) {
        this.prices.push(price);
        
        if (this.prices.size >= this.prices.capacity) {
            return this.calculate();
        }
        return null;
    }
    
    calculate() {
        const values = this.prices.toArray();
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
}
```

---

### 6. Registering for Recovery

#### Automatic (via BaseComponent)
```javascript
class MyComponent extends BaseComponent {
    // Recovery is automatic!
}
```

#### Manual Registration
```javascript
const { RecoveryManager } = require('@core/core/recovery/RecoveryManager');

const recovery = RecoveryManager.getInstance();
recovery.register(myComponent, {
    strategy: 'restart',
    maxRetries: 3,
    retryDelay: 5000
});
```

---

### 7. Creating Custom Commands

```javascript
const { RuntimeCommander } = require('@core/core/commands/RuntimeCommander');

const commander = RuntimeCommander.getInstance();

commander.register('my-command', async (args, context) => {
    // Your command logic
    console.log('Executing my command with args:', args);
    
    // Return result
    return {
        success: true,
        message: 'Command executed successfully'
    };
}, {
    description: 'My custom command',
    requiresAuth: true,
    confirmRequired: false,
    timeout: 30000
});
```

---

### 8. Monitoring Component Health

#### Get Component Status
```javascript
const status = myComponent.lifecycle.snapshot();
console.log(status);
// {
//     component: 'MY_COMPONENT',
//     state: 'RUNNING',
//     startedAt: 1234567890,
//     updatedAt: 1234567900,
//     uptimeMs: 10000,
//     lastError: null,
//     meta: {}
// }
```

#### Get Recovery Status
```javascript
const recovery = RecoveryManager.getInstance();
const status = recovery.getStatus('MY_COMPONENT');
console.log(status);
// {
//     state: 'healthy',
//     lastRecovery: 1234567890,
//     recoveryCount: 2,
//     failureCount: 0
// }
```

#### Get Metrics
```javascript
const metrics = myComponent.getMetrics();
console.log(metrics);
// {
//     operations: 1234,
//     errors: 5,
//     avgDuration: 45.2,
//     lastOperation: 1234567890
// }
```

---

### 9. Using the Cache Manager

```javascript
const { CacheManager } = require('@core/core/cache/CacheManager');

const cache = CacheManager.getInstance();

// Set value with TTL
await cache.set('my-key', myData, { ttl: 3600000 }); // 1 hour

// Get value
const data = await cache.get('my-key');

// Check if exists
const exists = await cache.has('my-key');

// Delete value
await cache.delete('my-key');

// Clear all
await cache.clear();

// Get stats
const stats = cache.getStats();
console.log(stats);
// {
//     hits: 1234,
//     misses: 56,
//     hitRate: 0.956,
//     size: 1024,
//     memoryUsage: 5242880
// }
```

---

### 10. Testing Your Component

```javascript
// test/myComponent.test.js
const MyComponent = require('../engine/services/myComponent');
const { STATES } = require('@core/core/lifecycle/ComponentLifecycle');

describe('MyComponent', () => {
    let component;
    
    beforeEach(async () => {
        component = new MyComponent();
        await component.initialize();
    });
    
    afterEach(async () => {
        await component.cleanup();
    });
    
    it('should initialize successfully', () => {
        expect(component.lifecycle.state).toBe(STATES.READY);
    });
    
    it('should handle errors gracefully', async () => {
        // Simulate error
        const result = await component.doSomething('invalid');
        
        // Should return fallback, not throw
        expect(result).toBeNull();
        expect(component.lifecycle.state).toBe(STATES.READY);
    });
    
    it('should recover from failures', async () => {
        const recovery = RecoveryManager.getInstance();
        recovery.register(component);
        
        // Simulate failure
        component.lifecycle.fail(new Error('Test error'));
        
        // Wait for recovery
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Should be recovered
        expect(component.lifecycle.state).toBe(STATES.RUNNING);
    });
});
```

---

## Common Patterns

### Pattern 1: Retry with Exponential Backoff

```javascript
async retryWithBackoff(fn, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === maxRetries - 1) throw err;
            const delay = Math.pow(2, i) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
```

### Pattern 2: Circuit Breaker Usage

```javascript
async callExternalService() {
    return this.circuitBreaker.execute(async () => {
        const response = await fetch('https://api.example.com/data');
        return response.json();
    });
}
```

### Pattern 3: State Snapshot & Restore

```javascript
async saveState() {
    const snapshot = {
        data: Array.from(this.data.entries()),
        config: this.config,
        timestamp: Date.now()
    };
    await this.stateManager.save(this.name, snapshot);
}

async restoreState() {
    const snapshot = await this.stateManager.load(this.name);
    if (snapshot) {
        this.data = new Map(snapshot.data);
        this.config = snapshot.config;
    }
}
```

### Pattern 4: Graceful Shutdown

```javascript
async stop() {
    this.lifecycle.transition(STATES.STOPPING);
    
    // Stop accepting new work
    this.accepting = false;
    
    // Wait for pending work to complete
    await this.waitForPending();
    
    // Save state
    await this.saveState();
    
    // Cleanup resources
    await this.cleanup();
    
    this.lifecycle.transition(STATES.STOPPED);
}
```

---

## Configuration Examples

### Recovery Configuration

```javascript
// config/recovery.js
module.exports = {
    recovery: {
        enabled: true,
        maxRetries: 3,
        retryDelay: 5000,
        strategies: {
            'MY_COMPONENT': 'restart',
            'CRITICAL_SERVICE': 'fallback'
        }
    }
};
```

### Command Configuration

```javascript
// config/commands.js
module.exports = {
    commands: {
        enabled: true,
        terminal: { enabled: true },
        ui: { enabled: true },
        api: { enabled: true, requireAuth: true }
    }
};
```

### Resource Configuration

```javascript
// config/resources.js
module.exports = {
    pools: {
        tick: { maxSize: 10000, preAllocate: 1000 },
        order: { maxSize: 5000, preAllocate: 500 }
    },
    cache: {
        maxMemoryMB: 512,
        evictionPolicy: 'LRU',
        ttl: 3600000
    }
};
```

---

## Troubleshooting

### Component Won't Start

1. Check lifecycle state: `component.lifecycle.snapshot()`
2. Check last error: `component.lifecycle.lastError`
3. Check recovery status: `recovery.getStatus(componentId)`
4. Check logs: Look for error messages in console/file

### High Memory Usage

1. Check pool stats: `pool.getStats()`
2. Check cache stats: `cache.getStats()`
3. Check for memory leaks: Use Node.js profiler
4. Verify objects are released back to pools

### Commands Not Working

1. Check if commands are enabled in config
2. Verify authentication token
3. Check command registration: `commander.list()`
4. Check terminal mode: Ensure `process.stdin.isTTY` is true

### Recovery Not Triggering

1. Check if recovery is enabled in config
2. Verify component is registered: `recovery.getStatus(componentId)`
3. Check circuit breaker state: `component.circuitBreaker.getState()`
4. Check error threshold: May not have reached threshold yet

---

## Best Practices

### ✅ Do's

- Always extend BaseComponent for new components
- Use safeExecute for operations that might fail
- Release objects back to pools after use
- Log errors with context
- Use circuit breakers for external services
- Save state before shutdown
- Test recovery scenarios
- Monitor metrics

### ❌ Don'ts

- Don't use silent catch blocks
- Don't create objects in hot paths (use pools)
- Don't ignore lifecycle states
- Don't skip error handling
- Don't forget to cleanup resources
- Don't hardcode retry logic (use BaseComponent)
- Don't bypass circuit breakers
- Don't ignore memory limits

---

## Getting Help

### Documentation
- [`ARCHITECTURE.md`](../docs/ARCHITECTURE.md) - System architecture
- [`RECOVERY_GUIDE.md`](../docs/RECOVERY_GUIDE.md) - Recovery system details
- [`COMMAND_REFERENCE.md`](../docs/COMMAND_REFERENCE.md) - Command usage
- [`COMPONENT_GUIDE.md`](../docs/COMPONENT_GUIDE.md) - Component patterns

### Code Examples
- [`engine/services/strategyManager.js`](../engine/managers/strategyManager.js) - Service example
- [`engine/core/engine.js`](../engine/core/engine.js) - Engine implementation
- [`corex-ui/src/views/HomeView.jsx`](../corex-ui/src/views/HomeView.jsx) - View example

### Support
- Check logs in `logs/corex.log`
- Run health check: CTRL+H
- Check system status: `GET /api/system/heartbeat`
- Review metrics in UI dashboard

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                    COREX QUICK REFERENCE                     │
├─────────────────────────────────────────────────────────────┤
│ TERMINAL COMMANDS                                            │
│  CTRL+R         Restart server                               │
│  CTRL+SHIFT+R   Reload strategies                            │
│  CTRL+E         Clear errors                                 │
│  CTRL+G         Garbage collect                              │
│  CTRL+H         Health check                                 │
│  CTRL+?         Help                                         │
├─────────────────────────────────────────────────────────────┤
│ COMPONENT LIFECYCLE                                          │
│  CREATED → INITIALIZING → READY → RUNNING → STOPPING        │
│                    ↓                                         │
│                  ERROR → RECOVERING → QUARANTINED            │
├─────────────────────────────────────────────────────────────┤
│ CIRCUIT BREAKER STATES                                       │
│  CLOSED      Normal operation                                │
│  OPEN        Cooling down (rejecting requests)               │
│  HALF_OPEN   Testing recovery                                │
├─────────────────────────────────────────────────────────────┤
│ RECOVERY STRATEGIES                                          │
│  restart     Full component restart                          │
│  reset       Reset state without restart                     │
│  isolate     Quarantine failing component                    │
│  fallback    Switch to backup implementation                 │
├─────────────────────────────────────────────────────────────┤
│ KEY CLASSES                                                  │
│  BaseComponent      Foundation for all components            │
│  BaseService        Singleton services                       │
│  BaseWorker         Background tasks                         │
│  RecoveryManager    Orchestrates recovery                    │
│  CircuitBreaker     Prevents cascading failures              │
│  ErrorBoundary      Isolates errors                          │
│  ObjectPool         Reusable objects                         │
│  CircularBuffer     Fixed-size time series                   │
└─────────────────────────────────────────────────────────────┘
```
