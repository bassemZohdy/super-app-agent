# Documentation index

The [README](../README.md) describes what exists today, [TODO.md](../TODO.md) is the only tracker of open work, the [changelog](CHANGELOG.md) is the delivered record and the [evidence register](reports/README.md) says what was verified and when. Dated reports and recordings preserve their own checkpoint facts.

## Focused agent

[Architecture](architecture.md), [agent flow](agent-flow.md), [integrations/API](integrations.md), [security](security.md) and [testing](testing.md) describe the one-process SQLite implementation. The guides below continue to describe the preserved integrated compatibility demo where indicated.

## Reading order

1. [README](../README.md) — purpose and quickstart.
2. [What exists today](../README.md#what-exists-today) — implemented scope and its explicit limits.
3. [Local development](development/local-development.md) and [testing](development/testing.md).
4. [System overview](architecture/system-overview.md), [service contracts](architecture/service-contracts.md), [agent runtime](architecture/agent-runtime.md) and [frontend shells](architecture/frontend-and-miniapps.md).
5. [Custom protocol inventory](architecture/protocol-ag-ui-a2-ui.md) and [authenticated event stream](architecture/event-stream.md).
6. [Operations/recovery](development/operations.md), [security](../SECURITY.md) and [evidence register](reports/README.md).
7. [Target architecture](architecture/target-architecture.md), [payment/automation plan](architecture/payment-automation-demo.md) and [backlog](../TODO.md) for proposed work.

## Setup, identity and local AI

| Guide | Scope |
| --- | --- |
| [Provider backends](demo/provider-backends.md) | Reference stack, signed HTTP boundaries, account-owned resources and simulator contracts |
| [Application API](development/application-api.md) | Six application services, 46 integrated operations, authentication, probes and contract generation |
| [MCP](development/mcp.md) | Authenticated core Streamable HTTP and compatibility descriptors |
| [Delegation](development/delegation.md) | Supported RFC 7523 broker, exact grants, consent, execution/revocation and rollback |
| [Local text/voice](development/local-ai.md) | Internal open-source models, setup, licences and troubleshooting |
| [Voice/conversation design](architecture/voice-and-conversation.md) | Reviewable dictation, opt-in speech and device/language limits |
| [Design tokens](development/design-tokens.md) | One layered source for React, Angular and Flutter constants, drift check and the raw-color ratchet |
| [Recording](development/recording.md) | Twelve provider journeys, asserted waits, pacing and artifact retention |
| [Operations](development/operations.md) | Private telemetry, readiness, SLOs, cold backup, restore and fenced failover |

## Payments and simulation

Payments use synthetic funds only. Automatic execution is disabled; open work is in [TODO.md](../TODO.md).

| Guide | Delivered behavior or remaining boundary |
| --- | --- |
| [Payment accounts](development/payment-accounts.md) | Owned billers, synthetic saved cards, current sources and quote APIs |
| [Journal/migration](development/payment-ledger.md) | Balanced entries, wallet projection, holds and retained migration backups |
| [Authorization](development/payment-authorization.md) | Stored wallet/card reviews, exact source/amount, expiry and challenge |
| [Payables](development/payables.md) | Provider-owned current/closed obligations, revisions and history |
| [Settlement claims](development/settlement-claims.md) | Authenticated merchant claims, provider fences and refund exclusion |
| [Bill checkout](development/payment-checkout.md) | Explicit capture, source admission, original status/recovery |
| [Wallet funding](development/wallet-funding.md) | Saved-card capture and atomic wallet credit |
| [Fine checkout](development/fine-checkout.md) | Exact owned fine sets and reviewed wallet/card payment |
| [Recharges](development/provider-recharges.md) | Toll/prepaid target, quote, capture and settlement |
| [Grouped checkout](development/checkout-groups.md) | Sequential one-source child payments and visible partial outcomes |
| [Refunds](development/payment-refunds.md) | Original-source reversals and conservative uncertain outcomes |
| [Financial events](development/payment-events.md) | Signed outbox/inbox, delivery leases and inspection-only callbacks |
| [Issuer scenarios](development/issuer-scenarios.md) | Isolated operator-bound finite issuer outcomes |
| [Mandates](development/payment-mandates.md) | Finite consent records; execution disabled |
| [Automation worker](development/automation-worker.md) | Off-by-default leased jobs; no schedule yet |
| [Payment surfaces](development/payment-surfaces.md) | Shared explicit review, challenge, pay, cancel and recovery actions |
| [Reconciliation](development/payment-reconciliation.md) | Owned evidence-bound inspections and guarded original-operation actions |
| [History/receipts](development/payment-history.md) | Snapshot-paginated journals/activity and original-source details |
| [Owner/source lifecycle](development/payment-lifecycle.md) | Current permission versions, revocation and retained in-flight state |
| [Business obligations](development/payment-obligations.md) | Invoice/fine/recharge exclusion and original capture identities; AUTO qualification open |
| [Preview simulator](development/simulator.md) | Persisted business clock/due-event preview; no execution authority |

[Payment/automation design](architecture/payment-automation-demo.md) separates implemented payments from planned services. [Automation threat model](architecture/payment-automation-security.md) and [proposed AUTO-03 contract](architecture/automation-permit-contract.md) gate future permits, shared budgets and unattended execution. [Delegation analysis](architecture/secure-identity-delegation.md) preserves the original blueprint assessment; current implementation is in the guide and ADR-0012.

## ADR register

| ADR | Current interpretation |
| --- | --- |
| [0001 — product](adr/ADR-0001-superapp-and-mini-app-ecosystem.md) | Accepted concept; local demonstration |
| [0002 — UI protocols](adr/ADR-0002-ag-ui-and-a2-ui-declarative-protocols.md) | Custom naming retained; standards migration proposed |
| [0003 — service boundaries](adr/ADR-0003-backend-agent-microservices-architecture.md) | REST application/provider boundaries implemented |
| [0004 — mini-app runtime](adr/ADR-0004-microfrontend-and-mini-app-runtime.md) | Bundled surfaces; remote federation remains proposed |
| [0005 — three shells](adr/ADR-0005-multi-flavor-frontend-adapters-react-angular-flutter.md) | React primary; comparison shells have explicit parity gaps |
| [0006 — state/security](adr/ADR-0006-state-security-and-event-bus.md) | Demo guards and recovery; production guarantees open |
| [0007 — cognitive runtime](adr/ADR-0007-agentic-platform-langgraph-and-llm-gateway.md) | Bounded LangGraph reviews; model-selected plans open |
| [0008 — agentgateway](adr/ADR-0008-adoption-of-agentgateway-dev.md) | Unvalidated configuration candidate, outside active execution |
| [0009 — agent-first authority](adr/ADR-0009-agent-first-with-bounded-authority.md) | Proposed architecture |
| [0010 — providers/Redis](adr/ADR-0010-provider-simulators-and-redis-demo.md) | Implemented local demo; production boundaries open |
| [0011 — delivery target](adr/ADR-0011-local-demo-target.md) | Accepted local-only target; later AI/delegation/operations amendments apply |
| [0012 — delegated identity](adr/ADR-0012-secure-delegation-demo.md) | Accepted supported JWT-grant demo; production gates open |

## Evidence and provenance

- [Execution register](reports/README.md): latest operating evidence first, then dated feature checkpoints.
- [Operations/recovery evidence](reports/2026-10-24-operations.md): 533 tests, 18 builds, signed load/soak and actual durable-state/dependency recovery.
- [Local AI evidence](reports/2026-10-24-local-ai.md): CPU text/speech/dictation and synthetic browser audio; physical/native device limits remain.
- [Dependency triage](reports/2026-10-24-dependency-triage.md): dated audit/dispositions; no fresh dependency scan is implied by a documentation update.
- [Provider contracts](../services/provider-simulator/openapi) and [application contract](../packages/backend-kit/openapi/application-apis.openapi.json): generated from runtime tables, with request/response coverage limits documented in the guides.
- [Provider recording viewer](recordings/index.html), [delegation viewer](recordings/delegation/index.html), and the payment viewers linked by each guide preserve successful dated runs. A recording does not certify later source changes.
- [Historical transcript](reports/E2E_LIFE_SCENARIOS_RECORDING.md), [archived demo backlog](history/demo-backlog-pre-production.md) and [changelog](CHANGELOG.md) retain prior observations.
- Repository source, contracts and tests define current behavior; target designs and unimplemented checkboxes do not.

External standards: [AG-UI](https://github.com/ag-ui-protocol/ag-ui), [A2UI](https://a2ui.org/), [MCP](https://modelcontextprotocol.io/) and [A2A](https://a2a-protocol.org/). Existing custom UI/event names do not establish conformance.
