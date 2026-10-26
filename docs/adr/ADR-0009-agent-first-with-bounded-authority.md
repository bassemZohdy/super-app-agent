# ADR-0009 — Agent-first Super App with bounded authority (Option A)

> Current demo implementation update (24 October 2026): see [ADR-0010](ADR-0010-provider-simulators-and-redis-demo.md) and the [provider guide](../demo/provider-backends.md). The implementation sections below describe the retained fixture path and integrated path where applicable. The integrated demo now has REST provider adapters, Keycloak browser/service authentication and Redis sessions. A real LangGraph approval graph with Redis checkpoints and authenticated core MCP now run; model-selected planning, production consent and UI standards migration remain targets.

**Status:** Superseded for the agent runtime by the explicit implementation assignment of 26 October 2026 and its embedded-database simplification. See [implemented architecture](../architecture.md). The proposal below is historical: its separate workflow executor, registry service and mandatory UI protocol migration are not requirements for the focused application.
**Related:** ADR-0001, ADR-0002, ADR-0003, ADR-0006, ADR-0007.

## Context

The product vision is an agent-centric Super App, not merely a chat panel alongside fixed mini-apps. Citizens should express goals and receive a coherent multi-service journey. Some teams may be tempted to make the agent the sole executor, identity authority, workflow engine and UI runtime; that would create an unsafe distributed monolith.

## Decision proposal

1. One **Concierge** primarily owns intent interpretation, journey plans, user dialogue, capability discovery and view selection.
2. The **host shell** owns navigation, presentation, session/device lifecycle and native permissions. The agent requests transitions; the shell authorizes them.
3. **Business domains** own resource state, authorization and transactions. Every agent tool/action call is verified by downstream policies, not by prompt text or UI presence.
4. A **durable deterministic workflow executor** owns multi-step waits/retries, idempotency, deadlines, reconciliations and compensation. It is callable by the Concierge, not replaced by it.
5. A **capability registry** exposes typed contracts, versions, risk labels, consent requirements and supported UI representations.
6. Agent interaction and UI use **standard AG-UI** and **standard A2UI** respectively, through explicit migration adapters from the current custom contract.
7. Support assisted, delegated and eventually proactive autonomy, scoped by user approval and revocable policy. Keep a non-agent path for critical operations.

## Trade-offs

**Advantages:** unified journey context, natural multi-domain navigation, personalization and scalable new capability onboarding.

**Costs and risks:** hallucinated planning, variable latency/spend, complex cross-domain recovery, user trust, authorization/delegation and UI reliability. Use model-independent tests and safe deterministic fallback.

## Acceptance questions before marking Accepted

- Can a user finish critical transactions without the LLM?
- Can the domain independently reject an unauthorized or stale delegated action?
- Can a failed multi-domain journey resume/reconcile after a process restart?
- Are the plan, approval, execution and resultant UI independently auditable?
- Can a new provider register a capability without code changes in the Concierge?
- Is the same A2UI definition safely rendered across web/native mobile?

See [target architecture](../architecture/target-architecture.md) and [TODO](../../TODO.md).
