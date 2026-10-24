# ADR-0003 — Backend domain boundaries and Concierge API

> Implementation review, 24 October 2026: [current status](../STATUS.md), [delivery target](ADR-0011-local-demo-target.md) and [bounded delegation amendment](ADR-0012-secure-delegation-demo.md) identify the implemented demo. This decision does not establish production approval.

**Status:** **Authenticated REST application/provider boundaries implemented for the demo; production delegation remains open.**
**Reviewed:** 2026-10-24.

## Context

A Super App can aggregate domains without requiring all services to be remote microservices in a local simulation. The product requires independent ownership, but the prototype prioritizes demonstrable journeys over deployment isolation.

## Decision

- Separate the **agent-facing session/interaction API** from **domain business contracts**.
- Keep capability logic and domain authorization in individually governable services; an agent can only invoke exposed, consented capabilities.
- Treat the Concierge as a task and UI coordinator, not as a universal permission/persistence/payment gateway.
- Permit one-process local simulation as a development convenience without claiming it exercises network gateway, service-mesh, tenancy or resilience guarantees.
- Future network adapters should provide authenticated REST/OpenAPI or real MCP contracts, clear timeouts, tracing, versioning and subject/actor delegation.

## As-built architecture

`services/agent-core/src/index.ts` runs HTTP + SSE. With `DOMAIN_TRANSPORT=http`, checked domain operations call six application APIs with verified user/account context; those APIs forward the signed interactive bearer to seven independent SQLite provider simulators. Separate machine clients handle narrowly scoped proof/settlement/eligibility operations; ADR-0012 governs broker-delegated calls. Legacy mode retains imported fixture handlers for offline tests. Production cryptographic delegation, quotas, HA and durable workflow execution remain open.

Current demo data boundaries are deliberately imperfect: `service-food` also serves utility bills; `service-wallet` also handles fines; `service-catalog` handles housing. These are not proposed bounded contexts.

## Consequences

Microservice ownership would improve independent deployment and compliance, but network boundaries add operational complexity and need HA/DR, policy, tracing and consistency design. A modular monolith can be appropriate for early implementation, provided contracts allow extraction later.

**Follow-up:** define true capability contracts, domain ownership and authorization tests before declaring any multi-service production use case complete. See [service inventory](../architecture/service-contracts.md).
