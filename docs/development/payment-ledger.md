# Payment journal and migration

PAY-02 adds the payment provider's balanced journal and wallet projection checks. Current wallet top-ups, wallet/external-simulated captures and refunds use it. Saved-card order execution, card limits/challenges, settlement claims, recurring mandates and automatic services are separate unfinished tasks. [Payment setup](payment-accounts.md) · [Executed migration evidence](../reports/2026-10-24-payment-ledger.md).

## Stored records and invariants

Only the payments provider creates `payment_migrations`, `payment_journal_entries`, `payment_journal_postings` and `payment_wallet_holds` in its own SQLite database. Entity providers keep their independent stores. Journal schema version 1 rejects unknown versions rather than guessing a migration.

Each sealed entry has exactly two integer-fils postings whose signed sum is zero. Wallet-positive amounts increase its carried balance; external/merchant clearing receives the offset. Opening balance, top-up, capture and refund have distinct kinds/references. SQL triggers reject unbalanced sealing, direct sealed inserts, edits/deletion of sealed entries and edits/deletion of postings. This protects ordinary application mistakes; a database administrator can still alter the database/schema. It is not immutable external audit evidence.

The existing wallet JSON resource becomes a projection checked against sealed wallet postings. A disagreement fails with `WALLET_PROJECTION_MISMATCH`; no balancing adjustment silently repairs it. New effects update journal, projection, transaction/charge and request-idempotency records in the same provider transaction. Nested ledger work uses savepoints, so a failed effect rolls back completely. No transaction spans another provider's HTTP call.

`GET /v1/accounts/{accountId}/wallet` retains `balance`/`balanceMinor` and adds `heldMinor` and `availableMinor`. Available funds equal posted balance minus active unexpired wallet holds. Existing wallet capture checks available funds. Holds can expire or be voided without creating a journal debit; internal accounting helpers exist for later order authorization but no hold creation/management endpoint is exposed yet. A new hold is bounded to a one-hour expiry and cannot over-reserve shared funds. Wallet self-funded credits, negative/overflow/fractional minor amounts and over-limit balances fail.

Existing external-simulated funding still uses the current demo-approved/declined fixture path. Journal entries model its clearing effects; this does not implement a real card issuer, finite saved-card limits or proof-of-funds from a bank.

## First upgrade

At payment-provider startup, an existing legacy database with wallet resources receives a consistent SQLite `VACUUM INTO` backup beside the configured database:

`PROVIDER_DB_PATH` + `.before-ledger-v1.sqlite`

The initial snapshot is not overwritten on retries. The journal schema and one opening entry per legacy wallet are created in one transaction. Existing resource/charge/transaction IDs and idempotency rows remain unchanged. Existing balances are carried forward once; old transactions are retained as historical records, not replayed into new money. Subsequent account seed/reopen cannot reset an existing wallet or insert another opening. A malformed balance rolls back the migration/schema and startup fails closed, preserving the backup for inspection.

New accounts start at the demo's existing 1500 AED balance with one opening entry. An empty new database needs no legacy backup. Normal service restarts retain the journal and append no additional opening/financial entries.

## Verification and recovery

Run financial verifiers serially, with no concurrent money-changing demo actions:

```bash
npm run demo:verify:payment-ledger
npm run demo:wait
npm run demo:verify:payment-accounts
npm run test:e2e
npm run check
```

The ledger verifier deliberately pauses the payment provider, hashes existing resource/idempotency rows without printing their contents, starts the migrated provider, verifies matching snapshots, one balanced opening per wallet and zero projection mismatches, then reloads core. On the first upgrade it opens the pre-migration backup read-only and compares that snapshot as well. It does not reset funds or execute payments. Later runs verify restart stability. The payment-account/browser harnesses use isolated databases; the migration verifier intentionally checks the running local provider's actual volume.

Before a migration, retain the named volume and stop payment writers. Inspect a failed startup using provider logs and the preserved backup. Restore into a **separate** volume/copy first; verify identity/resources/idempotency and balances before switching the service. Unit checks exercise this offline pre-traffic restore and remigration. Do not overwrite an active database or treat restoring a pre-migration snapshot after new payments as a safe rollback: it discards later effects. After new traffic, use a forward repair/reconciliation plan and retain the current database/journal. Older binaries must not continue writing the migrated projection without journal entries.

Backups contain synthetic account/payment data and stay in the private provider volume; they are not committed. This is local-demo migration/recovery, not HA, immutable audit or disaster-recovery certification.

The same `demo:verify:payment-ledger` command now also verifies [settlement-claim migration](settlement-claims.md). It briefly pauses/recreates the five source providers and gateway, compares financial/idempotency hashes, checks the separate claim backup and conservative old-capture count, then restarts core. Run serially without other financial actions. Old captures may require source reconciliation before a refund; no balance/history is reset.

Capture consumes a wallet hold and records its debit atomically; the additive payment_hold_captures link distinguishes consumption from the original closed-hold status. The same verifier now checks exact stored-review preservation across the capture-state schema migration and its backup, and recreates the billing application containers with providers. [Checkout migration](payment-checkout.md).
