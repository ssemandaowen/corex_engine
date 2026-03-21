# Architecture Decision Records (ADR)

## Overview

This document records the key architectural decisions made for the Corex crash recovery and standardization system, including the rationale, alternatives considered, and trade-offs.

---

## ADR-001: Recovery Manager as Central Orchestrator

**Status:** Accepted  
**Date:** 2026-02-25

### Context
The system needs a unified approach to handle component failures and recovery across different subsystems (engine, strategies, brokers, etc.).

### Decision
Implement a centralized RecoveryManager that orchestrates all recovery operations, rather than having each component implement its own recovery logic.

### Rationale
- **Consistency:** Single source of truth for recovery policies
- **Observability:** Centralized monitoring and metrics
- **Flexibility:** Easy to change recovery strategies without modifying components
- **Testability:** Easier to test recovery scenarios in isolation

### Alternatives Considered

1. **Distributed Recovery (Rejected)**
   - Each component handles its own recovery
   - ❌ Inconsistent behavior across components
   - ❌ Difficult to coordinate cascading failures
   - ❌ Duplicated recovery logic

2. **Event-Based Recovery (Rejected)**
   - Components emit failure events, listeners handle recovery
   - ❌ Harder to reason about recovery flow
   - ❌ Potential for missed events
   - ✅ More decoupled (but not worth the complexity)

### Consequences
- ✅ Centralized control and monitoring
- ✅ Consistent recovery behavior
- ✅ Easy to add new recovery strategies
- ⚠️ Single point of failure (mitigated by making RecoveryManager itself recoverable)
- ⚠️ Potential bottleneck (mitigated by async operations)

---

## ADR-002: Circuit Breaker Pattern for External Services

**Status:** Accepted  
**Date:** 2026-02-25

### Context
External services (database, MT5 bridge, market data) can fail or become slow, potentially causing cascading failures.

### Decision
Implement circuit breaker pattern for all external service calls, with three states: CLOSED, OPEN, HALF_OPEN.

### Rationale
- **Fail Fast:** Don't wait for timeouts when service is known to be down
- **Automatic Recovery:** Test service health periodically
- **Resource Protection:** Prevent resource exhaustion from retrying failed calls
- **User Experience:** Return fallback data instead of hanging

### Configuration
```javascript
{
    failureThreshold: 5,        // Failures before opening
    successThreshold: 2,        // Successes to close
    timeout: 60000,            // Cooldown period
    monitoringPeriod: 10000    // Rolling window
}
```

### Alternatives Considered

1. **Simple Retry Logic (Rejected)**
   - Just retry failed operations with exponential backoff
   - ❌ Doesn't prevent cascading failures
   - ❌ Wastes resources on known-bad services
   - ✅ Simpler to implement

2. **Bulkhead Pattern (Deferred)**
   - Isolate resources for different services
   - ✅ Better resource isolation
   - ❌ More complex to implement
   - 📝 Consider for Phase 6

### Consequences
- ✅ Prevents cascading failures
- ✅ Faster failure detection
- ✅ Automatic recovery testing
- ⚠️ May reject valid requests during cooldown
- ⚠️ Requires tuning thresholds per service

---

## ADR-003: Error Boundaries for Strategy Isolation

**Status:** Accepted  
**Date:** 2026-02-25

### Context
Strategy errors should not crash the entire engine. Need isolation between strategies and between strategies and engine.

### Decision
Wrap each strategy execution in an ErrorBoundary that catches and handles errors, preventing propagation to the engine.

### Rationale
- **Isolation:** One strategy failure doesn't affect others
- **Stability:** Engine continues running even if strategies crash
- **Debugging:** Capture full error context for debugging
- **Recovery:** Can restart individual strategies without restarting engine

### Implementation
```javascript
class ErrorBoundary {
    async wrap(fn, fallback) {
        try {
            return await fn();
        } catch (error) {
            this.capture(error);
            this.notifyRecovery();
            return fallback;
        }
    }
}
```

### Alternatives Considered

1. **Process Isolation (Rejected)**
   - Run each strategy in separate Node.js process
   - ✅ Complete isolation
   - ❌ High overhead (memory, IPC)
   - ❌ Complex state management

2. **Worker Threads (Deferred)**
   - Run strategies in worker threads
   - ✅ Better isolation than error boundaries
   - ✅ Lower overhead than processes
   - ❌ More complex implementation
   - 📝 Consider for Phase 6

### Consequences
- ✅ Simple to implement
- ✅ Low overhead
- ✅ Good isolation for most cases
- ⚠️ Doesn't protect against infinite loops (mitigated by timeouts)
- ⚠️ Doesn't protect against memory leaks (mitigated by monitoring)

---

## ADR-004: BaseComponent as Foundation Class

**Status:** Accepted  
**Date:** 2026-02-25

### Context
Components have inconsistent patterns for lifecycle management, error handling, and monitoring.

### Decision
Create BaseComponent abstract class that all components extend, providing standard lifecycle hooks, error handling, and metrics.

### Rationale
- **Consistency:** All components follow same patterns
- **DRY:** Common functionality in one place
- **Maintainability:** Easier to update all components
- **Onboarding:** New developers learn one pattern

### Required Methods
```javascript
abstract initialize(): Promise<void>
abstract start(): Promise<void>
abstract stop(): Promise<void>
abstract cleanup(): Promise<void>
```

### Provided Methods
```javascript
safeExecute(fn, fallback): Promise<T>
snapshot(): ComponentSnapshot
restore(state): Promise<void>
recordMetric(name, value): void
getMetrics(): Metrics
```

### Alternatives Considered

1. **Composition over Inheritance (Rejected)**
   - Use mixins or composition for shared functionality
   - ✅ More flexible
   - ❌ More boilerplate
   - ❌ Harder to enforce contracts

2. **Interface-Only (Rejected)**
   - Define interface, let components implement
   - ✅ Maximum flexibility
   - ❌ No code reuse
   - ❌ Inconsistent implementations

### Consequences
- ✅ Consistent component structure
- ✅ Reduced boilerplate
- ✅ Built-in error handling and metrics
- ⚠️ Inheritance can be limiting (mitigated by composition where needed)
- ⚠️ Migration effort for existing components

---

## ADR-005: Object Pooling for High-Frequency Objects

**Status:** Accepted  
**Date:** 2026-02-25

### Context
Creating millions of tick/order objects causes high GC pressure and memory allocation overhead.

### Decision
Implement object pooling for high-frequency objects (ticks, orders, messages, buffers).

### Rationale
- **Performance:** Reduce allocation overhead
- **Memory:** Reduce GC pressure
- **Predictability:** More consistent latency
- **Scalability:** Handle higher throughput

### Target Objects
- Tick objects (10,000 pool size)
- Order objects (5,000 pool size)
- WebSocket messages (5,000 pool size)
- Indicator buffers (1,000 pool size)

### Expected Improvements
- 30% reduction in memory allocations
- 40% reduction in GC time
- 20% improvement in tick processing throughput

### Alternatives Considered

1. **No Pooling (Current State)**
   - Let GC handle everything
   - ❌ High GC pressure
   - ❌ Allocation overhead
   - ✅ Simpler code

2. **Native Addons (Deferred)**
   - Use C++ addons for critical paths
   - ✅ Maximum performance
   - ❌ Complex to maintain
   - ❌ Platform-specific
   - 📝 Consider for Phase 8

### Consequences
- ✅ Significant performance improvement
- ✅ Reduced memory usage
- ✅ More predictable latency
- ⚠️ Must remember to release objects (mitigated by linting rules)
- ⚠️ Potential for stale data if not reset properly (mitigated by reset function)

---

## ADR-006: Circular Buffer for Time-Series Data

**Status:** Accepted  
**Date:** 2026-02-25

### Context
Indicators need fixed-size windows of historical data. Current implementation uses arrays with slicing, causing allocations.

### Decision
Use circular buffers for all fixed-size time-series data (indicator windows, price history, etc.).

### Rationale
- **Performance:** O(1) append and read
- **Memory:** Fixed size, no growth
- **Cache-Friendly:** Contiguous memory
- **Simple:** Easy to understand and use

### Implementation
```javascript
class CircularBuffer {
    constructor(capacity) {
        this.buffer = new Array(capacity);
        this.capacity = capacity;
        this.size = 0;
        this.head = 0;
    }
    
    push(value) {
        this.buffer[this.head] = value;
        this.head = (this.head + 1) % this.capacity;
        if (this.size < this.capacity) this.size++;
    }
}
```

### Alternatives Considered

1. **Array with Shift (Current State)**
   - Use array.shift() to maintain size
   - ❌ O(n) operation
   - ❌ Frequent allocations
   - ✅ Simple API

2. **Linked List (Rejected)**
   - Use doubly-linked list
   - ✅ O(1) operations
   - ❌ Poor cache locality
   - ❌ More memory overhead

### Consequences
- ✅ Constant time operations
- ✅ Fixed memory usage
- ✅ Better cache performance
- ⚠️ Slightly more complex API (mitigated by helper methods)
- ⚠️ Must handle wraparound correctly

---

## ADR-007: Runtime Commands via Multiple Interfaces

**Status:** Accepted  
**Date:** 2026-02-25

### Context
Need to control system at runtime (restart, reload, clear errors, etc.) from multiple interfaces.

### Decision
Implement RuntimeCommander with support for terminal keyboard shortcuts, UI hotkeys, and REST API.

### Rationale
- **Flexibility:** Control from anywhere
- **Developer Experience:** Quick access via keyboard
- **Automation:** API for scripts and tools
- **Consistency:** Same commands across all interfaces

### Interfaces
1. **Terminal:** readline with keypress events
2. **UI:** document.addEventListener('keydown')
3. **API:** POST /api/commands/execute

### Alternatives Considered

1. **API Only (Rejected)**
   - Only provide REST API
   - ❌ Slower for quick operations
   - ❌ Requires separate tool
   - ✅ Simpler to implement

2. **Terminal Only (Rejected)**
   - Only support terminal commands
   - ❌ Not accessible from UI
   - ❌ Requires terminal access
   - ✅ Simpler to implement

### Consequences
- ✅ Maximum flexibility
- ✅ Great developer experience
- ✅ Supports automation
- ⚠️ More code to maintain
- ⚠️ Potential for hotkey conflicts (mitigated by configuration)

---

## ADR-008: LRU Cache with Eviction Policies

**Status:** Accepted  
**Date:** 2026-02-25

### Context
Need caching for expensive operations (database queries, API calls, calculations) with memory limits.

### Decision
Implement CacheManager with pluggable eviction policies (LRU, LFU, TTL, SIZE).

### Rationale
- **Performance:** Avoid repeated expensive operations
- **Flexibility:** Different policies for different use cases
- **Memory Control:** Prevent unbounded growth
- **Observability:** Track hit/miss rates

### Default Policy: LRU
- Evict least recently used items
- Good general-purpose policy
- Simple to implement
- Predictable behavior

### Alternatives Considered

1. **No Caching (Current State)**
   - Recompute everything
   - ❌ Wasted computation
   - ❌ Higher latency
   - ✅ No memory overhead

2. **Simple Map (Rejected)**
   - Use Map without eviction
   - ❌ Unbounded memory growth
   - ❌ No TTL support
   - ✅ Simpler implementation

### Consequences
- ✅ Improved performance
- ✅ Controlled memory usage
- ✅ Flexible policies
- ⚠️ Cache invalidation complexity (mitigated by TTL)
- ⚠️ Memory overhead for tracking (acceptable trade-off)

---

## ADR-009: Gradual Migration Strategy

**Status:** Accepted  
**Date:** 2026-02-25

### Context
Cannot rewrite entire system at once. Need incremental migration path.

### Decision
Implement new patterns alongside existing code, migrate components gradually, maintain backward compatibility.

### Migration Priority
1. Critical services (engine, strategy manager)
2. High-traffic components (tick processing)
3. User-facing components (UI views)
4. Utility components (helpers, tools)

### Backward Compatibility
- New BaseComponent works with existing code
- Old components continue to work
- No breaking changes to APIs
- Gradual deprecation of old patterns

### Alternatives Considered

1. **Big Bang Rewrite (Rejected)**
   - Rewrite everything at once
   - ❌ High risk
   - ❌ Long development time
   - ❌ Difficult to test
   - ✅ Clean slate

2. **Parallel System (Rejected)**
   - Build new system alongside old
   - ❌ Duplicate effort
   - ❌ Complex synchronization
   - ✅ Lower risk

### Consequences
- ✅ Lower risk
- ✅ Continuous delivery
- ✅ Learn and adapt
- ⚠️ Temporary inconsistency
- ⚠️ Longer overall timeline

---

## ADR-010: Metrics Collection in Base Classes

**Status:** Accepted  
**Date:** 2026-02-25

### Context
Need consistent metrics across all components for monitoring and debugging.

### Decision
Build metrics collection into BaseComponent, automatically track common metrics, allow custom metrics.

### Automatic Metrics
- Operation count
- Error count
- Average duration
- Last operation timestamp
- Component uptime

### Custom Metrics
```javascript
this.recordMetric('strategies_loaded', 1);
this.recordMetric('tick_processing_ms', duration);
```

### Alternatives Considered

1. **Manual Metrics (Current State)**
   - Each component implements own metrics
   - ❌ Inconsistent
   - ❌ Often forgotten
   - ✅ Maximum flexibility

2. **External Metrics Library (Rejected)**
   - Use Prometheus, StatsD, etc.
   - ✅ Industry standard
   - ❌ External dependency
   - ❌ More complex setup
   - 📝 Consider for Phase 6

### Consequences
- ✅ Consistent metrics
- ✅ Zero-effort basic metrics
- ✅ Easy to add custom metrics
- ⚠️ Memory overhead (minimal)
- ⚠️ Performance overhead (negligible)

---

## Trade-Off Summary

### Performance vs. Simplicity
**Decision:** Favor performance for hot paths (pooling, circular buffers), simplicity elsewhere  
**Rationale:** Trading system needs high throughput, but not all code is performance-critical

### Flexibility vs. Consistency
**Decision:** Favor consistency through base classes, allow flexibility where needed  
**Rationale:** Consistency improves maintainability, flexibility prevents lock-in

### Isolation vs. Overhead
**Decision:** Use error boundaries (low overhead) over process isolation (high overhead)  
**Rationale:** Error boundaries provide sufficient isolation for most cases

### Centralization vs. Distribution
**Decision:** Centralize recovery management, distribute execution  
**Rationale:** Central control improves observability, distributed execution improves performance

### Immediate vs. Gradual
**Decision:** Gradual migration over big bang rewrite  
**Rationale:** Lower risk, continuous delivery, ability to learn and adapt

---

## Future Considerations

### Phase 6: Advanced Recovery
- Machine learning for failure prediction
- Automatic performance tuning
- Distributed recovery coordination

### Phase 7: Advanced Commands
- Natural language commands
- Command scripting/macros
- Remote command execution

### Phase 8: Advanced Optimization
- JIT compilation for strategies
- SIMD for indicator calculations
- Worker threads for parallel processing
- Native addons for critical paths

### Phase 9: Observability
- Distributed tracing
- Advanced metrics (Prometheus)
- Real-time dashboards
- Alerting system

---

## Lessons Learned

### What Worked Well
- Existing ComponentLifecycle provided good foundation
- Event bus enabled loose coupling
- Modular architecture made changes easier
- Comprehensive documentation helped planning

### What Could Be Improved
- More consistent error handling from start
- Earlier adoption of pooling patterns
- Better metrics from day one
- More automated testing

### Recommendations for Future Projects
1. Design for recovery from the start
2. Build observability into base classes
3. Use pooling for high-frequency objects
4. Implement circuit breakers for external services
5. Standardize component patterns early
6. Plan for gradual migration
7. Document architectural decisions
8. Test recovery scenarios

---

## References

### Internal Documents
- [`crash-recovery-and-standardization.md`](crash-recovery-and-standardization.md) - Main architecture
- [`recovery-system-diagram.md`](recovery-system-diagram.md) - Visual diagrams
- [`quick-start-guide.md`](quick-start-guide.md) - Developer guide

### External Resources
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Object Pool Pattern](https://en.wikipedia.org/wiki/Object_pool_pattern)
- [Error Handling Best Practices](https://nodejs.org/en/docs/guides/error-handling/)
- [Node.js Performance Best Practices](https://nodejs.org/en/docs/guides/simple-profiling/)

### Related Work
- [`ComponentLifecycle.js`](../engine/core/lifecycle/ComponentLifecycle.js) - Existing lifecycle system
- [`healthCheck.js`](../engine/services/healthCheck.js) - Existing health monitoring
- [`strategyLoader.js`](../engine/strategyLoader.js) - Strategy boot system
- [`engine.js`](../engine/core/engine.js) - Core engine implementation

---

## Approval

**Architect:** Kilo Code  
**Date:** 2026-02-25  
**Status:** Awaiting Review

**Reviewers:**
- [ ] Technical Lead
- [ ] Senior Developer
- [ ] DevOps Engineer
- [ ] Product Owner

**Next Steps:**
1. Review and approve architecture
2. Begin Phase 1 implementation
3. Set up monitoring for success metrics
4. Schedule weekly progress reviews
