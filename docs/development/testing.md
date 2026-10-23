# Testing and verification

## Commands

```bash
npm test
npm run build -- --concurrency=2
npm run demo:up
npm run test:redis
npm run demo:verify
npm run demo:verify:journeys
```

`npm test` uses explicit fixture/demo identity, disables live model calls, and requires no Docker. Some tests bind local HTTP servers to verify signed JWTs and actual SSE requests. Restricted sandboxes must allow local listening. It includes the provider tests and validates every generated OpenAPI 3.1 document against its runtime source.

`npm run test:redis` is a separate integration test against `TEST_REDIS_URL` or localhost:6379. It uses a random key prefix, cleans up only its own keys, verifies cross-client ownership/account rejection, leases, fenced saves, transcript/surface persistence, empty JSON arrays, pub/sub and replay.

`npm run demo:verify` requires the running reference stack. It authenticates the two seeded users through real local Keycloak, obtains real client-credential tokens, calls both REST boundaries, checks account/session denial, payment capture/replay/conflict/decline/refund, wrong-service denial, telecom calls, and stale UI action rejection. All money and entity records are simulated.

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
| Flutter | source changes | SDK/native run and PKCE/SSE parity unverified |
| OpenRouter | controlled-response regression tests, visible network errors | latest real HTTPS call failed; key validity/live generation not proven |

Current executed results are recorded in [the provider demo report](../reports/2026-10-23-provider-demo.md). Earlier release reports and videos describe their dated fixture baselines and must not be used as evidence of current provider, identity or production guarantees. `npm run lint` still has no meaningful workspace lint tasks; it is not a quality/security gate.
