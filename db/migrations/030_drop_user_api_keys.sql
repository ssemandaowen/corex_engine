-- Complete the 2026-08-21 auth-simplification decision: drop user_api_keys.
-- The table was kept "for safety" in that decision; the code that used it (API-key issuance
-- routes, the x-auth-key fallback in /ws upgrade auth, 5 pgStore methods) has now been
-- removed. The table is no longer reachable from any application code path.
--
-- JWT is the sole authentication mechanism for HTTP routes (authGuard.js) and WebSocket
-- upgrades (server.js authenticateUpgrade).

BEGIN;

DROP TABLE IF EXISTS user_api_keys;

COMMIT;
