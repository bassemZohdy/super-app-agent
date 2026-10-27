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

## Cross-shell verification

`npm run check:shell-contracts` checks generated Flutter catalogs, PKCE bridge, provider-status vectors and the shared request deadline against TypeScript sources. Backend policy regressions cover shared model minimization/budgets, exact fine selection, response bounds and CORS without widening authority. `services/test/demo-renewal-identity.test.ts` verifies optional renewal enrollment preserves existing identities and configuration.

With Flutter 3.47+ and Dart 3.13+ installed, run `flutter analyze` and `flutter test` from `apps/shell-flutter`, then `npm run build:flutter` at the root. The build disables remote engine resources and localizes the engine font fallback; fonts and licenses are bundled. Flutter is a separate toolchain and is not implied by the npm workspace build.

After building Angular and Flutter and starting the compatibility Compose stack, run `npm run test:browser -- parity`. These suites check web PKCE, provider labels, Angular pane/fold behavior, focused payments and separate fines/renewal approvals across all three shells on desktop and phone. The focused business paths use isolated temporary SQLite files and test personas; compatibility Keycloak login uses the local demo realm. Flutter widget tests separately exercise hinge bounds, resize/swap/restore, phone drafts, client validation and server binding precedence. This qualifies these shared web journeys, not every specialized React payment-account panel or native device behavior.

The focused `model-failures.test.ts` suite uses controlled compatible responses and real loopback HTTP stalls to cover malformed JSON, invented plans, unsupported finish reasons, reported output-budget overruns, oversized bodies and deadlines before headers and during body consumption. An actual graph/SQLite regression asserts that a truncated response produces `model_unavailable` without consent, seeded business reads or effects. No fixture fallback or automatic model retry is permitted.
