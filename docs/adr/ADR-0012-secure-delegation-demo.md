# ADR-0012 — Supported JWT-grant delegation in the local demo

**Date:** 24 October 2026. **Status:** accepted for the synthetic local demo following the user's instruction to start the planned work. **Production/security release approval:** not granted. Extends [ADR-0011](ADR-0011-local-demo-target.md); [analysis](../architecture/secure-identity-delegation.md), [runbook](../development/delegation.md), [evidence](../reports/2026-10-24-delegation-demo.md), OBO tasks in [TODO](../../TODO.md).

## Decision

Use the existing exact Keycloak 26.6.4 image for an isolated local compatibility demonstration of supported RFC 7523. No preview/experimental features, scripts or native token-exchange delegation are enabled. Selecting a maintained/advisory-reviewed production patch and image scanning remain release gates, not claims established by this demo.

Run a separate trusted `delegation-broker` process on 4010. Only that service mounts the issuer/client private keys and authoritative grant/binding/job SQLite volume. Agent-core provides an authenticated UI/MCP facade; it has no issuer-key or grant-data volume. Separate RSA keys authenticate the client with private-key JWT and sign external user assertions. Workloads never receive assertions, delegated access tokens or human refresh tokens.

The actual OAuth actor is `delegation-broker`, reflected in `azp`; the authenticated initiating human or `delegation-runner` service account is audited separately. Do not emit a custom `act` object. The Java mapper is omitted because verified `azp` and server records meet this demo's provenance requirement. Revisit only with a new requirement and exact-image SPI proof.

Each grant permits one exact provider/method/path/body, owned account, purpose, expiry and count limit. The single realm's exact issuer is stored with the grant; changing realm configuration invalidates it. Broker exchanges are short-lived, independently capped at 90 seconds, and use prelinked external identities `cityside:<existing internal UUID>`. Internal subjects and account IDs are preserved. Binding uses SHA-256 of the issued token against the grant version, actual actor, user and operation; no token is stored. Only trusted broker code registers bindings.

Resource providers independently verify Keycloak JWTs/introspection, then perform an uncached online grant check. The authority's transaction checks current consent and atomically consumes the operation reservation. Revocation before this authorization point denies the operation; an already authorized in-flight effect may complete. Committed effects are not undone. No extra token or positive authority cache is used.

The reference `demo:up` activates/reconciles this local demo lane. Legacy fixture mode leaves it disabled. Read grants cover exact supported GET operations across all seven simulators; the first UI presets target wallet reads. Writes are restricted to one exact synthetic wallet credit of AED 1–10, with one execution per grant; UI presets approve AED 1. All other delegated mutations are denied. This is not general spending, PSP settlement, schedules or multi-hop authority. Broadening requires explicit scope review and the remaining OBO tasks.

Interactive requests retain a separate lane: application services forward the verified user token, and providers derive ownership from its signed subject. The demo browser token includes `provider-api`; the providers share that demo audience. True machine access is limited to the separate captured-charge proof reader. With delegation enabled, other service tokens cannot impersonate a human through `X-User-Subject`. Legacy fixture tests retain their earlier explicit service-header profile. Production needs per-resource audience design and a reviewed interactive authorization profile.

## Consequences and risk disposition

- A completed execution returns its stored result for the same request key. Pending/unknown executions block new work; no automatic retry or bypass can cause a second effect. Operator reconciliation remains manual and automated compensation is deferred.
- Consent narrowing increments the version and invalidates prior bindings. Renewal or broadening requires a new explicitly approved grant. No MCP tool can create or expand consent.
- SQLite transactions and two-connection/reopen tests cover the demo's durable count/idempotency boundary. They do not establish distributed external-payment atomicity, database HA, immutable audit or disaster recovery.
- Current owner policy combines authenticated `superapp-user`, owned personal/household resources and PAY-21 online owner/membership eligibility epochs. Restored permission requires fresh authority; original in-flight IDs and history remain retained. Broader tenant, fine-grained entitlement and identity-unlink/role-change lifecycle enforcement remains open; administrative entitlement changes must revoke affected grants. Existing tokens may otherwise outlive a role change until their short expiry.
- This is a bearer-token profile. Private-key client authentication does not make access tokens sender-constrained. Tokens stay between broker and providers; TLS, egress isolation, KMS, rotation drills and proof-of-possession selection remain production work.
- Local HTTP, H2 Keycloak, public seeded credentials and source mounts remain deliberately local. The broker refuses the demo flow in `NODE_ENV=production`. External security/integration review is still OBO-35; this ADR does not replace it.

## Rejected or deferred alternatives

Direct agent exchange would require a proven trusted grant-binding path and would expose credentials to the workflow runtime. A mapper emitting `act` alone cannot supply that binding. Native delegation, JavaScript mappers and experimental exchange violate the feature constraint. Persisting actor/grant context in mutable user attributes or shared session notes risks cross-request contamination. Ordinary interactive OAuth remains the path for foreground actions; this new lane does not replace per-action approval.

## Rollback

Stop new runner execution, revoke grants, disable the broker client/IdP, and stop the broker service. Existing delegated provider calls fail closed when authority is unavailable. Keep interactive login and user UUIDs intact. Do not restore header-based impersonation on the reference profile. Retain grant/job/audit data for investigation, and reconcile unknown effects before any replacement grant is used to repeat them.

## Expanded payment mandate boundary — AUTO-02

The [payment automation threat model](../architecture/payment-automation-security.md) records the authority allocation and required permit/budget/entitlement admission contract. Its baseline and findings are separate from subsequent code hardening. The legacy broker now uses an explicit reviewed read profile, rejects extra authority terms, validates pending-job token bindings and retains terminal results. Stored grants are revalidated against that profile before use; unsupported consent/audit remains available for inspection/revocation. New OpenAPI routes do not become delegated rights automatically.

Finite `cityside-automation` mandates remain non-executable. They cannot be attached to the legacy small top-up/read grant to acquire recurring spending. AUTO-03 must derive exact commands and reserve shared amount/count/payable authority from current consent/entitlement; PAY-08/PAY-21 and AUTO-15 retain their reservation/lifecycle/revocation gates. Production security disposition remains pending; a bound bearer can still race its exact intended request and is not sender constrained. [Executed local controls](../reports/2026-10-24-automation-security.md).
