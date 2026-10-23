# ADR-0011 — Local demo delivery target

**Status:** Accepted for this delivery following the user's clarification, “it have to be demo”. **Date:** 24 October 2026.

## Context and boundaries

Deliver a runnable local demonstration using synthetic city records and funds. Retain React as the primary interactive demo; Angular and Flutter web remain comparison shells with explicitly documented parity gaps. Docker Compose on localhost is the deployment target. No OpenShift/cloud deployment, actual agency/UAE PASS/PSP contracts, native app distribution or offline/air-gapped operation is selected. OpenRouter is optional internet egress; the demo remains usable through bundled manual routes without it.

Architecture review applied the orchestrator's context → specialist review → synthesis sequence. AI architecture and security were selected because checkpointed approval execution, model boundaries and token/authority handling changed. Inputs were the running provider stack, repository contracts, TODO acceptance criteria and the user's demo constraint. Key quality attributes are repeatability, truthful outcomes, resource ownership and bounded reversible local operation. No external contract is inferred from a simulator's name.

## Decision

- Run a real LangGraph `StateGraph` with prepare, review interrupt and execute nodes. Persist its bounded root graph through the demo Redis saver; keep deterministic service routing and policy outside model prose. Completed/replaced/cancelled graph continuations are deleted; outstanding checkpoints have TTL. A scheduler, compensation engine and arbitrary subgraph persistence are not delivered.
- Use the official MCP TypeScript SDK for authenticated Streamable HTTP at core `/mcp`. Existing application `GET /mcp` descriptors stay compatibility metadata. A2A is deferred because no remote-agent journey is selected. agentgateway remains an unvalidated candidate; the demo uses direct HTTP and direct OpenRouter HTTPS.
- Use repository-bundled custom UI surfaces and allowlisted `/services/{id}` routes. Load no remote JavaScript and grant no device permissions from a manifest. This closes the demo loading decision without asserting Module Federation, signatures for remote bundles, Lit or official AG-UI/A2UI conformance.
- Require subject/account/revision-bound, expiring, digest-checked one-time approvals. Cancellation prevents a pending action. Keep at most 50 lifecycle entries with the conversation. Long-lived delegation, proactive effects and scheduled grants are deferred.
- Verify access-token type, issuer/audience, bounded claims and signature using shared bounded JWKS logic. Integrated mode introspects each new request through a separate confidential verifier. Browser login uses PKCE; Flutter's seeded password login remains local-demo only. Existing SSE connections are not immediately terminated by every remote logout.
- Restrict demo inference to official OpenRouter HTTPS with zero-priced provider routing, bounded context/output/time and per-actor request quotas. Keep the supplied environment key private. Its current HTTP 401 is an external authentication failure, not a passing generation test.

## Acceptance and tradeoffs

The [current report](../reports/2026-10-24-demo-completion.md) records executed gates, exceptions and a mapping of all original TODO groups. The original production criteria remain visible and unchecked where only part is delivered. [TODO](../../TODO.md) remains the source of remaining requirements; this ADR does not waive or relabel unfinished features as complete.

Source mounts and public demo credentials make the local stack easy to inspect and reset, but are unsuitable for public deployment. Redis AOF `everysec` plus SQLite demonstrates ordinary restart persistence, not HA, exactly-once external transactions or tested disaster recovery. Three reference renderers cost more maintenance and do not imply identical component/accessibility/device support.

## Follow-up triggers

A real provider contract, public hosting request, remote-agent requirement, remote mini-app deployment, native distribution, scheduled payment or offline operation reopens the relevant architecture and security acceptance criteria before that capability is advertised.
