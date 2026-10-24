# Original-source payment refunds

PAY-17 adds explicit, owner-approved provider reversal followed by refund to the original wallet or card. Requests are finite and cumulative: a capture cannot return more than its original value, including across partial refunds or retries. An unknown provider result does not restore funds.

## Demo policies

| Original effect | Provider reversal policy | Money return |
| --- | --- | --- |
| DEWA/Etisalat/du bill, traffic fine or exact fine selection | Full cancellation of the exact settled obligation(s); no partial bill/fine payment or reopening | Original captured wallet/card |
| Salik or telecom prepaid recharge | Full/partial unused balance reversal, bounded by original credit and current active target balance; conflicts with another admitted target operation deny | Original captured wallet/card |
| Card-funded Cityside wallet top-up | Full/partial reversal from current available wallet funds; held/spent funds cannot create an overdraft | Original captured card only |

These are synthetic provider policies. They do not assert that real government agencies, banks or telecom providers accept cancellation under these terms. Historical raw captures keep their conservative claim/refund guard; the new flow requires a confirmed stored order and exact source admission. A legacy unknown claim does not become refundable through this API.

## Use the application

Open **Payment accounts → Refund to the original source**. Choose a confirmed payment, enter a partial amount where supported and a reason, then **Review original-source refund**. Read its original source, amount, cumulative refund and provider cancellation before explicitly approving it. No effect occurs during review.

The provider confirms cancellation or credit removal first. A card refund reduces net spent card value; it never credits the wallet. A wallet-funded bill refund restores the original wallet. A wallet-funding refund removes available wallet value and returns that amount to its original card. A disabled, expired or removed card can receive a return; it cannot become a new funding source through this operation.

Pending results show **Inspect or resume refund**. Continue this original refund after a timeout; do not create a new refund or charge. Confirmed receipts persist across reload. Original payment/top-up receipts remain historical and carry separate cumulative refund annotations, including within groups. A previously completed group does not become an atomic reversal of all its children.

## API contracts

Payment contract **1.14.0**. Payment-provider OpenAPI **2.18.0**; RTA **2.3.0**, DEWA **2.5.0**, Etisalat/du/Police **2.6.0**. Provider routes are under `/v1/accounts/{accountId}` and require an interactive owner JWT; machine and delegated tokens cannot request or apply these reversals. POST requires `Idempotency-Key`.

| Payment-provider route | Request / outcome |
| --- | --- |
| `GET /payment-refunds` | Owned review/history list, up to current demo cap of 100 |
| `GET /payment-refunds/{id}` | Current original refund state |
| `POST /payment-refunds` | `origin: PAYMENT or WALLET_FUNDING`, `orderId`, `expectedVersion`, `amountMinor`, `reason` |
| `POST /payment-refunds/{id}/execute` | `expectedVersion`, `approvalDigest`; explicit exact approval |
| `POST /payment-refunds/{id}/recover` | Empty object; inspect/reuse original reversal |
| `POST /payment-refunds/{id}/cancel` | `expectedVersion`; only before reversal starts |

The corresponding core POST routes are `/api/payments/refunds` and `/api/payments/refunds/{execute,recover,cancel}`. Include `accountId` and explicit-action `requestKey`; actions use `orderId` to identify the refund review. `GET /api/payments/overview` includes `refunds`. The original order ID is used only for creation. Unknown properties, source overrides, fractional/invalid amounts and stale versions deny.

Source providers expose `GET/POST /payment-reversals/{refundId}`. POST has an empty body. The source fetches the gateway's current refund itself and validates signed owner/account, state, exact original admission/capture/quote/source and cumulative value. Neither a caller's receipt nor a caller-supplied refund object grants authority. A completed original source acknowledgement is required before a recharge reversal.

Payment-provider POST keys reserve their fingerprint durably before asynchronous dispatch, preventing a changed body/path racing the first response from reaching another effect. Failed/unknown requests retain that binding. Repeated POST keys return saved response snapshots. Read GET/overview for current status; a new explicit recover action uses a fresh key and the same refund ID. Reviews expire after five real minutes, while already-started reversal recovery remains available after that deadline. Expired unstarted reviews can be cancelled. Business-clock changes do not bypass JWT/approval security time.

## State, transactions and recovery

`AWAITING_APPROVAL → REVERSING → REFUNDED` is the success path. Uncertain network/status or local persistence outcomes become `RECONCILIATION_REQUIRED`; provider-declared permanent rejection becomes `FAILED`; only unstarted reviews may become `CANCELLED`. One active refund per original order excludes parallel partial refund requests. The amount is bounded by the original immutable capture less already-confirmed refunds.

Source cancellation/credit reduction and its APPLIED decision commit together. Definitive source denials persist REJECTED decisions; replay cannot apply them after the balance is later replenished. Source identity, target fences and revision/cumulative checks remain independent defenses. Bills/fines become CANCELLED with original capture and reversal metadata retained; their original admission/use fences remain permanent, so no paid obligation is silently revived.

Gateway journal posting, original issuer return, cumulative claim/order/charge updates, transaction and confirmed refund receipt commit together. Partial card refunds are keyed by refund ID against the original captured authorization, with independent cumulative bounds. Net card spent/available reflects confirmed returns. The wallet-funding reversal posts wallet → external clearing and checks available funds, including active holds. Provider response loss after commit cannot duplicate reversal or money return; local posting failure retains the source result for original-ID recovery.

The additive `payment_refunds`, `payment_card_refunds` and source `provider_payment_reversals` tables do not reseed wallets or rewrite historical journals. Restore source and gateway snapshots together. Preserve unknown reversals and their original IDs on rollback; removing an endpoint never proves non-application. Never restore only one side or edit balances to manufacture a completed refund.

The existing raw `/charges/{id}/refunds` route remains guarded and cannot refund an applied/pending/unknown stored-order claim. `PaymentClaims.reversedMinor` tracks confirmed source-backed returns without releasing the original settlement fence for reuse. Refund receipt/transaction history and original source snapshots provide audit linkage; the [PAY-19 workbench](payment-reconciliation.md) consolidates guarded recovery; [PAY-20 statements](payment-history.md) supply paginated financial and activity history.

## Verification

```sh
node --experimental-strip-types --import ./scripts/test-env.ts --test services/test/payment-refunds.test.ts
npm run demo:verify:payment-refunds
npm run record:payment-refunds
```

The browser uses real local Keycloak/Redis with temporary provider/application SQLite and model calls disabled. Refund reviews pause six seconds; confirmed and declined results pause eight seconds. The viewer is published only after every assertion passes. [Evidence](../reports/2026-10-24-payment-refunds.md) · [Recording](../recordings/payment-refunds/index.html).

A reconciliation workbench, statements, automatic policies and Angular/Flutter refund parity retain separate backlog gates. No external payment network or preview identity feature is enabled.

[Signed financial status events](payment-events.md) append with stored order/source transitions and arrive as owned inspection hints. Callbacks never authorize funds or replace authoritative provider lookup. SIM-03 supplies named issuer scenarios; PAY-18 covers current manual paths. General fault controls and unattended execution retain separate gates.

[Isolated issuer scenarios](issuer-scenarios.md) add operator-bound named outcomes and `AUTHORIZATION_PENDING`. Pending card capacity cannot capture/credit or dispatch later group lines; the original real-time deadline and separate customer execution remain enforced. Normal providers expose no run controls.
