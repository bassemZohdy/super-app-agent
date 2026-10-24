# Recharge an owned toll tag or prepaid line

PAY-15 adds wallet/card recharge execution for the local Salik, Etisalat prepaid and du prepaid simulators. These credits change the selected provider balance, separate from adding money to the Cityside wallet. No real agency, telephone account, PSP or card is contacted.

## Try it

1. Sign in to React, choose a workspace and open **Payment accounts**. Link its Salik tag or Etisalat/du prepaid line using provider-verified discovery.
2. Open **Recharge a toll tag or prepaid mobile**. Choose the exact target, one of its denominations, and wallet or a saved demo card. The current provider balance is visible.
3. Choose **Review provider recharge**. Read the provider/target, amount, zero fee, total, current balance and selected funding source. Creating the review does not move funds.
4. Create the authorization review, explicitly approve it, and complete any bound demo card challenge. Funds are only held at this stage.
5. Choose **Pay AED …**. **Recharge applied** confirms the exact target credit and provider balance after payment. Wallet funding debits once; card funding leaves wallet funds unchanged.

Salik denominations are AED 50/100/200; seeded Etisalat/du prepaid denominations are AED 25/50/100. Only current active targets and denominations are allowed. The bounded provider balance limit is AED 1000000. A later recharge is a new explicit intent/review, never an automatic retry or fallback. Wallet top-up, subscription bill payment, prepaid mobile recharge and toll recharge retain distinct labels and targets.

## Unknown and pending outcomes

An authorization/challenge has no provider credit. After capture, a timeout leaves the original order **RECONCILIATION_REQUIRED** and blocks a new recharge for that target. Use **Inspect or resume payment** on the original order; do not create a replacement charge.

Source credit and its receipt commit atomically with source proof consumption/idempotency. The source then waits for a verified gateway SETTLED confirmation before releasing its target fence. If this last confirmation is lost, the UI truthfully shows the confirmed credit plus **Finish recharge confirmation**. That action only finishes the original confirmation; it cannot capture or credit again. Target fences never expire while a capture/credit may have committed. Cancel/expiry before capture safely releases them.

## APIs and persistence

Payment contract **1.9.0**; payment-provider OpenAPI **2.12.0**; RTA **2.3.0**; Etisalat/du and Police **2.6.0**; DEWA **2.5.0**; DLD **2.0.0**.

Provider routes are relative to `/v1/accounts/{accountId}`:

| Operation | Contract |
| --- | --- |
| `GET /recharge-targets` | Owned target reference/type/status/version, balance and denominations |
| `POST /recharge-quotes` | `targetReference`, `amountMinor`, `expectedTargetVersion`, `intentId`; provider `Idempotency-Key` required |
| `GET /recharge-intents/{intentId}` | Original immutable quote for one owned intent, for adapter resume |
| `GET /payables/{quoteId}` | Fresh executable/expired/changed/paid state for the recharge quote |
| Existing payment-order APIs | Store exact source/quote approval, authorize/challenge, capture, recover |
| Existing admission APIs plus `/finish` | Prepare/admit/cancel/apply; finish requires this exact applied credit to be SETTLED at the gateway |

Core adds `POST /api/payments/recharge-preview` with `accountId`, `requestKey`, provider, target reference/version, denomination and funding method/version. Unlike bill/fine preview, its request key identifies one explicit recharge occurrence. It persists no money effect and rechecks current quote state after issuance/retry. Reusing an intent/key with changed terms conflicts. Raw caller prices, fees, arbitrary sources and additional fields deny.

`provider_recharge_quotes` stores immutable intent terms and the eventual receipt. Admission retains a permanent quote/proof-use key and a separate target key. The target key remains active through PREPARED, ADMITTED, APPLIED and any lost final acknowledgement; `/finish` verifies the current gateway order server-side before releasing only that target key. Bill/fine locks are unaffected. Target balance/version changes invalidate old unexecuted quotes, while already-captured current admissions can complete against their bounded original terms after quote expiry. Unrecoverable target changes after capture stay blocked for reconciliation, with no invented credit/refund.

All new quote/admission/order writes require the current signed-in owner. A worker, service credential or caller-supplied order snapshot cannot approve or finalize them. Provider-specific settlement workloads retain their existing merchant-scoped claim authority; no new Keycloak feature/client or preview extension is enabled.

## Existing adapters and upgrade

The existing wallet-funded Salik adapter and unified checkout now use recharge intents and stored orders. Lost-response resume looks up the original intent before reading a new target version, preserving operation identity after an applied credit. New telecom manual APIs are `GET /telecom/{etisalat|du}/prepaid` and `POST /telecom/{etisalat|du}/prepaid/recharges` with `lineId`, `amountMinor`, `expectedTargetVersion` (provider names are literal paths).

New raw gateway recharge capture namespaces for RTA (`salik:`, `payable:`, `admission:`) and telecom (`prepaid:`, `recharge:`, `payable:`, `admission:`) require stored orders. Historical captured Salik proofs can still settle through the retained legacy source endpoint, with target-fence/lifecycle/balance guards; that endpoint cannot mint a new capture. Old request/idempotency records and balances are preserved. New quote/fence tables are additive, and existing targets start at version 1 without reseeding balances. Source and payment histories must be restored together.

Recurring reload rules, full A2UI funding selection and Angular/Flutter parity retain separate tasks. MCP/voice do not gain unattended recharge authority from these APIs.

## Verify and record

```bash
npm run demo:verify:recharge-checkout
npm run record:recharge-checkout
npm run test:e2e
npm run demo:verify:payment-ledger
```

The first two use real local Keycloak/Redis with isolated provider/application SQLite, disabled model inference and separate browser ports. Recording holds each review/authorization/challenge for six seconds and each confirmed receipt for eight seconds. All six wallet/card provider journeys must pass before publication. [Recording](../recordings/recharge-checkout/index.html) · [Evidence](../reports/2026-10-24-provider-recharges.md).

A current recharge preview can be included in [grouped checkout](checkout-groups.md). The unified civic adapter now persists a complete group/plan; retry uses the original recharge child even after its provider balance/version changes.

[Original-source refunds](payment-refunds.md) now cancel eligible full bills/fine sets or reverse bounded unused recharge/funding value. Confirmed returns annotate original receipts and group children; uncertain reversals keep their original ID and do not restore funds.

[Signed financial status events](payment-events.md) append with stored order/source transitions and arrive as owned inspection hints. Callbacks never authorize funds or replace authoritative provider lookup. SIM-03 now supplies named issuer scenarios; legacy event-path qualification keeps PAY-18 in progress.

[Isolated issuer scenarios](issuer-scenarios.md) add operator-bound named outcomes and `AUTHORIZATION_PENDING`. Pending card capacity cannot capture/credit or dispatch later group lines; the original real-time deadline and separate customer execution remain enforced. Normal providers expose no run controls.
