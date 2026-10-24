# Payment journal migration — 24 October 2026

PAY-02 delivered after payment-account checkpoint `65fec3c`. The accompanying publication commit identifies the exact journal source. [Storage/migration/recovery guide](../development/payment-ledger.md) · [Remaining payment tasks](../../TODO.md#payment-accounts-and-automation-demo--planned-backlog).

## Executed evidence

- Seven focused ledger tests pass: migration/once-only opening and no reseed; balanced wallet/external captures/top-ups/refunds; holds/available funds and expiry/void; injected persistence rollback; SQL sealing/append guards and corruption/amount denial; failed migration/backup preservation/repair; and shared funds across two database connections/reopen.
- Legacy migration tests retain original charge IDs and idempotency records, compare an unchanged backup, and restore/remigrate a separate offline copy. This does not prove a safe rollback after later financial traffic.
- Existing provider tests also pass with the new journal (15 combined focused/provider tests). Full repository check passes **143 Node tests and 18 workspace builds**, lint, strict harness, document and source-secret checks. Additional sealing/self-funding guards pass the final focused run.
- All **twelve existing isolated browser journeys** pass with the journal-backed engine, including actual financial effect/receipt assertions, cancellation, grouped checkout, persistence and account restore.
- Payment-account desktop/mobile browser verification passes with the new posted/held/available summary and no funds moved by that setup flow.
- `npm run demo:verify:payment-ledger` upgraded the **actual running local payment database**. Pre/post resource and idempotency hashes match; its readable pre-migration backup matches the pre-upgrade snapshot. **Three wallets** each have one balanced opening, no invalid sealed entries and zero projection discrepancies. Core was reloaded after migration. No live financial operation was issued by this verifier.

## Scope and remaining work

Old wallet/external-simulated financial routes now append balanced entries atomically with their existing records. Journal openings carry forward existing balances rather than reconstructing/replaying historical transactions. Holds are accounting infrastructure for later authorization and have no public creation endpoint. Independent provider settlement, old proof/refund races, order-level idempotency/business guards, card issuer/limits/challenges and automation remain their own unfinished tasks. SQL guards are application integrity controls, not administrator-resistant immutable audit.
