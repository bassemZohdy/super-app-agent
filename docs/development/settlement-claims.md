# Settlement claims and refund exclusion

Existing provider settlement now admits a gateway claim before applying a captured payment. Gateway refund and claim admission serialize in the payments SQLite writer transaction. A pending/applied/unknown claim blocks refund; only durable provider non-application permits release. This fixes stale GET-proof/refund races in the current demo. Stored bill capture and provider reservation now use this protocol through [bill checkout](payment-checkout.md). Supported business reversals remain PAY-17 work.

## Runtime flow

1. The source persists a PENDING attempt bound to account, payment and the exact operation fingerprint before calling the gateway. Retries use that same attempt.
2. Its own settlement workload authenticates with Keycloak and claims the exact captured merchant/reference/amount. Refunded captures and another merchant's credentials deny.
3. The source applies the business effect, records payment consumption, idempotency result, receipt digest and APPLIED attempt in one local transaction.
4. The source acknowledges the gateway. A lost ACK leaves the gateway CLAIMED and blocks refunds; an exact retry or current settlement-status read retries confirmation without reapplying the effect.
5. A definitive source rejection first commits a RELEASED local fence, then requests gateway release. A late/in-flight request must read that fence and cannot apply after release/refund. Unknown exceptions keep the attempt/claim pending for reconciliation; they never expire into refundable funds.

The source and gateway databases do not share a transaction. No network call runs inside a SQLite business transaction. Source PENDING/APPLIED/RELEASED fences prevent late effects; gateway CLAIMED/APPLIED/RELEASED states prevent concurrent fund restoration. At-least-once requests are deduplicated; global exactly-once transport is not claimed.

## Narrow identities and APIs

Each of RTA, DEWA, Etisalat, du and Police has a separate `provider-{provider}-settlement` confidential Keycloak service client and only `payment-settlement:{provider}` authority. JWT audience is `provider-api`. The gateway pins both client and role, derives the existing account owner from its database and ignores human identity headers. These clients cannot read wallets, capture/refund funds, approve reviews or claim another merchant's payment. The old `provider-settlements` client remains read-only.

Protected gateway routes under `/v1/accounts/{accountId}/charges/{chargeId}/settlement`:

| POST route | Strict body | Effect |
| --- | --- | --- |
| `/claim` | `attemptId`, `reference`, `amountMinor` | Claim a current unrefunded capture; bind derived capture/order/attempt metadata |
| `/ack` | `attemptId`, `claimId`, `receiptDigest` | Confirm the immutable committed provider receipt |
| `/release` | `attemptId`, `claimId`, `reason: NOT_APPLIED` | Release only the same provider attempt after a source fence |

Claim control requires `Idempotency-Key`, with keys/fingerprints isolated per claimant. These control endpoints deliberately return **current claim state** on exact retries, not stale cached admission. Changed payloads conflict. Ordinary payment APIs retain their original cached-result policy. A previous CLAIMED response cannot reauthorize a source after its durable fence is closed.

Signed owners can `GET /settlement-attempts/{paymentId}` at the source provider. It returns PENDING/APPLIED/RELEASED and `gatewayConfirmed`, retries safe confirmation, and can reconcile historical consumed-payment markers as APPLIED. It cannot fabricate non-application or reverse a paid obligation. Payment proof GETs include current settlement metadata; a GET alone is not application authority.

`npm run demo:realm` reconciles the new clients without changing user IDs. The optional `PROVIDER_{NAME}_CLAIM_SECRET` variables must match realm reconciliation and that provider's container. Defaults are public synthetic-demo credentials; never reuse them for real services. Only each source's own variable is injected into its container. No preview Keycloak feature or shared-client write permission was added.

## Existing data and recovery

On first gateway startup, existing eligible unrefunded captures become LEGACY_UNKNOWN. Their old source application status cannot be inferred from a captured GET. They are blocked from refund until current source state is reconciled; a used-payment marker reconciles as applied, never released. Previously unconsumed captures can go through the fenced settlement path or receive verified non-application before refund. Balances, resource records, transaction history and request idempotency are preserved.

Migration uses a consistent `.before-settlement-claims-v1.sqlite` backup when old captures exist, with schema version 1 and idempotent reopen. Keep gateway and provider histories together. Do not remove claims/fences, revert to code without refund guards or independently restore an older source/payment database while financial operations are enabled. There is no arbitrary balance-edit, force-release or TTL-based unlock control.

```bash
npm run demo:verify:payment-ledger
npm run demo:verify:payment-accounts
npm run test:e2e
npm run check
```

The migration verifier briefly pauses/recreates the source/payment providers, compares hashed financial/idempotency rows, checks backup and unknown-claim counts, and preserves volumes. Run it serially. Browser tests use isolated synthetic funds and real local Keycloak; no real agency or payment system is contacted. [Evidence](../reports/2026-10-24-settlement-claims.md).

The gateway trusts each protected provider workload to attest its own committed effect or fenced non-application. Its credential must stay outside browsers/agents. Merchant pinning limits that authority; it does not make a compromised provider truthful or create administrator-resistant proof.
