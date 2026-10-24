# Settlement/refund exclusion — 24 October 2026

Progress on PAY-10 after `82568d3`. Current legacy and revisioned provider HTTP settlement paths now require a gateway claim and durable source fence. Full stored-order capture/payable reservation remains disabled and its integration criteria stay open. The publication commit identifies this source.

Implemented: separate per-provider Keycloak claim clients/roles; gateway claim/ACK/release and refund guards; PENDING/APPLIED/RELEASED source attempts; atomic business effect/consumption/idempotency/receipt; current-state claim retries; lost-response/ACK recovery and conservative historical capture migration. No user bearer token is persisted or replaced by caller identity headers. No shared read-client write authority or preview Keycloak features were enabled.

Nine focused tests prove stale-proof refund rejection, claim-before-refund exclusion, lost claim response, lost ACK/reopen, definitive non-application release, two-connection release-versus-late-effect fencing, unknown local failure rollback, provider/attempt/receipt substitution and historical migration/backup/reconciliation. The signed-JWT HTTP suite verifies narrow identity denial, another merchant/key-cache isolation, applied release denial and current APPLIED state on an exact prior claim retry.

The real-Keycloak payment browser passes current setup/lifecycle checks plus actual APPLIED claim/ACK, refund/human-release denial, non-application release/refund, late retry rejection and a separate du merchant settlement. Setup-owner funds remain unchanged; settlement cases use a different isolated owner. Complete repository checks pass **180 tests and 18 builds**.

All twelve isolated browser journeys pass through the updated settlement flow. The actual local migration preserves hashed resource/idempotency rows and journal entries, creates a matching readable pre-claims backup, and marks **14 historical captures** LEGACY_UNKNOWN across the existing **3 wallets**. Wallet projections and sealed journals remain consistent. Readiness and the signed-owner inventory check pass with funds/history unchanged. Current Markdown links pass across 61 documents. Existing payment capture admission, full order execution, safe partial/provider reversals, asynchronous outbox/reconciliation, mandates and autopay remain their unchecked tasks.

[Operating contract and recovery](../development/settlement-claims.md).
