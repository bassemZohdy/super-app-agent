# Conversational funding and exact payment reviews

PAY-07 brings the integrated service workspace onto the stored payment APIs used by Payment accounts. Manual **Utilities**, **Telecom**, **Payments**, traffic-fine conversation and civic grouped checkout now offer funding selection before authorization or capture. These are the project's custom JSON surfaces; no new external UI protocol conformance is implied.

## User flow

1. Open the bill, fine set, wallet reload or grouped checkout. **Review funding** opens a source choice and creates no hold/capture. Bills/fines are checked against the exact IDs, revisions and AED amount displayed on the original service surface. Groups bind the displayed unpaid items, toll target/version and total; already-paid items stay excluded.
2. Choose **Cityside wallet** or an owned active saved card. Wallet reloads list only saved cards; no compatibility funding flag or wallet self-funding is offered. Each choice displays masked metadata, source version, card expiry and available/held capacity at selection. A changed source cannot silently fall back to the wallet/default.
3. **Review selected funding** stores the immutable quote/order. Its surface shows biller/target, constituent fine lines and discounts, exact source/version, amount, fees, total, expiry and order reference. This metadata step can link a provider-verified biller to the current workspace, as disclosed on the chooser. It does not authorize or capture money.
4. **Approve authorization** reserves finite funds. A saved-card challenge requires a separate exact owner decision. A pending issuer decision remains pending, with inspection/cancellation controls. **Pay** or **Add to wallet** is a further explicit action. Only source-confirmed settlement/atomic funding produces a receipt.
5. Groups use one selected source and separate child receipts. Approve the exact group, then pay sequentially. A challenge or uncertain child stops later lines; complete the original child's challenge or inspect/recover that same operation before continuing. Prior confirmed payments remain visible when a group stops.

There is no charge from Send, chat/voice assent, selecting a radio option, opening a review, model prose, changing a default or creating a draft. Authorization is distinct from user consent and capture. Wallet balance is unchanged by direct card bill/fine/recharge payment. A wallet reload credits only after its selected card captures.

## Exact bindings and recovery

`payment_surface_choose`, `payment_surface_authorize`, `payment_surface_challenge`, `payment_surface_execute`, `payment_surface_refresh` and `payment_surface_cancel` are strict shared action contracts. The owner/session/account, current surface revision/digest, allowed choice, original flow ID, order ID/version/digest and challenge ID/decision must agree. Caller-supplied prices, sources, alternate orders or extra fields fail before dispatch. Providers independently revalidate current owner, quote, source and authorization deadlines.

The five-minute source choice deadline uses real time. Stored reviews and issuer authorizations keep their existing independent deadlines. A chat follow-up may re-render the surface, but cannot extend the stored order/authorization. Disabled/changed sources or stale payable amounts/revisions fail. Current capacity is rechecked at authorization; the chooser's availability is labelled as a snapshot.

The session persists a credential-free original flow context: exact frozen source choices, pending metadata request, order/group identity and last authoritative view. A lost creation response retries the same immutable metadata request/idempotency identity. Financial-response uncertainty hides further financial buttons until original-status inspection. Refresh reads that original order and, when capture/settlement needs reconciliation, uses its existing guarded recovery endpoint. It never selects another funding source or creates a replacement charge. Group continuation keys additionally bind the original child versions/states, so finishing a child challenge can continue the same group instead of replaying an earlier challenge response.

A definitive creation rejection, such as a changed/disabled source, releases that failed metadata request so the user can cancel or explicitly choose again. Authentication/unknown-response failures retain original recovery context instead of assuming that creation did not commit.

Header **Cancel approval**, surface **Cancel payment review** and explicit chat cancellation all use the original provider cancellation path before discarding a payment surface. Before capture, holds/lifecycle references release and funds remain unchanged. Unknown creation must first resolve the original request. Captured/unknown payments cannot be dismissed as unstarted; a rejected/uncertain cancellation keeps the original review visible. Already-confirmed group payments are retained.

An open payment review blocks replacing that session's service with an unrelated request. Explanation/assent can keep the review open, and cancellation remains available. A new conversation does not erase the original durable payment or relax business-obligation guards; its saved conversation/payment-panel history remains the recovery path. Deleting/expiring a conversation does not erase financial records.

## Reload and shell boundary

The server records the originating manual service in session metadata and returns it with owned conversation restoration. React now preserves that restored conversation when the URL identifies the same service; it no longer opens a new initial proposal over an authorized payment after reload. Explicit navigation to a different service still opens that service. Provider restart and page reload retain the original authorization/order IDs; the browser does not hold payment credentials.

The flow uses existing `SurfaceCard`, text, choice and button components. Shared request/payload contracts serve the shell renderers. The verified browser evidence is React; full Angular/Flutter/device parity remains QA-06. Existing raw application compatibility routes retain their documented wallet behavior; the manual service workspace and conversational buttons use the explicit reviewed flow in provider-backed mode. Offline fixture mode retains its historical behavior and is not this integrated payment security profile.

## Verify and record

```sh
node --experimental-strip-types --import ./scripts/test-env.ts --test services/test/payment-surfaces.test.ts
npm run demo:verify:payment-surfaces
npm run record:payment-surfaces
npm run test:e2e
```

Eleven focused tests exercise exact immutable binding, source/quote drift, wrong owner/workspace, source-choice expiry, cancellation/hold release, lost metadata/authorization responses, saved-card wallet funding and human challenges. The signed browser matrix adds chat assent, expired provider review, actual provider restart/session reload, lost-after-commit settlement response, original recovery and per-child challenged checkout. The twelve-journey harness now explicitly selects funding and separates authorize/pay; its wallet reload uses a named saved synthetic card.

Recordings use six-second review pauses and eight-second outcomes. The browser matrix refreshes its API test login during long recordings without persisting bearer tokens. Temporary provider data is isolated; normal wallets/history are preserved. [Evidence](../reports/2026-10-24-payment-surfaces.md) · [Paced recording](../recordings/payment-surfaces/index.html).
