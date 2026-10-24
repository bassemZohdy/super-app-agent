# Wallet/card bill checkout

DEWA, Etisalat and du bills now use the same stored-order capture and settlement path from React's payment panel and the existing wallet-funded service/conversation routes. Explicit approval authorizes a finite hold; the separate **Pay AED …** action captures it and settles the provider-admitted bill. A receipt is shown only after the provider confirms application. Exact-set fines now use this same flow; prepaid/toll recharges now extend it through explicit intents and target fences. Multi-provider checkout, automatic rules and full refund/reversal workflows retain their separate backlog tasks.

## Use the demo

1. Open **Payment accounts**, link an owned biller, select an unpaid bill and wallet or synthetic card, then review its current quote.
2. Create the stored review and explicitly authorize the displayed source/amount. Complete the bound demo challenge when required.
3. Choose **Pay AED …**. The backend reserves the exact provider obligation, captures the approved hold once, applies settlement using the merchant-scoped claim protocol and records the provider receipt.
4. Inspect the confirmed amount/source and receipt. Card payments consume the card's finite limit and leave wallet funds unchanged. Wallet captures consume their hold and debit the balanced journal once.
5. If status is CAPTURING/CAPTURED/RECONCILIATION_REQUIRED, use **Inspect or resume payment** on that order. Recovery preserves payment identity; it never starts a replacement debit. A captured-but-unconfirmed operation is not displayed as a paid bill.

Cancellation remains available before capture. After capture, cancellation cannot void a committed payment. Paid/pending/unknown settlement claims block generic refunds; new stored-order refunds require the future original-source reconciliation/reversal workflow. No automatic refund or balance edit is inferred from a timeout.

## Admission and capture boundary

The source prepares a short-lived reservation containing owner/account, exact payable revision/amount, order/digest and funding ID/version. Before admitting it, the source independently reads the gateway's current CAPTURING order and verifies the full binding. Quote changes, closed bills, unavailable sources, wrong owners and expired holds deny before capture.

PREPARED reservations expire safely. ADMITTED reservations do not expire into a second payment when capture may have committed. Source amendments and competing settlement are blocked. Capture is permitted only before the funding/review/provider deadline; a capture admitted before that boundary can be applied afterward against its frozen terms. Cancellation/release requires a durable gateway FAILED/CANCELLED fence with no capture. A late capture loses the local writer race to that fence and is denied.

The gateway commits hold consumption, issuer/wallet effect, balanced postings, charge/attempt identity and CAPTURED order in one SQLite transaction. Source settlement, consumption marker, attempt fence, reservation receipt and idempotency response commit together through the existing claim protocol. Source confirmation changes the order to SETTLED and releases lifecycle locks. No database transaction spans an HTTP call.

## APIs and compatibility

| Core POST | Provider POST under `/v1/accounts/{accountId}` | Body beyond account/request key |
| --- | --- | --- |
| `/api/payments/orders/execute` | `/payment-orders/{orderId}/execute` | `orderId`, `expectedVersion`, `approvalDigest` |
| `/api/payments/orders/recover` | `/payment-orders/{orderId}/recover` | `orderId` |

Current order GETs and overview expose CAPTURING, CAPTURED, RECONCILIATION_REQUIRED and SETTLED, `fundsCaptured`, provider admission/payment IDs and the confirmed receipt. Contract version is 1.5. An ordinary preview remains `previewOnly: true`; the broader overview is no longer labelled preview-only. Exact request retries return their stored response; use current status/recovery after an unknown result.

Source routes `/payables/{payableId}/admissions` prepare a reservation; `/{admissionId}` reads it, and `/admit`, `/cancel`, `/payments` control its guarded lifecycle. They require the current interactive owner. The source obtains gateway state itself; caller-supplied order snapshots or arbitrary URLs are never accepted. Worker execution remains disabled pending the mandate/grant contract.

Existing bill application APIs now create/authorize/execute wallet orders. Their explicit human payment request remains the decision; A2UI bill bindings echo bill ID, provider revision and amount, and stale/missing fields fail. Unlinked owned billers can receive a verified setup link as part of that one-time payment. General funding defaults do not change.

**Migration for raw capture consumers:** `/charges` rejects bill/payable/admission reference namespaces for DEWA/Etisalat/du with `STORED_BILL_ORDER_REQUIRED`. Use the new stored-order APIs; raw billing flags cannot bypass the reservation/approval contract. Non-bill compatibility fixtures remain unchanged. New card IDs are not accepted as generic free-standing `/charges` sources.

The order table migrates existing review IDs/snapshots into its capture-state schema and creates `.before-order-capture-v2.sqlite` when upgrading a persisted old table. Journal schema remains v1; a new hold-consumption link distinguishes captured holds from cancellation in the original closed-hold vocabulary. Reopen does not repeat financial effects. Preserve gateway/source histories together; do not revert to code that cannot inspect captured/pending orders.

## Verification

`demo:verify:payment-authorization` now includes a real challenged-card payment, unchanged wallet balance, finite issuer spend and receipt restoration after reload. `demo:verify:payment-accounts` includes idempotent wallet bill execution and source claim/refund checks. Existing twelve journeys verify the migrated conversational/manual wallet paths. Focused tests cover both sources, lost responses before/after provider commit, exact recovery, source changes, hold expiry, admission substitution/cancellation and old-order migration. [Evidence](../reports/2026-10-24-payment-checkout.md).
