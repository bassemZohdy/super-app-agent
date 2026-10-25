# Payment accounts and quote review

React manages owned synthetic cards/billers and explicit wallet/card bills, fines, prepaid/toll recharges, wallet funding, grouped checkout, original-source refunds, events, statements and reconciliation. Quote previews cannot capture; stored reviews require separate approval/challenge and explicit payment actions. Owner/workspace/source lifecycle is enforced. Finite mandates exist, but automatic execution is disabled. [What exists today](../../README.md#what-exists-today) · [Open work](../../TODO.md) · [Design](../architecture/payment-automation-demo.md).

The Bills & fines section shows source-owned revisions, due state, discount eligibility and closed cycles for linked accounts. Seeded prior-cycle history is explicitly labelled; withdrawn/expired/restricted obligations cannot be selected for review. [Payable API and lifecycle boundaries](payables.md).

Current wallet funds are journal-backed, with posted/held/available balances shown in the panel. [Migration/recovery](payment-ledger.md). Explicit stored-review approval can now create temporary holds without a capture.

## Try it

Use the integrated demo (`npm run demo:up`, then `npm run dev:react`). For the reader/operator and environment upgrade, use [the lifecycle migration steps](payment-lifecycle.md#separate-local-operator). Ordinary source-only changes need a restart of the affected service.

1. Sign in and choose a personal or household workspace.
2. Open **Payment accounts**. Add a named synthetic card preset. The available presets describe future approve/decline/challenge/expired behavior; limits, approval/decline/challenge and expiry are enforced by the local issuer for stored authorization reviews.
3. Link one of the provider-verified DEWA, telecom subscription, Salik or traffic-fine references. Etisalat/du prepaid lines are included; each starts with 50 AED simulated provider balance. Registered-vehicle discovery works even with no unpaid fines.
4. Select a linked unpaid bill or fine and an active funding method. **Review payment quote** reads the current provider amount, shows zero demo fees and binds the source/version and biller. Review expires after five minutes; it is not an approval or receipt, and funds do not move.
5. Disable a card or choose a new default. Disabled defaults remain explicit; another card/wallet is never silently selected. Defaults apply to future drafts and do not rewrite an existing review. Choose another default before removing a default card.
6. Archive a biller link when no longer needed. Active server-registered order/hold/mandate references block removal/archive and are shown as related items. The references are lifecycle locks, not consent; actual execution producers must bind/release them through their own guarded lifecycle. Historical records are retained as tombstones.

The panel scrolls independently, stacks on small screens and returns focus to its opening control on close. Account switching remounts its state; cancelled/late loads cannot expose the previous account's data. Angular/Flutter setup parity remains QA-06 work.

## Current APIs

Core paths use the authenticated signed owner. GET requires `accountId` as a query parameter; POST includes it in JSON. Provider paths are under `/v1/accounts/{accountId}` and independently verify that owner. New provider OpenAPI is **2.18.0**, additive to the existing `/v1` financial routes.

| Core route | Provider route / behavior |
| --- | --- |
| `GET /api/payments/overview` | Parallel current provider reads plus `/payment-methods`, `/billing-accounts` and `/wallet`; returns methods, default, owned candidates, links and provider-owned current/historical payables |
| `POST /api/payments/methods` | `POST /payment-methods`: `preset`, `nickname` |
| `POST /api/payments/methods/status` | `POST /payment-methods/status`: `methodId`, `expectedVersion`, `status` (ACTIVE/DISABLED/REMOVED) |
| `POST /api/payments/methods/default` | `POST /payment-methods/default`: `methodId`, `expectedVersion` |
| `POST /api/payments/billing-accounts` | `POST /billing-accounts`: `provider`, `reference`, `nickname`; source-provider ownership checked before link commit |
| `POST /api/payments/billing-accounts/archive` | `POST /billing-accounts/archive`: `billingAccountId`, `expectedVersion` |
| `POST /api/payments/preview` | Read-only overview → fresh snapshot; `payableId`, `methodId`, `expectedMethodVersion` |

Management POSTs additionally require a caller-generated `requestKey` (8–100 ASCII letters/digits/underscore/hyphen). Core forwards it as a namespaced provider `Idempotency-Key`. Same key/body returns the stored result across restart; a changed canonical request returns 409. Preview does not require a mutation key because it only reads state.

Strict schemas reject unknown fields, raw PAN/CVV, caller prices/fees/source overrides and invalid versions. Tokens are opaque random IDs, account-bound, with synthetic last-four/expiry and no card number. The demo limits non-removed cards to 20 and active biller links to 30; list projections keep active entries ahead of bounded historical tombstones. Removed cards cannot be reactivated. Expired cards cannot become active/default but may be removed.

Provider ownership discovery uses fixed server paths and the forwarded signed interactive identity. Another user's reference, card token or workspace cannot be used. Unknown versions fail with 409 and unavailable account-owned methods with 404/409. The APIs do not load fallback fixture data when a provider is unavailable.

A preview contains `previewOnly: true`, contract version, account, cloned payable/link/source metadata, authoritative integer-fils total, timestamps and a SHA-256 content digest. This digest is a snapshot identifier, **not a signed authorization credential**. There is no endpoint accepting it to execute a payment. Future stored quote/order issuance must remain server-owned; a caller-modified digest must never establish authority.

Dependency registration/release is server-internal, with no public mutation endpoint. The browser verifier injects isolated persisted reference fixtures to prove UI/API locks; it does not run an issuer hold or approve a mandate. Source disable stops new bindings while retaining existing in-flight references for cancellation/reconciliation. Active references survive restart; releasing one cannot reopen/rebind it. At most 200 active lifecycle-use records are supported per workspace. Lists expose only active owned dependencies.

## Compatibility and verification

`packages/protocol-core/src/payments.ts` owns additive request/method/biller and future-order response schemas plus state vocabularies. The older full payment-order schema describes the broader full-order contract; the separate authorization-review API persists reviews and holds now. Existing wallet/top-up/capture/refund request shapes and old simulated funding flag shapes remain compatible, with top-ups now resolving to persistent finite issuer cards; new saved-card IDs cannot be passed as legacy charge sources.

```bash
npm run demo:verify:payment-accounts
npm run check
```

The first command uses real local Keycloak, a separate React browser and isolated provider/SQLite state; it requires Keycloak/Redis running, Chrome and free ports 3002/14000–14107. It covers card setup/idempotency, ownership/invalid requests, verified linking, quote amount/source, unchanged funds, disable/default semantics, stale versions, account switching/reload, mobile width and keyboard focus. The extended verifier also checks lifecycle changes and revision-bound settlement against a separate isolated owner, asserting one exact journal debit. The payment-setup owner retains its initial funds. No physical microphone, cloud inference or normal demo database is used. [Executed evidence](../reports/2026-10-24-payment-accounts.md).

The separate signed-owner settlement case now also verifies gateway APPLIED/ACK status, paid-refund/human-release denial, non-application release/refund and a separate du workload. It now also exercises stored bill capture. [Settlement guards](settlement-claims.md).

For DEWA/Etisalat/du, the stored review now offers explicit Pay after authorization/challenge and produces a confirmed bill receipt. Pending capture/settlement uses Inspect or resume on that same order. [Checkout and compatibility migration](payment-checkout.md).

[Add wallet funds from a selected saved card](wallet-funding.md): owned source/amount review, explicit challenge/capture, balanced credit and a restored receipt.

[Pay selected traffic fines](fine-checkout.md): select exact IDs under the source picker, review current discounts, authorize wallet/card funds and explicitly Pay. The individual obligation selector also supports single-fine execution.

[Recharge toll/prepaid provider balances](provider-recharges.md) through the separate target/denomination/source form. A provider credit does not top up the Cityside wallet; each subsequent recharge requires a fresh explicit intent.

[Grouped checkout](checkout-groups.md) freezes one source for sequential child payments, retains separate provider receipts, and stops/resumes the original line on challenge or uncertain settlement. It does not imply cross-provider atomicity.

[Original-source refunds](payment-refunds.md) now cancel eligible full bills/fine sets or reverse bounded unused recharge/funding value. Confirmed returns annotate original receipts and group children; uncertain reversals keep their original ID and do not restore funds.

[Signed financial status events](payment-events.md) append with stored order/source transitions and arrive as owned inspection hints. Callbacks never authorize funds or replace authoritative provider lookup. SIM-03 supplies named issuer scenarios; PAY-18 covers current manual paths. General fault controls and unattended execution retain separate gates.

[Isolated issuer scenarios](issuer-scenarios.md) add operator-bound named outcomes and `AUTHORIZATION_PENDING`. Pending card capacity cannot capture/credit or dispatch later group lines; the original real-time deadline and separate customer execution remain enforced. Normal providers expose no run controls.

[AUTO-01 finite consent records](payment-mandates.md) use the same signed owner and resource-use guards, with separate create/revise/approve/revoke/history APIs. They do not enable automatic execution or add a rule editor to this panel.

[Conversational/manual funding reviews](payment-surfaces.md) reuse these stored order APIs. The service workspace now requires explicit funding selection, authorization and payment, and saved-card funding for wallet reload. It can link the current provider-verified biller during the disclosed review step.

## Consolidated recovery

Open **Payment recovery** to page all owned payment/funding/refund/legacy cases, inspect current capture/provider evidence and read saved action outcomes/audit. Only permitted original-operation actions are offered; supported refunds require a separate review and approval. [Workbench guide](payment-reconciliation.md).

## Statements and receipts

**Statements & funding history** pages all posted journal effects and payment activity, with exact running balances and original masked source/biller details. Captured/unknown/partial records remain distinct from completed receipts, and removed sources retain their original snapshots. [Full history guide](payment-history.md).

[Current owner/workspace lifecycle](payment-lifecycle.md) adds permission metadata, the in-flight work view, separate local operator controls, epoch-bound approvals and no-cache eligibility checks. Restricted accounts retain history but cannot read financial details until access is restored.
