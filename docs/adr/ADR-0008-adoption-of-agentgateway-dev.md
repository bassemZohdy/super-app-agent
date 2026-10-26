# ADR-0008 — agentgateway.dev as candidate AI/agent data plane

> Implementation review, 24 October 2026: [what exists today](../../README.md#what-exists-today), [delivery target](ADR-0011-local-demo-target.md) and [bounded delegation amendment](ADR-0012-secure-delegation-demo.md) identify the implemented demo. This decision does not establish production approval.

**Status:** **Deferred candidate; unused experimental configuration removed. Adoption and compatibility NOT verified.**
**Reviewed:** 2026-10-26.

## Context

Production agent traffic may require model budgets, authentication, MCP federation, A2A routing, tracing and rate policy. A gateway should govern eligible data-plane traffic without taking ownership of domain business state or consent.

## Decision

- **Evaluate** agentgateway.dev as a self-hosted AI data-plane component that might cover LLM and MCP/A2A governance requirements.
- Do **not** treat its configuration as implemented federated capability execution, real model failover or complete security.
- Keep application ingress/identity, domain authorization and workflow durability separate from any LLM/MCP/A2A proxy.
- Validate vendor/image version, YAML schema, air-gap/self-hostability, claims propagation, authorization features and observability in a real end-to-end POC before adopting for production.

## Current evidence

The unused gateway YAML, older default Compose file and historical OpenRouter connector/diagnostic/tests were removed during workspace cleanup. No retained application path imported that connector. The focused agent uses its configured OpenAI-compatible planner; the integrated demo uses private llama.cpp. `compose.agent.yml` and `docker-compose.demo.yml` are the respective explicit entry points.

Application services still expose legacy `GET /mcp` descriptors. The core has a real authenticated MCP endpoint, but no gateway federation has been wired to or tested against it. No gateway startup/integration test establishes supported syntax, policy or real federation.

## Consequences

Potential centralized observability, routing and tool governance if verified. New risks include gateway misconfiguration, protocol/version drift, operational overhead, token delegation and authorization gaps.

**Decision gate:** keep in candidate status until a reproducible POC confirms at least authentication, real MCP tool calls, model routing/limits, tracing and security under intended deployment constraints.

See [system overview](../architecture/system-overview.md) and [target architecture](../architecture/target-architecture.md).
