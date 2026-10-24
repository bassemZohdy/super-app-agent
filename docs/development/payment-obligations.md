# Business reservations and original capture attempts

PAY-08 now reserves business obligations at the payment gateway before a funding authorization, independently of HTTP keys and conversation IDs. This is an implementation checkpoint; PAY-08 remains open until the automatic caller path is integrated and qualified under AUTO-03. No new unattended payment lane is enabled.

## One business obligation across callers

A bill or individual fine is keyed by provider and its authoritative business obligation ID within the owned workspace. Quote aliases, revisions, transport keys, sessions and selected funding sources cannot create a second reservation. A fine selection reserves every constituent in the same transaction that saves its order. An overlapping single-fine/group/manual request fails before it can open a competing hold. Group creation rolls back every child/order/resource reference if any business reservation conflicts.

A recharge reserves both its explicit provider intent and the target's current version. Two different intents quoted against the same target version cannot open competing funding reviews. A successful credit changes the source target version; a later deliberate recharge can reserve the new version. This does not authorize threshold-based recurring recharge or infer a new intent after an uncertain result.

The source provider retains its independent admission/settlement guards. Gateway business exclusion does not replace current quote validation, source admission, finite funding holds, capture checks or settlement-versus-refund exclusion.

## Attempt identity and uncertainty

Before the first provider admission POST, `beginCapture` commits the original order, planned payment ID and `capture_<order ID>` attempt together. Source calls use this stored identity. The attempt records PREPARING, UNKNOWN, CAPTURED, SETTLED, FAILED or CANCELLED; its account/order/payment/approval/source/amount identity cannot be updated.

The lifecycle view distinguishes planned amount from `fundsCaptured`. UNKNOWN before capture means no capture is recorded and source admission needs inspection; UNKNOWN after capture means the original captured payment needs settlement reconciliation. Neither state permits a new payment identity, funding fallback or automatic release because a token, approval or process expired.

Capture, reservation commitment, journal/issuer effects, charge/order state and attempt transition commit in the same local SQLite transaction. A persistence failure rolls them back together. Current eligibility and exact source/quote/admission still apply. After a verified source response, recovery completes the original attempt rather than dispatching another charge.

An explicit cancellation or definitive failure can release an **uncaptured** reservation after the local order permanently fences capture. A captured/settled obligation stays COMMITTED; cancellation, response replay and refunds do not create replacement payment authority. Source-side cleanup is separately retried using the original order.

## Read the React view

Open **Payment accounts**, then **Show business reservations and attempts** under **Access & in-flight work**. Each reservation names the original order and business resource. The attempt view names the original payment, planned amount, source and whether capture is recorded. It is an owned read model; it cannot charge, approve, release an unknown reservation or grant automation permission.

The existing owner-only `/api/payments/lifecycle` and private operator inspection return `obligations` and `attempts` arrays. Shared payment contract **1.14.0**, payments OpenAPI **2.18.0** describe their strict shapes. No new caller-controlled origin, permit, obligation key or command field is accepted by order creation. The existing interactive-owner restriction remains in force.

Transport replay and current state are deliberately distinct. An exact HTTP creation-key replay returns its saved original response and order ID. A changed body with that key conflicts. Read the current original order/lifecycle to see later authorization, unknown or settlement state. Do not treat an old creation response as permission to replace an order.

## Upgrade without changing history

The new tables are additive: `payment_order_obligations` and `payment_capture_attempts`. Startup derives references from stored order snapshots without rewriting order, charge, journal, issuer, wallet or transport-idempotency bodies. Existing captured history takes precedence when legacy reviews overlap. A conflicting old review remains stored with BLOCKED reservation evidence and cannot authorize new funds; an owner can explicitly cancel uncaptured work through its original order. A blocked historical row continues to exclude new work until resolved, even if another overlapping review is cancelled first.

An incomplete legacy quote is conservatively labelled LEGACY and blocks new orders for its provider/workspace; it needs explicit reconciliation rather than an invented resource mapping. Already captured work keeps its original recovery identity. A derived attempt is labelled `inferred:true`: an old order's approval/creation time is not represented as an observed dispatch time. New attempts record their actual preparation time.

For an existing stack, restart affected services using the migration/preservation command. Do not reset volumes:

```bash
npm run demo:verify:payment-ledger
npm run demo:wait
npm run demo:verify:inventory
npm run demo:verify:payment-obligations
npm run record:payment-obligations
```

The normal preservation command verifies existing financial/order bytes and, on subsequent restarts, the derived table hash. Non-empty historical overlap and captured-order migration are tested separately in temporary SQLite databases.

## Remaining gate

AUTO-03 must derive exact operations from current approved mandates and atomically bind shared budgets, counts, occurrences and these business exclusions before signing or issuing execution credentials. Automatic/manual races, unknown reservations and definitive failure release must be tested over the actual authenticated caller path. The current primitive and forged-origin negatives do not prove that integration, so PAY-08 remains unchecked and scheduled spending remains disabled.

[Execution evidence](../reports/2026-10-24-payment-obligations.md) · [Paced recording](../recordings/payment-obligations/index.html) · [Admission requirements](../architecture/payment-automation-security.md#required-auto-03-admission-contract).
