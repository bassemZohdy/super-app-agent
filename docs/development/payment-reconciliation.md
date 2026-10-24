# Owned payment reconciliation

PAY-19 adds **Payment accounts → Payment recovery** for stored payments, saved-card wallet funding, refunds and retained raw captures. It uses owned records, the balanced journal and fixed source-provider status reads to distinguish a capture that never committed from a provider effect whose response was lost. All money remains simulated.

## Use the workbench

1. Select **Load recovery cases**, then inspect the original operation. **Load more recovery cases** walks stable pages of 25, including older records beyond the ordinary overview's history cap.
2. Read the capture/provider evidence, classification, masked source and permitted action. A new inspection is valid for five real minutes; an action rechecks both local and source evidence before admission.
3. **Resume original operation** continues the existing admitted capture or approved reversal. It never creates a replacement payment or uses another source. A missing/unavailable provider result can leave funds blocked.
4. **Request original-source refund review** creates a normal PAY-17 review for a confirmed stored payment or wallet funding. Review creation moves no funds. Separately approve it in **Refund to the original source**; existing provider, cumulative and available-wallet policies can still deny the refund.
5. A retained raw capture offers **Return confirmed unapplied capture** only when the exact source attempt and gateway claim both persist RELEASED. Missing source evidence or an uncertain claim is insufficient. The explicit return uses the existing original-source refund guard.

Keep the displayed inspection reference. After a lost action response or reload, **Read saved recovery outcome** retrieves its current result without dispatching money operations. An UNKNOWN action may resume the same inspection and operation; stale or expired unstarted decisions require inspection again. During an active action, read its saved outcome. A dead process's lease expires after two minutes; current evidence is still required before recovery resumes.

## Evidence and decisions

| Classification | Evidence / action |
| --- | --- |
| BEFORE_CAPTURE | Original capture intent exists; no exact capture/journal committed. Resume only this original admitted operation. |
| CAPTURE_COMMITTED | Original immutable charge and sealed balanced journal agree; source operation remains unresolved. Resume only if current admission is available and bound. |
| PROVIDER_APPLIED | Original capture committed and its exact source admission is APPLIED. Finish the original receipt. |
| RETURN_PENDING | The exact source reversal is APPLIED, but the original gateway return is unresolved. Finish that refund. |
| CONFIRMED | Original settlement/funding/return is recorded. A supported stored payment may request a separate refund review. |
| NOT_APPLIED | Closed operation, or exact legacy source/gateway release. Only the explicitly offered original-source action is permitted. |
| REVIEW_REQUIRED | An unstarted review/authorization needs its ordinary approval/challenge controls. |
| BLOCKED | Required source result is unavailable/missing/cancelled, or legacy non-application is unproven. No workbench money action. |
| INCONSISTENT | Capture/journal/admission/reversal bindings disagree. No automatic repair or balance edit. |

An APPLIED source read is evidence, not a caller-issued authorization. Existing checkout/refund services independently validate all terms before completing the operation. Legacy source status reads may retry the acknowledgement of an existing source attempt; they cannot create a meter, service application or charge. No new historical recovery decisions are backfilled during upgrade.

## API

Payment contract **1.13.0**, payment-provider OpenAPI **2.17.0**. Every route requires the interactive signed owner and owned account. Service/broker actors cannot use the workbench. Provider paths below are relative to `/v1/accounts/{accountId}`; POST requires an idempotency key.

| Provider route | Contract |
| --- | --- |
| `GET /payment-reconciliation` | First 25 cases and nullable `nextCursor` |
| `GET /payment-reconciliation/pages/{cursor}` | Next stable owned page |
| `POST /payment-reconciliation/inspect` | `kind: PAYMENT, FUNDING, REFUND or LEGACY`, `operationId` |
| `GET /payment-reconciliation/inspections/{inspectionId}` | Saved owned decision/action result |
| `POST /payment-reconciliation/inspections/{inspectionId}/act` | Exact `decisionDigest` and offered `action` |
| `GET /payment-reconciliation/audit/{kind}/{operationId}` | Latest 100 append-only audit records |

Core routes are `GET /api/payments/reconciliation` (optional `cursor`), `GET .../inspection` (`inspectionId`), `GET .../audit` (`kind`, `operationId`), `POST .../inspect` and `POST .../act` (`inspectionId` plus action/digest). GET includes `accountId` in query; POST includes it and `requestKey` in JSON. Unknown fields, caller amounts/sources/subjects/URLs and arbitrary verbs deny. POST replays return saved response snapshots; GET reads the current persisted outcome.

## Persistence, fencing and audit

The additive `payment_recovery_inspections` table binds owner/account, original kind/ID, immutable terms, local/source evidence hashes, allowed actions and expiry into a decision digest. The persisted lifecycle records OPEN/RUNNING/UNKNOWN/COMPLETED, admitted action, result IDs and attempts. A two-minute lease with a 30-second heartbeat fences each action; dispatch checks the lease before and after each provider call. At most 20 admissions are permitted per inspection. Underlying order/claim/issuer/reversal idempotency still guards concurrent inspections.

`payment_recovery_audit` is append-only through SQLite triggers. It records inspection, admission, original checkout/refund recovery start/observation/uncertainty and final result/error with safe codes. It contains no bearer tokens or raw signed assertions. Review creation and a confirmed legacy return commit with their workbench outcome/audit in one local transaction. Asynchronous provider and gateway effects remain separate transactions: a durable start may lack a final observation after a crash. Original IDs, journals, provider receipts and transactional outboxes provide effect evidence; later inspection resolves the outcome. This is local application integrity, not an administrator-resistant external audit system.

Ordinary wallet/history/order/issuer/source rows are preserved on upgrade. There is no reset, arbitrary balance adjustment or automatic compensation endpoint. Restore gateway and source snapshots together; do not infer non-application from removing a record or losing connectivity. [PAY-20 statements](payment-history.md) provide paginated history. Automatic-caller budget admission, broader failpoint controls and final race/shell qualification retain their own TODO gates.

## Verification

`npm run demo:verify:payment-reconciliation` runs isolated signed-owner HTTP/browser scenarios. `npm run record:payment-reconciliation` adds six-second evidence reviews and eight-second action results. Setup uses scripted signed APIs; recovery/refund decisions use the actual React UI. Private failure hooks exist only in the test process and expose no HTTP operator controls. Temporary databases are removed; local Keycloak/Redis remain shared, with isolated random conversation references and bounded TTL.

[Execution evidence](../reports/2026-10-24-payment-reconciliation.md) · [Paced recording](../recordings/payment-reconciliation/index.html) · [Refund policies](payment-refunds.md) · [Event boundaries](payment-events.md).
