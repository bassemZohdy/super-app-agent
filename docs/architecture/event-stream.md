# Authenticated event stream

`GET /api/a2ui/stream?sessionId=...&accountId=...` transports the project's custom JSON envelopes. Send a bearer token in the Authorization header; never place a token in the URL. React and Angular use the shared fetch SSE reader and obtain refreshed user tokens through the public-client OIDC helper.

Every connection verifies identity and owner/account membership. CORS origins are checked. A fresh connection sends a handshake and current surface; a reconnect with `Last-Event-ID` replays later journal entries. Unknown/expired cursors return 409 with `STREAM_RESET_REQUIRED`; clients clear the cursor and request a snapshot. Invalid tokens return 401, wrong owners/accounts 403, invalid IDs 400. Connections close at token expiry or after five minutes, and send heartbeat comments every 20 seconds.

## Integrated Redis mode

The last 100 events per session are persisted with the configured session TTL and published through Redis channels. Different agent-core instances can serve an owned session and subscribe to its events. Normal restarts preserve transcripts, surfaces and replay state through Redis AOF. Session owner/account claims are atomic; conversation mutations acquire an expiring, renewed lease and use a fenced final save.

Redis errors fail closed. Conversation data is serialized in JavaScript before the atomic Redis write so empty arrays retain their JSON type. A regression test covers the empty-table reload failure caught during browser testing. The reference Compose Redis is single-node with AOF `everysec`; it is not a lossless production event broker or HA deployment.

## Fixture mode and bounds

Without `SESSION_STORE=redis`, the legacy map and replay journal remain process-local. That journal is bounded to 100 events per session, 1000 sessions, 8 MiB total and five-minute idle retention. Redis mode has 100 events/session and session TTL; deployment-wide quotas are still pending.

Both modes retain slow-consumer limits: 256 KiB queued/writable output per listener, at most five local listeners/session, incremental UTF-8 parsing, and exponential reconnect from 500 ms to 10 seconds. The five-listener count is process-local, not a cluster quota. Snapshots restore a surface, while the session API restores transcript history separately.

Flutter currently uses HTTP responses and saved-session restoration rather than a native SSE reader. Immediate cancellation of every open stream on Keycloak revocation is not implemented; token expiry bounds existing connections.

Verification: `services/test/event-stream.test.ts`, `test/integration/redis-sessions.ts`, `npm run demo:verify`, and the [current report](../reports/2026-10-23-provider-demo.md).
