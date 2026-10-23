# Security and runtime status (October 2026)

This repository is a **simulated demonstration**, not a production government, banking, or identity application. Domain datasets and transactions are fixtures; the current agent engine is keyword-driven despite LangGraph-themed class names.

## Local setup

1. Copy `.env.example` to `.env`; never commit `.env` or provider keys.
2. Set `DEMO_AUTH=true` **only for local demo use**. This enables a shared mock identity called `demo-local`. The mock is rejected under `NODE_ENV=production`. Local backend ports are bound to loopback by Docker Compose.
3. Run `npm test` for the deterministic integration tests. Tests set `DEMO_AUTH=true` only inside the test runner.
4. Run `npm run dev:backend`, then a frontend shell. If using Docker Compose, set `DEMO_AUTH=true` in the local `.env` explicitly.
5. Optional free inference: create an OpenRouter API key at https://openrouter.ai/keys, store it only in `.env`, set `OPENROUTER_MODEL=openrouter/free` (or a specific `:free` model), and `ENABLE_LIVE_LLM=true`. **The current model call is a preview; it does not drive the deterministic demo router.**
6. `OPENROUTER_ALLOW_PAID_MODELS=false` is the default. If no key is present, the simulation runs locally without inference spend. Provider outages never silently switch to paid models.

Do not embed real access tokens in source code or URL query parameters. Browser EventSource demo mode is unauthenticated except for the explicit local demo gate. Production streaming requires an OAuth/OIDC-capable client transport (for example authenticated fetch-based SSE) and a real authorization-code/PKCE login flow.

## Authentication contract

- Real JWTs must be RS256 signed and valid for `KEYCLOAK_ISSUER` and `KEYCLOAK_AUDIENCE`, with an unexpired `exp`.
- JWKS are retrieved from configured `KEYCLOAK_JWKS_URL`, cached briefly, and verified cryptographically.
- Production JWKS transport must use HTTPS.
- HTTP request sessions are bound to authenticated subject IDs within the current process.
- UI actions require a corresponding binding on the active surface; sensitive provided resource values are checked against the UI-bound values.
- Token verification **does not replace** resource-level authorization, delegation consent, or financial transaction controls.

## Known production blockers

1. Frontend shells still need **real OIDC/PKCE authentication** and authenticated, resumable SSE streams. The static `demo-local` marker is **not an identity solution**.
2. Domain services are simulated and don't enforce independent per-subject authorization and service-level consent. Rework domain ownership, tenant partitioning, policy checks, and propagation of delegated user identity before integrating real citizen data.
3. Memory sessions and action duplicate protection are **process-local**; production needs database-backed workflow state, session TTL/cleanup, stable event IDs, replay, and durable idempotency enforced by domain services.
4. Payments and multi-agency actions need transactional reconciliation, failure handling, compensation, user confirmation tied to an immutable transaction quote, and an auditable authorization decision.
5. Agent reasoning is not implemented with a real LangGraph runtime; the current optional OpenRouter call is informational and the model's output is ignored. Replace keyword routing only with an explicitly tested, governed planner.
6. Custom AG-UI/A2-UI interfaces are not yet official AG-UI/A2UI protocol implementations. Compatibility adapters, version negotiation, semantic action validation and renderer parity are still required.
7. Supply-chain hardening, pinned container image digests, Keycloak upgrade, API rate limits, prompt-injection testing, secrets handling, and OpenTelemetry audit correlation require independent validation.
8. The source verification performed for this patch is not a runtime audit; execute `npm test`, build frontend shells, and run integration/e2e security tests against a real Keycloak realm before deployment.

Never deploy the repository to the public internet or process genuine citizen, identity, payment or health data without resolving these blockers.
