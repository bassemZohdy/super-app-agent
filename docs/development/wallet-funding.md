# Fund a wallet from a saved demo card

PAY-13 uses the existing finite synthetic issuer and balanced journal. Select a saved card, review its exact amount and source version, approve the authorization, complete any demo challenge, then explicitly add funds. No PAN/CVV, bank account, hosted PSP or real money is involved. This is separate from bills, mobile recharge and toll recharge.

## Try it

1. Sign in to React and choose a workspace. Open **Payment accounts** and add an Approved or Challenge demo card.
2. In **Add wallet funds**, select that card and an amount from AED 1 to AED 500. Fees are zero; the wallet balance after funding must not exceed AED 10000.
3. Choose **Review wallet top-up**. The stored review moves no funds and prevents another open top-up in the same workspace.
4. Read the source, amount, fee and total, then choose **Authorize wallet top-up**. Card capacity is held for at most two minutes. A challenge requires an explicit signed-owner decision. The wallet is still unchanged.
5. Choose **Add AED … to wallet**. Only a confirmed atomic card capture and wallet credit produce **Wallet credited**. Cancel before capture to release the hold. Reload or refresh after a lost response to inspect the same review and receipt.

Funding uses the shared per-card issuer limit, including bill authorizations/captures. Disabled, changed, expired, declined or exhausted sources cannot fall back to another card. Account switching clears the UI state; another owner/workspace cannot see or use the original source or receipt. [Original-card funding refunds](payment-refunds.md) now debit available wallet funds and return captured value within cumulative bounds; spent/held funds cannot cause an overdraft. Automatic low-balance rules remain AUTO-09 work. Angular/Flutter parity remains QA-06.

## Protocol and persistence

Payment contract 1.5.0, payment-provider OpenAPI 2.8.0. Provider routes sit under `/v1/accounts/{accountId}`:

| Operation | Provider route | Core route |
| --- | --- | --- |
| List current status/history | `GET /wallet-funding-orders` | `GET /api/payments/wallet-funding-orders?accountId=…` |
| Read one authoritative status | `GET /wallet-funding-orders/{orderId}` | Included in overview/list |
| Store exact card/amount review | `POST /wallet-funding-orders` | `POST /api/payments/wallet-funding-orders` |
| Authorize/challenge/cancel/execute | `POST /wallet-funding-orders/{orderId}/{action}` | `POST /api/payments/wallet-funding-orders/{action}` with `orderId` |

Creation accepts only `amountMinor`, `methodId`, `expectedMethodVersion`. Decisions bind `expectedVersion` and `approvalDigest`; cancel requires the version, and challenge additionally binds challenge ID and explicit APPROVE/REJECT. Core POSTs include `accountId` and `requestKey`; provider POSTs require `Idempotency-Key`. Schemas reject raw card fields, caller fees/currency/source overrides, self-funding and extra properties. New funding routes require the signed-in owner; service credentials/header impersonation and broker automation cannot use them.

`wallet_funding_orders` is an additive persisted table with one active review per workspace. Creation binds a METHOD/ORDER dependency; approval binds a METHOD/HOLD. Expiry/cancel/failure releases dependencies and issuer capacity. Review expiry is five minutes; authorization/challenge expiry is at most two minutes and no longer than the review. There is no scheduler; owned reads and subsequent provider operations persist expiry lazily.

Execution rechecks source version/status and wallet capacity. The local issuer CAPTURED transition, sealed TOPUP journal, wallet projection, transaction record, receipt and terminal order commit in one SQLite transaction. An exception rolls all of them back. A lost response after commit is resolved by reading/repeating the original order, without a new charge or credit. No remote pending capture is simulated here; challenge/authorization is truthfully pending with no wallet credit. Source snapshots remain in historical receipts after a card is removed. A top-up cannot masquerade as a merchant bill-payment proof.

## Legacy compatibility

The existing `/topups` approved/declined flags keep their request shapes and sub-AED precision (AED 0.01–500). They now resolve to one persisted owned **Demo top-up card** or **Declined top-up card**, consume the same finite AED 2000 source limit, and obey the AED 10000 wallet cap. They never recreate a disabled/removed/exhausted alias card. Old idempotency results and balances are preserved; historical synthetic credits are not retroactively charged to a new issuer.

Interactive legacy service/conversation top-ups and the separately bounded existing one-time delegation-credit demonstration retain their explicit authorization boundaries. The alias does not grant a future automation worker authority. General recurring wallet funding is still disabled. Other generic legacy merchant-capture flags remain separate compatibility behavior; they cannot credit a wallet through the new funding API.

## Verification and recording

```bash
npm run demo:verify:wallet-funding
npm run record:wallet-funding
npm run demo:verify:payment-ledger
```

The first two use real local Keycloak/Redis, a separate browser and isolated SQLite/ports; they preserve normal demo funds. Recording waits six seconds after asserted review/challenge/authorization and eight seconds after confirmed receipts. Publication occurs only after all assertions pass. [Recording](../recordings/wallet-funding/index.html) · [Evidence](../reports/2026-10-24-wallet-funding.md).

In an explicitly [isolated issuer run](issuer-scenarios.md), `AUTHORIZATION_PENDING` reserves card capacity without capture or wallet credit. Refresh after the operator resolves the issuer decision; a separate Add action remains required. Pending cancellation and expiry release capacity.

The provider-backed [conversational wallet action](payment-surfaces.md) now chooses an existing saved card and uses the same review/challenge/capture-before-credit API. It does not call the legacy funding-flag path. No active saved card means no offered reload source.
