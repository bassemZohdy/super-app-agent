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

The `test` script imports `scripts/test-env.ts`, forcing `DEMO_AUTH=true`, `NODE_ENV=test` and disabled OpenRouter calls. Real user identity and remote service auth are *not* exercised by these tests. The build is a separate command and may require additional toolchain/build configuration.

## Test groups

| Source | Focus |
| --- | --- |
| `packages/protocol-core/test/protocol.test.ts` | Custom surface/message shape validation |
| `services/test/agent-core.test.ts` | Routing and interactive surface actions |
| `services/test/microservices.test.ts` | Simulated endpoint behavior |
| `services/test/service-profile.test.ts` | Profile fixture and preferences |
| `services/test/security.test.ts` | RSA-signed token verification, claims, session ownership and action allowlist |
| `services/test/openrouter.test.ts` | Free inference default, mock fallback and paid-model guard |
| `test/e2e-workflow.test.ts` | Simulated composite journey |
| `test/e2e-life-scenarios.test.ts` | Historical civic/consumer scenarios on mock services |

## Verification matrix

| Capability | Source-level evidence | Independent verification needed |
| --- | --- | --- |
| Signed tokens | `auth.ts` RS256 verify using JWKS | Real Keycloak issuer/audience, key rotation, clock skew and PKCE |
| Session isolation | Subject-bound in-memory map | Multi-node/restart isolation, TTL, revocation and load testing |
| UI action guard | Current-surface bindings and selected values | Replay races, malicious clients, domain authorization and user consent |
| Event stream | HTTP SSE with heartbeat/listener Set | Authenticated streams, replay, device reconnection, backpressure |
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

**Status:** This doc refresh verified source contracts and command definitions. It did not run the suite or browsers. Record actual CI/runtime results separately before calling a release verified.
