# ADR-0010 — Provider simulators and account-bound demo sessions

Status: implemented for the local demonstration, following the user's request to add REST provider backends, Keycloak client credentials, embedded databases, a payment simulator and Redis user/account sessions. This does not approve production deployment.

Use separate configurable provider processes for RTA, DEWA, Etisalat, du, Police, DLD and payments. Each owns a SQLite database and versioned OpenAPI contract. Keep existing application API routes as adapters; in integration mode the concierge awaits HTTP calls instead of imported singleton handlers. Keep fixture handlers explicitly available for offline regression tests.

Authenticate people through Keycloak; authenticate application-to-provider calls with distinct confidential service accounts. Providers validate client audience/roles and account-owned resources. Carry the verified user's subject separately as a trusted-service assertion. This permits realistic service integration without pretending service credentials alone establish end-user consent.

Use Redis for expiring owner/account-bound conversation state, per-session renewed leases, fenced saves and shared replay/pubsub. Serialize state as JavaScript JSON to preserve empty arrays. Persist provider business records/idempotency beyond conversation expiry in SQLite.

Payment capture and entity settlement remain separate transactions with proof verification and conservative unknown-outcome handling. Avoid legacy unified double debits and artificial residential meter activation. The trade-off is explicit reconciliation for partial results; no distributed atomicity, production on-behalf-of delegation, HA or workflow engine is implied.

Evidence: provider contract/HTTP/SQLite/payment tests, real Redis integration, real local Keycloak and REST stack verifier, browser sign-in/account/restore checks. Exact results and limitations: [verification report](../reports/2026-10-23-provider-demo.md).
