# Payment accounts and quote review

Implemented foundations: PAY-01–PAY-04. React can manage owned synthetic cards/biller links and request a fresh non-executable payment review. Existing service payments still use the legacy wallet flow. Stored payment orders, executable authorization/challenges, direct saved-card payments and automatic rules are not enabled yet. [Full backlog](../../TODO.md#payment-accounts-and-automation-demo--planned-backlog) · [Design](../architecture/payment-automation-demo.md).

The Bills & fines section shows source-owned revisions, due state, discount eligibility and closed cycles for linked accounts. Seeded prior-cycle history is explicitly labelled; withdrawn/expired/restricted obligations cannot be selected for review. [Payable API and lifecycle boundaries](payables.md).

Current wallet funds are journal-backed, with posted/held/available balances shown in the panel. [Migration/recovery](payment-ledger.md). Internal holds are not a public financial-authorization API yet.

## Try it

Use the integrated demo (`npm run demo:up`, then `npm run dev:react`). Backend source changes need `docker compose -f docker-compose.demo.yml restart provider-payments provider-dewa provider-etisalat provider-du provider-police agent-core`.

1. Sign in and choose a personal or household workspace.
2. Open **Payment accounts**. Add a named synthetic card preset. The available presets describe future approve/decline/challenge/expired behavior; only metadata and expired/disabled eligibility are modeled in this slice.
3. Link one of the provider-verified DEWA, telecom subscription, Salik or traffic-fine references. Etisalat/du prepaid lines are included; each starts with 50 AED simulated provider balance. Registered-vehicle discovery works even with no unpaid fines.
4. Select a linked unpaid bill or fine and an active funding method. **Review payment quote** reads the current provider amount, shows zero demo fees and binds the source/version and biller. Review expires after five minutes; it is not an approval or receipt, and funds do not move.
5. Disable a card or choose a new default. Disabled defaults remain explicit; another card/wallet is never silently selected. Defaults apply to future drafts and do not rewrite an existing review. Choose another default before removing a default card.
6. Archive a biller link when no longer needed. Active server-registered order/hold/mandate references block removal/archive and are shown as related items. The references are lifecycle locks, not consent; actual execution producers must bind/release them through their own guarded lifecycle. Historical records are retained as tombstones.

The panel scrolls independently, stacks on small screens and returns focus to its opening control on close. Account switching remounts its state; cancelled/late loads cannot expose the previous account's data. Angular/Flutter setup parity remains QA-06 work.

## Current APIs

Core paths use the authenticated signed owner. GET requires `accountId` as a query parameter; POST includes it in JSON. Provider paths are under `/v1/accounts/{accountId}` and independently verify that owner. New provider OpenAPI is **2.2.0**, additive to the existing `/v1` financial routes.

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

`packages/protocol-core/src/payments.ts` owns additive request/method/biller and future-order response schemas plus state vocabularies. Order schemas describe the upcoming persistence boundary, not an implemented order API. Existing wallet/top-up/capture/refund request shapes and old simulated funding flags remain unchanged for current flows; new saved-card IDs cannot be passed as legacy charge sources.

```bash
npm run demo:verify:payment-accounts
npm run check
```

The first command uses real local Keycloak, a separate React browser and isolated provider/SQLite state; it requires Keycloak/Redis running, Chrome and free ports 3002/14000–14107. It covers card setup/idempotency, ownership/invalid requests, verified linking, quote amount/source, unchanged funds, disable/default semantics, stale versions, account switching/reload, mobile width and keyboard focus. The extended verifier also checks lifecycle changes and revision-bound settlement against a separate isolated owner, asserting one exact journal debit. The payment-setup owner retains its initial funds. No physical microphone, cloud inference or normal demo database is used. [Executed evidence](../reports/2026-10-24-payment-accounts.md).
