# Provider-owned payables and bill history

PAY-06 is partially implemented. DEWA, Etisalat, du and Police now own their payable summaries and revisions. React's **Payment accounts → Bills & fines** shows the linked account's current and closed obligations, due state, amount, discount and version. Saved-card orders, capture admission, payable reservations and settlement/refund claims remain PAY-05/PAY-07–PAY-10 work. A payable revision or settlement reference is not permission to spend.

## Contract

All paths below are relative to `/v1/accounts/{accountId}` on the source provider. A signed owner token and owned workspace are independently checked. OpenAPI 2.2.0 describes the additive contracts; the HTTP resource prefix remains `/v1`. Obtain payable IDs from the list and URL-encode them in individual paths.

| Operation | Behavior |
| --- | --- |
| `GET /payables` | Current and historical obligations, capped at 100 by the current bounded fixture store |
| `GET /payables/{payableId}` | Fresh current summary and revision-bound settlement reference |
| `POST /payables/{payableId}/reviews` | Body `{expectedRevision}`; reject a changed, closed or restricted obligation; no money effect |
| `POST /payables/{payableId}/payments` | Body `{expectedRevision,paymentId}`; check current state and owned captured proof before recording provider settlement |

POSTs require `Idempotency-Key`. Exact retries return the original recorded result; another payload conflicts. A retried POST review can therefore be an older snapshot: use a fresh GET and current revision at execution admission. Neither result is a credential or stored approval.

Each summary includes provider/obligation identity, provider account reference, amount/currency, a persisted version, status, due state and a SHA-256 revision of its authoritative terms. Fine summaries additionally expose original amount, effective discount, eligibility, optional discount/obligation expiration and restrictions. Amounts are integer AED fils. Date/amount inconsistencies fail closed.

Discount expiry changes an unpaid fine's effective amount and revision at business time. Legacy fine lists use the same current amount. Paid fine history retains the amount/discount actually applied after its discount window closes. Expired, withdrawn, paid and restricted obligations are excluded from payment review or rejected by provider preflight/settlement. Due bills remain payable when overdue unless separately expired/withdrawn.

Revision-bound settlement requires the captured proof's exact account, payment ID, AED currency, merchant, amount, unrefunded captured status and reference. The reference hashes identity and authoritative terms rather than accepting a caller's price. Concurrent source changes are rechecked in the provider's write transaction. This does not serialize a separate payment-provider refund; PAY-10 must implement claim/ack/release before new orchestration relies on that guarantee.

## Lifecycle and compatibility

`ProviderPayables` has trusted server-only `issueBill` and `amend` seams for future scenario events. Issuance checks the target provider account/subscription, bounded amount/date and unused invoice ID. Amendment requires the current revision, increments its version, cannot change identity/ownership and cannot reopen a closed obligation. There is no public issue/amend/reset endpoint. These seams are not an enabled scheduler or SIM-02 event-delivery engine.

Existing seeded billing accounts gain one clearly labelled prior-cycle **settled opening fixture** on first access. It creates no charge or journal entry, preserves the existing current bill and runs only once. The original bill stays first in `/bills`, preserving existing application adapters. Additional issued cycles and withdrawals remain visible in `/payables`; no live volume reset is required. Existing legacy settlement routes remain compatible and check current lifecycle/amounts, but they do not provide the upcoming immutable stored-order approval contract.

Business time defaults to wall time. Isolated trusted tests/scenarios may inject a different business clock per engine. JWT, client, key and credential validity continues using the existing real security clock; no global clock or Keycloak feature setting changes.

## Verification

```bash
npm run check
npm run demo:verify:payment-accounts
npm run demo:verify:inventory
```

The browser verifier requires the local Keycloak/Redis stack and free isolated ports described in [payment setup](payment-accounts.md). It checks source changes/withdrawals through private test fixtures, real signed-owner HTTP rejection, current history/review rendering, and a separate owner's revision-bound settlement with one exact journal debit. It deletes only its temporary provider data. The inventory verifier performs read-only financial checks against the normal local stack. [Executed evidence](../reports/2026-10-24-payables.md).
