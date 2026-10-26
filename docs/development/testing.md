# Testing and verification

Verification results and the evidence behind them are in the [evidence register](../reports/README.md). Current documentation checks cover local paths/Markdown anchors, documented npm commands outside historical material, unique task IDs and short task bullets in `TODO.md`. Dated report totals remain historical.

## Commands

```bash
npm run check # lint, E2E TypeScript, docs, source secrets, local-only policy, offline tests and workspace builds
npm run check:local-only      # no hosted SDK, deploy command, linkage file, cloud key or CDN/remote-font bundle asset
npm run openapi:generate      # regenerate the provider OpenAPI contracts (checked by tests)
npm run openapi:generate:apps # regenerate the application API contract (checked by tests)
npm run sbom:generate         # local CycloneDX SBOM into dist/sbom; opt-in, no CI workflow
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

QA-01–QA-08 in [the new backlog](../../TODO.md) specify future security, ledger, concurrency/restart, positive/failure browser, shell-parity and paced-recording gates. SIM-01–SIM-06 provide run-isolated business time, issuer presets and delivery/commit failpoints. The first `demo:verify:payment-accounts` check now covers setup/link/quote and negative ownership/version scenarios; the complete planned payment/automation matrix is not yet current coverage. The business clock must never override JWT/security time, and assertions must inspect both funds and provider effects. Existing twelve journeys remain regression requirements. [Design and scenario scope](../architecture/payment-automation-demo.md).

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

`npm run demo:verify:automation-execution` runs an armed isolated payments run against the Compose Keycloak and broker (the broker container is recreated to point at the run and restored afterwards): the `automation-worker` token prepares, obtains one owner token, settles the stored order once through the real providers, a replay or any other operation moves nothing, and the qualification scenarios hold: two workers racing for the credential, three parallel executes, a broker outage that fails closed and recovers with the same token, a provider restart followed by a replay, and an owner pause before admission. It needs `npm run demo:up` and the realm reconciled with `DELEGATION_ENABLED=true npm run demo:realm`.

`npm run demo:verify:mandates` validates all six finite policy families with real signed owners, isolated current provider reads, exact consent/revision/idempotency checks and a payment-provider restart. Consent actions preserve wallet/transaction state; policy execution is disabled. [Guide](payment-mandates.md) · [Evidence](../reports/2026-10-24-payment-mandates.md).

`demo:verify:payment-surfaces` and `record:payment-surfaces` verify exact-funding service surfaces with signed identities, cancellation, expiry, provider restart/page reload, lost-after-commit original recovery, saved-card wallet funding and per-child challenged checkout. The updated twelve-journey harness selects funding and separates approval/payment. [Guide](payment-surfaces.md) · [Evidence](../reports/2026-10-24-payment-surfaces.md).

`demo:verify:legacy-payment-events` qualifies real signed callbacks for parking, held acknowledgement/restart/inspection, extension and confirmed non-application/refund, plus stored utility/telecom bills, fine sets, toll/mobile recharge, full/partial source reversal, wallet funding and refund. `record:legacy-payment-events` records actual inspection UI with six-second reviews and eight-second outcomes; legacy setup uses transparently scripted signed APIs. [Guide](payment-events.md) · [Evidence](../reports/2026-10-24-legacy-payment-events.md).

`demo:verify:payment-reconciliation` and `record:payment-reconciliation` cover before-commit loss, committed-provider response loss across gateway restart, separately approved refund/reversal loss, unavailable source blocking, saved outcome reload and owner/digest denial. The workbench suite also checks concurrent admissions, unknown retry, journal/audit failure, legacy release, funding inspection and pagination beyond 100 records. [Guide](payment-reconciliation.md) · [Evidence](../reports/2026-10-24-payment-reconciliation.md).

`demo:verify:payment-history` and `record:payment-history` assert pagination of 116 real journal entries and 117 operation records, immutable snapshot totals, current unknown/challenge/decline outcomes, removed-source/link receipts, partial funding return, provider restart and reload. Unit coverage also checks stable cursors under backdated insertion, group accounting and signed exact-cent formatting. [Guide](payment-history.md) · [Evidence](../reports/2026-10-24-payment-history.md).

`demo:verify:automation-security` checks signed user/workload/runner and exact-image delegated-token boundaries with isolated providers and a temporary broker. Existing issuer keys remain in a read-only trusted container; no credentials are printed. Negative probes preserve money; a separate explicit AED 1 legacy credit proves replay compatibility. `demo:verify:delegation:restart` hashes normal authority records across a broker restart. [Threat model](../architecture/payment-automation-security.md) · [Evidence](../reports/2026-10-24-automation-security.md).

`npm run demo:verify:payment-lifecycle` verifies reader/operator isolation, membership/owner revocation, stale order/challenge/conversation/grant denial after restore, original-capture recovery, permission restart, authority outage and a temporary real Keycloak user disablement. `npm run record:payment-lifecycle` records six-second reviews and eight-second outcomes. [Guide](payment-lifecycle.md) · [Evidence](../reports/2026-10-24-payment-lifecycle.md).

`npm run demo:verify:payment-obligations` tests real signed concurrent invoice requests, changed request bodies, fine overlap across panel/manual APIs, recharge target-version exclusion, unknown admission response/restart, original capture recovery and owned reads. `npm run record:payment-obligations` adds six-second reviews and eight-second outcomes. [Guide](payment-obligations.md).

## P2-02 operating qualification

`npm run ops:verify` exercises signed, isolated HTTP journeys, rejects unauthorized diagnostic access, joins a failed composite journey across service/tool/provider spans, checks all 14 application/provider/core probes, runs an eight-worker 10-second read load and a paced 60-second soak. Inference is disabled and no normal payment database is changed. `npm run ops:verify:recovery` starts dedicated Redis containers, fences the original writer, restores an encrypted checkpoint and verifies actual financial/broker tables, revocation, original replay/pending fences, approvals, graph pending writes, TTL and signing identity. Passing an extracted full-stack cold checkpoint also boots its Keycloak H2 realm and Redis copy on isolated ports. Private summaries go to `.data/operations/`.

Offline tests cover trace isolation/parent links/redaction, protected operations routes, readiness failure, bounded retention/stuck work/backpressure, encrypted integrity/overwrite/link protection and successful/failed SIGTERM drain. Container shutdown uses init plus a bounded request drain; cold backup refuses unclean exits. [Runbook and targets](operations.md) · [Execution evidence](../reports/2026-10-24-operations.md).

## Browser journeys under Playwright Test

`npm run test:browser` runs `test/browser/**/*.spec.ts` with the Playwright Test runner that ships in the `playwright` package, against the running Compose stack (`npm run demo:up`). Folders are named for the resident's intent (`operate-automation`, `platform`). There is a `desktop` project (1440 by 1000) and a `mobile` project (390 by 844, touch); `--project=desktop` selects one. Every test gets a fresh browser context, so no cookie or storage carries over, and an automatic fixture aborts any request to a host outside this machine and fails the test; `platform/external-host-guard.spec.ts` is expected to fail, so it reports a problem if the guard ever stops working. Traces, screenshots and the HTML report are kept on failure under `.data/e2e-artifacts/<suite>/`: set `E2E_SUITE` (a lowercase label) or `E2E_ARTIFACT_ROOT` so two suites write to sibling folders and can run side by side. A journey that needs a layout the shell does not have yet skips on that project with the task ID in the reason. At phone width the sidebar is an off-canvas drawer, so a journey that needs the account switcher uses `withAccountSwitcher` from `test/browser/layout.ts`, which opens the drawer when it is collapsed and closes it afterwards; the kill-switch journey now runs on both projects. `accessibility/touch-focus-motion.spec.ts` measures the real React shell on the desktop and phone projects: every control is at least 44px with text of at least 14px on the home, payment accounts and delegated access screens, keyboard focus is visible on the composer and on each of the first 14 Tab stops, and reduced motion stops every transition and animation. `accessibility/angular-touch-focus-motion.spec.ts` makes the same three measures on the built Angular shell, on both projects (`npm run build --workspace=apps/shell-angular` first), served on port 3001 against a stubbed local gateway so the layout is measured without Keycloak. Both specs add a motion canary: they first prove that motion exists, then that reduced motion stops it, so the check cannot pass only because a page has none. The live gateway checks each new token with Keycloak's introspection endpoint within 5 seconds; on a cold local Keycloak it can take 3 to 5 seconds, so the first signed-in call could return 401 once; the limit is now 8 seconds by default (`KEYCLOAK_INTROSPECTION_TIMEOUT_MS`). `operate-scenarios/console.spec.ts` starts a real isolated run and the scenario console beside it (real Keycloak sign-in for the operator and a resident) and drives the page on both projects: launch link, failpoints, export, the two-step reset, and a resident refused on every control route. The older `scripts/e2e` journeys still run as before.

## Fast signed-issuer suite

`test/support/test-issuer.ts` starts a test-only OIDC issuer on a loopback port so auth negatives run in `npm test` without Docker: `services/test/p210-test-issuer.test.ts` exercises the real `verifyJwt` and `ClientCredentials` against it, and `services/test/p210-delegation-exchange.test.ts` runs the broker's grant, runner, exchange, provider-authorization and kill-switch role checks through it. It is **not Keycloak evidence**. It does not model Keycloak policy, mappers or realm configuration, and the real-Keycloak suites (`npm run demo:verify:security` and the delegation checks) remain the release gate.

## Windows test notes

The offline suite runs on Windows, with these platform rules:

- Temporary directories are removed with `removeTemp` (`test/support/temp-cleanup.ts`). Windows keeps a SQLite file locked for a moment after its connection closes, so a refused removal is retried briefly and then left for the OS to clear. Cleanup never fails a test.
- Tests that need POSIX behaviour skip on Windows, with the reason printed: graceful `SIGTERM` drains (Windows cannot deliver `SIGTERM` to a child process), and POSIX owner-only file modes (Windows does not enforce them).
- The symlink check probes once. If the account cannot create symlinks (developer mode or elevation is needed), it skips with that reason; otherwise it runs in full.
- Tools launched from Node use the platform shim: `npm.cmd` through a shell on Windows (the SBOM generator and the isolated React build).
- The SBOM generator needs the workspace links in `node_modules`. If `npm sbom` reports a missing `@superapp/*` package, run `npm install` once to link the workspaces.

`npm test` on Windows reports the platform skips as skipped, not as passed. A run with no failures and only those skips is the expected result.
