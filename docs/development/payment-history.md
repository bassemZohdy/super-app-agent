# Statements, receipts and funding history

PAY-20 adds **Payment accounts → Statements & funding history**. The funding statement pages sealed journal effects with exact wallet running balances. Payment activity includes pending reviews, challenges, declines, groups, uncertain captures and refunds. Both views use the signed owner's selected workspace. All funds and provider records are simulated.

## Use the application

- **Load funding statement** reads the first 25 journal entries and full-snapshot totals. **Load more statement entries** continues beyond 100 records. Opening + wallet credits − wallet debits equals the displayed snapshot balance. Card-funded provider payments and their card returns have zero wallet movement; their amounts and clearing postings remain visible.
- **Load payment activity** includes financial and nonfinancial states. **Load more payment activity** pages older operations. A group is an activity summary; its children create the individual money entries. The statement never posts the group total again.
- Open an activity or statement operation to read original masked funding, linked biller/target, amount/fee/total, capture/settlement/refund state, correlation and related operations. Funding returns show the original card and the wallet debit; they are not another wallet credit.
- A completed history receipt requires matching retained confirmation and journal evidence. Captured, challenged, declined, partial or unknown operations show their state without a completed receipt. A recharge awaiting its final source acknowledgement also remains pending in receipt renderers.
- Use **Payment recovery** for uncertain work. History reads never authorize a charge, retry a provider operation, issue a refund or change balances.

Receipt facts in bill/fine/recharge, funding, refund and group-child panels share AED formatting, original masked funding, target, fee breakdown, correlation and cumulative return annotations. The conversational wallet overview shows funding, current operation state and actual wallet movement alongside amount; it links users to the full statement instead of treating four recent rows as complete history. Conversation payment surfaces also suppress completed styling/receipt text until their exact confirmation is ready.

## Snapshot and current-state semantics

Journal pages sort oldest to newest by immutable insertion sequence. A cursor retains the highest journal rowid from the first page, so later inserts do not change this statement's entries, totals or running balances. Refresh starts a new snapshot. Opening is a retained migration/opening balance, not a fabricated history of earlier simulated transactions.

Activity pages sort newest to oldest by original creation time, kind and ID. Their cursor freezes an insertion ceiling for each of the five record stores, preventing new or backdated inserts from appearing mid-pagination. Original states may advance between reads: the money rows/totals remain at their financial snapshot, while attached operation status is explicitly current. A page is not a frozen historical copy of mutable provider outcomes.

Cursors are opaque read positions bound to stream, owner and account. They convey no spending authority. Every read independently checks the JWT-owned workspace and record owner. Malformed, cross-workspace and cross-stream cursors deny. Cursor lengths and exact-safe-integer bounds are validated; aggregate display supports signed clearing balances and cumulative values without changing the stricter nonnegative payment-amount formatter.

Original stored orders retain source and biller snapshots from approval. Removing a card or archiving its link does not rewrite history. Retained raw captures have their original source identifier; older external simulations without a saved-card snapshot are labelled **Legacy external simulation**, without inventing a card mask or issuer. An unclaimed legacy capture is an uncertain provider result, not a paid-service receipt. A confirmed legacy refund is visible as a posted return and refund annotation; it does not manufacture an applied service.

## API contracts

Shared payment contract **1.13.0**, payment-provider OpenAPI **2.17.0**. Provider routes are under `/v1/accounts/{accountId}` and require the interactive signed owner. Service/broker actors cannot use these new history routes. These are GET-only read models.

| Provider route | Result |
| --- | --- |
| `GET /payment-history` | `operations` (up to 25), nullable `nextCursor` |
| `GET /payment-history/pages/{cursor}` | Next owned activity page at the same insertion ceilings |
| `GET /payment-history/details/{kind}/{operationId}` | One normalized original operation; kind PAYMENT, FUNDING, REFUND, LEGACY or GROUP |
| `GET /payment-statement` | `entries` (up to 25), full `summary`, nullable `nextCursor` |
| `GET /payment-statement/pages/{cursor}` | Next immutable journal snapshot page |

Core routes are `GET /api/payments/history` and `GET /api/payments/statement`, with `accountId` and optional `cursor` query parameters. `GET /api/payments/history/detail` requires `accountId`, `kind` and `operationId`. Unknown fields and arbitrary kinds deny. Generated schemas specify normalized operation, posting, summary and cursor shapes.

The retained `GET /transactions` / application `GET /wallet/transactions` remains a latest-100 compatibility view. Known charge, funding and refund rows receive current normalized state, original funding labels, actual wallet movement and confirmation metadata. Stored transaction rows are preserved. Older seeded history without a journal operation remains labelled retained history; it does not become a new posted effect. The full statement/activity API provides pagination.

## Accounting and receipt evidence

Statements derive totals only from finalized balanced journal entries/postings, not transaction display rows or group summaries. Every entry carries original journal ID/reference, time, amount, signed wallet delta, running balance, two clearing/wallet postings and an owned operation where the original journal reference resolves. Aggregate wallet/external/merchant clearing must balance. Missing sealed posting evidence prevents confirmed receipts; inconsistent capture metadata also denies confirmation.

Stored payment receipt readiness checks state, fundsCaptured, exact amount/currency/payment reference and final source acknowledgement. Backend details additionally match the immutable charge/order/digest/source/admission and journal. Funding checks its captured issuer context and journal. Refund confirmation checks the original capture, sealed return journal and exact refund/payment/order/digest/cumulative receipt. Group confirmation requires every child; partial groups retain only their actual prior confirmed total. A later partial/full return annotates the original receipt instead of erasing its historical capture.

No new tables, financial migration, reseed or history rewrite is required. History reads use existing journal/orders/refunds/claims; posted money and provider confirmation remain separate effects. Preserve gateway/source snapshots together. The local journal is an integrity control, not an externally immutable accounting/audit platform. Automatic budgets, source/owner lifecycle coordination, final race qualification and cross-shell parity remain separate TODO tasks.

## Verification

`npm run demo:verify:payment-history` runs signed isolated HTTP and browser checks; `npm run record:payment-history` adds six-second review and eight-second confirmed-result/reload holds. The scenario uses actual synthetic card/wallet effects, an uncertain provider response, a partial funding return, decline/challenge, original source/link removal, provider restart and more than 100 records. Its 111 one-fils legacy captures intentionally have no provider effect and remain uncertain; they cannot appear as completed service receipts.

[Execution evidence](../reports/2026-10-24-payment-history.md) · [Paced recording](../recordings/payment-history/index.html) · [Recovery workbench](payment-reconciliation.md) · [Journal](payment-ledger.md).
