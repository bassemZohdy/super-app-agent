# ADR-0003 — Backend domain boundaries and Concierge API

> Current demo implementation update (23 October 2026): see [ADR-0010](ADR-0010-provider-simulators-and-redis-demo.md) and the [provider guide](../demo/provider-backends.md). Earlier implementation descriptions below record the prior fixture baseline. The integrated demo now has REST provider adapters, Keycloak browser/service authentication and Redis sessions; LangGraph, production consent and standards migration remain targets.

**Status:** **Logical separation demonstrated; distributed boundary/protocol target not implemented.**
**Reviewed:** 2026-10-23.

## Context

A Super App can aggregate domains without requiring all services to be remote microservices in a local simulation. The product requires independent ownership, but the prototype prioritizes demonstrable journeys over deployment isolation.

## Decision

- Separate the **agent-facing session/interaction API** from **domain business contracts**.
- Keep capability logic and domain authorization in individually governable services; an agent can only invoke exposed, consented capabilities.
- Treat the Concierge as a task and UI coordinator, not as a universal permission/persistence/payment gateway.
- Permit one-process local simulation as a development convenience without claiming it exercises network gateway, service-mesh, tenancy or resilience guarantees.
- Future network adapters should provide authenticated REST/OpenAPI or real MCP contracts, clear timeouts, tracing, versioning and subject/actor delegation.

## As-built architecture

`services/agent-core/src/index.ts` runs HTTP + SSE; `services/agent-core/src/langgraph/graph.ts` imports `executeRideRequest`, `executeFoodRequest`, `executeWalletRequest`, `executeCatalogRequest` and `executeProfileRequest` and calls them **directly**. Standalone HTTP servers also exist but the graph does not route its operations through them.

Current demo data boundaries are deliberately imperfect: `service-food` also serves utility bills; `service-wallet` also handles fines; `service-catalog` handles housing. These are not proposed bounded contexts.

## Consequences

Microservice ownership would improve independent deployment and compliance, but network boundaries add operational complexity and need HA/DR, policy, tracing and consistency design. A modular monolith can be appropriate for early implementation, provided contracts allow extraction later.

**Follow-up:** define true capability contracts, domain ownership and authorization tests before declaring any multi-service production use case complete. See [service inventory](../architecture/service-contracts.md).
