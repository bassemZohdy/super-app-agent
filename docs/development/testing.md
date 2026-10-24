# Testing and verification

## Commands

```bash
npm run check # ESLint, Markdown links, tracked-source secrets, tests, 18 builds
npm run demo:up         # includes readiness polling
npm run demo:wait       # check endpoints of an already running stack
npm run test:redis
npm run demo:verify
npm run demo:verify:journeys
npm run demo:verify:manual
npm run demo:verify:security
npm run demo:verify:restart
npm run local-ai:verify
npm run local-ai:test
npm run local-ai:browser
```

`npm test` uses explicit fixture/demo identity, disables live model calls, and requires no Docker. Some tests bind local HTTP servers to verify signed JWTs and actual SSE requests. Restricted sandboxes must allow local listening. It includes the provider tests and validates every generated OpenAPI 3.1 document against its runtime source.

`npm run test:redis` is a separate integration test against `TEST_REDIS_URL` or localhost:6379. It uses a random key prefix, cleans up only its own keys, verifies cross-client ownership/account rejection, leases, fenced saves, transcript/surface persistence, empty JSON arrays, pub/sub and replay.

`npm run demo:verify` requires the running reference stack. It authenticates the two seeded users through real local Keycloak, obtains real client-credential tokens, calls both REST boundaries, checks account/session denial, payment capture/replay/conflict/decline/refund, wrong-service denial, telecom calls, and stale UI action rejection. All money and entity records are simulated.

Flutter checks run separately from npm:

```bash
cd apps/shell-flutter
flutter pub get
flutter analyze
flutter test
flutter build web
```

The widget tests use a controlled HTTP client, exercise real widget account switching at phone/desktop sizes, verify account/session references, ensure previous conversation state clears, and preserve the final reply when restoring a saved surface without assistantMessage. They do not establish native provider or speech integration.

## Coverage and limits

| Boundary | Evidence | Remaining limits |
| --- | --- | --- |
| Existing scenario/security regressions | default Node tests | deterministic fixtures are not production integrations |
| Provider schemas | Swagger Parser + equality with generator | nested demo resource fields remain extensible |
| SQLite | isolated per-provider/account tests and reopen persistence | no production HA, backups or migration framework |
| Keycloak | actual local user and service-token checks | seeded realm, public demo secrets, no production federation |
| Redis | real two-client integration and reference AOF | single Redis node, crash-loss window and global quotas remain |
| Payments | integer arithmetic, proof matching, replay, decline and refund | no distributed transaction, automatic compensation or real PSP |
| Browser | React PKCE login, account/history/restore; Angular build/login checks | no complete automated cross-platform conformance suite |
| Flutter | strict analysis, phone/desktop account-switch widgets, UTF-8/multiline SSE/cursor/reauthentication regressions and web build | native execution, PKCE/speech and full renderer parity remain open |
| Local text and speech | actual CPU Qwen reply, KittenTTS WAV, Whisper draft and browser fake-device capture/preview | physical device quality, Arabic evaluations, native speech and production load remain open |

Current text/speech results are recorded in [the local AI report](../reports/2026-10-24-local-ai.md), supplementing [the demo validation report](../reports/2026-10-24-demo-completion.md). Earlier release reports and videos describe their dated fixture baselines and must not be used as evidence of current provider, identity or production guarantees. `npm run lint` now executes ESLint correctness rules over TypeScript/JavaScript source. The docs gate checks local Markdown links; the secret gate scans tracked/unignored source for OpenRouter keys and private keys without printing values. These targeted checks are not comprehensive security certification.

`demo:verify:restart` now orchestrates preparation, core/Redis/payment container restarts, readiness, approval resume and its own temporary-record cleanup. Run it without simultaneous wallet-changing tests. The manual verifier covers all eleven integrated routes, cancellation replay denial and a real-Keycloak MCP call. The security verifier proves ID-token rejection and immediate access-token denial after logout on a new request. Existing streams are bounded by expiry, not continuously introspected.

## Real browser journeys and recording

`npm run test:e2e` executes the same twelve real-browser scenarios as `npm run test:video`, with presentation pauses disabled. Unlike the older fixture transcript generator, these assert actual login, UI controls, HTTP outcomes and persisted domain effects. Missing steps fail rather than being skipped. The video adds readable pauses and publishes only a fully successful run with measured chapters, MP4/WebM, captions and assertions. [Recording guide](recording.md) describes isolation, prerequisites, pacing, diagnostics and cleanup. `npm run check:e2e` strictly type-checks this harness and is included in `npm run check`.

## Delegation verification

[Executed delegation report](../reports/2026-10-24-delegation-demo.md) supplements the earlier baseline. `npm run demo:verify:delegation` checks actual private-key RFC 7523 exchange, authenticated runner, reads across all seven providers, cross-user/revoked-grant denial and one AED 1 synthetic write without duplicate effect. Run wallet-mutating checks serially. `npm run demo:verify:delegation:security` executes the controlled-key attack matrix inside the broker, including a Keycloak-active token rejected after consent revocation. Unit tests cover binding substitution, exact bodies, limits, narrowing, expiry, uncertain outcomes and two-connection/reopen behavior. These do not prove cluster replay persistence, key rotation, native-device UI or production security. [Guide](delegation.md).

The new Flutter consent widget test proves inspection does not create consent, grant approval does not execute, the separate run action works and withdrawal disables execution. The final Flutter suite passes six tests; native-device parity remains open. All twelve retained React browser journeys were also rerun against isolated state with signed-user provider enforcement.

## Local inference checks

`local-ai:test` runs four FastAPI tests covering actual bounded audio decoding with controlled inference, silence and invalid media, strict input/language/preset constraints, model absence, busy responses and origin rejection. `local-ai:verify` generates original speech, compresses it to browser-format audio, runs actual Whisper and Qwen, checks authentication/non-audio failures and writes the public preview. `local-ai:browser` uses that synthetic WAV as Chrome’s fake microphone, asserts a reviewable draft with zero intent submissions, tests an alternate voice and saves a screenshot. It never uses a physical microphone. Run these serially to respect CPU/rate limits. Node tests additionally cover cancellation races, no browser/cloud fallback, bounded text preparation, private endpoint enforcement and local model error/context handling. [Setup](local-ai.md).

## Planned payment/automation acceptance

QA-01–QA-08 in [the new backlog](../../TODO.md#payment-accounts-and-automation-demo--planned-backlog) specify future security, ledger, concurrency/restart, positive/failure browser, shell-parity and paced-recording gates. SIM-01–SIM-06 provide run-isolated business time, issuer presets and delivery/commit failpoints. The first `demo:verify:payment-accounts` check now covers setup/link/quote and negative ownership/version scenarios; the complete planned payment/automation matrix is not yet current coverage. The business clock must never override JWT/security time, and assertions must inspect both funds and provider effects. Existing twelve journeys remain regression requirements. [Design and scenario scope](../architecture/payment-automation-demo.md).

`npm run demo:verify:payment-accounts` builds an isolated React/provider environment using real local Keycloak/Redis and verifies the new setup workspace without moving funds. Eight payment-account regressions cover strict contracts, persistence, ownership forwarding, non-executable snapshot binding and owned inventory upgrades. [Usage and required ports](payment-accounts.md) · [Executed results](../reports/2026-10-24-payment-accounts.md).

`npm run demo:verify:payment-ledger` checks the actual local provider's migration/restart with hashed resource/idempotency snapshots and a readable backup. It briefly pauses payments; run serially. Seven isolated ledger regressions exercise balanced effects, shared holds, sealing/corruption guards, rollback and offline restore. [Migration evidence](../reports/2026-10-24-payment-ledger.md).

`npm run simulator:verify` exercises the fixed-path preview CLI across separate processes. Seven scenario tests cover persistent deterministic time/events, bounded owner/revision changes, reset containment and real-time JWT behavior. Payment browser checks now include owned prepaid linking and visible/direct-API lifecycle locks using trusted internal reference fixtures, while the twelve-journey harness verifies vehicle discovery after fines are paid. These do not establish actual issuer or mandate producers. [Evidence](../reports/2026-10-24-lifecycle-simulator.md).

`npm run demo:verify:inventory` checks current signed-owner prepaid/vehicle discovery and lifecycle reads against the running local stack, asserting that wallet funds and transaction history stay unchanged. It does not execute payment or automation.

Seven payable regressions cover provider schemas, lifecycle/revision/discount/expiry bounds, proof substitution and persistence/concurrency. The payment browser now also verifies current/historical/withdrawn bill rendering and a separate signed owner’s revision-bound settlement with one exact journal debit; the setup owner’s funds remain unchanged. [Payable evidence and capture limits](../reports/2026-10-24-payables.md).

`npm run demo:verify:payment-authorization` covers explicit stored owner approval, finite card/wallet holds, bound challenges, reload/cancellation, decline/limit/expiry, stale/unknown obligations, and owner/machine/replay denial against isolated real-Keycloak services. A constructor-only test clock exercises expiry without changing JWT time. This suite never captures funds or settles a bill. [Evidence](../reports/2026-10-24-payment-authorization.md).

Nine settlement/refund regressions cover stale GET proofs, claim/refund exclusion, lost claim/ACK, two-connection release-versus-late-application, unknown rollback and legacy migration/reopen. The payment browser also verifies actual claim/ACK, paid-refund and human-release denial, rejected-source release/refund and separate du workload scope. The migration verifier now pauses/recreates source/payment providers and checks claims backup/state as well as journal/resource/idempotency preservation. [Evidence](../reports/2026-10-24-settlement-claims.md).

Eight checkout regressions cover both funding sources, exact one-payment recovery across lost provider responses, changed terms, expiry, source admission fencing and v1 review migration. The card browser now also executes an admitted challenged bill, verifies unchanged wallet funds/finite issuer spend and reloads the confirmed receipt. The old utilities fixture now echoes the actual offered resource and asserts omission denial. [Checkout evidence](../reports/2026-10-24-payment-checkout.md).

`npm run demo:verify:wallet-funding` checks selected-card wallet funding in isolated state with real Keycloak. `npm run record:wallet-funding` adds six-second review/challenge/authorization and eight-second confirmed-receipt holds. [Guide](wallet-funding.md) · [Evidence](../reports/2026-10-24-wallet-funding.md).

`npm run demo:verify:fine-checkout` verifies wallet and challenged-card exact fine selections. `npm run record:fine-checkout` adds six-second review/challenge/authorization and eight-second receipt holds, using isolated databases with real Keycloak. [Fine guide](fine-checkout.md) · [Evidence](../reports/2026-10-24-fine-checkout.md).

`npm run demo:verify:recharge-checkout` verifies all three providers with wallet and challenged-card funding. `npm run record:recharge-checkout` records the six asserted journeys with six-second review/authorization/challenge and eight-second confirmed-receipt holds. [Recharge guide](provider-recharges.md) · [Evidence](../reports/2026-10-24-provider-recharges.md).

`npm run demo:verify:checkout-groups` verifies wallet multi-provider success, per-line challenged-card payments and a partial limited-card recharge/fine checkout with exact provider/funding effects and owner/retry checks. `npm run record:checkout-groups` adds six-second reviews/challenges and eight-second completed/partial-result holds. [Guide](checkout-groups.md) · [Evidence](../reports/2026-10-24-checkout-groups.md).

`npm run demo:verify:payment-refunds` exercises full wallet bill/card fine cancellations, cumulative partial mobile-credit returns, wallet-funding return and spent-funding denial against actual local provider/issuer/journal state. `npm run record:payment-refunds` adds six-second reviews and eight-second result holds. [Guide](payment-refunds.md) · [Evidence](../reports/2026-10-24-payment-refunds.md).

`npm run demo:verify:payment-events` checks actual provider settlement with a lost response, signed callback inspection, original-order recovery, forged/duplicate/late callback denial and a subsequent reversed bill. `npm run record:payment-events` adds six-second review/attention and eight-second receipt holds. [Event guide](payment-events.md) · [Scoped evidence](../reports/2026-10-24-payment-events.md).

`npm run simulator:issuer` / `npm run demo:verify:issuer-scenarios` verify all eight named outcomes through a signed run operator and independent customer, including ordinary-user/body denial, exact card/wallet effects, pending provider restart and refund failure. `npm run record:issuer-scenarios` adds six-second reviews and eight-second outcomes. [Guide](issuer-scenarios.md) · [Evidence](../reports/2026-10-24-issuer-scenarios.md).

`npm run demo:verify:mandates` validates all six finite policy families with real signed owners, isolated current provider reads, exact consent/revision/idempotency checks and a payment-provider restart. Consent actions preserve wallet/transaction state; policy execution is disabled. [Guide](payment-mandates.md) · [Evidence](../reports/2026-10-24-payment-mandates.md).

`demo:verify:payment-surfaces` and `record:payment-surfaces` verify exact-funding service surfaces with signed identities, cancellation, expiry, provider restart/page reload, lost-after-commit original recovery, saved-card wallet funding and per-child challenged checkout. The updated twelve-journey harness selects funding and separates approval/payment. [Guide](payment-surfaces.md) · [Evidence](../reports/2026-10-24-payment-surfaces.md).

`demo:verify:legacy-payment-events` qualifies real signed callbacks for parking, held acknowledgement/restart/inspection, extension and confirmed non-application/refund, plus stored utility/telecom bills, fine sets, toll/mobile recharge, full/partial source reversal, wallet funding and refund. `record:legacy-payment-events` records actual inspection UI with six-second reviews and eight-second outcomes; legacy setup uses transparently scripted signed APIs. [Guide](payment-events.md) · [Evidence](../reports/2026-10-24-legacy-payment-events.md).

`demo:verify:payment-reconciliation` and `record:payment-reconciliation` cover before-commit loss, committed-provider response loss across gateway restart, separately approved refund/reversal loss, unavailable source blocking, saved outcome reload and owner/digest denial. The workbench suite also checks concurrent admissions, unknown retry, journal/audit failure, legacy release, funding inspection and pagination beyond 100 records. [Guide](payment-reconciliation.md) · [Evidence](../reports/2026-10-24-payment-reconciliation.md).

`demo:verify:payment-history` and `record:payment-history` assert pagination of 116 real journal entries and 117 operation records, immutable snapshot totals, current unknown/challenge/decline outcomes, removed-source/link receipts, partial funding return, provider restart and reload. Unit coverage also checks stable cursors under backdated insertion, group accounting and signed exact-cent formatting. [Guide](payment-history.md) · [Evidence](../reports/2026-10-24-payment-history.md).

`demo:verify:automation-security` checks signed user/workload/runner and exact-image delegated-token boundaries with isolated providers and a temporary broker. Existing issuer keys remain in a read-only trusted container; no credentials are printed. Negative probes preserve money; a separate explicit AED 1 legacy credit proves replay compatibility. `demo:verify:delegation:restart` hashes normal authority records across a broker restart. [Threat model](../architecture/payment-automation-security.md) · [Evidence](../reports/2026-10-24-automation-security.md).
