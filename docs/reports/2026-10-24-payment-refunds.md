# Original-source refunds — 24 October 2026

PAY-17 implements exact owner refund reviews, full bill/fine cancellation, bounded unused recharge reversal, and card-funded wallet reversal without overdraft. Confirmed provider reversal precedes gateway money return. The original capture/source, cumulative amount and refund identity remain fixed across retries, partial returns and restart.

Source: the commit adding `payment-refunds.ts`, `provider-reversals.ts`, payment contract 1.7.0 and payment-provider OpenAPI 2.10.0. [Usage and recovery boundaries](../development/payment-refunds.md).

Nineteen new domain/integration tests cover wallet/card DEWA and fine-set reversal; all three recharge providers with partial/remaining returns; before/after-source-response loss; spent credit and permanent rejection; owner/digest/altered-receipt denial; local persistence rollback; concurrent dispatch; removed-card return; available-wallet funding reversal; held/spent funds; reopen; invalid money; unsupported partial bill/fine and expired/unapproved review; and durable pre-dispatch request-key binding across reopen.

## Executed evidence

- Full repository suite: 264 Node tests and all 18 workspace builds pass. ESLint and strict E2E type checks pass.
- Real local Keycloak/Redis browser over temporary SQLite: full wallet bill and card fine-set cancellation, two cumulative partial mobile-credit returns, partial card-funded wallet reversal and spent-funding denial pass. Five confirmed refund receipts restore after reload. Each attempt asserts owner denial, exact original source, retry/recovery identity and wallet/card/provider effects.
- The paced VP9 recording is 96.84 seconds, 1440×1050 and 10,873,735 bytes. Reviews pause six seconds, results eight seconds. The spent-funding screenshot was visually inspected: FAILED / INSUFFICIENT_AVAILABLE_FUNDS, original masked card and no money returned. [Viewer](../recordings/payment-refunds/index.html) · [Denial](assets/refund-spent-funding.png).
- All twelve existing isolated browser journeys pass. The final HTTP refund check also exercises the durable pre-dispatch request-key reservation added during review.
- Controlled normal-stack restart preserves all three wallets, balanced journal/projections, source payment resource/idempotency rows, claims, issuer authorizations, funding/order/group/refund records and original-card return history. Empty new refund tables do not create a capture, reversal or credit. Signed inventory/readiness checks pass.
- Markdown links in 73 documents and source-secret checks pass. Disabled GitHub workflows and the supported no-preview Keycloak profile remain unchanged.

TODO records 16 delivered slices and 34 open. This local synthetic provider policy does not claim real provider refund eligibility or production certification. Refund events, consolidated workbench/statements, automation and retained-shell parity retain their separate tasks.
