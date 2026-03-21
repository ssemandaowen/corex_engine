# Corex Recovery System - Visual Architecture

## System Overview

```mermaid
graph TB
    subgraph "User Interface Layer"
        UI[Web UI]
        Terminal[Terminal/Console]
        API[REST API]
    end
    
    subgraph "Command Layer"
        RC[Runtime Commander]
        HK[Hotkey Manager]
        TH[Terminal Handler]
        CP[Command Palette]
    end
    
    subgraph "Recovery Layer"
        RM[Recovery Manager]
        CB[Circuit Breaker]
        EB[Error Boundary]
        SM[State Manager]
    end
    
    subgraph "Component Layer"
        Engine[CoreX Engine]
        SL[Strategy Loader]
        SM2[Strategy Manager]
        BM[Backtest Manager]
        BR[Broadcaster]
        MT5[MT5 Bridge]
    end
    
    subgraph "Resource Layer"
        OP[Object Pool]
        CirBuf[Circular Buffer]
        RQ[Ring Queue]
        CM[Cache Manager]
    end
    
    subgraph "Storage Layer"
        DB[(PostgreSQL)]
        FS[File System]
        MEM[Memory Cache]
    end
    
    UI --> HK
    Terminal --> TH
    API --> RC
    HK --> RC
    TH --> RC
    CP --> RC
    
    RC --> RM
    RM --> CB
    RM --> EB
    RM --> SM
    
    CB --> Engine
    CB --> SL
    CB --> SM2
    CB --> BM
    CB --> BR
    CB --> MT5
    
    EB --> SL
    EB --> SM2
    
    Engine --> OP
    SL --> CirBuf
    SM2 --> RQ
    BM --> CM
    
    Engine --> DB
    SM --> FS
    CM --> MEM
    
    style RC fill:#4CAF50
    style RM fill:#2196F3
    style Engine fill:#FF9800
    style OP fill:#9C27B0
```

## Recovery Flow

```mermaid
sequenceDiagram
    participant Component
    participant ErrorBoundary
    participant CircuitBreaker
    participant RecoveryManager
    participant StateManager
    
    Component->>ErrorBoundary: Execute Operation
    ErrorBoundary->>CircuitBreaker: Check State
    
    alt Circuit CLOSED
        CircuitBreaker->>Component: Allow Execution
        Component-->>CircuitBreaker: Success
        CircuitBreaker-->>ErrorBoundary: Success
        ErrorBoundary-->>Component: Return Result
    else Circuit OPEN
        CircuitBreaker-->>ErrorBoundary: Reject (Cooling Down)
        ErrorBoundary-->>Component: Return Fallback
    else Operation Fails
        Component-->>CircuitBreaker: Failure
        CircuitBreaker->>CircuitBreaker: Increment Failure Count
        
        alt Threshold Exceeded
            CircuitBreaker->>CircuitBreaker: Open Circuit
            CircuitBreaker->>RecoveryManager: Trigger Recovery
            RecoveryManager->>StateManager: Save Current State
            RecoveryManager->>Component: Restart Component
            Component->>StateManager: Restore State
            StateManager-->>Component: State Restored
            Component-->>RecoveryManager: Recovery Complete
            RecoveryManager->>CircuitBreaker: Reset Circuit
        end
        
        ErrorBoundary-->>Component: Return Fallback
    end
```

## Command Execution Flow

```mermaid
sequenceDiagram
    participant User
    participant UI/Terminal
    participant RuntimeCommander
    participant CommandHandler
    participant TargetComponent
    participant EventBus
    
    User->>UI/Terminal: Press CTRL+R
    UI/Terminal->>RuntimeCommander: execute('restart')
    RuntimeCommander->>RuntimeCommander: Validate Command
    
    alt Requires Confirmation
        RuntimeCommander->>UI/Terminal: Request Confirmation
        UI/Terminal->>User: Show Confirmation Dialog
        User->>UI/Terminal: Confirm
        UI/Terminal->>RuntimeCommander: Confirmed
    end
    
    RuntimeCommander->>CommandHandler: Execute
    CommandHandler->>TargetComponent: Perform Action
    TargetComponent-->>CommandHandler: Result
    CommandHandler->>EventBus: Emit Command Event
    CommandHandler-->>RuntimeCommander: Success
    RuntimeCommander-->>UI/Terminal: Command Result
    UI/Terminal->>User: Show Notification
```

## Component Lifecycle with Recovery

```mermaid
stateDiagram-v2
    [*] --> CREATED
    CREATED --> INITIALIZING: initialize()
    INITIALIZING --> READY: success
    INITIALIZING --> ERROR: failure
    READY --> RUNNING: start()
    RUNNING --> STOPPING: stop()
    RUNNING --> ERROR: failure
    STOPPING --> STOPPED: success
    STOPPED --> [*]
    
    ERROR --> RECOVERING: auto-recovery
    RECOVERING --> INITIALIZING: restart
    RECOVERING --> QUARANTINED: max retries exceeded
    QUARANTINED --> INITIALIZING: manual intervention
    
    note right of ERROR
        Circuit Breaker Opens
        Recovery Manager Triggered
    end note
    
    note right of RECOVERING
        State Snapshot Saved
        Component Restarted
        State Restored
    end note
    
    note right of QUARANTINED
        Component Isolated
        Manual Review Required
        Alerts Sent
    end note
```

## Circuit Breaker State Machine

```mermaid
stateDiagram-v2
    [*] --> CLOSED
    CLOSED --> OPEN: failures >= threshold
    OPEN --> HALF_OPEN: timeout elapsed
    HALF_OPEN --> CLOSED: success >= threshold
    HALF_OPEN --> OPEN: any failure
    CLOSED --> CLOSED: success (reset counter)
    
    note right of CLOSED
        Normal Operation
        Requests Allowed
        Monitoring Failures
    end note
    
    note right of OPEN
        Cooling Down
        Requests Rejected
        Return Fallback
    end note
    
    note right of HALF_OPEN
        Testing Recovery
        Limited Requests
        Evaluating Health
    end note
```

## Resource Pool Architecture

```mermaid
graph LR
    subgraph "Application Layer"
        Engine[Engine]
        Strategy[Strategy]
        Broker[Broker]
    end
    
    subgraph "Pool Manager"
        TickPool[Tick Pool]
        OrderPool[Order Pool]
        MsgPool[Message Pool]
        BufPool[Buffer Pool]
    end
    
    subgraph "Memory Management"
        Heap[Heap Memory]
        GC[Garbage Collector]
    end
    
    Engine -->|acquire| TickPool
    Strategy -->|acquire| OrderPool
    Broker -->|acquire| MsgPool
    Strategy -->|acquire| BufPool
    
    TickPool -->|release| TickPool
    OrderPool -->|release| OrderPool
    MsgPool -->|release| MsgPool
    BufPool -->|release| BufPool
    
    TickPool -.->|reduced allocation| Heap
    OrderPool -.->|reduced allocation| Heap
    MsgPool -.->|reduced allocation| Heap
    BufPool -.->|reduced allocation| Heap
    
    Heap -->|less pressure| GC
    
    style TickPool fill:#4CAF50
    style OrderPool fill:#4CAF50
    style MsgPool fill:#4CAF50
    style BufPool fill:#4CAF50
    style GC fill:#FF5722
```

## Data Structure Comparison

```mermaid
graph TB
    subgraph "Current Implementation"
        A1[Array-based Queue]
        A2[Array Slicing]
        A3[Frequent Allocations]
        A4[GC Pressure]
        
        A1 --> A2
        A2 --> A3
        A3 --> A4
    end
    
    subgraph "Optimized Implementation"
        B1[Ring Queue]
        B2[Circular Buffer]
        B3[Object Pooling]
        B4[Reduced GC]
        
        B1 --> B2
        B2 --> B3
        B3 --> B4
    end
    
    A4 -.->|30% reduction| B4
    
    style A4 fill:#FF5722
    style B4 fill:#4CAF50
```

## Error Propagation & Isolation

```mermaid
graph TB
    subgraph "Strategy 1"
        S1[Strategy Instance]
        EB1[Error Boundary]
        S1 --> EB1
    end
    
    subgraph "Strategy 2"
        S2[Strategy Instance]
        EB2[Error Boundary]
        S2 --> EB2
    end
    
    subgraph "Strategy 3"
        S3[Strategy Instance]
        EB3[Error Boundary]
        S3 --> EB3
    end
    
    Engine[CoreX Engine]
    RM[Recovery Manager]
    
    EB1 --> Engine
    EB2 --> Engine
    EB3 --> Engine
    
    EB1 -.->|error isolated| RM
    EB2 --> Engine
    EB3 --> Engine
    
    S1 -.->|crashed| S1
    S2 --> S2
    S3 --> S3
    
    style S1 fill:#FF5722
    style EB1 fill:#FFC107
    style S2 fill:#4CAF50
    style S3 fill:#4CAF50
    
    note right of EB1
        Error Captured
        Strategy Isolated
        Engine Continues
    end note
```

## Cache Architecture

```mermaid
graph TB
    subgraph "Request Flow"
        App[Application]
        CM[Cache Manager]
        L1[L1 Cache - Memory]
        L2[L2 Cache - Compressed]
        DB[(Database)]
    end
    
    App -->|request| CM
    CM -->|check| L1
    
    L1 -->|hit| App
    L1 -->|miss| L2
    L2 -->|hit| L1
    L2 -->|hit| App
    L2 -->|miss| DB
    DB -->|data| L2
    L2 -->|data| L1
    L1 -->|data| App
    
    subgraph "Eviction Policy"
        LRU[LRU Tracker]
        TTL[TTL Monitor]
        Size[Size Monitor]
    end
    
    L1 --> LRU
    L1 --> TTL
    L1 --> Size
    
    LRU -.->|evict| L1
    TTL -.->|evict| L1
    Size -.->|evict| L1
    
    style L1 fill:#4CAF50
    style L2 fill:#2196F3
    style DB fill:#9C27B0
```

## Monitoring Dashboard Layout

```mermaid
graph TB
    subgraph "System Health"
        SH1[Engine Status]
        SH2[Recovery Stats]
        SH3[Circuit Breakers]
    end
    
    subgraph "Performance Metrics"
        PM1[Memory Usage]
        PM2[CPU Usage]
        PM3[GC Stats]
    end
    
    subgraph "Resource Pools"
        RP1[Pool Utilization]
        RP2[Reuse Rates]
        RP3[Cache Hit Rates]
    end
    
    subgraph "Strategy Health"
        ST1[Active Strategies]
        ST2[Error Rates]
        ST3[Quarantined]
    end
    
    subgraph "Command Activity"
        CA1[Recent Commands]
        CA2[Command Stats]
        CA3[Hotkey Usage]
    end
    
    style SH2 fill:#4CAF50
    style PM1 fill:#2196F3
    style RP2 fill:#9C27B0
    style ST2 fill:#FF9800
    style CA2 fill:#00BCD4
```

## Implementation Phases Timeline

```mermaid
gantt
    title Corex Recovery & Standardization Implementation
    dateFormat YYYY-MM-DD
    section Phase 1
    Recovery Foundation           :p1, 2026-03-01, 7d
    RecoveryManager              :p1a, 2026-03-01, 2d
    CircuitBreaker               :p1b, 2026-03-03, 2d
    ErrorBoundary                :p1c, 2026-03-05, 2d
    StateManager                 :p1d, 2026-03-07, 1d
    
    section Phase 2
    Runtime Commands             :p2, 2026-03-08, 7d
    RuntimeCommander             :p2a, 2026-03-08, 2d
    Terminal Handler             :p2b, 2026-03-10, 2d
    UI Hotkey Manager            :p2c, 2026-03-12, 2d
    Command API                  :p2d, 2026-03-14, 1d
    
    section Phase 3
    Component Standardization    :p3, 2026-03-15, 7d
    Base Classes                 :p3a, 2026-03-15, 3d
    Frontend Components          :p3b, 2026-03-18, 2d
    Migration Examples           :p3c, 2026-03-20, 2d
    
    section Phase 4
    Resource Optimization        :p4, 2026-03-22, 7d
    Object Pools                 :p4a, 2026-03-22, 2d
    Data Structures              :p4b, 2026-03-24, 2d
    Cache Manager                :p4c, 2026-03-26, 2d
    Performance Testing          :p4d, 2026-03-28, 1d
    
    section Phase 5
    Integration & Testing        :p5, 2026-03-29, 7d
    Integration Tests            :p5a, 2026-03-29, 2d
    Load Testing                 :p5b, 2026-03-31, 2d
    Documentation                :p5c, 2026-04-02, 2d
    Final Migration              :p5d, 2026-04-04, 1d
```

## Key Metrics Dashboard

```mermaid
graph LR
    subgraph "Recovery Metrics"
        R1[Recovery Rate: 95%]
        R2[Avg Recovery Time: 3.2s]
        R3[Quarantined: 0]
    end
    
    subgraph "Resource Metrics"
        M1[Memory: -25%]
        M2[Pool Reuse: 82%]
        M3[Cache Hit: 73%]
    end
    
    subgraph "Command Metrics"
        C1[Commands/hr: 45]
        C2[Success Rate: 99.8%]
        C3[Avg Latency: 120ms]
    end
    
    subgraph "Component Metrics"
        P1[Migrated: 85%]
        P2[Error Rate: -60%]
        P3[Code Reduction: 40%]
    end
    
    style R1 fill:#4CAF50
    style R2 fill:#4CAF50
    style R3 fill:#4CAF50
    style M1 fill:#2196F3
    style M2 fill:#2196F3
    style M3 fill:#2196F3
    style C1 fill:#9C27B0
    style C2 fill:#9C27B0
    style C3 fill:#9C27B0
    style P1 fill:#FF9800
    style P2 fill:#FF9800
    style P3 fill:#FF9800
```
