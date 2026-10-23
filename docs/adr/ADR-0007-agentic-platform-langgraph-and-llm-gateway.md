# ADR-0007 — Agent reasoning runtime and model inference separation

**Status:** **Model preview adapter implemented; LangGraph orchestration remains a target.**
**Reviewed:** 2026-10-23.

## Context

Model inference (text completion) is different from maintaining a stateful, permissioned multi-step agent. The project wants vendor-agnostic LLM access and an engine capable of selecting tools, applying policy and coordinating long-running journeys.

## Decision

- Keep model inference behind a replaceable provider adapter; never embed provider keys in frontend code.
- Prefer **free inference for experiments** and an offline deterministic mock for repeatable tests.
- Use a real agent framework (LangGraph is an evaluated target) only when its graph/checkpoint/interrupt semantics are implemented and tested, not inferred from naming.
- Keep durable deterministic workflows distinct from probabilistic planning. The workflow/policy layer enforces effects and approvals.

## As built

`services/agent-core/src/langgraph/graph.ts` is a large **handwritten static class**, routing on English substring matches and calling simulators directly. The package does **not** depend on LangGraph. `invokeOpenRouterChat` is called only when enabled and configured; its response is **ignored** for selecting a domain or tool.

`openrouter.ts` defaults to `openrouter/free`, uses `max_tokens=300` and a 20-second timeout, and rejects paid model IDs unless `OPENROUTER_ALLOW_PAID_MODELS=true`. With no key, it returns a demo fallback and makes no network request. `OPENROUTER_MODEL` can be set to an available fixed `:free` model.

## Missing implementation

Genuine graph state/checkpointing, model-decided tool invocation, secure tool schemas, human-in-the-loop persisted interrupts, multi-agent routing, contextual evaluation, tenant-specific memory and budget/cost observability.

**Consequence:** the current app must be described as **deterministic simulation with optional LLM preview**, not an autonomous LangGraph agent.

See [agent runtime](../architecture/agent-runtime.md).
