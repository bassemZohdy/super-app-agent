# Security boundaries

This repository is a local demo. The reference stack uses known users/client secrets, local HTTP, single-node Redis and embedded SQLite. The named entities and all money are simulated. Do not deploy this realm/configuration publicly or use real personal/card/government records.

## Identity and service authorization

React and Angular use a public Keycloak client with authorization code and S256 PKCE, state/expiry checks, refresh and logout. Browser tokens live in sessionStorage, not in URLs or committed configuration. This remains readable by same-origin JavaScript: production needs an explicit XSS/session architecture and hardened deployment. Flutter's current sign-in is an explicitly local-demo password grant; native PKCE remains pending.

Core and application APIs verify RS256 signatures against configured JWKS, exact issuer/audience, finite bounded token times, access-token type and user subject. Integrated Compose also performs authenticated online introspection on each request. ID tokens and revoked/inactive access tokens are rejected. JWKS fetches are issuer-scoped, bounded, deduplicated and cooled down on unknown keys. Application APIs additionally require `superapp-user`. The core's `DEMO_AUTH=true` bypass applies only outside production and is disabled in integrated Compose. Fixture mode intentionally retains weaker legacy handlers and singleton data for offline tests.

Application services independently obtain client-credential tokens, cached only in their process and refreshed before expiry. Providers require audience `provider-api`, an allowed `azp` and an exact provider realm role. The settlement client has read-only payment access. No service credential enters a browser. Production provider/JWKS/token endpoints require HTTPS.

`X-User-Subject` is trusted only after machine authentication. Application services derive it from the validated user JWT. Providers enforce account membership and resource ownership through their SQLite account records. This is a demo trusted-service delegation boundary, not cryptographic on-behalf-of token exchange, tenant federation, or production consent.

## Session ownership and recovery

Integrated mode stores owner subject, immutable selected account, up to 100 messages, current surface/revision and reconciliation state in Redis. Default inactivity TTL is one hour. Active requests renew an expiring lease, check it before mutations, and use token-fenced saves/releases. Overlaps return 409; Redis failures fail closed rather than creating new sessions. React can list/restore/delete only the signed-in user's conversations.

Redis also persists 100 replay events/session and carries cross-process pub/sub. Socket backpressure/listener bounds remain local to each core process. The reference AOF uses `everysec`: normal restarts preserve state, but a crash can lose recent writes. Global quotas, HA, encryption, retention enforcement and disaster recovery remain production work. Online revocation is checked for new requests/reconnects; existing streams remain bounded by expiry/maximum duration. Deleting an idle conversation deletes its state/events and active graph continuation; entity financial/business records are retained. Redis checkpoints share the session TTL; this is not a tested disaster-recovery or general workflow store.

## Business writes and payments

Every provider write requires a persisted per-account idempotency key and a request hash. Matching replays return the stored result; changed payloads conflict. Input schemas reject unknown fields and invalid amounts. Gateway amounts are integer AED fils; capture/decline/refund and balance updates are transactional. Refund is allowed once per captured payment.

Providers check captured payment ownership, merchant, reference, amount and refund state before settlement, and record consumed proof IDs. Application quotes derive from provider resources. Core stores an approval ID, five-minute expiry, subject/account/revision and canonical surface digest. Every advertised payload field must match; missing, extra, altered, expired and stale actions fail. Cancellation invalidates the pending approval and graph continuation. The conversation retains at most 50 approval lifecycle entries. This is a one-time demo proposal binding, not a cryptographic provider quote, delegated grant or immutable audit service.

Capture and entity settlement are separate transactions. An unknown outcome blocks further mutations in that conversation; no cross-service atomicity or automatic compensation is claimed. A provider refund does not itself reverse a settled entity bill. Operators must reconcile payment and entity state. Redis persistence cannot guarantee exactly-once external effects under all crashes or lease-loss scenarios.

## Models, data and secrets

OpenRouter keys stay in ignored `.env`/server environment. No key means no inference. Live replies use bounded conversation/surface context, with a default free router, bounded timeout/tokens, zero-priced provider ceiling, per-actor hourly/concurrent call limits and no automatic paid fallback. Model endpoints must be official OpenRouter HTTPS. Remote TTS requires explicit opt-in. Provider failures are visible. A real request in the latest validation reached OpenRouter but received 401 for the configured key; successful generation is not established by mocked tests or the public health response.

Integration profiles omit real Emirates IDs, but prompts/surfaces still contain synthetic names, vehicle/premise references and bills. Production needs data minimization, approved provider egress/consent, redaction, retention/deletion controls and audit. No raw microphone audio is stored by the app; a browser speech service may process it remotely.

`.dockerignore` excludes `.env`, local databases and repository metadata. Generated OpenAPI examples contain no access tokens. The seeded realm and Compose secrets are intentionally public demo credentials and must be replaced outside local development.

HTTP readers enforce byte-based 64 KiB bodies, JSON media type, read deadlines and controlled malformed/aborted input handling. Each process has bounded IP rate/concurrency/cardinality budgets. These do not establish distributed user/tenant quotas. MCP uses the same identity/action guard, validates host/origin and caps input; it cannot bypass a current approval.

## Remaining release blockers

Production identity/tenant federation; native Flutter OIDC/device parity; complete consent/quotes and audit; payment reconciliation/compensation workflows; dependency upgrades/security scans; per-user/global quotas; durable workflow execution; production identity operations; HTTPS deployment; HA/backups; remote mini-app isolation; official protocol compatibility.

The legacy `DEMO_AUTH` runner and agentgateway candidate are not production security boundaries. See [backlog](TODO.md), [provider guide](docs/demo/provider-backends.md), and [executed verification](docs/reports/2026-10-24-demo-completion.md).
