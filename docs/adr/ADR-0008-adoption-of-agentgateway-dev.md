# ADR-0008 — agentgateway.dev as candidate AI/agent data plane

> Implementation review, 24 October 2026: [what exists today](../../README.md#what-exists-today), [delivery target](ADR-0011-local-demo-target.md) and [bounded delegation amendment](ADR-0012-secure-delegation-demo.md) identify the implemented demo. This decision does not establish production approval.

**Status:** **Candidate/configured for experimentation; adoption and compatibility NOT verified.**
**Reviewed:** 2026-10-24.

## Context

Production agent traffic may require model budgets, authentication, MCP federation, A2A routing, tracing and rate policy. A gateway should govern eligible data-plane traffic without taking ownership of domain business state or consent.

## Decision

- **Evaluate** agentgateway.dev as a self-hosted AI data-plane component that might cover LLM and MCP/A2A governance requirements.
- Do **not** treat its configuration as implemented federated capability execution, real model failover or complete security.
- Keep application ingress/identity, domain authorization and workflow durability separate from any LLM/MCP/A2A proxy.
- Validate vendor/image version, YAML schema, air-gap/self-hostability, claims propagation, authorization features and observability in a real end-to-end POC before adopting for production.

## Current evidence

`services/agentgateway/config.yaml` describes listener, LLM, tool and tracing settings; `docker-compose.yml` references an unpinned `ghcr.io/agentgateway/agentgateway:latest` image. The demo agent graph **does not use** the gateway for its business calls and active inference uses private llama.cpp through an internal adapter. The historical OpenRouter helper uses direct HTTP only when explicitly invoked for diagnostics/tests.

The config describes `/mcp` endpoints, but application services still expose legacy `GET /mcp` descriptors. The core now has a real authenticated MCP endpoint, but the candidate gateway has not been wired to or tested against it. No gateway startup/integration test in this repository validates supported syntax, policy or real federation. Its listener includes wildcard CORS, unsuitable without review.

## Consequences

Potential centralized observability, routing and tool governance if verified. New risks include gateway misconfiguration, protocol/version drift, operational overhead, token delegation and authorization gaps.

**Decision gate:** keep in candidate status until a reproducible POC confirms at least authentication, real MCP tool calls, model routing/limits, tracing and security under intended deployment constraints.

See [system overview](../architecture/system-overview.md) and [target architecture](../architecture/target-architecture.md).
