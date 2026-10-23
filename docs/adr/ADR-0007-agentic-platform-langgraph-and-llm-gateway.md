# ADR-0007 — Agent reasoning runtime and model inference separation

> Current demo implementation update (24 October 2026): see [ADR-0010](ADR-0010-provider-simulators-and-redis-demo.md) and the [provider guide](../demo/provider-backends.md). The implementation sections below describe the retained fixture path and integrated path where applicable. The integrated demo now has REST provider adapters, Keycloak browser/service authentication and Redis sessions. A real LangGraph approval graph with Redis checkpoints and authenticated core MCP now run; model-selected planning, production consent and UI standards migration remain targets.

**Status:** **LangGraph approval runtime and grounded replies implemented; model-selected planning remains a target.**
**Reviewed:** 2026-10-24.

## Context

Model inference (text completion) is different from maintaining a stateful, permissioned multi-step agent. The project wants vendor-agnostic LLM access and an engine capable of selecting tools, applying policy and coordinating long-running journeys.

## Decision

- Keep model inference behind a replaceable provider adapter; never embed provider keys in frontend code.
- Prefer **free inference for experiments** and an offline deterministic mock for repeatable tests.
- Use a real agent framework (LangGraph is an evaluated target) only when its graph/checkpoint/interrupt semantics are implemented and tested, not inferred from naming.
- Keep durable deterministic workflows distinct from probabilistic planning. The workflow/policy layer enforces effects and approvals.

## As built

A real LangGraph `StateGraph` now wraps the deterministic service router with prepare, persisted review interrupt and execute nodes. Integrated mode uses bounded Redis checkpoints; fixtures use MemorySaver. Normal restart recovery resumes an outstanding approval. Model-selected routing, schedules and general workflow compensation are not implemented. See [runtime details](../architecture/agent-runtime.md).

OpenRouter supplies grounded text with bounded context/output/time, official HTTPS, zero-priced provider routing and per-actor call limits. The current key is rejected with HTTP 401. Manual bundled routes bypass the model and retain the same approval checks.

## Consequences

Describe the app as a checkpointed LangGraph approval demo with deterministic service coordination and optional generated conversation. It is not an autonomous planner or general durable workflow platform. [Demo target decision](ADR-0011-local-demo-target.md) records the accepted boundary.
