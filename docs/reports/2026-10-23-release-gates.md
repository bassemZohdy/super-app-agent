# Release-gate execution — 23 October 2026

Base: documentation PR #2 (`19347827d77895d8f5bf32cfddf9a950b8263484`), itself based on main after PR #1. This implementation is stacked on that unmerged documentation branch.

Environment: Linux x64, Node **24.19.0**, npm **11.9.0**. No live model key/provider used; no GitHub Actions workflow added or enabled. All domain data is simulated. Results validate this prototype scope, not production readiness.

| Command / target | Actual result | Evidence / limitation |
| --- | --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS | Locked dependencies install cleanly; lifecycle scripts deliberately disabled; this is not a vulnerability scan |
| `npm test` | PASS — 49/49; no skips | [Full output](2026-10-23-tests.txt); includes signed JWT HTTP/SSE with mocked JWKS, client reconnect/parser/backpressure, 32 catalog contracts and previous journeys |
| `npm run build -- --force` | PASS — 14/14 tasks; zero cache hits | [Full output](2026-10-23-build.txt); Node/protocol/mini-app type checks without emission, React/Angular bundles; Flutter excluded |
| `npm run test:keycloak` | BLOCKED / exits 1 | [Output](2026-10-23-keycloak.txt); no Docker executable/daemon; runner and real-issuer test added but actual Keycloak execution is unverified |
| `npx playwright install chromium` | FAIL — browser unavailable | Download yielded an invalid/truncated ZIP; no visual smoke was executed |
| Flutter native/web | NOT RUN | Flutter SDK unavailable; not part of npm build |

## What changed

- P1-01 discovery is implemented and verified against simulators: 32 stable IDs with owners, versions, input/output schemas, mutation/risk and consent metadata. Contract tests compile all schemas and validate their example requests and actual response envelopes. Nested output objects are intentionally extensible. Registry metadata is not yet enforced during execution.
- P0-02 backend/web stream handles signed bearer auth, session ownership, Origin rejection, replay/reset, snapshot recovery, token-expiry disconnect, backpressure and client abort/reconnect. Replay is bounded and process-local. Browser shells still use the demo token getter; native Flutter replay and real OIDC lifecycle remain open.
- P0-08 baseline initially failed (41/42 tests; build could not resolve package manager). Fixed the missing build configuration/workspace metadata, TS crypto types and HTTP JSON response argument bug. The personalization scenario now opens the profile surface before invoking its advertised update action; the action authorization guard was preserved.

## Reproduce the remaining gates

On a Docker-equipped host, run `npm run test:keycloak`. It creates an isolated realm with two generated confidential service-account identities and audience mapping, verifies HTTP/SSE and cross-subject isolation, and removes temporary resources. It does not cover end-user PKCE, revocation/rotation or domain authorization.

For visual smoke, install Chromium (`npx playwright install chromium`), run the local backend with `DEMO_AUTH=true`, launch React and follow [the manual smoke steps](../development/testing.md). Also check Angular and Flutter independently; web build success is not renderer parity.

Production remains blocked by the other P0 items: end-user login, domain/tenant/delegated authorization, quote-bound consent, durable state and payment guarantees, deployment hardening and complete integration evidence. See [TODO](../../TODO.md).
