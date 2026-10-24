# Payment accounts foundation — 24 October 2026

Implementation: PAY-01 delivered; PAY-03/PAY-04 management portions implemented and still unchecked for prepaid resources and future dependent order/hold/mandate guards. Builds on source `283521a` plus the accompanying payment/planning worktree changes. Use this file's publication commit to identify the delivered source. [Usage/API compatibility](../development/payment-accounts.md) · [Full design](../architecture/payment-automation-demo.md).

## Delivered behavior

- Strict versioned contract/state schemas, additive payments OpenAPI 2.1 and authenticated account-scoped core facade.
- Persisted synthetic card presets/defaults/status with masked metadata, optimistic versions and safe tombstones. No raw card collection or financial effects.
- Biller linking verifies the signed user's reference at the real local source provider before committing; cross-user references are denied.
- Fresh preview reads current bills/fines and binds owned active link, source/version, amount, zero fee, expiry and digest. `previewOnly` is explicit; it cannot execute funds movement.
- React management/review workspace with cancellation-safe account changes, a scrollable responsive layout and close-focus restoration. Existing service navigation continues to use current wallet payments.

## Executed checks

| Check | Observed result |
| --- | --- |
| Focused payment tests | Six pass: strict input/response/order contracts, persistence/default/version/tombstone behavior, provider ownership forwarding, immutable non-executable snapshot binding and current provider amounts |
| `npm run check` | 136 Node tests, ESLint, strict harness checks, source/doc gates and 18 workspace builds pass |
| `npm run demo:verify:payment-accounts` | Actual PKCE sign-in, isolated providers/SQLite and Chrome setup/link/review pass |
| Browser/API negatives | Same-key replay returns one method, changed payload conflicts; raw-card/price overrides, wrong owner/source/account and unauthenticated requests deny |
| Browser lifecycle | Disabled default stays explicit; stale source version fails; household/personal methods/links isolate and restore after switching/reload |
| Financial invariant of this slice | Initial/final isolated wallet remains exactly 150000 fils; no new charge, top-up or provider payment is executed |
| Existing service journeys | All twelve isolated real-browser journeys pass after the new workspace; wallet effects and restored receipts remain correct |
| Mobile/focus | 390px viewport has no horizontal overflow; panel scrolls; close restores focus |

[Reviewed source-bound quote](assets/payment-accounts-review.png) · [Mobile setup](assets/payment-accounts-mobile.png).

The first browser run exposed a harness wait on a hidden native option; the wait now checks attachment, while interaction uses the native select. Initial build checks caught a widened TypeScript literal and a Node strip-mode parameter property; both were corrected before passing checks. Failures were not counted as feature evidence.

## Remaining work

PAY-02 is next: balanced journal/migration. No order workflow, authorization holds, executable saved-card quotes, issuer challenge, settlement claim/reconciliation, recurring mandate or worker is claimed delivered. Saved-card expiry/disabled checks are setup eligibility, not actual issuer authorization. Prepaid resources, usage simulation, source-in-use protection and Angular/Flutter management parity remain open. Historical provider/payment semantics are preserved for the current wallet demo until guarded execution migrates them.
