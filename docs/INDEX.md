# Documentation index

Updated **24 October 2026**: provider/Redis, supported Keycloak delegation and local text/voice foundation `283521a`; payment setup `65fec3c`; journal `58dc0dd`; the [evidence register](reports/README.md) identifies current lifecycle/preview additions and groups execution results. Dated reports retain their original observations; proposed work is never counted as implemented.

The bounded delegation extension is documented in [ADR-0012](adr/ADR-0012-secure-delegation-demo.md). The latest delivered text/speech checks are in [the local AI report](reports/2026-10-24-local-ai.md).

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

## Payment accounts and next demo work

[Payment accounts and automation design](architecture/payment-automation-demo.md) defines linked biller accounts, wallet/cards, bounded automatic payments/services and an isolated simulator. [The 50-task backlog (24 slices delivered, 26 open)](../TODO.md#payment-accounts-and-automation-demo--planned-backlog) is the authoritative implementation checklist. PAY-01–PAY-07, PAY-09–PAY-21, AUTO-01–AUTO-02, SIM-03 and preview-only SIM-01 are delivered. [Current lifecycle/scenario evidence](reports/2026-10-24-lifecycle-simulator.md) defines their tested boundary. [Current usage](development/payment-accounts.md) and [execution evidence](reports/2026-10-24-payment-checkout.md) describe quote review, explicit authorization and confirmed wallet/card bill payment. [Planning and cleanup record](reports/2026-10-24-payment-planning.md) preserves the initial planning observations and records this backlog review.

[Balanced journal and migration](development/payment-ledger.md) · [Actual three-wallet migration and regression evidence](reports/2026-10-24-payment-ledger.md). Stored authorization reviews are implemented; bill/fine/recharge capture and original-source refunds are implemented; automatic execution remains planned.

[Stored authorization reviews and finite issuer](development/payment-authorization.md) · [Authorization evidence](reports/2026-10-24-payment-authorization.md).

[Provider-owned payable revisions and history](development/payables.md) · [Verification and remaining capture boundary](reports/2026-10-24-payables.md). PAY-06 capture criteria are now covered by the bill and exact-set fine flows.

[Preview simulator CLI](development/simulator.md) — persistent isolated business time and due events; no financial execution or network admin controls.

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

[Documentation change history](CHANGELOG.md) · [Current execution evidence](reports/README.md) · [Event stream contract](architecture/event-stream.md)

## Evidence and provenance

- Source of truth: checked-in `package.json`, `docker-compose.demo.yml`, `services/**/src`, `apps/**`, `packages/protocol-core` and tests.
- [Historical scenario transcript](reports/E2E_LIFE_SCENARIOS_RECORDING.md) describes the earlier fixture demonstration. The [current recording viewer](recordings/index.html) has twelve asserted provider journeys; the [delegation viewer](recordings/delegation/index.html) covers its separate dated broker profile. Recordings do not certify subsequent changes or production security.
- Old detailed demo backlog retained at [historical backlog](history/demo-backlog-pre-production.md); current work is [TODO.md](../TODO.md).
- [Local open-source text and voice setup](development/local-ai.md) — pinned models, internal modules, privacy, sources and licences.
- [Local AI verification](reports/2026-10-24-local-ai.md) — actual inference and synthetic browser audio evidence.
- [Voice and conversational chat](architecture/voice-and-conversation.md) — drafts, spoken replies, follow-ups and verification limits.
- [MCP setup and tools](development/mcp.md) — authenticated core transport, reference client and legacy descriptor boundary.
- [Application API onboarding](development/application-api.md) — the six integrated application services, bearer calls, probes and the generated OpenAPI contract.
- [Production dependency triage](reports/2026-10-24-dependency-triage.md) — the five production audit advisories, their evidence-based dispositions, the ajv upgrade and the open Angular and zod items.
- External specifications: [AG-UI](https://github.com/ag-ui-protocol/ag-ui), [A2UI](https://a2ui.org/), [MCP](https://modelcontextprotocol.io/) and [A2A](https://a2a-protocol.org/). Do not infer conformance from the use of names.

## Integrated provider demo

- [Run and understand the provider backends](demo/provider-backends.md): contracts, grants, embedded databases, payment semantics and Redis sessions.
- [ADR-0010](adr/ADR-0010-provider-simulators-and-redis-demo.md): implemented local-demo boundaries.
- [Provider OpenAPI contracts](../services/provider-simulator/openapi): generated, validated OpenAPI 3.1 JSON.
- [Current video viewer](recordings/index.html) and [recording guide](development/recording.md): paced real-browser journeys, assertions and synthetic-data boundaries.
- [Evidence register](reports/README.md): current and historical results with their verified scope.

Earlier dated reports, transcripts, videos and archived backlogs are historical evidence and are not overwritten by the new baseline.

[Settlement claims, provider fences and conservative migration](development/settlement-claims.md) · [Race/identity/upgrade evidence](reports/2026-10-24-settlement-claims.md). Existing provider HTTP payments and stored bill/fine/recharge captures use the guard; automatic callers retain separate integration gates.

[Wallet/card bill capture, provider admission and recovery](development/payment-checkout.md) · [End-to-end evidence](reports/2026-10-24-payment-checkout.md).

[Saved-card wallet funding](development/wallet-funding.md) · [Execution evidence](reports/2026-10-24-wallet-funding.md) · [Paced recording](recordings/wallet-funding/index.html).

[Exact-set fine payments](development/fine-checkout.md) · [Wallet/card, race and lifecycle evidence](reports/2026-10-24-fine-checkout.md) · [Paced recording](recordings/fine-checkout/index.html).

[Provider recharge guide](development/provider-recharges.md) · [Six-provider/funding journey evidence](reports/2026-10-24-provider-recharges.md) · [Paced recording](recordings/recharge-checkout/index.html).

[Grouped checkout guide](development/checkout-groups.md) · [Success/partial evidence](reports/2026-10-24-checkout-groups.md) · [Paced recording](recordings/checkout-groups/index.html).

[Original-source refund guide](development/payment-refunds.md) · [Refund evidence](reports/2026-10-24-payment-refunds.md) · [Paced recording](recordings/payment-refunds/index.html).

[Signed financial events and recovery hints](development/payment-events.md) · [Scoped PAY-18 evidence](reports/2026-10-24-payment-events.md) · [Paced callback recovery recording](recordings/payment-events/index.html). The subsequent retained-path report completes PAY-18 for current manual paths.

[Isolated issuer scenario guide](development/issuer-scenarios.md) · [Eight-outcome evidence](reports/2026-10-24-issuer-scenarios.md) · [Paced recording](recordings/issuer-scenarios/index.html).

[Finite mandate consent](development/payment-mandates.md) and [signed verification](reports/2026-10-24-payment-mandates.md) document AUTO-01. Consent recording leaves execution disabled; the editor, permits, budgets and worker remain separate tasks.

[Conversational payment review parity](development/payment-surfaces.md) · [signed evidence](reports/2026-10-24-payment-surfaces.md) · [paced recording](recordings/payment-surfaces/index.html). PAY-07 now uses explicit source selection and original-order cancellation/recovery in the service workspace.

[Retained payment-event qualification](reports/2026-10-24-legacy-payment-events.md) completes PAY-18 for current manual paths, including legacy/parking and mixed v1/v2 delivery. [Guide](development/payment-events.md) · [Recording](recordings/legacy-payment-events/index.html).

[Owned payment reconciliation](development/payment-reconciliation.md) · [Recovery/restart evidence](reports/2026-10-24-payment-reconciliation.md) · [Paced recording](recordings/payment-reconciliation/index.html). PAY-19 is delivered; automatic admission and general fault controls keep their separate gates.

[Statements and original-source receipts](development/payment-history.md) · [Pagination/accounting evidence](reports/2026-10-24-payment-history.md) · [Paced recording](recordings/payment-history/index.html). PAY-20 is delivered; owner/source lifecycle and automatic execution retain separate gates.

[Automation authority/threat model](architecture/payment-automation-security.md) · [Hardening and signed authority evidence](reports/2026-10-24-automation-security.md). AUTO-02 completes the security contract; permits, shared budgets, owner lifecycle and workers remain gated.

[Current owner/workspace lifecycle](development/payment-lifecycle.md) · [Signed lifecycle qualification](reports/2026-10-24-payment-lifecycle.md) · [Paced restricted/restored access recording](recordings/payment-lifecycle/index.html). Owner/membership/source changes retain original IDs and require new authority; scheduled spending remains disabled.

[Gateway business reservations and capture attempts](development/payment-obligations.md) · [Checkpoint evidence](reports/2026-10-24-payment-obligations.md) · [Paced recording](recordings/payment-obligations/index.html). PAY-08 stays open until the actual automatic path shares the same exclusion and budget/occurrence gates.

[Stable application handoff](development/handoff.md) — user-requested pause at verified application checkpoint `79cd691`; proposed AUTO-03 design and local WIP archive location.
