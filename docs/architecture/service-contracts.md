# Service contracts

Interactive REST boundaries forward the user's signed access token from concierge through application APIs to providers; each boundary verifies identity and ownership. The separate delegation broker issues short-lived user tokens bound to explicit grants, and providers check current exact-operation authority online. Header-only human impersonation is denied in the reference profile. HTTP errors never silently select old shared fixtures. [Delegation contracts](../development/delegation.md).

| Application | Port | API responsibility | Provider |
| --- | --- | --- | --- |
| service-ride | 4001 | `/mobility/*`, `/rides/*` | RTA, payments |
| service-food | 4002 | `/utilities/*`, dining compatibility routes | DEWA, payments; local account-scoped dining records |
| service-wallet | 4003 | `/wallet/*`, `/fines/*`, `/pay/unified` | payments, Police, DEWA, RTA |
| service-catalog | 4004 | `/miniapps`, `/capabilities`, `/housing/*` | DLD, DEWA, RTA |
| service-profile | 4005 | `/profile`, preferences, prompt context, `/accounts` | application-owned account-scoped SQLite |
| service-telecom | 4006 | `/telecom/{etisalat|du}/*` | Etisalat, du, payments |

Application compatibility request schemas remain in `packages/protocol-core/src/request-validation.ts`. Provider operation/request/response contracts are generated from `services/provider-simulator/src/contracts.ts` into the seven [OpenAPI files](../../services/provider-simulator/openapi). `npm run openapi:generate` refreshes them and the default tests validate their syntax and equality with the runtime.

Provider routes are versioned under `/v1/accounts/{accountId}`. Each protected operation verifies its permitted signed interactive, broker-delegated or narrowly scoped machine identity and account/resource ownership. Writes require a persistent idempotency key. Money capture uses integer AED fils; entity bills and tariffs are authoritative. Providers verify captured payment proofs before settlement. Details, exact endpoints, grants, failures and examples are in the [provider guide](../demo/provider-backends.md).

Private application records come from verified user claims and selected membership, rather than a shared singleton. Client-selected user IDs are not accepted. The core only accepts the user's personal or household account references and binds a conversation to one of them.

The capability catalog and custom UI metadata do not themselves implement consent, production delegated authority, independent mini-app deployment, or official MCP/AG-UI/A2UI conformance. Legacy direct handlers are preserved for offline fixture tests and have different durability/isolation guarantees.

## Concierge entry points

The authenticated core `/mcp` transport exposes account/capability/conversation discovery and the normal guarded intent/action operations. Its schemas reuse the HTTP request contracts. Application `GET /mcp` descriptors remain compatibility metadata; see [the MCP guide](../development/mcp.md).

Manual `/api/manual/prepare` selects one of eleven server-owned bundled service IDs. It bypasses model calls but uses the same session ownership, approval, effect and result path as concierge proposals. Unknown service IDs cannot load remote code. `POST /api/a2ui/cancel` invalidates the current one-time proposal; it does not reverse completed provider effects.

## Local text and speech

The authenticated core exposes `GET /api/voice/config`, `POST /api/a2ui/tts` and `POST /api/voice/transcribe`. Speech accepts text (1–480 chars), one of four installed presets, speed 0.8–1.2 and English; it returns base64 WAV with local provenance. Dictation accepts at most 45 KB of base64 WebM/Ogg/MP4/WAV and English/Arabic language, returning bounded text with `requiresReview: true`. It does not submit an intent or service action. Schemas reject caller model/URL/file parameters. Limits, privacy, licence sources and error behavior are in [the local AI guide](../development/local-ai.md). Private `voice`/`conversation` APIs have no published host ports; normal clients use only core.

## Payment contract extension — live setup, execution and reversal

[The payment/automation design](payment-automation-demo.md) is being implemented in slices. `GET /api/payments/overview`, method/default/status management, biller linking/archive and `POST /api/payments/preview` are live. Every request requires a user token and owned account; mutations require a request key, and references are verified at the source provider. Additive payment-provider OpenAPI is 2.18.0; DEWA payable/status contracts use 2.5.0, telecom/Police 2.6.0; RTA status/recharge uses 2.3.0. Quote previews are explicitly non-executable; reviewed orders require their separate approval/challenge/pay actions; the balanced journal backs current wallet effects; stored authorization reviews and finite wallet/card holds are now implemented; bill/fine/recharge capture and source-backed reversal are implemented; finite consent-record APIs are implemented; runs and general execution-simulator controls remain future work. [Exact routes, request shapes and compatibility](../development/payment-accounts.md).

Related-use records are visible in the payment setup read model and block unsafe parent removal/archive. Binding/release has no public API and grants no financial authority. The preview clock likewise has a local operator CLI only. [Current controls/evidence](../reports/2026-10-24-lifecycle-simulator.md).

[Provider-owned payables](../development/payables.md) add current/historical summaries, exact-revision review and revision-bound settlement. Core consumes the provider revision instead of deriving it from raw lists. Trusted scenario code can issue/amend obligations; no public mutation/control route is exposed. Stored financial orders now use source admission and serialized gateway claims/refund exclusion. Actual automatic-caller qualification remains open.

[Stored authorization reviews](../development/payment-authorization.md) require the independently verified interactive owner on every new provider order route. Creation/approval/challenge read current source-provider terms; no actor or caller price override is accepted. Current GET status expires holds, exact POST retries preserve their original result, and the new review store uniquely reserves each active obligation. These reservations do not yet cover legacy or automatic capture paths.

[Gateway settlement claims](../development/settlement-claims.md) replace reliance on GET proofs alone on existing provider HTTP settlement paths. A provider-specific workload pins merchant authority; local persisted attempt fences and gateway claim/refund serialization prevent a paid effect plus restored funds. Current status reads/retries reconcile missing ACKs; stored bill capture and source reservations now integrate this protocol; other payable types remain separate work.

[Bill execution](../development/payment-checkout.md) adds execute/recover, source prepare/admit/cancel/apply, current capture states and confirmed receipts. Source contracts are 2.5.0 for DEWA, 2.6.0 for telecom/Police and 2.3.0 for RTA; payment contract is 1.14.0 and provider OpenAPI 2.18.0. Raw billing charge namespaces return STORED_BILL_ORDER_REQUIRED; application bill routes now share stored orders.

[Wallet funding](../development/wallet-funding.md) adds strict owned source/amount reviews and approve/challenge/cancel/execute routes. Atomic local capture/credit avoids a remote unknown-outcome window; pending authorization/challenge never credits funds. Legacy top-up flags now consume persistent finite source capacity.

[Fine selections](../development/fine-checkout.md) expose a bounded source-owned FINE_SET payable. Constituent unique reservations protect overlapping sets, and the shared stored-order flow carries approval, capture, claim and atomic source settlement. Existing fine application/conversation routes now use it.

[Provider recharge contracts](../development/provider-recharges.md) add owned targets, fixed-denomination intent quotes and original-intent reads. Shared admission/capture/claim/apply plus verified gateway finalization protects each target while an outcome is unknown. New prepaid manual adapters validate target/version/amount and resume the same order.

[Grouped checkout](../development/checkout-groups.md) freezes one source for sequential child payments, retains separate provider receipts, and stops/resumes the original line on challenge or uncertain settlement. It does not imply cross-provider atomicity.

[Original-source refunds](../development/payment-refunds.md) now cancel eligible full bills/fine sets or reverse bounded unused recharge/funding value. Confirmed returns annotate original receipts and group children; uncertain reversals keep their original ID and do not restore funds.

[Signed financial status events](../development/payment-events.md) append with stored order/source transitions and arrive as owned inspection hints. Callbacks never authorize funds or replace authoritative provider lookup. SIM-03 supplies named issuer scenarios; PAY-18 covers current manual paths. General fault controls and unattended execution retain separate gates.

[Isolated issuer scenarios](../development/issuer-scenarios.md) add operator-bound named outcomes and `AUTHORIZATION_PENDING`. Pending card capacity cannot capture/credit or dispatch later group lines; the original real-time deadline and separate customer execution remain enforced. Normal providers expose no run controls.

[Mandate contract 1.0.0](../development/payment-mandates.md) adds owner-only `/api/payments/mandates` and provider `/payment-mandates` create/read/revise/approve/revoke/history. All responses explicitly disable execution. Provider target eligibility, exact source versions, finite terms and immutable history are independently enforced.

[Conversational payment review actions](../development/payment-surfaces.md) now share exact flow/order/version/digest contracts across source choice, authorization/challenge, explicit pay, original status/recovery and cancellation. Owned conversation restoration includes its server-recorded originating manual service so React can retain a restored payment at that service URL. No provider version or money schema changes are needed for this caller integration.

[Payment event schema v2](../development/payment-events.md) isolates `LEGACY_PAYMENT` capture fingerprints and admitted provider attempts from v1 stored-order approval bindings. Owner-only `/api/payments/legacy-status` reads the original capture and a fixed provider status endpoint; it dispatches no new payment, service action or refund. Deploy the dual-version receiver before v2 producers.

[Owned reconciliation](../development/payment-reconciliation.md) adds paginated cases, five-minute evidence-bound inspections, saved outcomes, guarded original-operation actions and append-only local audit. Payment-provider OpenAPI 2.18.0 documents exact request/response schemas; signed interactive ownership is required independently at core and provider.

[Statements and receipt detail](../development/payment-history.md) add signed-owner journal/activity pagination and normalized original-operation reads. Financial pages retain immutable insertion ceilings and exact running balances; mutable current operation outcomes remain explicitly separate. The retained latest-100 transaction view exposes normalized status and actual wallet movement without rewriting stored rows.

[Payment lifecycle contracts](../development/payment-lifecycle.md) add strict owned eligibility/lifecycle GETs and three private exact-client reader/operator operations. Payments OpenAPI 2.18.0 and shared payment contract 1.14.0 include optional immutable permission versions for new reviews, with byte-preserved legacy bodies. Private permission metadata does not confer delegated spending authority.

[Gateway business exclusion](../development/payment-obligations.md) extends the existing lifecycle result with strict obligation/attempt arrays. Canonical per-invoice/per-fine and recharge intent/target-version keys are server-owned; original capture identity is stored before dispatch. Order creation still rejects a caller-supplied automation origin or permit.
