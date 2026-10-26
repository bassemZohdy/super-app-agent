# Target architecture: one main Super App Agent

The implementation assignment of 26 October 2026 supersedes this file's earlier Option A proposal for a separate workflow executor and registry infrastructure. The subsequent simplification instruction selects embedded SQLite for the local demo.

The actual implemented architecture, component decisions, diagram and boundaries are documented in [architecture](../architecture.md). Native nodes and checkpoints handle orchestration inside one Node.js/TypeScript/LangGraph.js agent. Existing REST services do not need MCP. Additional protocols and independently deployed agents are added only for a concrete service requirement.

The older integrated Cityside application remains runnable while retained journeys are migrated incrementally. Its business/identity contracts are preserved; the focused demo adds no workflow runtime, DSL or general-purpose platform. See [agent flow](../agent-flow.md), [integrations](../integrations.md), [security](../security.md) and [open work](../../TODO.md).
