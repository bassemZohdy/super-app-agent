# Testing and verification

## Scope

Tests in `packages/protocol-core/test`, `services/test`, and `test` exercise the **simulation**. A passing suite is **not evidence of government integrations, Keycloak production configuration, MCP/A2A interoperability, model-driven planning or distributed transaction safety**.

## Commands

```bash
npm install
npm test
npm run build
# Optional historical scenario generator:
npm run test:record
```

The `test` script imports `scripts/test-env.ts`, forcing `DEMO_AUTH=true`, `NODE_ENV=test` and disabled OpenRouter calls. Real Keycloak identities and remote domain-service auth are *not* exercised by the default suite. The stream HTTP regression test temporarily disables demo auth and uses locally signed JWTs with a mocked JWKS fetch. It proves handler behavior, not real Keycloak compatibility. The build type-checks Node/protocol/mini-app source without emission and bundles React/Angular; Node still executes TypeScript source. Flutter is outside the npm build.

## Test groups

| Source | Focus |
| --- | --- |
| `packages/protocol-core/test/protocol.test.ts` | Custom surface/message shape validation |
| `services/test/agent-core.test.ts` | Routing and interactive surface actions |
| `services/test/microservices.test.ts` | Simulated endpoint behavior |
| `services/test/service-profile.test.ts` | Profile fixture and preferences |
| `services/test/security.test.ts` | RSA-signed token verification, claims, session ownership and action allowlist |
| `services/test/event-stream.test.ts` | Real HTTP bearer/session/origin/replay/expiry checks; backpressure, client parser and reconnect tests |
| `services/test/capabilities.test.ts` | 32 discovery contracts, JSON Schema compilation, simulator response validation and risk/consent metadata |
| `services/test/openrouter.test.ts` | Free inference default, mock fallback and paid-model guard |
| `test/e2e-workflow.test.ts` | Simulated composite journey |
| `test/e2e-life-scenarios.test.ts` | Historical civic/consumer scenarios on mock services |

## Verification matrix

| Capability | Source-level evidence | Independent verification needed |
| --- | --- | --- |
| Signed tokens | `auth.ts` RS256 verify using JWKS | Real Keycloak issuer/audience, key rotation, clock skew and PKCE |
| Session isolation | Subject-bound in-memory map | Multi-node/restart isolation, TTL, revocation and load testing |
| UI action guard | Current-surface bindings and selected values | Replay races, malicious clients, domain authorization and user consent |
| Event stream | Passing signed-token HTTP tests; bounded replay, expiry, backpressure; shared web fetch client | Real browser smoke, Flutter parity, durable replay and multi-instance tests |
| Models | Free-router default and no-cost mock | Real model capability, prompt injection, token budget, provider limits |
| Frontend | React/Angular/Flutter demos | Build each shell, accessibility, renderer parity, cross-device navigation |
| Gateway | YAML configuration | Pin image + validate supported config, actual MCP/A2A/LLM traffic |
| Transactions | Simulated wallet/services | Durable idempotency, consistency, audit, compensation/reconciliation |

## Manual smoke test

1. Run backend and React shell with `DEMO_AUTH=true`.
2. Request a wallet balance, parking options and a composite task; inspect rendered custom surfaces.
3. Click a displayed action once; expect an updated UI. Repeat immediately; expect duplicate submission rejection (HTTP 409 if using API).
4. With an invalid token, expect 401; with another valid user trying to reuse the same session, expect 403 (covered in token-based unit test).
5. Verify no API key or JWT is included in URLs, source control or server progress logs.

## Isolated real Keycloak gate

```bash
npm run test:keycloak
```

Requires a running Docker daemon and access to `quay.io/keycloak/keycloak:24.0.5` (matching the repository demo, not a production version recommendation). The runner creates a disposable realm with two confidential service-account clients, generated secrets and an `agent-core` audience mapper. It binds Keycloak on loopback, waits for discovery, runs `test/integration/keycloak.test.ts`, removes the container and deletes generated files. No demo realm/users, stored credentials or model calls are used.

The integration checks real token issuance/JWKS, authenticated intent/SSE, rejection of demo tokens and cross-subject session isolation. It does **not** validate end-user PKCE, UI login, rotation/revocation, delegation or tenant/resource authorization. Missing Docker fails the command; it is not silently skipped. No GitHub Actions workflows are added or enabled.

**Latest status:** 49 tests and all 14 workspace builds passed; browser download failed, Docker is unavailable, Flutter was not run. See [dated evidence](../reports/2026-10-23-release-gates.md).

