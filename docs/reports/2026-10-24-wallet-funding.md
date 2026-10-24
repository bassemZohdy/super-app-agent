# Saved-card wallet funding — 24 October 2026

Implementation follows `e99f71f` (bill checkout) and `e1d59ba` (correct conversation probe). Publication commit identifies the source. PAY-13 adds owned card-funded wallet reviews, explicit approval/challenge, finite capture, an atomic balanced wallet credit and receipt restoration. It also replaces unlimited legacy top-up flags with persistent finite card aliases.

Thirteen focused funding regressions pass: no credit before execution; exact retry; invalid/self/cross-owner input; bound and rejected challenges; decline/limit/expiry; source changes; wallet cap recheck; rollback after capture but before receipt persistence; reopen/lost response; shared SQLite admission; and exhausted/removed legacy alias denial. Existing HTTP idempotency tests prove sub-AED compatibility, canonical-key conflicts and signed-provider guards. The complete repository check passed **201 Node tests and 18 workspace builds**; all twelve existing real-Keycloak browser journeys passed, including the legacy conversational top-up now backed by a finite card. Lint and strict harness checks pass. Deployment/preservation and final document checks are recorded below.

The real-Keycloak Chrome run passed the complete challenged-card UI flow, exact execution retry, issuer/wallet effects and receipt restoration. Wrong owner/machine, changed approval, duplicate open review, wallet self-funding, excessive amount and funding-flag injection deny. The actual credit was AED 50, wallet AED 1500 → AED 1550, issuer spent AED 50/held zero. The [receipt screenshot](assets/wallet-funding-receipt.png) was visually inspected.

The [paced recording](../recordings/wallet-funding/index.html) is 37.16 seconds, VP9, 1440×1050. Six-second review/challenge/authorization holds and eight-second confirmed-receipt holds follow asserted states. The run uses isolated provider/application SQLite, real local Keycloak/Redis and disabled model inference; it makes no changes to normal demo funds and includes no physical microphone or real card input. The normal local inference verification separately passed generated speech, local Whisper transcription and a Qwen reply after the corrected health probe.

Remaining scope includes fine/recharge execution, grouped checkout, refunds/reversals, asynchronous events, broader statement/recovery/parity, mandates and automation. This is a local synthetic demo, not PSP or production certification.

## Normal demo deployment

The serial restart/preservation verifier passed after deploying the updated payment/core/application services. Resource/idempotency hashes, journal entries, claims, issuer authorizations and stored bill/funding review rows were unchanged; all three normal wallets retained one balanced opening and matching projections. The normal database had zero funding reviews at deployment; non-empty funding preservation is demonstrated by the isolated reopen regression. The conversation container remains healthy after the corrected probe.

Post-deployment `demo:wait` and signed-owner read-only `demo:verify:inventory` pass for contract 1.3.0, unchanged wallet funds/history and current provider revisions. Final documentation/secret/diff gates pass across 65 Markdown documents. Backlog audit: 50 unique tasks, 11 delivered, 39 open.
