# Signed payment events — 24 October 2026

This checkpoint adds PAY-18's stored-order event infrastructure and a real callback-assisted original-payment recovery demo. PAY-18 remains unchecked: named issuer-run presets, legacy raw-capture event coverage and the remaining qualification require their own work. Selected backlog totals remain 16 delivered and 34 open.

Source: the commit adding `payment-events.ts`, event schema version 1, payment contract 1.8.0 and payment-provider OpenAPI 2.11.0. [Usage, trust boundaries and recovery](../development/payment-events.md).

## Evidence

- Fourteen focused tests cover atomic gateway/source outbox rollback, original captured unknown recovery, forged/expired/substituted/duplicate/reordered events, ID/nonce/version conflicts, current refunded state, two-connection expired leases, crash/reopen, lost callback responses, backoff/exhaustion and signing-key rollover/retirement.
- Full repository checks pass: 278 Node tests, all 18 workspace builds, ESLint and the strict E2E harness type check. The signature-boundary test fixes the verifier clock so ±60-second denial is deterministic.
- The real Keycloak/Redis/temporary-SQLite browser commits DEWA settlement, loses the response after commit, receives an actual signed callback, leaves the captured order unresolved until explicit owner recovery, and verifies the same payment ID and one wallet debit. It then reverses the payment and proves forged/duplicate/late callbacks cannot revive the cancelled bill or change returned funds.
- The current VP9 recording is 43.84 seconds (1440×1050, 5,657,449 bytes). Reviews/attention pause six seconds, receipts eight seconds. The previous successful dated run is retained. The final screenshot was visually inspected: original APPLIED/SETTLED notifications show authoritative current REFUNDED state with zero pending gateway deliveries. [Viewer](../recordings/payment-events/index.html) · [Status view](assets/payment-event-updates.png).
- All twelve existing isolated browser journeys pass, including prior financial receipts, original unified checkout, account switch/reload and logout.
- Controlled normal-stack upgrade/restart preserves all three wallets, sealed balanced journal/projections, resource/idempotency rows, claims, issuer authorizations/returns and funding/order/group/refund histories. The new gateway event tables initialize without a history backfill or money effect; immutable outbox IDs/content survive the restart check. Readiness and signed-owner inventory checks pass.
- Compose configuration validates without printing secrets; local Markdown links in 75 documents and source-secret checks pass. No new Keycloak preview feature, production deployment, automatic spending rule or GitHub workflow is enabled.

The callback carries no spending authority or retained user credentials. It prompts existing owner recovery and cannot create funds or assert bill settlement by itself. This is local synthetic integration evidence, not production certification or closure of the remaining simulator/automation tasks.
