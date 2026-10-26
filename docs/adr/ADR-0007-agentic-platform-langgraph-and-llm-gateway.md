# ADR-0007 — Native LangGraph.js runtime and replaceable model inference

**Status:** Accepted for the focused local demo, amended 26 October 2026. The [implemented architecture](../architecture.md) supersedes the earlier separate workflow-layer direction. Synthetic data and funds remain the delivery boundary.

## Decision

- Use strict TypeScript, Node.js 24 and first-party LangGraph.js for one main agent. Native nodes, conditional edges, interrupts and checkpoints own execution transitions; no separate workflow engine or generic DSL is added.
- Keep model inference behind the `Planner` interface. The configured OpenAI-compatible endpoint selects a bounded validated plan. Fixture planning is an explicitly selected test/demo adapter, never an outage fallback.
- Use the official SQLite saver and one embedded database for the minimal demo. Checkpoint continuation, authority and business idempotency have separate responsibilities. No Redis or PostgreSQL service is required by this entry point.
- Deterministic code authenticates, checks scope/consent, builds the exact quote and revalidates before effects. Model text cannot approve a payment or change authority. Credentials remain outside graph state.
- Add REST/MCP/A2A/legacy integrations only for actual services; preserve a direct governed REST adapter where an API already exists. No mandatory gateway, registry service or independent specialist hierarchy is selected.

## As built and boundaries

The focused graph classifies a fines request, reads its REST simulator, builds a quote, pauses durably and executes an approved simulated payment with an original stable operation key. Its deterministic suite verifies real SQLite/HTTP and actual process restart; live model quality, the new Keycloak fines scopes, primary-shell adoption and container execution require their own evidence. See [flow](../agent-flow.md), [security](../security.md) and [testing](../testing.md).

The optional compatibility entry point retains its deterministic domain coordinator, Redis saver, current shell APIs, authenticated MCP and local voice/model integration. This preserves working journeys while a selected React interaction adopts the focused API. Its historical reports keep their original scope; those components do not become mandatory infrastructure for the default agent.
