# Documentation changelog

## 2026-10-23 — Full documentation reconciliation

- Replaced misleading `README.md` claims of full agentic autonomy/official protocol support with an **as-built prototype** description and free-model/no-key quick start.
- Added [index](INDEX.md) and detailed [local development](development/local-development.md), [testing](development/testing.md), [agent runtime](architecture/agent-runtime.md), [service contracts](architecture/service-contracts.md), [frontend/mini-apps](architecture/frontend-and-miniapps.md), and [target architecture](architecture/target-architecture.md) guides.
- Rewrote [system overview](architecture/system-overview.md) to show direct TypeScript service calls, in-memory state and custom HTTP/SSE protocol.
- Corrected public AG-UI/A2UI terminology in [protocol guide](architecture/protocol-ag-ui-a2-ui.md); distinguished advertised `GET /mcp` tool listings from verified protocol-compliant MCP servers.
- Revisited ADR-0001–0008 with implementation statuses, and added [ADR-0009](adr/ADR-0009-agent-first-with-bounded-authority.md) for proposed Option A.
- Reorganized [TODO](../TODO.md) into prioritized P0/P1/P2 work, preserving the old historical demo checklist under [history](history/demo-backlog-pre-production.md).
- Expanded [SECURITY](../SECURITY.md) into explicit threat boundaries and release gates; marked recordings and E2E transcripts **historical**.

Documentation work is **docs-only** and does not itself validate a successful build, Keycloak integration, agentgateway syntax, model interoperability or production behavior.
