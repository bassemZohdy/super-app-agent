# ADR-0006 — Session state, UI events and security boundaries

**Status:** **Partial protections implemented after PR #1; production security pending.**
**Reviewed:** 2026-10-23.

## Context

Agent-first civic journeys span identity, conversation, UI actions and potentially financial effects. No trust boundary may be inferred from a generated component or an agent plan.

## Decision

- Require a verified user identity for nonpublic agent ingress; the only exception is **explicit nonproduction local demo mode**.
- Scope sessions to authenticated subject IDs and validate each action against the current UI surface as a *preliminary* control.
- Keep API keys on the backend; do not place bearer tokens in SSE query strings.
- Treat domain resource authorization, delegated consent, immutable transaction quotations, distributed idempotency, audit and revocation as separate mandatory controls.
- Use a typed event contract; for production, support durable event ordering/replay and per-session/per-user access control.

## Implemented after PR #1

`auth.ts` verifies RS256 tokens using configured JWKS, exact issuer, audience and expiration. `DEMO_AUTH=true` admits a synthetic identity only outside `NODE_ENV=production`. `index.ts` stores process-local session owner, SSE subscriber sets, active transition coordination and surface UUID revisions; guards selected action payload fields and limits some inputs; allows configured CORS origins. React/Angular/Flutter hardcoded forged JWTs were replaced with a local demo marker.

## Unresolved

- No client OIDC/PKCE login or production authenticated streaming.
- Global in-memory state with no TTL or multi-node durability.
- No domain-level policy check or verifiable user-consent evidence.
- No durable transaction idempotency, partial-failure recovery or audit.
- Keycloak realm sample retains insecure development settings and seeded credentials.
- Agentgateway config allows wildcard CORS and uses a floating image tag.

This ADR is **not** a security certification. See [SECURITY.md](../../SECURITY.md).

