# End-to-end bill capture and settlement — 24 October 2026

Implementation after `aaef2b0`. PAY-09/PAY-10/PAY-11/PAY-12 are delivered for the selected demo behavior. PAY-06/PAY-07/PAY-08 retain broader fine/payable, full review/parity and cross-operation criteria; automatic services and refunds/reversals remain open. The publication commit identifies source.

The explicit Pay action now captures an approved finite wallet/card hold, settles the source-admitted DEWA/Etisalat/du bill through merchant claims, and shows a provider-confirmed receipt. Existing service/conversation bill payments use the same wallet-order path and bind displayed bill ID/revision/amount. Raw billing capture namespaces are rejected. Source reservations freeze terms; captured/unknown orders keep their identity and cannot be cancelled or automatically replaced.

Eight checkout regressions verify wallet/card effects, exact source/order/attempt binding, lost responses before/after source commit, one-payment recovery, stale terms, admission substitution/fenced cancellation, funding expiry and old-table snapshot migration/reopen. The old utilities fixture was updated to echo the offered bill binding; omitted resource data now explicitly denies rather than silently choosing the current bill.

The real-Keycloak card browser completes authorization/challenge and the separate Pay action, asserts one finite card spend, unchanged wallet funds, paid provider state and a restored confirmed receipt after reload. The wallet browser verifies execution retry, receipt/claim, duplicate source settlement denial and separate du bill execution. All twelve existing journeys pass through the migrated wallet bill flow.

Complete repository checks pass **188 Node tests and 18 builds** after correcting the obsolete fixture. The final admission/source-version guards also pass the focused checkout/receipt tests and provider build; the real challenged-card browser was rerun against those guards. No Keycloak preview features, real funds, new cloud service, automatic rule or model transaction authority is introduced.

[Usage, protocol and migration](../development/payment-checkout.md) · [Card receipt](assets/payment-card-receipt.png).


## Running demo and preservation

The coordinated `npm run demo:verify:payment-ledger` restart/migration passed on the normal Compose stack. Business/idempotency hashes and journal entries were unchanged, existing settlement claims were preserved, and all three wallets retained one balanced opening with matching projections. This normal database contained zero stored reviews; the non-empty old-order migration/backup/reopen case is covered by the focused regression, rather than claimed as live data migration.

`npm run demo:wait` and the signed-owner, read-only `npm run demo:verify:inventory` passed after restart, including contract 1.2.0, provider payable revisions and unchanged funds/history. Lint, strict browser-harness type checking, 63-document link checks, source-secret checks and diff whitespace checks pass. These payment/API checks do not certify text or speech inference: Docker reported the separately running conversation container unhealthy, which remains an independent local-AI follow-up.

Backlog audit: 50 unique payment/automation/simulator/QA tasks, 10 delivered and 40 open. No new recording was produced for this checkpoint; the receipt screenshot comes from the final asserted browser run.
