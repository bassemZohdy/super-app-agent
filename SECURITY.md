# Security and trust boundaries

**Review baseline:** 23 October 2026 after merged hardening PR #1. **This project is not production-safe for government, identity or financial data.** The names DubaiNow, TAMM, UAE PASS, Salik, DEWA, Police, etc. identify fictional scenarios, not authenticated integrations or organizational endorsement.

Security issues should be assessed against actual source/deployment, not against aspirational ADRs.

## Trust model

| Actor/component | Trusted for | **Not** trusted for |
| --- | --- | --- |
| Browser/Flutter shell | Rendering allowed UI and initiating requests | Business authorization, deciding transaction amounts, asserting user identity |
| Agent/LLM | Suggesting plans, responses, selected approved capabilities | Granting consent, selecting its own security scope, invoking arbitrary money movement |
| Agent-core | Validating incoming tokens/session and surface action constraints | Domain resource ownership or distributed transaction safety |
| Capability/domain service | Owning its specific data/business policy **when implemented** | Trusting UI/agent-provided authorization without verifying it |
| Identity/consent service | Verifying user + actor delegation, scopes, consent, revocation | Inferring approval from model text |
| Gateway | Ingress/data-plane mediation **if verified** | Replacing domain authorization or durable workflow state |

## What the source currently implements

**Keycloak token validation:** `services/agent-core/src/auth.ts` requires RS256 with configured JWKS, exact `KEYCLOAK_ISSUER`, audience `KEYCLOAK_AUDIENCE`, expiration, subject, optional not-before and future issue-time check. Public keys are cached in process for about five minutes. This is a useful ingress guard, **not** proof of a complete OIDC/RBAC/delegation architecture. Claim verification has no online revocation check or explicit token-type/scope authorization.

**Demo bypass:** `DEMO_AUTH=true` and `NODE_ENV !== production` permit synthetic `demo-local` identity (including requests without bearer token). This is for isolated localhost demonstrations **only**. Never configure it on shared environments or any public network.

**Session authorization:** an in-memory map associates a session ID to subject `sub`. SSE verifies bearer tokens and ownership, rejects disallowed origins, expires connections, and supports replay/snapshots. Replay is bounded to 100 events/session, 1,000 sessions, 8 MiB total and five-minute idle retention; five listeners/session and 256 KiB pending output/listener limit slow consumers. None of this is durable or cross-replica; owner/session/action maps still need lifecycle limits.

**Action authorization:** agent-core checks whether the action is represented by the active surface, validates selected UI choices, and protects certain submitted fields (amount, duration, zone, plate, ticket) from client edits. Repeated same-surface actions are rejected in one process. **These checks cannot establish payment consent, prevent races across processes or enforce domain ownership.**

**CORS/network:** agent-core rejects requests with a disallowed Origin and uses the `CORS_ORIGINS` allowlist for HTTP/SSE, with `Vary: Origin`. Requests without Origin still require API authentication. CORS does not replace authorization. Compose exposes demo backend and Keycloak host ports only on 127.0.0.1. The separate agentgateway YAML has wildcard CORS and has not been validated as an active enforcement path.

**LLM spend:** no key = no network inference; live preview is off by default and free-model routing is default. Paid models require opt-in, and no automatic paid fallback is configured. This guards **model spend**, not privacy or prompt safety.

## Immediate risk register

| Severity | Risk | Required production resolution |
| --- | --- | --- |
| Critical | Demo identity/dev Keycloak realm includes static accounts and insecure settings | Remove fixture users/default passwords, full OIDC/PKCE and production realm hardening |
| Critical | Domain simulator state shared without per-user authorization; agent calls domain handlers directly | Subject/tenant-aware domain service APIs; enforcement at resource boundaries |
| Critical | Fake wallet/fines/utility/pay flows can appear successful without reliable transaction guarantees | Server-derived immutable quotes, real payment authority, durable idempotency, compensation, receipts, audit |
| High | Session and duplicate state only in memory | Durable scoped session/claim-state store, TTL, revocation, per-tenant partitioning |
| High | Browser shells still supply demo tokens; replay is process-local; Flutter has no new replay adapter | OIDC token lifecycle, Flutter parity, durable replay and multi-instance ownership |
| High | UI schema/action validation is only partial | Official schema and semantic policies, limits, fuzzing, renderer sandboxes |
| High | Prompt injection, data exfiltration and tool privilege misuse not evaluated for a real agent | Capability allowlists, input/output safety evaluation, trace-level audit, approved access envelopes |
| High | Floating agentgateway image, unverified config and wildcard CORS | Version pinning, validated deployment tests, explicit origins, least privilege |
| Medium | Session/owner/action maps remain unbounded despite bounded replay/listener queues | Session TTL, per-user and total connection quotas, rate limits, monitoring |
| Medium | No formal official protocol conformance | AG-UI/A2UI/MCP compatibility test harnesses |

## Local-only safety rules

1. Never commit `.env`, keys, genuine tokens or copied citizen records.
2. Demo: copy `.env.example` → `.env`; set `DEMO_AUTH=true` only in a local environment. Use fictional records.
3. Without a key, the mock scenarios work and incur no LLM API usage.
4. For model experiments, select `OPENROUTER_MODEL=openrouter/free`, `OPENROUTER_ALLOW_PAID_MODELS=false` and consciously enable `ENABLE_LIVE_LLM=true`. **Sending any text to a hosted model may transfer it to third-party providers.** Use synthetic prompts only.
5. Do not expose Compose frontend or backend outside localhost for testing without rechecking all container/public bindings; backend loopback mappings do not make an insecure frontend safe.
6. The Keycloak realm JSON is a seeded demo; it is **not an identity-provider hardening template**.
7. Do not represent mock “receipts”, “verified identity” badges, balances or agency integration as a real authority's confirmation.

## Production release gates

- Real end-user OIDC/PKCE and secure authenticated stream lifecycle.
- Per-resource user/tenant authorization and explicit delegated consent; scope/actor chain verified on **every effect**.
- Real persistent domain stores and idempotent transaction/compensation workflows.
- Signed manifest/component catalogs and enforced least-privileged mini-app runtime.
- Auth/key-rotation/revocation tests, rate limits, CSRF/CORS/stream threat analysis and auditing.
- Tracing, load/resilience testing, pinned and scanned artifacts, production secrets management.
- Actual passing builds, security tests against real Keycloak, and signed review of release evidence.

This is an engineering risk summary, not a penetration test or compliance assessment. See [TODO](TODO.md) and [architecture](docs/architecture/system-overview.md).

