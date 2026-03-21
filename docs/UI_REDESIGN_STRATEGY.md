# CoreX UI/Architecture Redesign - Implementation Strategy

**Date:** March 15, 2026  
**Status:** Planning Phase  

## Overview

This document outlines the implementation strategy for 14 major UI/architecture improvements to the CoreX trading system. Organized by priority and implementation complexity.

---

## CRITICAL FIXES (Implemented ✅)

### 1. Backtest cleanupBacktests Error ✅
**Status:** FIXED

**Changes Made:**
- Fixed import in backtestController.js to use storageManager object
- Changed from sync `cleanupBacktests()` to async `storageManager.cleanupBacktestsAsync()`
- Same fix applied to cleanupUploads (now cleanupUploadsAsync)
- Made cleanup fire-and-forget to not block responses
- Added error logging for failed cleanups

**Result:** Backtest error "cleanupBacktests is not a function" is now resolved

### 2. Loading Spinner Infinite Loop Fix ✅
**Status:** FIXED

**Changes Made:**
- Modified backtest.jsx error catch block to set `setLoading(false)`
- Added `setProgressJobId("")` to reset progress tracking
- Progress polling already handles ERROR status by stopping spinner

**Result:** Spinner now stops properly on backtest failure

---

## ARCHITECTURE IMPROVEMENTS (Priority Order)

### Priority 1: Authentication & Security System

#### 3. User vs Admin System Separation
**Complexity:** HIGH  
**Impact:** HIGH - Security critical

**Design:**
```
ROLE-BASED ACCESS CONTROL
├── ADMIN Role
│   ├── User Management
│   ├── System Monitoring
│   ├── System Logs Access
│   ├── Settings (Danger Zone access)
│   └── Data Management
│
└── USER Role
    ├── Strategy Management
    ├── Live Trading
    ├── Paper Trading
    ├── Backtesting
    └── Account Settings (personal only)
```

**Implementation Steps:**
1. Add `role` column to users table (ENUM: 'admin', 'user')
2. Create middleware: `requireAdmin()`, `requireUser()`
3. Update all endpoints with role checks
4. Frontend: Hide Users tab when `currentUser.role !== 'admin'`
5. Create separate admin UI components
6. Add role initialization on user signup

**Files to Modify:**
- `engine/routes/*.js` (add role checks)
- `corex-ui/src/components/` (conditional rendering by role)
- Database schema

#### 6. Authentication System Redesign
**Complexity:** VERY HIGH  
**Impact:** HIGH - Security critical

**Current State:** Basic email/password  
**Target State:** Enterprise auth system

**Implementation Plan:**
```
Phase 1: Authentication Portal
├── Signup page with email validation
├── Signin page with remember-me
├── Password reset flow
├── Email verification
└── Terms & privacy acceptance

Phase 2: Multi-Factor Auth
├── Google OAuth integration
├── Optional 2FA (TOTP)
├── Device fingerprinting
└── IP tracking & logging

Phase 3: Security Dashboard
├── Active sessions view
├── Login history
├── IP whitelist management
├── Device trust management
└── Security alerts
```

**Security Features:**
- IP-based anomaly detection
- Device fingerprinting (hash of: user agent, screen res, timezone)
- Auth token rotation
- Session invalidation on suspicious activity
- Rate limiting on login attempts

**Database Schema Additions:**
```sql
-- Authentication
CREATE TABLE auth_tokens (
    id UUID PRIMARY KEY,
    user_id UUID,
    token_hash VARCHAR(255),
    expires_at TIMESTAMP,
    device_fingerprint VARCHAR(255),
    ip_address INET,
    created_at TIMESTAMP
);

-- Login History
CREATE TABLE login_history (
    id UUID PRIMARY KEY,
    user_id UUID,
    ip_address INET,
    device_fingerprint VARCHAR(255),
    success BOOLEAN,
    reason VARCHAR(255),
    created_at TIMESTAMP
);

-- OAuth
CREATE TABLE oauth_providers (
    id UUID PRIMARY KEY,
    user_id UUID,
    provider VARCHAR(50),  -- 'google', 'github'
    provider_user_id VARCHAR(255),
    email VARCHAR(255),
    created_at TIMESTAMP
);
```

### Priority 2: UI/UX Redesign

#### 3. Terminal / Log View Redesign
**Complexity:** MEDIUM  
**Impact:** HIGH - User experience

**Current State:** Embedded system terminal in editor  
**Target State:** Global terminal component (like browser DevTools)

**Design:**
```
┌─────────────────────────────────────────┐
│  Main App Content                       │
│                                         │
│                                         │
└─────────────────────────────────────────┤
┌─────────────────────────────────────────┤
│  🖥️  Global Terminal (Toggleable)       │  ← Terminal icon visible when minimized
│  [📝 Info] [⚠️ Warn] [❌ Error] [🎯 Log]│
│  ...log output...                       │
│  (↕️ resize handle)                     │
└─────────────────────────────────────────┘
```

**Features:**
- Toggle open/close with keyboard shortcut (e.g., Ctrl+`)
- Icon button shows when closed (sticky bottom-right)
- Real-time log streaming
- Log type icons instead of text labels
- Collapsible log entries
- Search/filter functionality
- Clear logs button
- Export logs button

**Implementation:**
1. Create `TerminalPanel.jsx` component
2. Create `useTerminal` hook for log management
3. Add EventEmitter for log distribution
4. Capture `console.log` from strategies
5. Create icon-based log display
6. Add keyboard shortcut handler

#### 4. Strategy Editor UI Improvements
**Complexity:** LOW  
**Impact:** MEDIUM - Aesthetics

**Changes:**
- Replace "Deploy" button → X/trash icon
- Replace "Run" button → ▶️ play icon
- Replace "Save" button → 💾 disk icon
- Add tooltip on hover showing full action name

**Implementation:**
- Update button JSX with Lucide icons
- Add `title` attribute for tooltips
- Adjust sizing for icon-only buttons
- Add visual feedback on hover

#### 9. Run System UI Improvements
**Complexity:** MEDIUM  
**Impact:** HIGH - User experience

**Current:** Strategy cards in grid layout  
**Target:** Single-row card layout with filters

```
┌─ Run Strategies ────────────────────────────────────┐
│ [🔍 Search...] [Paper/Live] [Status] [Timeframe]   │
├──────────────────────────────────────────────────────┤
│ ┌─ Strategy A ──────────────────────────────────────┐│
│ │ Status: ACTIVE | Equity: $12,500 | P&L: +$500   ││
│ │ [📊 Stats] [⚙️  Settings] [⏹️ Stop]              ││
│ └──────────────────────────────────────────────────┘│
│                                                      │
│ ┌─ Strategy B ──────────────────────────────────────┐│
│ │ Status: PAUSED | Equity: $10,000 | P&L: -$250   ││
│ │ [📊 Stats] [⚙️  Settings] [▶️ Start]              ││
│ └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

**Implementation:**
1. Modify card layout to full-width rows
2. Add search input with debounce
3. Add filter dropdowns (status, type, timeframe)
4. Implement filter logic
5. Add sorting options

#### 10. Chart Organization
**Complexity:** LOW  
**Impact:** MEDIUM

**Tabs to Create:**
- **Runtime Chart** - Live/paper strategy charts
- **Historical** - Backtest result charts
- Remove: "Live Bridge", "System", etc.

**Implementation:**
1. Update chart tab configuration
2. Remove obsolete tabs
3. Route chart data based on context

#### 8. Account Center Redesign
**Complexity:** LOW  
**Impact:** MEDIUM

**Changes:**
- Use consistent vertical card layout
- Set equal card heights (CSS grid)
- Improve spacing (24px gaps)
- Better visual hierarchy
- Organized tabs in top nav

#### 14. Global UI Design Standardization
**Complexity:** MEDIUM  
**Impact:** HIGH

**Standards:**
- Top navigation: Fixed 64px height, consistent spacing
- Cards: Min 300px width, equal heights in grid
- Tabs: Scrollable when >6 tabs
- Padding: 16/24/32px system
- Border radius: 8/12px system
- Colors: Consistent with CSS variables

**Implementation:**
1. Create design system documentation
2. Update CSS variables
3. Create reusable card component
4. Create reusable tab component
5. Audit all pages for consistency

### Priority 3: Feature Enhancements

#### 2. Runtime Data Visibility Fix
**Complexity:** MEDIUM  
**Impact:** MEDIUM - Transparency

**Goal:** Show which dataset is being used during runtime

**Implementation:**
1. Add dataset metadata to strategy runtime display
2. Query user uploads for dataset info
3. Display in runtime panel:
   ```
   Dataset: BTC_1h.csv (uploaded: 2 days ago)
   Records: 1,200 bars
   Date Range: 2025-01-01 → 2025-04-01
   ```

#### 7. Live Trading Connectivity System
**Complexity:** HIGH  
**Impact:** HIGH - Feature

**Protocol Support:**
```
PROTOCOL SELECTOR
├── MetaApi
│   ├── API Token (required)
│   ├── Account ID (required)
│   └── Password (optional)
│
├── MQL Connector
│   ├── Bridge Address (required)
│   ├── Bridge Port (required)
│   └── EA Settings
│
└── Python Connector
    ├── Service URL (required)
    ├── API Key (required)
    └── Config JSON (optional)
```

**UI Flow:**
1. User selects protocol in Live Settings
2. UI dynamically shows protocol-specific fields
3. Validation based on protocol requirements
4. Save connection config
5. Test connection button

**Implementation:**
1. Create `ProtocolSelector.jsx`
2. Create protocol-specific forms
3. Add validation schema per protocol
4. Implement connection testing
5. Store in database with encryption

#### 11. Connectivity Settings
**Complexity:** MEDIUM  
**Impact:** MEDIUM - Feature

**Features:**
- API Key management for external providers
- TwelveData API configuration
- Per-user API keys (encrypted storage)
- Connection testing
- Usage statistics

**Implementation:**
1. Create `ConnectivitySettings.jsx`
2. Add API key management UI
3. Encrypt sensitive data in transit/storage
4. Create provider connection test
5. Add rate limit monitoring

#### 12. System Settings – Danger Zone
**Complexity:** MEDIUM  
**Impact:** HIGH - Admin feature

**Admin-only Maintenance Actions:**
```
⚠️ DANGER ZONE

Reset Strategies
- Clears all strategy states
- Preserves definitions
- Confirmation required

Clear Cached Data
- Removes all cache files
- Frees disk space
- Non-destructive

Reset Datasets
- Removes uploaded data
- Keeps references
- Ask for confirmation

Factory Reset System
- Full system reset
- All user data erased
- Cannot be undone
```

**Implementation:**
1. Create `DangerZone.jsx` component
2. Add confirmation dialogs
3. Implement reset handlers
4. Add activity logging
5. Create admin audit trail

#### 13. Analytics UI Improvements
**Complexity:** LOW  
**Impact:** MEDIUM

**Feature:** Collapsible sidebar navigation

```
[☰] Analytics
├─ Overview
├─ Performance
├─ Risk Metrics
├─ Trades
└─ Reports

[Content fills freed space]
```

**Implementation:**
1. Add sidebar toggle button
2. Create collapsible menu
3. Update layout grid
4. Add animation on toggle

---

## Implementation Timeline

**Week 1:**
- Complete Priority 1 fixes (Auth separation)
- Start Priority 2 terminal redesign

**Week 2:**
- Complete Priority 2 UI improvements
- Start Priority 3 features

**Week 3:**
- Complete connectivity system
- Polish and testing

**Week 4:**
- Auth portal implementation
- Security dashboard

---

## Testing Strategy

**Unit Tests:**
- Auth middleware functions
- Protocol validation logic
- Storage cleanup operations

**Integration Tests:**
- Auth flow (signup → signin → logout)
- Terminal log capture
- Protocol switching

**UI/E2E Tests:**
- User role restrictions
- Terminal open/close
- Filter/search functionality
- Admin operations

---

## Security Considerations

1. **Role-Based Access:** Every API endpoint must verify user role
2. **Auth Tokens:** Implement token rotation and expiration
3. **API Keys:** Encrypt at rest, never log in plaintext
4. **IP Tracking:** Log all login attempts with IPs
5. **Device Fingerprinting:** Hash browser characteristics
6. **Rate Limiting:** 5 attempts per 15 minutes for login
7. **CORS:** Restrict to known domains

---

## Code Organization

**Frontend:**
```
corex-ui/src/
├── components/
│   ├── auth/
│   │   ├── SignupPortal.jsx
│   │   ├── SigninPortal.jsx
│   │   └── SecurityDashboard.jsx
│   ├── terminal/
│   │   ├── TerminalPanel.jsx
│   │   └── LogEntry.jsx
│   ├── settings/
│   │   ├── ConnectivitySettings.jsx
│   │   ├── DangerZone.jsx
│   │   └── ProtocolSelector.jsx
│   └── ...
└── hooks/
    ├── useTerminal.js
    ├── useAuth.js
    └── useProtocol.js
```

**Backend:**
```
engine/
├── middleware/
│   ├── authMiddleware.js
│   ├── roleMiddleware.js
│   └── rateLimitMiddleware.js
├── routes/
│   ├── authRoutes.js
│   ├── connectivityRoutes.js
│   └── ...
└── services/
    ├── authService.js
    ├── deviceFingerprintService.js
    └── connectionService.js
```

---

## Rollout Strategy

**Phase 1 (Week 1):** Role-based access (non-breaking)  
**Phase 2 (Week 2):** Terminal redesign (UI improvement)  
**Phase 3 (Week 3):** Feature additions (new features)  
**Phase 4 (Week 4):** Auth portal (user-facing change)  

All changes are backward-compatible until final auth migration.

---

## Success Metrics

- ✅ All tests passing
- ✅ No security vulnerabilities found
- ✅ UI is responsive and fast (<1s interaction)
- ✅ Auth flow completes in <3 seconds
- ✅ Terminal logs display in real-time
- ✅ Zero breaking changes for existing users
