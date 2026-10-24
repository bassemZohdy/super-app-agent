# ADR-0006 — Session state, UI events and security boundaries

> Implementation review, 24 October 2026: [current status](../STATUS.md), [delivery target](ADR-0011-local-demo-target.md) and [bounded delegation amendment](ADR-0012-secure-delegation-demo.md) identify the implemented demo. This decision does not establish production approval.

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

Shared verification enforces RS256 issuer/audience, bounded finite times, access-token type, issuer-scoped JWKS rotation/cooldown and configured online introspection. Browser shells use PKCE/refresh/logout and header-authenticated SSE. Application APIs verify user roles/account membership; providers verify the appropriate interactive/delegated/machine audience/client/role and account-owned SQLite resources. Redis provides subject/account binding, TTL, renewed leases, fenced saves and shared replay. Action requests require the current approval revision, five-minute expiry, canonical view digest and every offered payload field. Cancellation invalidates the pending continuation. Fixture mode retains the explicit nonproduction `DEMO_AUTH` bypass and process-local shared data.

## Unresolved

- Native Flutter PKCE/device validation, production browser session design and complete stream revocation lifecycle. Dart authenticated SSE is implemented and tested at its documented boundary.
- Global quotas, replicated HA/off-host backup automation and production retention/storage encryption. P2-02 delivers local encrypted cold restore, critical-dependency readiness and fenced recovery.
- Production entitlement/tenancy, immutable external audit and broader delegated authority. ADR-0012 delivers bounded signed delegation, exact current grants and revocation; reviewed payment quotes and non-executable mandate records are implemented.
- Cross-service atomicity and general compensation. Owner-authenticated original-operation reconciliation/refunds are implemented for the retained payment paths.
- Known local credentials, HTTP/start-dev and the candidate gateway configuration must not become production defaults.

This ADR is **not** a security certification. See [SECURITY.md](../../SECURITY.md).

