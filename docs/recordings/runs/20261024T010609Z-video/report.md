# Cityside browser recording

Recorded: 2026-10-24T01:10:35.846Z. Source: `efee3a95f293dcf3ff21334ecd5fabc1e122e2d3` plus working-tree recording changes.

Isolated local provider/application SQLite; real local Keycloak and Redis; deterministic replies; no real agencies, UAE PASS or money.

**Result:** 12 chapters and 34 checks passed. Video: 249.5 seconds, 1600 × 1000.

Pacing: chapter 3.5s, review 6s, pre-action 1.5s, receipt 8s. These pauses follow state/response assertions; they do not replace readiness checks.

[MP4](cityside-e2e.mp4) · [WebM](cityside-e2e.webm) · [Timed captions](chapters.vtt) · [Machine-readable checks](results.json)

## 00:00 — Sign in and choose an account

Real local Keycloak PKCE · isolated SQLite data · simulated services and money

- PASS: Real PKCE sign-in reached the authenticated account workspace

## 00:11 — Wallet: review, cancel and top up

Review first. Cancelled approvals cannot be replayed. A confirmed top-up changes the ledger once.

- PASS: Payments opened without a chat/model request
- PASS: Changing the offered top-up amount is rejected with HTTP 403 and no debit
- PASS: Cancelled approval replay rejected with HTTP 409; balance unchanged
- PASS: Payments opened without a chat/model request
- PASS: topup_wallet returned its asserted receipt and a new revision
- PASS: Replaying the consumed top-up approval is rejected with HTTP 409
- PASS: Exactly one 50 AED top-up appears in the independently read ledger

## 00:45 — Parking: select, activate and extend

Review the account-owned vehicle and zone. Confirm two hours, then review the extension receipt.

- PASS: Mobility opened without a chat/model request
- PASS: activate_parking returned its asserted receipt and a new revision
- PASS: extend_parking returned its asserted receipt and a new revision
- PASS: Provider state shows the same ticket extended to three hours; exact 12 AED debit

## 01:16 — Utilities: review and settle a fresh bill

Fresh isolated DEWA bill. Review meter data and line items before paying from the simulated wallet.

- PASS: Utilities opened without a chat/model request
- PASS: pay_utilities_bill returned its asserted receipt and a new revision
- PASS: Bill is PAID in the provider and wallet matches the authoritative bill amount

## 01:36 — Telecom: review a subscription and pay its bill

Etisalat is a simulator. Confirm only the offered provider and bill; verify settlement independently.

- PASS: Telecom opened without a chat/model request
- PASS: pay_telecom_bill returned its asserted receipt and a new revision
- PASS: Selected Etisalat bill is paid once for its exact amount

## 01:55 — Traffic fines: review and settle

Natural-language request through the same guarded core. Read violations and discounts before confirmation.

- PASS: pay_police_fines returned its asserted receipt and a new revision
- PASS: No unpaid fines remain and the exact payable amount was debited

## 02:16 — Ride: choose and confirm a real demo booking

Chat prepares a proposal. The receipt carries a real provider booking ID; unknown tracking IDs must fail.

- PASS: book_ride returned its asserted receipt and a new revision
- PASS: Actual booking tracks correctly; an invented booking returns HTTP 404

## 02:37 — Dining: choose a meal and verify the order

A separate service journey with an account-owned persisted order and a traceable order reference.

- PASS: order_food returned its asserted receipt and a new revision
- PASS: Actual order tracks correctly; an invented order returns HTTP 404

## 02:58 — Move in: activate a reviewed tenancy plan

Read the proposal before confirmation. DLD, utility connection and residential permit records must agree.

- PASS: Housing opened without a chat/model request
- PASS: confirm_movein returned its asserted receipt and a new revision
- PASS: Only confirmed move-in created matching persistent tenancy, connection and permit records

## 03:18 — Unified checkout: avoid paying settled bills twice

The earlier utility bill and fines are already settled. Only the remaining Salik recharge may debit the wallet.

- PASS: Review quote excludes already-paid bills and matches the remaining 100 AED effect
- PASS: confirm_smartcity_checkout returned its asserted receipt and a new revision
- PASS: Already-settled DEWA/fines were not charged again; only 100 AED recharged Salik

## 03:39 — Switch accounts and restore the conversation

Household funds stay separate. Return to Personal, then reload the saved dining receipt and transcript.

- PASS: Saved conversation history opens the original dining receipt without creating another order
- PASS: Household account has separate fresh funds and no personal receipt
- PASS: Personal receipt, revision, transcript and balance survive account switch and reload

## 03:57 — Sign out and return to the login screen

The private workspace closes. All services, balances and receipts in this recording are simulated.

- PASS: Signed-out screen has no private account selector or receipt


## Playback verification

MP4 loads in the recording viewer with a measured duration of 249.48 seconds and no media error. Chapter seeking was verified at the unified-checkout chapter. The local artifact server supports HTTP byte ranges. Final verification: 120 Node tests, strict harness checks, lint/document/secret checks and all 17 workspace builds passed.
