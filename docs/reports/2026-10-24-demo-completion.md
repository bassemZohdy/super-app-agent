# Local demo implementation and verification — 24 October 2026

## Scope and source

The selected delivery target is a **local demo**, without a production hosting target or actual agency/payment contracts. [ADR-0011](../adr/ADR-0011-local-demo-target.md) records the decision. The implementation builds on `057141339fe3caa03995e75905cb20762b6ce846`. Its code, tests and documentation are versioned together with this report. Use `git log -1 --format=%H -- docs/reports/2026-10-24-demo-completion.md` to identify the publication commit. Public deployment and GitHub workflow activation are outside this delivery.

This report supersedes the current-status interpretation of the [23 October reconciliation](2026-10-23-demo-reconciliation.md); that report and earlier recordings remain historical evidence. All identity profiles, funds, providers, orders and city records are synthetic.

## Delivered behavior

- Real LangGraph 1.5.2 prepare/review/execute graph and Redis-backed root checkpoint saver, persisted approval interrupt, ordinary restart resume, and continuation cleanup on replacement/cancellation/completion.
- Official authenticated MCP SDK transport at core `/mcp`, initialization/discovery/tool calls, authoritative schemas and guarded core invocation. Reference clients prove success, denied tampering/replay, missing identity and hostile origin. A real local Keycloak access token also invokes a tool.
- Eleven model-independent bundled service routes, primary React `/services/{id}` navigation, explicit catalog trust/compatibility and no remote JavaScript loading or manifest device grants.
- Subject/account/revision-bound approval ID, five-minute expiry, canonical surface digest and exact offered-field/choice matching. Pending cancellation removes the action/continuation; a bounded lifecycle history is available in owned session data.
- Shared access-token verification, finite bounded claims, ID-token rejection, bounded issuer-scoped JWKS cache, rotation cooldown/deduplication and authenticated online introspection. Real Keycloak logout invalidates a still-unexpired access token on the next request.
- Byte-based HTTP limits, media-type and malformed-input errors, read deadlines and per-process admission budgets across core/application/provider servers.
- Dart authenticated SSE parsing/replay/reset/reconnect/reauthentication/lifecycle cleanup, phone/desktop account widgets and web bootstrap/build.
- Correct unknown booking/order rejection and actual receipt IDs; derived parking values and removal of misleading payment controls/provider claims.
- OpenRouter official HTTPS/zero-priced routing, context/output/time limits and per-actor request quotas; optional remote TTS defaults off. The environment key is private in ignored `.env`, mode 0600, and verified to propagate to core without printing it.
- Executable ESLint correctness checks, local documentation-link checks, tracked/unignored source-secret checks and a combined verification command. Unused core dependencies were removed and SDK dependencies assigned to their actual importing workspace.

## Executed gates

Environment: macOS, host Node 26.3.0/npm 11.16.0; reference Node container 24.21.0, Docker 29.6.2, Keycloak 26.6.4, Redis 8.2; Flutter 3.47.5/Dart 3.13.4.

| Gate | Result / boundary |
| --- | --- |
| `npm run check` | Pass: ESLint, local links in 38 Markdown documents, source secret patterns, 114/114 Node tests, all 17 workspace builds |
| `npm run demo:verify:manual` | Pass: all eleven integrated routes, cancellation replay denial, official MCP client with real local Keycloak access token |
| `npm run demo:verify:security` | Pass: valid access token, ID token rejected, same access token rejected immediately after logout on a new request |
| `npm run demo:verify` | Pass: two users, accounts/ownership, provider roles, payment capture/replay/conflict/decline/refund, telecom, stale UI action denial |
| `npm run test:redis` | Pass: two clients, ownership/account isolation, fencing, persistence, empty arrays, pub/sub and replay |
| `npm run demo:verify:restart` | Pass: prepare, actual core/Redis/payment container restarts, readiness, same approval thread/revision and wallet, one resumed top-up |
| `npm run demo:verify:journeys` | Pass: simulated RTA/DEWA/telecom/fines/unified/move-in boundaries |
| `flutter analyze` / `flutter test` | Pass: no analyzer issues; five tests covering phone/desktop account/history and SSE parsing/reset/reconnect/reauthentication |
| `flutter build web` | Pass: web artifact built; tool emitted an optional Cupertino font-family warning. Native/device execution is unverified |
| React browser | Final cancellation reply and disabled-action removal verified; [checked-in screenshot](../assets/demo/approval-cancelled.png). Manual Payments route opened `/services/wallet` without chat; service surface appeared; cancellation removed its action and showed cancellation. Existing PKCE/account/history checks are in the previous report |
| `npm run demo:check:openrouter` | Public catalog HTTP 200; configured key authentication HTTP **401**. Container adapter completion probe also returned 401. No successful live generation is claimed |
| `npm audit --json` | **51 findings:** 2 critical, 27 high, 15 moderate, 7 low. Predominantly the retained Angular 18/build dependency tree; major toolchain upgrades require a separately validated migration. Audit is not a passing release gate |

Local HTTP tests initially failed under sandbox `listen EPERM`; they were rerun with local listening allowed. A stale health-identifier assertion was updated for the real graph runtime. The restart command originally required manual preparation; it now orchestrates the complete sequence with an isolated temporary record and cleanup. These failures were corrected, not counted as passing evidence.

## Publication cleanup

The publication pass reconciles the current guides, fixes the ADR index table, includes portable browser evidence, removes redundant endpoint checks and shares typed action discovery between the approval and graph layers. Historical reports and recordings retain their original evidence. Private `.env` values, SQLite data, generated builds and local caches remain ignored and are not published.

Publication checks passed: `npm run check` (114 Node tests, 17 workspace builds, ESLint, 38-document link and source-secret checks), Flutter format/analyzer/five tests, and all authenticated demo/manual/security/provider/Redis/restart checks. OpenRouter's recorded 401 and dependency advisories remain explicit limitations, not passing gates.

## Original TODO disposition

“Partial” preserves the original unchecked acceptance criteria. “Deferred” is a demo scope decision, not an implementation claim.

| Original tasks | Demo disposition and remaining work |
| --- | --- |
| P0-01 / P0-02 | Browser PKCE and all-client bearer stream foundations delivered; Flutter password login remains demo-only. Native PKCE/device/proxy and complete interruption conformance remain partial |
| P0-03 | User/service/account/resource checks delivered in integrated mode; production tenancy/token exchange/delegation deferred |
| P0-04 / P1-10 | Expiring exact proposal binding, cancellation and bounded history delivered; provider quote attestation, long-lived scoped grants and immutable audit deferred |
| P0-05 / P1-03 | Redis ownership and real LangGraph interrupt/restart recovery delivered; global quotas, crash/failover semantics, migrations and model-selected planning remain partial |
| P0-06 / P1-04 | Persistent simulated capture/idempotency/proof checks and truthful partial outcomes delivered; scheduled workflows, outbox/status recovery, compensation and real PSP deferred |
| P0-07 / P0-08 | Reference Compose readiness and authenticated/restart gates delivered; clean-image/non-root release and native/production certification remain open |
| P0-09 / P0-10 / P0-12 | Original input/money, transition/revision and truthful-failure scopes remain implemented, with additional regression coverage |
| P0-11 / P0-13 | HTTP/JWKS/claim/introspection bounds and negative tests delivered; distributed quotas, soak/chaos and broader real-key rotation operations remain partial |
| P0-14 | Official model egress/size controls and source-secret checks delivered; production data minimization/consent/encryption/tamper-evident audit deferred |
| P1-01 / P1-02 / P1-14 | Versioned catalog and real REST/schema boundaries retained; protocol budgets/events and truthful tracking strengthened. Complete telecom/catalog/output typing and full UI semantics remain partial |
| P1-05 | Free-provider and request/context bounds delivered; successful live inference/evaluation blocked by rejected key. Distributed spend accounting and model-selected planning evaluation remain open |
| P1-06 | Custom compatibility protocol retained; official AG-UI/A2UI and shared Lit renderer deferred, not renamed or claimed compliant |
| P1-07 | Demo acceptance delivered: real authenticated MCP and independent clients. A2A deferred because no remote-agent requirement is selected |
| P1-08 | agentgateway remains unvalidated; direct HTTP/OpenRouter is the selected demo path. No gateway policy/traffic claim |
| P1-09 / P1-11 | Bundled primary React manual routes delivered; remote loader/signatures/rollout and separate legacy mount-module execution deferred. Angular/Flutter manual navigation parity remains open |
| P1-12 / P1-13 | Account/restore/action and resource correctness improved; exhaustive component/form/lifecycle and semantic conformance remain partial |
| P1-15 | Demo target decision complete in ADR-0011; public hosting, actual agency/UAE PASS/PSP and air-gap profile are not selected |
| P1-16 / P2-01 | Browser voice drafts/replies and responsive demo retained; full Arabic/RTL, accessibility and native speech/device parity remain open |
| P2-02 | Readiness/recovery checks and failure summaries delivered; structured operational telemetry, load/soak and backup/restore runbooks remain open |
| P2-03 | Dependency and source-secret findings recorded; major dependency migration, SBOM/signing/image/provenance release gates remain open. Disabled workflows remain disabled |
| P2-04 / P2-05 / P2-06 | Current guides/ADRs/TODO reconciled, real ESLint/docs/secrets gates, pinned new SDKs, Flutter lock/bootstrap and restart orchestration delivered. Full API onboarding, unsafe-any cleanup, clean images/offline packaging and lifecycle parity remain partial |

The complete original TODO is **not** finished. The delivered local demo has executable evidence; remaining demo capabilities and broader production requirements stay visible in [TODO](../../TODO.md). A working simulated payment or a green build does not certify the corresponding real-world integration.
