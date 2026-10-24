# Owned payment reconciliation — 24 October 2026

PAY-19 delivers the owned recovery workbench, evidence-bound guarded actions, separately approved refund reviews and local append-only audit. It retains existing payment/reversal identities and leaves unverifiable outcomes blocked. [Usage and contracts](../development/payment-reconciliation.md).

## Executed evidence

- Fifteen focused tests pass using real SQLite gateway/source state. They cover capture loss before commit and provider application loss after commit; unavailable and mismatched admission; owner, expiry, stale state and digest denial; separately approved refund review and replay; lost source reversal; concurrent recovery; saved UNKNOWN retry; database reopen; append-only audit; 111-record pagination; journal/decision mismatch; strict request validation; atomic funding inspection; exact legacy release return; and rollback when its final audit cannot persist.
- The signed isolated browser uses real local Keycloak/Redis and HTTP providers. It records DEWA loss before preparation, du source commit/response loss, an actual payment-provider restart before recovery, separate refund approval followed by lost reversal response, Etisalat source-status outage and later resolution, wrong-owner/digest denial, saved-outcome reload and final wallet arithmetic. There are exactly three original payment orders and one completed supported refund.
- Recording duration is **97.68 seconds**, **13,397,658 bytes**, with six-second evidence/review holds and eight-second results. Scripted signed APIs set up pending operations; actual React buttons perform recovery/refund decisions. Blocked and completed screenshots were visually inspected.
- All **12 existing browser journeys** pass on isolated provider data after the workbench addition.
- The normal-stack financial restart preserves all resource/idempotency hashes, existing journal/claim/order/funding/group/refund/event rows and issuer history. All three wallet openings, sealed postings and projections reconcile; normal issuer fault controls remain absent.
- `npm test`: **345 passing tests**. All **18 workspace builds**, ESLint, E2E TypeScript and generated OpenAPI validation pass. The shared payment contract is **1.11.0** and payment-provider OpenAPI **2.15.0**.

Normal `demo:wait` and signed-owner inventory checks pass; wallet funds and transaction history are unchanged.

Local links pass across **84 Markdown documents**; source/document secret checks and `git diff --check` pass.

The recording's fault controls are private test-process hooks. They do not add provider/operator HTTP endpoints. Normal accounts and funds are untouched by this isolated run; temporary SQLite files are removed. Local Keycloak and Redis remain shared, with random isolated conversation references and bounded session TTL. Test credentials are public synthetic demo identities; bearer tokens are never recorded in reports or audit.

[Recording](../recordings/payment-reconciliation/index.html) · [Blocked evidence](assets/payment-recovery-blocked.png) · [Saved completed outcome](assets/payment-recovery-completed.png).

An inspection is a historical evidence snapshot; its completed result/audit records the subsequent outcome. Missing provider data is not proof of non-application. Durable local audit starts and financial journal/outbox records retain effect identities across a crash; there is no cross-service atomic transaction or administrator-resistant audit guarantee. General simulator controls, automatic-caller admission/budgets, statements and final race/shell qualification retain separate TODO gates. The selected backlog now has **21 delivered slices and 29 open**.
