# Conversational payment review parity — 24 October 2026

PAY-07 moves provider-backed manual/conversational bills, exact fines, saved-card wallet reload and civic grouped checkout through explicit source selection, immutable stored review, authorization/challenge and separate payment. Header/chat cancellation resolves the original order and releases unconsumed holds. Source-owned receipts and original capture recovery remain authoritative. [Guide](../development/payment-surfaces.md).

## Verification

- Eleven focused tests cover choice/review separation, exact shared action bindings, source/quote changes, wrong owner/workspace, expiry, hold cancellation, lost committed review/authorization responses, saved-card funding and challenge-before-capture.
- The signed isolated browser matrix proves wallet review/cancellation, amount/version/foreign-owner denial, chat assent without capture, private-clock expired review, chosen-card challenge, actual provider restart and page reload, real source-commit response loss and original-order recovery, card-funded wallet reload, and sequential group challenge continuation. Exact card spend, wallet balance and provider bill/fine/toll effects are independently asserted.
- [The paced recording](../recordings/payment-surfaces/index.html) passes the complete matrix: 293.12 seconds, 36,100,350 bytes, six-second reviews and eight-second outcomes. [Confirmed chosen-card receipt](assets/conversation-payment-receipt.png) was visually inspected.
- `npm test`: 317 passing tests; all 18 workspace builds, lint and E2E TypeScript checks pass. The updated `test:e2e` passes all 12 existing browser journeys against the final code.
- The normal-stack financial rebuild/restart preserves prior resources/idempotency and payment history; all three wallet openings, sealed entries and projections reconcile. Signed-owner inventory reads leave funds/history unchanged. The final core image is rebuilt/recreated and all readiness checks pass.
- Local Markdown links pass across 81 documents; source/document secret checks and `git diff --check` pass. A definitive pre-order source rejection also leaves the review cancellable; the source-drift regression checks that no order/hold/capture survives.

The reload regression was a service URL opening its initial proposal after the saved conversation restored. Server-recorded originating service metadata now prevents that replacement. Group continuation also now differentiates original child progress when constructing request identities, while retaining the same group/child payment IDs. Conversation replies report current payment stages rather than repeat the initial service summary.

Evidence is scoped to the integrated local demo and React browser. Automatic permits/workers, consolidated recovery/statements and remaining simulator/QA/shell-parity tasks stay open. Raw application compatibility routes and offline fixture behavior are documented separately. Completing PAY-07 advances the selected backlog to 19 delivered slices and 31 open.
