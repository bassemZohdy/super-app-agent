# Finite consent records — 24 October 2026

AUTO-01 adds strict versioned policies, exact explicit approval, current source-owned target checks and immutable retained history for six payment/service families. Mandate contract 1.0.0 and payment-provider OpenAPI 2.13.0 are additive. [Usage and limits](../development/payment-mandates.md).

## Verification

- Fourteen focused tests cover exact approval, immutable policy history/reopen, source/target lifecycle locks, ownership and unattended denial, real-time expiry, invalid/unbounded amounts/windows/actors, ordered fallback, all six operation families, competing head versions, transaction rollback, fixed source-provider reads and shared API contracts.
- `npm run demo:verify:mandates` passes with real Keycloak identities and isolated provider databases: all six families explicitly reviewed/approved, exact retry and changed-body conflict, wrong owner/workspace denial, service-token denial, old-digest rejection after revision, source removal guard, actual payment-provider restart, history restoration, disabled-source rejection, revocation and lifecycle release. Wallet balances and transaction history are identical before/after consent actions. The parking session's synthetic setup payment precedes this baseline.
- `npm test`: 306 passing tests; all 18 workspace builds pass. Lint, E2E TypeScript and generated OpenAPI checks pass. The focused mandate suite also verifies that changing the default source leaves approved consent unchanged.
- `npm run test:e2e`: all 12 existing browser journeys pass.
- `npm run demo:verify:payment-ledger` preserves existing resources/idempotency and financial history across the normal stack rebuild/restart; all three wallet openings and projections reconcile. `demo:wait` and signed-owner `demo:verify:inventory` pass without money/history changes. Read-only checks against the normal running gateway return owned mandate lists for both workspaces with execution disabled.
- Local links pass across 79 Markdown documents; source/document secret checks and `git diff --check` pass.

Approval records consent only; all records return `executionEnabled: false`. No automation client is provisioned, credential minted, execution budget reserved, job scheduled or automatic effect dispatched. AUTO-02–AUTO-15, remaining payment/simulator slices and final QA retain their separate gates. The selected backlog advances to 18 delivered slices and 32 open. This API foundation has no new consent editor or browser recording; those remain AUTO-04 and QA-07.
