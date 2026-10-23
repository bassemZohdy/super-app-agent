# Testing and verification

## Commands

```bash
npm run check # ESLint, Markdown links, tracked-source secrets, tests, 17 builds
npm run demo:up         # includes readiness polling
npm run demo:wait       # check endpoints of an already running stack
npm run test:redis
npm run demo:verify
npm run demo:verify:journeys
npm run demo:verify:manual
npm run demo:verify:security
npm run demo:verify:restart
npm run demo:check:openrouter
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
| OpenRouter | real HTTPS request reached the API; configured key rejected with 401; controlled reply/error tests pass | successful generation needs a valid private key; neural TTS remains unverified |

Current executed results are recorded in [the current validation report](../reports/2026-10-24-demo-completion.md). Earlier release reports and videos describe their dated fixture baselines and must not be used as evidence of current provider, identity or production guarantees. `npm run lint` now executes ESLint correctness rules over TypeScript/JavaScript source. The docs gate checks local Markdown links; the secret gate scans tracked/unignored source for OpenRouter keys and private keys without printing values. These targeted checks are not comprehensive security certification.

`demo:verify:restart` now orchestrates preparation, core/Redis/payment container restarts, readiness, approval resume and its own temporary-record cleanup. Run it without simultaneous wallet-changing tests. The manual verifier covers all eleven integrated routes, cancellation replay denial and a real-Keycloak MCP call. The security verifier proves ID-token rejection and immediate access-token denial after logout on a new request. Existing streams are bounded by expiry, not continuously introspected.
