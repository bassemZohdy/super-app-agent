# Documentation index

Updated **24 October 2026** for the integrated provider demo based on `0571413`, including the checkpointed runtime, authenticated MCP and subsequent validation/fixes. [Latest evidence](reports/2026-10-24-demo-completion.md).

The bounded delegation extension is documented in [ADR-0012](adr/ADR-0012-secure-delegation-demo.md) and its [current execution evidence](reports/2026-10-24-delegation-demo.md); earlier baseline reports remain historical.

## Reading order

1. [README](../README.md) — purpose, current status and quickstart.
2. [As-built architecture](architecture/system-overview.md) — components and actual execution paths.
3. [Protocol inventory](architecture/protocol-ag-ui-a2-ui.md) — custom UI/event interfaces and external standards.
4. [Service contract inventory](architecture/service-contracts.md) — simulated APIs and action flow.
5. [Agent runtime](architecture/agent-runtime.md) — what `SuperAppAgentGraph` actually does.
6. [UI and mini-apps](architecture/frontend-and-miniapps.md) — three shell implementations and integration limits.
7. [Target architecture](architecture/target-architecture.md) — planned agent-centric direction; **not current behavior**.
8. [Browser scenarios and recording](development/recording.md), [local development](development/local-development.md) and [testing](development/testing.md).
9. [SECURITY](../SECURITY.md) and [TODO](../TODO.md).
10. [Architectural decision records](adr/) — rationale, status and tradeoffs.

[Secure identity delegation](development/delegation.md) — implemented bounded local broker/consent profile; [analysis](architecture/secure-identity-delegation.md), [evidence](reports/2026-10-24-delegation-demo.md) and [paced video](recordings/delegation/index.html). Production/security release approval remains pending.

## ADR register

| ADR | Subject | Current interpretation |
| --- | --- | --- |
| [0001](adr/ADR-0001-superapp-and-mini-app-ecosystem.md) | Super App + Concierge | Accepted **concept**; demo exists |
| [0002](adr/ADR-0002-ag-ui-and-a2-ui-declarative-protocols.md) | UI protocol | Legacy naming retained for compatibility; standards migration proposed |
| [0003](adr/ADR-0003-backend-agent-microservices-architecture.md) | Service boundaries | REST application/provider integration implemented in the demo |
| [0004](adr/ADR-0004-microfrontend-and-mini-app-runtime.md) | Mini-app runtime | Embedded demo; federation is target |
| [0005](adr/ADR-0005-multi-flavor-frontend-adapters-react-angular-flutter.md) | Three shells | Demo implementations; parity not verified |
| [0006](adr/ADR-0006-state-security-and-event-bus.md) | State/security | Initial guards implemented; production guarantees pending |
| [0007](adr/ADR-0007-agentic-platform-langgraph-and-llm-gateway.md) | Cognitive runtime | Real bounded LangGraph approval graph; model-selected planning remains open |
| [0008](adr/ADR-0008-adoption-of-agentgateway-dev.md) | Agent gateway | Configuration candidate; compatibility must be proven |
| [0009](adr/ADR-0009-agent-first-with-bounded-authority.md) | Option A agent-first authority boundaries | Proposed for architectural review |
| [0010](adr/ADR-0010-provider-simulators-and-redis-demo.md) | Provider simulators and Redis | Implemented local demo; production boundaries remain open |
| [0011](adr/ADR-0011-local-demo-target.md) | Delivery target | Accepted local demo; bundled routes, bounded graph, MCP and explicit exclusions |
| [0012](adr/ADR-0012-secure-delegation-demo.md) | Supported JWT-grant delegation | Accepted bounded local demo; isolated broker, exact grants and online checks; production gates open |

[Documentation change history](CHANGELOG.md) · [Current execution evidence](reports/2026-10-24-demo-completion.md) · [Event stream contract](architecture/event-stream.md)

## Evidence and provenance

- Source of truth: checked-in `package.json`, `docker-compose.demo.yml`, `services/**/src`, `apps/**`, `packages/protocol-core` and tests.
- [Historical scenario transcript](reports/E2E_LIFE_SCENARIOS_RECORDING.md) and [recording viewer](recordings/index.html) describe a demonstration at the time recorded. Neither certifies the security-hardening changes after PR #1.
- Old detailed demo backlog retained at [historical backlog](history/demo-backlog-pre-production.md); current work is [TODO.md](../TODO.md).
- [Local open-source text and voice setup](development/local-ai.md) — pinned models, internal modules, privacy, sources and licences.
- [Local AI verification](reports/2026-10-24-local-ai.md) — actual inference and synthetic browser audio evidence.
- [Voice and conversational chat](architecture/voice-and-conversation.md) — drafts, spoken replies, follow-ups and verification limits.
- [MCP setup and tools](development/mcp.md) — authenticated core transport, reference client and legacy descriptor boundary.
- External specifications: [AG-UI](https://github.com/ag-ui-protocol/ag-ui), [A2UI](https://a2ui.org/), [MCP](https://modelcontextprotocol.io/) and [A2A](https://a2a-protocol.org/). Do not infer conformance from the use of names.

## Integrated provider demo

- [Run and understand the provider backends](demo/provider-backends.md): contracts, grants, embedded databases, payment semantics and Redis sessions.
- [ADR-0010](adr/ADR-0010-provider-simulators-and-redis-demo.md): implemented local-demo boundaries.
- [Provider OpenAPI contracts](../services/provider-simulator/openapi): generated, validated OpenAPI 3.1 JSON.
- [Current video viewer](recordings/index.html) and [recording guide](development/recording.md): paced real-browser journeys, assertions and synthetic-data boundaries.
- [Latest verification](reports/2026-10-24-demo-completion.md): actual tests, browser checks and remaining limitations.

Earlier dated reports, transcripts, videos and archived backlogs are historical evidence and are not overwritten by the new baseline.
