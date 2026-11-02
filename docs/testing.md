# Focused agent verification

```bash
npm ci --ignore-scripts
npm rebuild better-sqlite3
npm run check:agent
npm run check
```

`check:agent` type-checks the agent and focused tests, then executes deterministic unit, HTTP/SQLite integration and restart tests. `check` also runs the existing repository gates and workspace builds. The existing vendored-skill assertion accepts both Python 3.12 and 3.14 argparse formatting; its optional pytest check is skipped if pytest is unavailable. Existing Docker/browser/device integration commands are separate and must not be inferred from offline test success.

| Test category | Executable evidence |
| --- | --- |
| Unit | `services/test/simple-agent.test.ts`: strict schemas, fixture intent/context routing, stable quote digest, configuration refusal, unavailable LLM, tool timeout/failure and idempotency precondition |
| HTTP + actual file-backed SQLite | `services/agent-core/test/orchestrator.integration.test.ts`: multi-turn list/pay, conditional routing, durable interrupt, approved payment, duplicate request/receipt, independent auth, cross-owner refusal, revocation, rejection/cancellation, expiry, changed quotes, invalid model plans, bounded execution, compatibility surface validation, SSE and credential exclusion from database tables |
| Vehicle renewal simulator | `services/agent-core/test/vehicle-renewal.test.ts`: per-caller vehicle list, permission and workload key, refusal while fines are outstanding, one effect and replay by the original key, consent and quote binding |
| Fines-then-renewal journey | `services/agent-core/test/renewal-journey.test.ts`: two approvals with one effect each, straight to renewal when no fines remain, declined renewal and refusal after paid fines as `partial`, revoked authority between approvals, refusal before any payment without the renew permission, lost renewal response recovered with the original key after reopening SQLite |
| Renewal adapter | `services/agent-core/test/vehicles-adapter.test.ts`: typed list and renew against the real HTTP simulator, `FINES_OUTSTANDING` kept as the refusal reason, per-tool permission, required idempotency key, a denied consent reported as a provider denial |
| Actual process restart | `services/agent-core/test/restart.test.ts`: spawn the real entry point, obtain approval, SIGKILL, restart on the same file, compare restored approval, approve, SIGKILL/restart again, replay the request and retain the same receipt |
| Lost-response reconciliation | Commit the actual simulator effect over HTTP, inject a lost reply, close/reopen the application database, recover with the original key and assert exactly one simulator payment |
| Browser fines adoption | `test/browser/focused-agent/fines.spec.ts`: actual React/agent HTTP requests, process restart on the same SQLite file, exact selected-fine review, duplicate/stale/cross-owner refusal, reject/cancel, lost-response recovery and database payment-row assertions |
| Pane controls | The same browser suite checks swap/read order, maximize/restore through the same icon, preserved drafts, automatic review reopening, labelled touch targets/focus, equal initial widths, mouse/touch/keyboard resizing, the main concierge width bounds and composer visibility; navigation/reload uses real local identity and APIs, while the main concierge layout check uses an explicitly stubbed compatibility gateway |

Run just the self-contained fines and pane journeys without Docker:

```bash
E2E_SUITE=focused-agent npm run test:browser -- focused-agent
```

The foldable cases use Chromium device metrics to expose two viewport segments in book and clamshell orientations, assert panes and composer stay outside the hinge, and return to an ordinary phone viewport. This is browser emulation, not physical foldable validation.

They start isolated Vite and real agent processes on ephemeral loopback ports with temporary SQLite files and explicit fixture planners. Desktop and phone projects use separate browser contexts and block external browser hosts. Screenshots, traces on failure and the report are saved under `.data/e2e-artifacts/focused-agent/`. No interactive data, local user token or OpenRouter key is used by this suite. The other browser suites still require their documented compatibility stack.

Default tests use a deterministic planner and isolated opaque-token test authority. They do not claim inference quality, actual government services, a real identity-provider integration for the new path or a financial payment. The SQLite saver and transaction engine are real, not database mocks. PostgreSQL testing is not required for the chosen embedded demo and no PostgreSQL runtime is included.

The official saver has a native `better-sqlite3` dependency. `npm rebuild better-sqlite3` is necessary after an installation using `--ignore-scripts`; on platforms without a prebuilt binary, a local compiler toolchain is needed. Mirror dependencies and image/native artifacts before air-gapped installation; normal runtime needs no hosted service.

Container/Compose, Kubernetes/OpenShift, live-provider inference and Angular/Flutter adoption remain distinct verification boundaries. The React fines browser suite qualifies that route; it does not qualify every retained shell journey or real identity-provider behavior.

Execution results for the implementation milestone belong in the dated [evidence report](reports/2026-10-26-simple-agent.md).

`services/test/receipt-contracts.test.ts` also checks that already-paid utility and telecom bills reject mismatched reviewed amounts without issuing another payment, and retain the receipt for matching amounts. Provider calls in that test are mocked.

`services/test/provider-response-limit.test.ts` checks that provider-supplied rejection text is not copied into application errors while the rejection status and code remain available. Only codes in the fixed simulator rejection catalog pass through; unknown codes become `PROVIDER_REJECTED` in both errors and connection records.

`services/test/provider-response-limit.test.ts` also checks contradictory, timed-out and unclassified application provider replies remain unknown for writes, while an explicit client rejection retains its status and code.

`services/test/provider-redirect.test.ts` also rejects traversal outside the chosen account, checks no request was sent, and preserves a normal encoded payable path and account bootstrap.

`services/test/provider-redirect.test.ts` uses a loopback provider to verify that application-client reads and writes refuse redirects and that a redirected write remains unknown.

`services/test/domain-response-limit.test.ts` sends oversized streamed HTTP domain responses and checks that the client cancels them early, reports a read failure and keeps a write outcome unknown. The application provider client uses the same limit; `services/test/provider-response-limit.test.ts` covers oversized, malformed and non-object replies, including unknown write outcomes. Other outbound clients are not covered.

`services/test/domain-redirect.test.ts` also checks that malformed domain paths cannot override the configured service origin, issue a request or record a mutation step; an ordinary root-relative path remains usable.

`services/test/domain-redirect.test.ts` uses a loopback HTTP server to verify that redirected authenticated domain reads and writes never reach the redirect target, and that a redirected write remains unknown.

`services/test/domain-telecom-receipt.test.ts` sends missing, malformed and wrong-bill receipts through the authenticated telecom adapter for both supported providers and verifies they remain unknown; a complete receipt for the selected bill is accepted. The same test compares receipts with a supplied reviewed amount in exact fils and rejects a one-fil difference and overflow-sized receipt. This checks the response boundary, not real provider settlement.

`services/agent-core/test/process-commit-recovery.test.ts` uses a local proxy to hold the simulator reply after a payment or renewal commits, kills the real agent process, and verifies that restart blocks a replacement and recovers the original operation once. It does not prove distributed failover or real-provider behavior.

`services/agent-core/test/thread-quotas.test.ts` exercises resident and global active-conversation limits, concurrent admission, slot release and the slot retained by an expired unresolved conversation. It also checks creation-rate limits across cancellation and SQLite reopen, expiration of rate events, resident isolation and concurrent global admission. It does not test distributed quotas or long-term storage retention.

`services/agent-core/test/slow-upload.test.ts` uses loopback HTTP and a shortened test deadline to check that continuously trickled request bodies time out, oversized bodies receive a 413, and neither starts creation, cancellation, recovery or a message transition. It also checks empty bodies and a later valid original-operation recovery. This is not a connection-flood or proxy test.

`services/agent-core/test/upload-authority.test.ts` changes a test identity's expiry, subject or permission between the start and end of an upload. It checks that conversation creation, cancellation, message processing and both simulator writes are denied before their actions. It does not establish real identity-provider revocation behavior.

`services/agent-core/test/renewal-journey.test.ts` checks that a planner cannot invent or substitute a vehicle, that ambiguous and unavailable selections do not produce an approval, and that a named owned vehicle appears in the reviewed quote. `model-failures.test.ts` checks that the compatible model request omits the exact vehicle reference.

`services/agent-core/test/fine-selection.test.ts` checks invented, omitted and unavailable fine references, immediate follow-ups and intervening requests. It approves a simulated selected-fine quote and verifies that another fine remains outstanding.

`services/agent-core/test/disconnect-before-dispatch.test.ts` closes loopback connections during controlled authentication and checks that creation, cancellation, message and direct simulator payment do not start. It also closes a connection after a simulated payment commits, then verifies completion, replay and a single effect. It does not cover proxy behavior or cancellation of already-running graph work.

`services/agent-core/test/message-quotas.test.ts` seeds admitted message records to exercise the boundary, competing requests, resident isolation and SQLite reopen. It also verifies replay, approval and unknown-payment recovery at the limit. It does not establish a bound on non-message requests or historical storage.

`services/agent-core/test/recovery-rate.test.ts` seeds recovery events and exercises the rate boundary, ordinary and streamed errors, the cross-origin retry header, request-key conflict and replay, resident isolation, SQLite reopen and original-operation recovery after the window. It is not a global flood test.

`services/agent-core/test/request-concurrency.test.ts` uses reduced test limits and a controlled authenticator to saturate each focused HTTP pool. It checks busy responses, health access, workload-key separation, a simulator payment under public saturation, slot release and a disconnected request whose authentication remains active. It does not cover pre-header socket floods or distributed capacity.

`services/agent-core/test/tool-deadline.test.ts` checks the deadline against a tool that ignores cancellation and an abort-triggered refusal. It also holds a response after a simulated payment commits, verifies the unknown outcome blocks replacement, then recovers the original key with one effect. It does not prove that noncooperative work is terminated.

`services/agent-core/test/tool-error-redaction.test.ts` injects synthetic sensitive text into unrecognized payment and renewal tool errors, checks replies and SQLite rows for that text, and verifies that the unresolved operation blocks replacement.

`services/test/jwt-lifecycle.test.ts` also advances a controlled clock during signing-key retrieval and online introspection, checking that the shared verifier rejects tokens that expire during either wait and accepts a still-valid control. This does not replace real identity-provider lifecycle testing.

The same suite signs tokens with separate 1,024-bit and 2,048-bit RSA keys from one mocked key set, requiring rejection of the weak key and acceptance of the valid one.

`services/test/oauth-redirect.test.ts` runs two loopback servers and verifies that common token-endpoint redirects are rejected without contacting the second server. A direct token response remains accepted; this does not test production egress policy.

`services/test/oauth-response.test.ts` exercises oversized and malformed token responses, invalid token values and lifetimes, cache recovery and uncooperative body cancellation. The local test issuer still exercises successful service-token issuance; production identity-provider compatibility requires separate verification.

`services/agent-core/test/thread-expiry-recovery.test.ts` expires conversations after a simulated effect and lost response, reopens SQLite and verifies that only the owner’s linked unresolved conversation is extended. It also covers saved legacy approvals and refusal to guess when the evidence is absent.

`services/agent-core/test/cross-thread-recovery.test.ts` covers pending and unknown writes across conversations, same and different quotes, renewal, read-only access, subject isolation, reopening SQLite, and unambiguous or ambiguous legacy ownership. This is local single-process evidence, not distributed failover proof.

Focused payment and renewal recovery tests simulate a lost response after commit, expire stored consent, close and reopen the SQLite-backed harness, and revoke permission. They require the outcome to remain unknown and replacement blocked, then restore the test authority and recover the original operation without a second effect. The reopen is in-process; it does not prove a crash, real identity or production authority renewal.

The focused renewal journey substitutes an unrecognized simulator 403 or 409 after a simulated renewal commits, then checks that the outcome is unknown, replacement is blocked and recovery returns the original operation. The adapter tests retain explicit consent and stale-quote refusals.

The retained domain and provider response tests cover codes for unknown, unconfirmed and reconciliation-required outcomes. `services/test/domain-failures.test.ts` also verifies that an unknown settlement after a wallet effect blocks later effects and replacement.

`services/test/domain-ambiguous-responses.test.ts` exercises local and authenticated HTTP adapters against uncertain, contradictory, empty and timeout mutation responses as well as an explicit rejection. `services/test/domain-failures.test.ts` also proves an uncertain result after a wallet effect stops the composite and blocks replacement pending reconciliation.

The Flutter event stream regression also forces an envelope handler to fail: it must reconnect from the last successfully handled event, replay the failed event and deliver subsequent events in order. Unreadable and foreign events remain deliberately skipped.

`test/browser/failures/stale-action.spec.ts` (and the Flutter `surface_stale_action_test.dart`) replay the gateway's `STALE_SURFACE` answer and require the reason, the current surface and exactly one action sent. `test/browser/failures/unreadable-surface.spec.ts` replaces the gateway's answer with an unreadable surface and requires the Angular and React shells to say it could not be read or shown, keep the composer usable and not blame the connection; `services/test/p112-action-schemas.test.ts` requires every action a surface advertises to have a payload schema at the gateway edge. `services/test/p112-stream-poison.test.ts` and the Flutter event stream test send a live stream an unreadable event between good ones and require the client to skip it, move its cursor past it and deliver the others once each. `services/test/p112-renderer-coverage.test.ts` requires each shell's renderer to draw every component type the protocol advertises and to name an unknown one, and the Flutter widget tests send unreadable surfaces to the shell and require it to refuse them without drawing them or blaming the connection.

Request contracts are checked offline in two ways. `services/test/protocol-fuzz.test.ts` fuzzes the surface and message validators, and `services/test/p114-hostile-input.test.ts` sends an array, a prototype-pollution key, an oversized string, an unknown field, a null and a deeply nested value to every application operation that has a request contract, in the body and in the query, and requires a 400, no throw and untouched input (with a positive control that a valid request is still accepted); the same proof covers every gateway request contract. `services/test/p114-mutation-coverage.test.ts` requires every mutating application operation to be called by a behavior test or verifier. `services/test/p114-client-mapping.test.ts` requires every gateway path the clients call, including each payment call the React shell makes, to have a gateway request contract.
`services/test/p114-tool-mapping.test.ts` pins that every tool a service advertises has a validated request schema and advertises exactly that schema. Against the running stack, `npm run demo:verify:contract` checks that every documented operation refuses a request with no token using the documented error shape, every write that needs no resource id refuses an invalid body with a documented 400, every read that documents a 404 returns it for an unknown resource, and every parameter-free read, and every telecom read for each of Etisalat and du, returns the keys the OpenAPI document requires. Add `--writes` and run it on a fresh disposable stack (`npm run qualify -- down`, `npm run qualify -- up`, then `npm run qualify -- run -- node --experimental-strip-types scripts/verify-application-contract.ts --writes`) and it also makes one valid write to each of the 17 mutating operations and checks the documented keys; it changes balances and uses up the resident's fines, bills and recharge target, so it never runs on the shared stack and runs once per fresh stack.

## Cross-shell verification

`npm run check:shell-contracts` checks generated Flutter catalogs, PKCE bridge, provider-status vectors and the shared request deadline against TypeScript sources. Backend policy regressions cover shared model minimization/budgets, exact fine selection, response bounds and CORS without widening authority. `services/test/demo-renewal-identity.test.ts` verifies optional renewal enrollment preserves existing identities and configuration.

With Flutter 3.47+ and Dart 3.13+ installed, run `flutter analyze` and `flutter test` from `apps/shell-flutter`, then `npm run build:flutter` at the root. The build disables remote engine resources and localizes the engine font fallback; fonts and licenses are bundled. Flutter is a separate toolchain and is not implied by the npm workspace build.

After building Angular and Flutter and starting the compatibility Compose stack, run `npm run test:browser -- parity`. These suites check web PKCE, provider labels, Angular pane/fold behavior, focused payments and separate fines/renewal approvals across all three shells on desktop and phone. The focused business paths use isolated temporary SQLite files and test personas; compatibility Keycloak login uses the local demo realm. Flutter widget tests separately exercise hinge bounds, resize/swap/restore, phone drafts, client validation and server binding precedence. This qualifies these shared web journeys, not every specialized React payment-account panel or native device behavior.

The focused `model-failures.test.ts` suite uses controlled compatible responses and real loopback HTTP stalls to cover malformed JSON, invented plans, unsupported finish reasons, reported output-budget overruns, oversized bodies and deadlines before headers and during body consumption. Its deadline tests warm the local connection, allow scheduling headroom and require the stalled connection to close; an independent watchdog fails a hung deadline. An actual graph/SQLite regression asserts that a truncated response produces `model_unavailable` without consent, seeded business reads or effects. No fixture fallback or automatic model retry is permitted.

## Selected-planner qualification

`npm run agent:qualify:model` uses the explicitly configured compatible planner in private `.env.agent`; fixture planners are refused. It evaluates the versioned synthetic gold cases in `scripts/agent-evaluation.ts`, with balanced English/Arabic coverage of listing, negated payment, payment review, exact fine references, clarification, unsupported services, registration renewal and multi-turn follow-ups. Each case requires the expected intent and exact selection, every call must finish within 15 seconds and the nearest-rank p95 must be at most 8 seconds. Thresholds are declared before execution. A small finite corpus does not establish general language quality or production safety.

After the quality gate passes, the same real planner runs through an actual HTTP/LangGraph/SQLite harness: read-only list, selected-fine approval, refusal of typed assent/wrong approval/cross-owner inspection, one simulated payment and replay, then an Arabic renewal with separate fines and renewal approvals. All simulated effects use disposable temporary state, random test credentials and scoped synthetic personas; interactive demo data is never opened or cleared. The authority runner has separate deterministic tests, which qualify its assertions rather than model quality.

The runner writes unique private JSON artifacts under ignored `.data/model-evaluation/`, recording revision/dirty state, source/corpus/tool hashes, model/configured limits, safe case results, locale totals, latency and authority results. It does not store endpoint URLs, credentials, raw replies or provider errors. A transport/invalid-plan error stops immediately without retry, failover or fallback and makes qualification fail. Failed calls are excluded from model latency measurements; unscored and unrun cases remain explicit. A failed run cannot overwrite previous artifacts. The ordinary per-owner model budgets still apply. Use the emitted artifact for a milestone report only after the actual target has passing evidence.

Local llama-server qualification uses `AGENT_LLM_PROVIDER=local`, the server's advertised model ID and its loopback `/v1/` endpoint. This mode uses the shared plan schema and disables reasoning for bounded planning; it retains strict validation and failure behavior. The configuration regression proves that lookalike/remote local endpoints are refused and hosted environment keys are not inherited. Live runs use the same versioned corpus, accuracy and latency thresholds for every provider.

Time-dependent invoice-automation tests freeze `Date` to a declared instant before constructing providers. This keeps seeded month-end invoices outside a fixture's due window while exercising current-invoice selection, cooldown, caps and source expiry with unchanged runtime policy. Test cases that need another instant should advance the test clock explicitly.

The [local selected-planner milestone](reports/2026-10-28-local-planner.md) records actual clean-revision execution, model-weight provenance, declared thresholds and finite-corpus limits. Other providers and changed model/prompt versions require their own evidence.
