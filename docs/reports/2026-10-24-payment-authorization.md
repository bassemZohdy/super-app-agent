# Payment authorization and issuer — 24 October 2026

PAY-05 implemented after baseline `08a5080`; PAY-07/PAY-08/PAY-09 receive partial stored-review/reservation/hold foundations and remain open. The publication commit identifies this source. Existing capture/settlement flows have not been migrated to saved-card orders.

## Delivered scope

Stored signed-owner reviews contain source-provider terms, exact source/link versions and immutable approval digest. Creation reserves the obligation within this new store; explicit approval holds finite wallet/card funds. The Challenge preset requires a separate one-time owner decision. Named low-limit/decline/expired states, source changes, stale prices and expiry deny safely. Cancellation/expiry release active order/hold dependencies. Real source producers now exercise the previously delivered lifecycle guard contract.

Issuer attempts persist finite limits, pending challenge/authorization holds and terminal outcomes. Current card summaries expose held/spent/available amounts. The private capture seam conserves cumulative limits in tests but has no public endpoint; this flow cannot debit posted funds or report a paid bill. New order APIs reject unattended/client-credential actors and caller price/outcome overrides. No Keycloak flags, cloud services, paid dependencies or model authority changed.

## Validation

Nine focused regressions cover explicit approval/digest/ownership, schema shape, real lifecycle binding, finite card holds/cancellation, bound challenges and replay/unattended denial, decline/limit/disabled/expired outcomes, wallet holds/insufficient funds, quote expiry/source changes, competing SQLite connections/reopen and cumulative issuer capture accounting. The legacy payment-account tests remain covered.

The isolated real-Keycloak browser passes creation, unchanged pre-approval availability, finite challenged authorization, reload, cancellation and direct owner/machine/modification/replay denial. Its private authorization-clock advances prove hold/approval expiry while real-time tokens remain valid. Wallet/card posted funds and provider bill state remain unchanged. An added unknown-obligation check reproduced a source 404 being mapped to 503; preserving the trusted `UpstreamError` fixes that boundary.

Full repository check passes **171 Node tests and 18 workspace builds**, ESLint, strict harness, source-secret checks and documentation links. The existing payment-account/lifecycle browser and all twelve service journeys pass, including the separate revision-bound settlement assertion, legacy financial effects and no-double-payment checkout. Current guides pass local link checks across 59 documents.

The updated normal payments/provider/core services were reloaded with existing volumes preserved. Readiness and `demo:verify:inventory` pass; the new authorization read APIs expose contract 1.1 and finite card summaries while wallet funds and transaction history stay unchanged. Desktop challenge/authorization screenshots were inspected. Existing dated recordings remain unchanged; no new authorization video is claimed.

Capture, settlement/refund claims, recurring mandates, scheduler, full A2UI/Angular/Flutter parity and new paced recordings remain their existing unchecked tasks.

[Usage, API and limits](../development/payment-authorization.md) · [Challenge screen](assets/payment-card-challenge.png) · [Authorized review](assets/payment-authorization.png).
