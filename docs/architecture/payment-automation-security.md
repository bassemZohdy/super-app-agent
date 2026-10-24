# Payment automation authority and threat model

**Date:** 24 October 2026. **Scope:** AUTO-02 review and implementation contract for the local synthetic demo. **Assessed baseline:** `fddcaaa5bc2b31f0ca2fd3224a036d058570da29`. **Security release disposition:** no production approval; scheduled money execution remains disabled. This review does not certify DAP process completeness or ASVS conformance. It extends [ADR-0012](../adr/ADR-0012-secure-delegation-demo.md) and [the payment design](payment-automation-demo.md).

The reviewed source manifest SHA-256 is `8064d61db1960da8645449593e9b70301c8f5eecdf43e32ed1d185c06a2078c3`: listed in the exact hashing order, `services/delegation/src/policy.ts`, `store.ts`, `service.ts`, `services/provider-simulator/src/payment-mandates.ts`, `index.ts`, `packages/backend-kit/src/delegation.ts`, `services/agent-core/src/mcp.ts`, `packages/protocol-core/src/payment-mandates.ts`. Resolve shortened names within their preceding directory. Hash each full path, NUL, baseline Git file bytes, NUL in that order. The reviewed baseline stays in Git; subsequent hardening has separate execution evidence.

## Assets and trust boundaries

The assets are owned wallet/card capacity and clearing records; current provider obligations/effects; immutable consent terms/versions; grant/token/operation bindings; reservations and unknown outcomes; signing keys and short-lived tokens; and auditable owner/actor/effect linkage. Data is synthetic; compromising it can still invalidate the demo's money and authorization guarantees.

| Boundary | Trusted decision | Untrusted input / required separation |
| --- | --- | --- |
| Human → core/provider | Signed interactive owner, workspace, current exact approval | Chat, voice, model output, browser state, actor/grant/source/price strings are proposals |
| Owner → mandate store | Finite reviewed policy, exact source/target versions and immutable approval | Saved cards/defaults and general read grants do not confer recurring authority |
| Scheduler/worker → trusted authority | A request to inspect one server-owned mandate/occurrence | Worker cannot choose user, price, grant scope, arbitrary body/URL, source or substitute target |
| Authority → Keycloak | Controlled short-lived assertion after independent policy decision | Signature alone is not proof of consent; no agent key or user refresh token |
| Keycloak → broker/provider | Verified issuer, audience, algorithm, lifetime, token purpose/client and current online authority | `act`/nested chains, forwarded headers and unknown token fingerprints confer no rights |
| Payment/source stores | Atomic local reservations/capture/claims/reversal and immutable IDs | HTTP success, callbacks and model prose cannot manufacture an effect or release unknown funds |
| Audit/history → owner | Owned redacted correlation and original receipts | UI completion is evidence of verified state, not authority to retry money |

The current OAuth actor is `delegation-broker`; the authenticated legacy initiator is separately audited. The future mandate actor is the exact `cityside-automation` identifier. These identities are not interchangeable. A runner is not a consent issuer, and neither client ID proves human entitlement.

## Authority allocation

| Action | Authority / decision point | Current state and implementation obligation |
| --- | --- | --- |
| Create/expand consent | Interactive signed owner at provider, exact policy digest/version | AUTO-01 implemented; expansion/source change withdraws prior approval |
| Derive a job | Trusted scheduling code from current approved mandate and fixed provider read | AUTO-05/AUTO-06; worker/model input cannot define the authoritative command |
| Derive price/source/target | Authoritative quote plus approved exact sources and current target eligibility | Manual PAY-07–PAY-20 implemented; automatic derivation remains AUTO-03 and service slices |
| Reserve budget/count/payable | One authoritative transaction before credential admission | AUTO-03/PAY-08; per-payment/period/lifetime/count/cooldown and occurrence uniqueness must serialize |
| Mint assertion/token | Separate trusted broker, controlled keys and prelinked user | Supported RFC 7523 local profile implemented; expanded mandates cannot use its legacy write profile |
| Admit money/service effect | Provider plus current permit/entitlement/reservation and existing order/claim guards | Interactive effects implemented; all scheduled money lanes remain denied until AUTO-03/PAY-21 checks exist |
| Revoke/pause | Owner/current authority; authenticated admin only for the explicit future kill switch | Mandate/grant revoke exists; AUTO-15 defines worker admission fencing and pause semantics |
| Reconcile | Original operation and current authoritative source evidence | PAY-19 implemented; workers must retain original IDs and reservations for unknown effects |

## Scoped findings at the baseline

Likelihood is qualitative for this local demo: **low** requires trusted-process mistakes or future unsafe extension; **medium** can be triggered through existing consent input. Severity describes authorization/integrity impact, not a production exploit score. Findings do not invent human risk acceptance.

| ID | Evidence / consequence | Severity, likelihood, confidence | Disposition / owner / verification |
| --- | --- | --- | --- |
| AS-01 | `delegation/policy.ts` discovers read rights from the growing provider OpenAPI inventory. New interactive-only financial reads can acquire apparently valid broker consent even though provider guards reject them. | Medium / medium / high | Identity: explicit reviewed read profile, independent of route growth; revalidate stored grants before use. AUTO-T01/T02/T04. |
| AS-02 | `grantInput` drops extra top-level authority fields and returns an aliased input body. This does not bypass provider ownership, but returned consent can misdescribe caller expectations or drift inside trusted code. | Low / medium / high | Identity: reject unknown authority fields and copy normalized terms. AUTO-T03/T05. |
| AS-03 | `GrantStore.bind` checks user/version/actor but postpones job/operation validation and accepts malformed lifetime/fingerprint descriptors from trusted issuer code. It is not a public binding API. | Medium / low / high | Broker: require an actual pending same-grant job, exact operation digest and valid live token fingerprint/lifetime before storing binding. AUTO-T06. |
| AS-04 | `GrantStore.finish` can overwrite terminal results or mark a not-yet-authorized job completed through a stale trusted callback. Existing network entry points serialize starts, but the storage invariant is weak. | Medium / low / high | Runtime: compare state/identity before completion; retain terminal result. AUTO-T10. |
| AS-05 | Bearer fingerprint binding restricts context and use count; it does not authenticate the sender. A stolen exact token can race the same intended request. Local HTTP and public demo credentials amplify this risk outside local use. | High outside local / medium with token theft / high | Production release owner: TLS, token containment and reviewed sender constraints remain gates. AUTO-T07/T08 record the actual bound, one-admission limit; no claim of theft-proof tokens. |
| AS-06 | Finite mandates have `executionEnabled:false`; there are no authoritative shared money-budget reservations, current owner/membership epochs or scheduled effect permits yet. Existing grants are not those permits. | Block expanded spending / high if enabled prematurely / high | Payments/identity: AUTO-03, PAY-08, PAY-21 and AUTO-15 must implement the controls below before enabling any scheduled write. Current automated-route denial is the containment. |

## Threat/control matrix

| Threat / STRIDE | Attack and consequence | Implemented containment and verification | Expanded execution gate |
| --- | --- | --- | --- |
| AT-01 spoofing/elevation | Worker or model invents human consent or an actor chain | Signed interactive mandate approval, strict schemas, unsupported `act` rejection; AUTO-T03/T12 and signed HTTP negatives | No worker/MCP/model consent create/expand authority |
| AT-02 tampering | Substitute user, workspace, target, source, amount, scope, grant or operation | Exact binding and owner policy; AUTO-T03/T06/T07 | Authority derives every executable term from current mandate and provider quote |
| AT-03 information disclosure/elevation | API growth silently broadens read grants | Explicit legacy read profile and active-grant revalidation; AUTO-T01/T02/T04 | New route/operation requires profile review; no wildcard permission |
| AT-04 spoofing/replay | Stolen, unregistered, expired or mismatched token | JWT/JWKS/introspection and current binding; AUTO-T06/T07/T08/T13, existing exact-image JWT suite | Sender constraints are a separate production decision; never call a bound bearer theft-proof |
| AT-05 tampering/elevation | Stale card, biller, membership, user state or policy version is used | Current source/version/owner checks; mandates remain non-executable; AUTO-T12/T13 and signed tests | Current owner/account entitlement and policy epochs checked at reservation and final admission; disable/unlink races must fail closed |
| AT-06 race/elevation | Revoke/narrow races admission or old token remains usable | Online grant transaction and version checks; two-connection AUTO-T09/T13 | Revocation before atomic admission denies; already-admitted effects retain IDs and must reconcile, never retroactively undo a capture |
| AT-07 race/denial/elevation | Two jobs overspend a shared cap or pay one obligation twice | Manual order/payable/issuer guards and unknown blocking; scheduled writes denied | Atomic period/lifetime/count/cooldown and payable/occurrence reservation shared across workers/manual callers |
| AT-08 integrity | Timeout triggers a replacement charge, source fallback or budget release | Existing unknown-job block and PAY-19 original-ID recovery; AUTO-T11 | Unknown reservations survive token expiry/restart. Only definitive non-application may release; no challenge/unknown fallback |
| AT-09 repudiation/integrity | Stale callback overwrites a completed result | Guarded terminal completion; AUTO-T10; journal/outbox/recovery tests | Worker lease/epoch checks before dispatch and commit; original effect identity in audit |
| AT-10 elevation | General read grant or small legacy top-up is treated as recurring mandate | Strict legacy exact write profile and `executionEnabled:false`; AUTO-T03/T12 and signed HTTP negatives | Distinct per-execution permit and narrowly scoped provider lane; legacy `demo_approved` is not automatic funding authority |
| AT-11 disclosure/repudiation | Tokens, assertions or private keys enter logs/prompts/history | Key mounts separated; hashed token bindings; safe audit fields and source-secret checks | Expanded execution audit stores mandate/version/permit/job/order/decision/effect IDs, never raw credentials |
| AT-12 denial/integrity | Authority/provider outage or poisoned callback becomes a success | Uncached online checks fail closed; signed events are non-authoritative; existing recovery/event suites | Fixed destinations, bounded RPC/leases/retries; no caller URLs, generic balance repair or session-dependent authority |

## Required AUTO-03 admission contract

These are implementation requirements, not claims that permits/budgets already exist:

1. Separate human/worker/issuer/provider roles. The worker authenticates as an exact workload and submits a mandate/occurrence reference, never a bearer-selected user or executable command. The authority resolves owner and current entitlement itself; token role claims alone do not replace membership/user lifecycle checks.
2. Resolve the current approved mandate/version and server-owned source/target/quote. Bind issuer, owner/account, actor, resource audience, operation/body digest, amount/currency, source/version, payable/revision, purpose, occurrence and short real-time expiry. A business-clock advance cannot extend consent or JWT security time.
3. In one authoritative transaction reserve shared amount/count/cooldown and exact occurrence/payable authority before dispatch. The budget reservation and immutable permit/order identity must survive a crash. Human and worker paths must share obligation exclusion; transport keys alone are insufficient.
4. Sign/exchange only after that reservation. Keep supported RFC 7523, approved client/IdP, explicit scope/audience bounds, unique jti and no refresh token. Keycloak authentication is separate from permit admission. No preview feature, JavaScript mapper or caller-supplied `act` chain is introduced.
5. Providers recheck the current permit, policy/entitlement epoch, source/target status and exact order before the documented atomic admission point. An authority outage denies. Revocation before admission stops it; an already-admitted capture/effect is reconciled under its original identity and retained budget reservation.
6. Persist original outcomes. UNKNOWN keeps reservations and forbids new source fallback; REQUIRES_ACTION pauses for the human. Only a definitively uncommitted failure may release appropriate reservation/count capacity, with an audited policy and no late replay. Settled/refunded effects never create automatic replacement authority.
7. Before enabling any one service, prove two-worker budget/count races, manual-versus-worker payable races, disabled owner/membership/source/target, revoke-versus-admission, token/grant substitution, issuer/provider outage, crash/reopen and source-response loss. Exact-image identity tests remain mandatory. AUTO-05 adds worker lease fencing; AUTO-15 adds pause/kill-switch semantics.

## Standards and residual risk

The review uses STRIDE scenarios and selected **ASVS 5.0.0** controls as traceability prompts: authorization documentation/decision placement and ownership (v5.0.0-8.1.1, 8.2.1, 8.2.2, 8.3.1, 8.3.2, 8.3.3), token integrity/purpose/audience/time (9.1.1–9.1.3, 9.2.1–9.2.3), and redacted correlation/fail-closed handling (16.2.1, 16.2.5, 16.5.1–16.5.3). This is a scoped mapping, not an audit or certification. [Pinned authorization chapter](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0_release/5.0/en/0x17-V8-Authorization.md), [token chapter](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0_release/5.0/en/0x18-V9-Self-contained-Tokens.md), [logging/error chapter](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0_release/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md).

Model, transcript, retrieved provider prose and voice inputs remain untrusted proposals. Deterministic policy checks and separately authenticated approval/admission contain their ability to cause effects; system prompts are not authorization. This addresses [OWASP LLM01:2025 prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) and [LLM06:2025 excessive agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) within the local-demo boundary. A bearer can be used by whoever possesses it; context binding does not supply proof of sender possession. [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html#section-1.2).

Production security review, TLS/egress/sender constraints, KMS/key rotation, administrator-resistant audit, HA/backups, identity federation and cross-shell/device qualification remain open. The current recommendation is to retain local-only operation, remediate AS-01–AS-04, and enforce AS-06 as a blocking condition for expanded scheduled money. Human integration/security approval is still pending under OBO-35; no approval is inferred from this review.

[Executed hardening and boundary tests](../reports/2026-10-24-automation-security.md) · [Backlog](../../TODO.md).

## Subsequent PAY-21 implementation evidence

The assessed baseline and its manifest above remain unchanged historical review evidence. [PAY-21](../reports/2026-10-24-payment-lifecycle.md) subsequently implements central owner/membership epochs, exact reader/operator credentials, no-positive-cache checks across core/application/provider/broker, pre-assertion and provider-use checks, immutable permission versions in approvals/grants, actual-account conversation access and local atomic capture fencing. Old JSON rows are not rewritten. Direct Keycloak disablement is independently checked by online introspection; the local permission operator is not a Keycloak synchronization service. AS-06 shared budget/occurrence reservations, scheduled effect permits and distributed revocation/admission fencing remain open under PAY-08/AUTO-03/AUTO-15. The baseline review is not a blanket approval of subsequent implementation.
