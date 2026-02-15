# PostgreSQL Migration + Auth Rollout

## 1. Configure Environment

Set either `DATABASE_URL` or full `PG*` variables.

Required auth vars:

- `JWT_SECRET` (recommended in production)
- `AUTH_ADMIN_EMAIL` (optional seed email, default `admin@corex.local`)
- `AUTH_ADMIN_PASSWORD` (optional seed password, default `ChangeMe123!`)
- `ALLOW_LEGACY_ADMIN_KEY` (`true` by default for transition)

## 2. Run Migration

```bash
npm run db:migrate
```

What migration does:

- Applies SQL schema in `db/migrations/001_corex_init.sql`
- Migrates legacy JSON data from:
  - `data/db/corex_db.json` (users/accounts/quota)
  - `system_settings` (DB)
  - `broker_settings` (DB)
- Seeds admin user if no users exist

## 3. Authentication Flow

- Public endpoint: `POST /api/auth/signin`
- Protected endpoints now accept:
  - `Authorization: Bearer <token>` (preferred)
  - `x-admin-key` fallback while `ALLOW_LEGACY_ADMIN_KEY=true`

Sign-in UI page is available in frontend and gates app access.

## 4. Verification

Run test suite:

```bash
npm test
npm run test:auth
```

`test/auth.integration.test.js` runs only when PostgreSQL config is present and `RUN_DB_INTEGRATION=true`.
