# Documentation index

Updated **23 October 2026** following security-hardening PR #1 on `main`.

## Reading order

1. [README](../README.md) — purpose, current status and quickstart.
2. [As-built architecture](architecture/system-overview.md) — components and actual execution paths.
3. [Protocol inventory](architecture/protocol-ag-ui-a2-ui.md) — custom UI/event interfaces and external standards.
4. [Service contract inventory](architecture/service-contracts.md) — simulated APIs and action flow.
5. [Agent runtime](architecture/agent-runtime.md) — what `SuperAppAgentGraph` actually does.
6. [UI and mini-apps](architecture/frontend-and-miniapps.md) — three shell implementations and integration limits.
7. [Target architecture](architecture/target-architecture.md) — planned agent-centric direction; **not current behavior**.
8. [Local development](development/local-development.md) and [testing](development/testing.md).
9. [SECURITY](../SECURITY.md) and [TODO](../TODO.md).
10. [Architectural decision records](adr/) — rationale, status and tradeoffs.

## ADR register

| ADR | Subject | Current interpretation |
| --- | --- | --- |
| [0001](adr/ADR-0001-superapp-and-mini-app-ecosystem.md) | Super App + Concierge | Accepted **concept**; demo exists |
| [0002](adr/ADR-0002-ag-ui-and-a2-ui-declarative-protocols.md) | UI protocol | Legacy naming retained for compatibility; standards migration proposed |
| [0003](adr/ADR-0003-backend-agent-microservices-architecture.md) | Service boundaries | Logical services implemented; remote integration incomplete |
| [0004](adr/ADR-0004-microfrontend-and-mini-app-runtime.md) | Mini-app runtime | Embedded demo; federation is target |
| [0005](adr/ADR-0005-multi-flavor-frontend-adapters-react-angular-flutter.md) | Three shells | Demo implementations; parity not verified |
| [0006](adr/ADR-0006-state-security-and-event-bus.md) | State/security | Initial guards implemented; production guarantees pending |
| [0007](adr/ADR-0007-agentic-platform-langgraph-and-llm-gateway.md) | Cognitive runtime | LangGraph is an architectural target, not installed |
| [0008](adr/ADR-0008-adoption-of-agentgateway-dev.md) | Agent gateway | Configuration candidate; compatibility must be proven |
| [0009](adr/ADR-0009-agent-first-with-bounded-authority.md) | Option A agent-first authority boundaries | Proposed for architectural review |

[Documentation change history](CHANGELOG.md) · [Current execution evidence](reports/2026-10-23-release-gates.md) · [Event stream contract](architecture/event-stream.md)

## Evidence and provenance

- Source of truth: checked-in `package.json`, `docker-compose.yml`, `services/**/src`, `apps/**`, `packages/protocol-core` and tests.
- [Historical scenario transcript](reports/E2E_LIFE_SCENARIOS_RECORDING.md) and [recording viewer](recordings/index.html) describe a demonstration at the time recorded. Neither certifies the security-hardening changes after PR #1.
- Old detailed demo backlog retained at [historical backlog](history/demo-backlog-pre-production.md); current work is [TODO.md](../TODO.md).
- External specifications: [AG-UI](https://github.com/ag-ui-protocol/ag-ui), [A2UI](https://a2ui.org/), [MCP](https://modelcontextprotocol.io/) and [A2A](https://a2a-protocol.org/). Do not infer conformance from the use of names.


- [Voice and conversational chat](architecture/voice-and-conversation.md) — microphone drafts, spoken replies, contextual follow-ups and verification limits.
