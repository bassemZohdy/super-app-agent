# Stored payment authorization and synthetic issuer

PAY-05 adds finite synthetic card authorization and explicit owner challenges. React can now create a stored authorization review, approve its exact terms, complete/reject a challenge, inspect current funds holds and cancel. **Authorization alone does not capture or settle a bill.** A separate explicit Pay action now performs admitted bill capture/settlement. Existing provider HTTP settlements now use the [claim protocol](settlement-claims.md). Existing bill service payments now use the same stored wallet-order flow.

## Try it

1. Open **Payment accounts**, add a Challenge demo card and link an owned biller.
2. Select the bill/card and choose **Review payment quote**, then **Create authorization review**. This saves exact provider terms and reserves that obligation within the new authorization-review store; it does not hold funds yet.
3. Read the stored bill, source/version, amount/fee/total and expiry. **Approve authorization** is a separate explicit decision. Chat, voice, preview creation and Send do not approve it.
4. The Challenge preset displays **Approve demo card challenge** and **Reject demo card challenge** for that order/amount. No real OTP, PAN, CVV or card login is required. An unattended service cannot answer.
5. Approval reserves available card limit or wallet funds for at most two minutes. The UI reports AUTHORIZED, never paid/settled. Reload restores the review. **Cancel authorization review** voids the hold and releases its related-item locks without changing posted funds. Refresh to inspect current expiry/status.

Preset limits are AED 2,000 per synthetic card; the Limited preset has AED 100. The Declined preset always declines; Expired cards cannot be used. Limits account for pending challenges, active authorizations and confirmed issuer captures. Reviews capture only through the separately approved bill-execution action; capture consumes the exact authorization once. Limits are per saved synthetic source, not a shared bank credit line. [Source-confirmed refunds](payment-refunds.md) return original card value and restore available issuer capacity within the original captured amount.

The initial review lasts five minutes. A challenge/authorization lasts at most two minutes and never outlives the review. Before capture begins, expiry is persisted lazily on current reads/admission and releases holds/locks; there is no scheduler yet. A disabled/changed source cannot receive a new authorization. Existing holds stay conservative until cancelled/expired; changing a default never rewrites a stored review.

## APIs and persistence

Core GETs take `accountId` in the query; POSTs require it and `requestKey` in JSON. All new provider order paths require the independently verified signed-in owner, even in the retained legacy machine profile. The generic broker and client-credential/header lane cannot approve these reviews. No authorization token, assertion, client secret or user refresh token is stored in a quote.

| Core API | Provider API under `/v1/accounts/{accountId}` | Input |
| --- | --- | --- |
| `GET /api/payments/orders` | `GET /payment-orders` | Current owned reviews |
| `GET /api/payments/overview` | Includes reviews, card limit/held/spent/available summaries and wallet funds | Current account |
| `POST /api/payments/orders` | `POST /payment-orders` | `provider`, `payableId`, `expectedPayableRevision`, `methodId`, `expectedMethodVersion` |
| `POST /api/payments/orders/approve` | `POST /payment-orders/{orderId}/approve` | `orderId`, `expectedVersion`, `approvalDigest` |
| `POST /api/payments/orders/challenge` | `POST /payment-orders/{orderId}/challenge` | Above plus `challengeId`, `decision` (APPROVE/REJECT) |
| `POST /api/payments/orders/cancel` | `POST /payment-orders/{orderId}/cancel` | `orderId`, `expectedVersion` |

The source provider is read through fixed server paths with the signed owner's token at creation, approval and challenge response. The provider-derived amount/reference/revision and current local method/link version are checked in admission. Unknown fields/prices/source overrides are rejected. The immutable stored quote digest is compared to the server's record; it is not a standalone spend credential. A declined authorization returns a successful request with order state FAILED and a durable reason, not a payment receipt.

SQLite stores review snapshots and issuer attempts in additive tables beside the existing journal. A partial unique index prevents two active new authorization reviews for the same account/provider/obligation, independent of transport keys or payable revisions. Lifecycle ORDER/HOLD references bind/release atomically with their producer transitions. Issuer available limit is checked under the same SQLite writer transaction. Wallet holds use the shared journal availability check, including concurrent legacy spends.

Exact POST retries return their stored result without another effect. They can show an older lifecycle snapshot; read current GET status before another decision. Changed payloads conflict; stale order versions/digests, cross-owner decisions, substituted challenges and new-key replay fail. History is bounded to 100 reviews and 500 issuer authorizations per account in this demo. Before reverting to code without this producer, cancel/expire all active reviews using current code and confirm their related-item locks are released. Preserve the tables/history and existing volumes; deleting rows or restoring an older wallet backup is not a cancellation procedure.

## Remaining integration boundaries

The reservation covers current bill/fine service settlement; other legacy service types and future automatic callers retain separate integration tasks. Source GET preflight and a local hold are separate transactions; bill/fine capture first acquires provider admission. No free-standing `/payment-orders/{id}/capture` endpoint exists; approved bill execution uses `/execute`. Stored bill execution now integrates those reservations, capture and claims; broader cross-operation admission and recovery remain open. This implementation does not grant recurring spend or activate a worker.

Runtime clocks default to real time. Tests can inject a private constructor-only authorization clock; no HTTP/env setting lets clients advance it. JWT/key/client validity continues using real security time. The separate preview scenario CLI cannot reach these funds or reviews. Execution-run clock integration remains future simulator work.

```bash
npm run demo:verify:payment-authorization
npm run check
```

The browser verifier needs local Keycloak/Redis, Chrome and the [isolated harness ports](payment-accounts.md). It exercises actual signed-owner HTTP/UI, deterministic private-clock expiry, owner/machine/replay/price denial, limited/declined/expired sources, unchanged funds before capture and a confirmed challenged-card bill payment. [Latest execution evidence](../reports/2026-10-24-payment-checkout.md); [original authorization evidence](../reports/2026-10-24-payment-authorization.md).

[Pay bills after authorization](payment-checkout.md) describes the explicit capture action, receipt and pending recovery states.

[Exact-set fine payments](fine-checkout.md) reuse the same authorization, challenge and capture controls with shared constituent reservations.
