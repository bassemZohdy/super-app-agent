# Finite payment and service consent

AUTO-01 delivers durable, owner-approved policy records. Contract `payment-mandates.ts` is **1.0.0**; payment-provider OpenAPI is **2.17.0**. The shared payment contract is 1.13.0. Every returned record has `executionEnabled: false`: consent recording does not start a worker, issue a token, reserve a budget or move money. The editor, scheduler, per-execution grants and automatic effects retain their separate TODO gates.

## Bound policy

Each policy includes the exact future actor `cityside-automation`, audience `provider-api`, one operation, purpose and AED currency. The future actor name is a policy binding; this slice neither provisions that client nor gives it provider access. Provider selection and exact resource authorization remain independent of the shared audience.

| Operation | Target and current ownership check | Trigger |
| --- | --- | --- |
| `BILL_PAYMENT` | Active linked DEWA account or Etisalat/du subscription | Invoice due or calendar |
| `WALLET_RELOAD` | This workspace's wallet; saved cards only | Low balance |
| `RECHARGE` | Active linked toll/prepaid target and approved denomination | Low balance |
| `FINE_PAYMENT` | Active linked vehicle and explicit eligible fine types | New fine |
| `PARKING_EXTENSION` | Exact active ticket, zone, plate, maximum hours and stop time | Parking ending |
| `SUBSCRIPTION_RENEWAL` | Active linked Etisalat/du subscription | Calendar |

The provider independently confirms the target through fixed read paths on create, revise and approval. A prepaid number cannot become a subscription renewal target. No request contains an arbitrary URL, ownership proof, outcome override or credential. Eligibility must be checked again at future execution; current consent is not evidence that a future invoice or parking session remains eligible.

One to three distinct source IDs and versions are frozen with masked metadata. One source requires `fallback.mode: NONE`; multiple sources require `ORDERED` and explicit fallback conditions limited to `INSUFFICIENT_FUNDS` and/or `CARD_DECLINED`. Challenge, timeout and unknown outcomes cannot trigger fallback. No default-source lookup changes recorded consent.

Every policy requires positive integer-fils per-payment, period and lifetime caps; finite period/lifetime counts; cooldown of 60 seconds to 31 days; an explicit IANA zone; and a valid UTC window of at most 366 days. Per-payment ≤ period ≤ lifetime caps, and period count ≤ lifetime count. Calendar policies specify month-end behavior. Low-balance policies bind threshold, exact reload and target balance; wallet funding retains its saved-card, AED 1–500 reload and AED 10000 target limits. Fine policies opt into a finite list of synthetic violation types. Unsupported operations, wildcard actors, extra fields, fractional/overflow amounts and cross-workspace references fail validation.

These are policy bounds, **not budget reservations or schedule calculations**. AUTO-03/AUTO-05/AUTO-06 must enforce live reservations, occurrence identities, leases and timezone behavior before automatic effects are enabled. Parking/renewal consent likewise does not enable the corresponding provider operation.

## APIs and explicit approval

All routes require the signed interactive owner. Delegation-broker and service-account tokens cannot manage these records. Core GET takes `accountId` in the query; core POST takes `accountId` and a unique `requestKey` in JSON. Provider POST uses `Idempotency-Key` and the account-scoped path.

| Core route | Provider route | Behavior |
| --- | --- | --- |
| `GET /api/payments/mandates` | `GET /v1/accounts/{accountId}/payment-mandates` | Current owned records |
| `POST /api/payments/mandates` | `POST …/payment-mandates` | `{policy}` → `AWAITING_APPROVAL` |
| `POST …/mandates/revise` | `POST …/payment-mandates/{id}/revise` | `{expectedVersion, policy}`; core also includes `mandateId` |
| `POST …/mandates/approve` | `POST …/payment-mandates/{id}/approve` | Exact `{expectedVersion, approvalDigest}`; core also includes `mandateId` |
| `POST …/mandates/revoke` | `POST …/payment-mandates/{id}/revoke` | Version-checked closure; core also includes `mandateId` |
| `GET …/mandates/history?accountId=…&mandateId=…` | `GET …/payment-mandates/{id}/history` | Immutable retained versions |

Creating or revising gives a five-minute real-time review. Approval binds owner, workspace, policy version, exact policy, source/biller snapshots and review expiry. A change to purpose, limits, source, target or schedule immediately replaces the old current policy with an unapproved version and a new digest. Old approval cannot approve that version. Chat, voice, a saved card and the existing short read delegation do not record consent.

`version` changes on every state transition; `policyVersion` changes only when policy terms change. State is `AWAITING_APPROVAL`, `APPROVED`, `REVOKED` or `EXPIRED`. Approved consent still returns `executionEnabled: false`. Revoked/expired records cannot reopen. Revoke closes consent and releases lifecycle references; there are no automatic in-flight effects in this slice. Worker admission/revocation semantics remain AUTO-15.

## Persistence and lifecycle

The payments database adds `payment_mandates` heads and append-only `payment_mandate_versions`. SQLite triggers deny history update/delete. Heads, historical snapshots and METHOD/BILLER lifecycle references commit in one transaction; failed binding rolls back all three. Compare-and-update versions serialize competing revisions. Current and historical records survive provider restart and retain masked source metadata after source removal. No bearer token, signing key or human refresh token is persisted.

Active drafts/approved policies prevent removal of their exact sources and links. Revoke, replacement and real-time expiry release only that policy version's references. Disable can still stop a card; changed/disabled/expired sources fail approval. Payment operations refresh mandate expiry before lifecycle checks. A workspace is bounded to 100 retained mandates; histories are bounded to 1000 transitions, with transition capacity reserved for terminal closure. Normal financial resources, journal and idempotency history are untouched by table creation. No destructive migration or reset is used.

## Validate the slice

```sh
node --experimental-strip-types --import ./scripts/test-env.ts --test services/test/payment-mandates.test.ts
npm run demo:verify:mandates
```

The signed verification uses existing local Keycloak/Redis with temporary provider databases. It creates and explicitly approves all six policy families, checks retries/changed terms, wrong owners, service-token denial, source locks, revision/reapproval, historical restoration and actual provider restart, then revokes and removes the saved card. One synthetic parking payment sets up an owned session **before** the consent baseline; subsequent consent actions must leave wallet/transaction state identical. No model call or automatic service execution occurs. [Evidence](../reports/2026-10-24-payment-mandates.md).

## Execution authority gate

[The AUTO-02 threat model](../architecture/payment-automation-security.md) separates consent records from executable permits. Current owner/source/target and exact policy terms must be rechecked when future AUTO-03 reservations and credentials are derived. The current API always returns `executionEnabled:false`; adding a mandate reference to a legacy grant is rejected. Budget/count/occurrence reservations, current membership/owner epochs and the worker/revoke admission boundary remain implementation gates.
