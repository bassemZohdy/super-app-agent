# ADR-0001 — Super App ecosystem with an agent-first Concierge

> Implementation review, 24 October 2026: [current status](../STATUS.md), [delivery target](ADR-0011-local-demo-target.md) and [bounded delegation amendment](ADR-0012-secure-delegation-demo.md) identify the implemented demo. This decision does not establish production approval.

**Status:** Accepted as **product direction**, **partially demonstrated**; production implementation pending.
**Reviewed:** 2026-10-24. See [ADR-0009](ADR-0009-agent-first-with-bounded-authority.md) for the refined autonomy boundary.

## Context

Conventional Super Apps expose catalogs of separate mini-apps. This project experiments with one Concierge conversation that can organize tasks across mobility, utilities, housing, citizen payments and user preferences. The experience should still work when a user opens a dedicated app directly.

## Decision

- Make a **Concierge Agent the default journey coordinator and discovery experience**, not the owner of every service.
- Treat mini-apps as independently governed capabilities and UI surfaces. The shell is responsible for identity UX, navigation, lifecycle and approved device APIs.
- Permit the agent to request a UI screen, capability invocation or approved deterministic workflow. It may not grant its own permissions or bypass domain checks.
- Offer manual navigation as an always-available alternative to model-driven interaction.
- Enforce separation between service capability description, UI representation, invocation semantics and resource permissions.

## Current evidence

`apps/shell-react` contains a conversational workspace, authenticated service surfaces, account selection and saved conversations. The graph composes journeys deterministically; integrated mode uses authenticated REST application/provider adapters and Redis. Catalog bundled routes bypass model execution; legacy mount modules do not establish independent MFE deployment or model-driven discovery. All named providers remain simulators.

## Consequences and trade-offs

**Benefits:** task-centric journeys, shared capability contracts, less user navigation, optional adaptive UI. **Costs:** model error handling, coordinated recovery, lifecycle complexity, consent clarity and observability across domains.

**Follow-up:** implement versioned capability registry and domain-verified authorization; test direct/manual and agent-first paths. See [target architecture](../architecture/target-architecture.md).
