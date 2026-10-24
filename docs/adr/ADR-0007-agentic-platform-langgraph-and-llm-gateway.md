# ADR-0007 — Agent reasoning runtime and model inference separation

> Implementation review, 24 October 2026: [current status](../STATUS.md), [delivery target](ADR-0011-local-demo-target.md) and [bounded delegation amendment](ADR-0012-secure-delegation-demo.md) identify the implemented demo. This decision does not establish production approval.

**Status:** **LangGraph approval runtime and grounded replies implemented; model-selected planning remains a target.**
**Reviewed:** 2026-10-24.

## Context

Model inference (text completion) is different from maintaining a stateful, permissioned multi-step agent. The project wants vendor-agnostic LLM access and an engine capable of selecting tools, applying policy and coordinating long-running journeys.

## Decision

- Keep model inference behind a replaceable provider adapter; never embed provider keys in frontend code.
- Use internal open-source text/voice for the selected demo and deterministic fixtures for repeatable tests. This supersedes the initial free-hosted-inference experiment under the later user choice.
- Use a real agent framework (LangGraph is an evaluated target) only when its graph/checkpoint/interrupt semantics are implemented and tested, not inferred from naming.
- Keep durable deterministic workflows distinct from probabilistic planning. The workflow/policy layer enforces effects and approvals.

## As built

A real LangGraph `StateGraph` now wraps the deterministic service router with prepare, persisted review interrupt and execute nodes. Integrated mode uses bounded Redis checkpoints; fixtures use MemorySaver. Normal restart recovery resumes an outstanding approval. Model-selected routing, schedules and general workflow compensation are not implemented. See [runtime details](../architecture/agent-runtime.md).

Private Qwen/llama.cpp supplies grounded text with bounded context/output/time and per-actor limits. KittenTTS/Whisper provide local speech. The retained OpenRouter helper is inactive compatibility/diagnostic code; earlier HTTP 401 observations belong to the dated hosted-model report. Manual bundled routes bypass inference and retain the same approval checks. [Current local AI setup](../development/local-ai.md).

## Consequences

Describe the app as a checkpointed LangGraph approval demo with deterministic service coordination and optional generated conversation. It is not an autonomous planner or general durable workflow platform. [Demo target decision](ADR-0011-local-demo-target.md) records the accepted boundary.
