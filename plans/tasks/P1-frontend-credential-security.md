# P1 — Frontend Credential Security — Remove Unsafe Defaults

**Status:** COMPLETE  
**Priority:** P1 (security)  
**Source:** Provider Integration Verification findings, `plans/reports/PROVIDER_INTEGRATION_VERIFICATION_RESULTS.md` §Defect 2  
**Repository:** `C:\Users\SBUM\Desktop\corex`  
**Branch:** Do not create a new branch unless required; preserve all existing uncommitted work

## Problem

`front_end/src/views/SettingsView.tsx` contains credential-like hardcoded defaults:
- Line 174: `useState({ accountId: 'ma_9832103a', token: 'eyJ...' })` — MetaApi accountId and JWT-like bearer token as React state defaults
- Line 175: `useState('mt5_sec_token_hash_value')` — apiSecretKey default
- Line 80: schema `default: 'mt5_sec_token_hash_value'` — connector API secret key schema default

These values may be fabricated demo values or previously valid credentials. They must not ship as hardcoded defaults in client source.

## Scope (in)

- Replace hardcoded credential-like defaults in `SettingsView.tsx` with empty strings
- Ensure the settings UI functions correctly with empty defaults (user must enter values)
- Do NOT reproduce literal token values in any message, commit, or log
- Do NOT attempt to validate whether the tokens are still active (that would require external network calls with potential secrets)
- Add a TODO/comment-free note that defaults are intentionally empty (no comments per project rules — keep code clean)

## Scope (out)

- Do not revoke or rotate credentials (requires Owen's credentials and separate authorization)
- Do not modify backend settings services
- Do not modify any other frontend files unless directly related to this finding
- Do not stage, commit, push, or merge

## Acceptance criteria

1. `SettingsView.tsx` line 174: `metaApiConfig` initial state uses empty strings for `accountId` and `token`
2. `SettingsView.tsx` line 175: `apiSecretKey` initial state uses empty string
3. `SettingsView.tsx` line 80: schema `default` for `apiSecretKey` is empty string or removed
4. Frontend type-checks/builds without errors (`npm --prefix front_end run build` or `tsc --noEmit`)
5. No literal credential values appear in any report, message, or log
6. All pre-existing uncommitted changes preserved; no application source modified outside `SettingsView.tsx`

## Dependencies

- None (bounded, single-file change)

## Evidence required

- `git diff` of `SettingsView.tsx` showing only the default-value replacements
- Build/typecheck command and result
- Confirmation that no secret values were printed
