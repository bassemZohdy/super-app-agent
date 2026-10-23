# ADR-0001 — Super App ecosystem with an agent-first Concierge

> Current demo implementation update (23 October 2026): see [ADR-0010](ADR-0010-provider-simulators-and-redis-demo.md) and the [provider guide](../demo/provider-backends.md). Earlier implementation descriptions below record the prior fixture baseline. The integrated demo now has REST provider adapters, Keycloak browser/service authentication and Redis sessions; LangGraph, production consent and standards migration remain targets.

**Status:** Accepted as **product direction**, **partially demonstrated**; production implementation pending.
**Reviewed:** 2026-10-23. See [ADR-0009](ADR-0009-agent-first-with-bounded-authority.md) for the refined autonomy boundary.

## Context

Conventional Super Apps expose catalogs of separate mini-apps. This project experiments with one Concierge conversation that can organize tasks across mobility, utilities, housing, citizen payments and user preferences. The experience should still work when a user opens a dedicated app directly.

## Decision

- Make a **Concierge Agent the default journey coordinator and discovery experience**, not the owner of every service.
- Treat mini-apps as independently governed capabilities and UI surfaces. The shell is responsible for identity UX, navigation, lifecycle and approved device APIs.
- Permit the agent to request a UI screen, capability invocation or approved deterministic workflow. It may not grant its own permissions or bypass domain checks.
- Offer manual navigation as an always-available alternative to model-driven interaction.
- Enforce separation between service capability description, UI representation, invocation semantics and resource permissions.

## Current evidence

`apps/shell-react` contains chat plus mini-app tabs; `services/agent-core/src/langgraph/graph.ts` composes example actions and screens using keywords and direct calls to simulators. `services/service-catalog` lists apps and example remote URLs. These are not independent provider integrations, real agent discovery or production MFE deployments.

## Consequences and trade-offs

**Benefits:** task-centric journeys, shared capability contracts, less user navigation, optional adaptive UI. **Costs:** model error handling, coordinated recovery, lifecycle complexity, consent clarity and observability across domains.

**Follow-up:** implement versioned capability registry and domain-verified authorization; test direct/manual and agent-first paths. See [target architecture](../architecture/target-architecture.md).
