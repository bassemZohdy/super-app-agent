# ADR-0006 — Session state, UI events and security boundaries

> Current demo implementation update (24 October 2026): see [ADR-0010](ADR-0010-provider-simulators-and-redis-demo.md) and the [provider guide](../demo/provider-backends.md). The implementation sections below describe the retained fixture path and integrated path where applicable. The integrated demo now has REST provider adapters, Keycloak browser/service authentication and Redis sessions. A real LangGraph approval graph with Redis checkpoints and authenticated core MCP now run; model-selected planning, production consent and UI standards migration remain targets.

**Status:** **Partial protections implemented after PR #1; production security pending.**
**Reviewed:** 2026-10-24.

## Context

Agent-first civic journeys span identity, conversation, UI actions and potentially financial effects. No trust boundary may be inferred from a generated component or an agent plan.

## Decision

- Require a verified user identity for nonpublic agent ingress; the only exception is **explicit nonproduction local demo mode**.
- Scope sessions to authenticated subject IDs and validate each action against the current UI surface as a *preliminary* control.
- Keep API keys on the backend; do not place bearer tokens in SSE query strings.
- Treat domain resource authorization, delegated consent, immutable transaction quotations, distributed idempotency, audit and revocation as separate mandatory controls.
- Use a typed event contract; for production, support durable event ordering/replay and per-session/per-user access control.

## Implemented demo controls

Shared verification enforces RS256 issuer/audience, bounded finite times, access-token type, issuer-scoped JWKS rotation/cooldown and configured online introspection. Browser shells use PKCE/refresh/logout and header-authenticated SSE. Application APIs verify user roles/account membership; providers verify service audience/client/role and account-owned SQLite resources. Redis provides subject/account binding, TTL, renewed leases, fenced saves and shared replay. Action requests require the current approval revision, five-minute expiry, canonical view digest and every offered payload field. Cancellation invalidates the pending continuation. Fixture mode retains the explicit nonproduction `DEMO_AUTH` bypass and process-local shared data.

## Unresolved

- Native Flutter PKCE/SSE, production browser session design and online revocation.
- Global quotas, HA/backup/crash recovery and production retention/encryption.
- Signed user delegation, immutable quotes, consent/revocation and audit.
- Cross-service atomicity and authenticated payment/provider reconciliation.
- Known local credentials, HTTP/start-dev and the candidate gateway configuration must not become production defaults.

This ADR is **not** a security certification. See [SECURITY.md](../../SECURITY.md).

