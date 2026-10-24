# Automation execution authority — implementation contract

24 October 2026. AUTO-03 remains in progress. This proposed contract records the requirements in [the threat model](payment-automation-security.md#required-auto-03-admission-contract), preserving supported RFC 7523 and the existing payment path. It does not enable normal scheduled spending. Work was paused at the user’s request; the unfinished protocol/run and order-hook prototype is archived locally, and the running application remains at verified code checkpoint `79cd691`.

The payment database is the authority for current mandates, owner/membership epochs, shared period/lifetime amounts and counts, cooldown, occurrences, business obligations and original orders. The broker remains the sole assertion signer. A worker submits references, never user identity, source, price, executable body or endpoint.

Implementation sequence under the existing AUTO-03 task:

1. **Atomic preparation:** exact machine authentication; server-owned provider lookup; current consent/owner/source/target; one transaction for immutable preparation/order, shared counters and occurrence/payable exclusion. Run-scoped qualification starts with due DEWA/Etisalat/du invoices; unsupported trigger/service adapters fail closed until their own tasks implement them.
2. **Credential issuance:** broker authenticates the worker, reads the exact prepared execution, checks current authority, signs/exchanges a short-lived assertion and binds the token to the immutable permit/operation. No user refresh token or arbitrary write is accepted.
3. **Admission and effects:** providers validate the token and current permit; payment capture rechecks policy/permission/budget in its local financial transaction; source effects reuse the existing admission/claim/order path. Human challenges pause; unknown effects retain original IDs and reservations. Definitive uncommitted closure releases capacity only after capture is fenced.
4. **Qualification:** concurrent workers and manual callers, shared caps/counts/cooldown, policy/owner/source/revocation changes, authority/issuer/source outage, response loss and restart. Actual exact-image credential issuance/admission is required before AUTO-03/PAY-08 can be checked off.

The proposed first checkpoint would implement preparation and owned inspection only in a pristine, persisted isolated run. A prepared order cannot approve, challenge or capture through ordinary APIs. Its budget reservation is not a funding hold or authorization. Mandates continue to return `executionEnabled:false`. Normal databases have no armed qualification run; copied/normal data cannot be armed and an existing run cannot reopen without its original context.

Period keys use real UTC time projected into the explicit IANA zone. Amount/count usage persists across policy versions. Changing period kind/zone after a reservation requires a distinct mandate rather than silently resetting a budget. Unknown/reserved work remains counted. Business-clock and schedule calculation remain separate from consent/credential security time.
