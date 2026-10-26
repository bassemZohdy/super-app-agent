# ADR-0011 — Local demo delivery target

**Status:** Accepted for this delivery following the user's clarification, “it have to be demo”. **Date:** 24 October 2026.

## 26 October 2026 amendment — minimal focused runtime

The default demo is now one Node.js/TypeScript/LangGraph.js agent with embedded SQLite and JSON-fixture REST simulation. `npm start` and the executable client run without the integrated Compose dependencies. `compose.agent.yml` supplies an optional single-container configuration whose execution remains separately qualified. Deterministic identity/model adapters are explicit and do not imply production authority or real inference quality.

React remains the primary shell to adopt this API; Angular/Flutter and retained payment/delegation journeys keep their current compatibility endpoints until migrated. The older integrated-stack decision and local-AI detail below apply to that optional compatibility runtime. PostgreSQL, a separate workflow engine, mandatory gateway/registry infrastructure and compulsory protocol migration are outside the minimal demo. See [actual architecture](../architecture.md) and [current task order](../../TODO.md).

## Context and boundaries

Deliver a runnable local demonstration using synthetic city records and funds. Retain React as the primary interactive demo; Angular and Flutter web remain comparison shells with explicitly documented parity gaps. Docker Compose on localhost is the deployment target. No OpenShift/cloud deployment, actual agency/UAE PASS/PSP contracts, native app distribution or offline/air-gapped operation is selected. The initial decision allowed optional OpenRouter egress; the later local-AI amendment below supersedes that choice. The current demo uses internal open-source inference and bundled manual routes.

Architecture review applied the orchestrator's context → specialist review → synthesis sequence. AI architecture and security were selected because checkpointed approval execution, model boundaries and token/authority handling changed. Inputs were the running provider stack, repository contracts, TODO acceptance criteria and the user's demo constraint. Key quality attributes are repeatability, truthful outcomes, resource ownership and bounded reversible local operation. No external contract is inferred from a simulator's name.

## Decision

- Run a real LangGraph `StateGraph` with prepare, review interrupt and execute nodes. Persist its bounded root graph through the demo Redis saver; keep deterministic service routing and policy outside model prose. Completed/replaced/cancelled graph continuations are deleted; outstanding checkpoints have TTL. A scheduler, compensation engine and arbitrary subgraph persistence are not delivered.
- Use the official MCP TypeScript SDK for authenticated Streamable HTTP at core `/mcp`. Existing application `GET /mcp` descriptors stay compatibility metadata. A2A is deferred because no remote-agent journey is selected. agentgateway remains an unvalidated candidate; application/provider execution uses direct HTTP; the initial OpenRouter inference choice is superseded by the local-AI amendment below.
- Use repository-bundled custom UI surfaces and allowlisted `/services/{id}` routes. Load no remote JavaScript and grant no device permissions from a manifest. This closes the demo loading decision without asserting Module Federation, signatures for remote bundles, Lit or official AG-UI/A2UI conformance.
- Require subject/account/revision-bound, expiring, digest-checked one-time approvals. Cancellation prevents a pending action. Keep at most 50 lifecycle entries with the conversation. Broader delegation, proactive effects and scheduled grants were deferred in this initial decision; ADR-0012 subsequently accepts bounded exact-operation demo grants, not recurring payment execution.
- Verify access-token type, issuer/audience, bounded claims and signature using shared bounded JWKS logic. Integrated mode introspects each new request through a separate confidential verifier. Browser login uses PKCE; Flutter's seeded password login remains local-demo only. Existing SSE connections are not immediately terminated by every remote logout.
- Restrict demo inference to official OpenRouter HTTPS with zero-priced provider routing, bounded context/output/time and per-actor request quotas. Keep the supplied environment key private. That initial experiment observed an external HTTP 401, not a passing generation test; the subsequent local-AI amendment replaces this inference choice.

## Acceptance and tradeoffs

The [initial acceptance report](../reports/2026-10-24-demo-completion.md) records its dated gates, exceptions and mapping of original TODO groups. [what exists today](../../README.md#what-exists-today) and the [evidence register](../reports/README.md) identify subsequent implementation and checks. The original production criteria remain visible and unchecked where only part is delivered. [TODO](../../TODO.md) remains the source of remaining requirements; this ADR does not waive or relabel unfinished features as complete.

Source mounts and public demo credentials make the local stack easy to inspect and reset, but are unsuitable for public deployment. Redis AOF `everysec` plus SQLite provides ordinary restart persistence. P2-02 subsequently adds tested local cold backup/restore and fenced recovery; replicated HA, lossless external transactions and production disaster recovery remain unqualified. Three reference renderers cost more maintenance and do not imply identical component/accessibility/device support.

## Follow-up triggers

A real provider contract, public hosting request, remote-agent requirement, remote mini-app deployment, native distribution, scheduled payment or offline operation reopens the relevant architecture and security acceptance criteria before that capability is advertised.

## Subsequent accepted demo amendments

- **Local open-source AI:** the user selected internal text and voice. Private Qwen/llama.cpp plus KittenTTS/Whisper replace active hosted inference. VoiceStudio integration is unnecessary. The earlier OpenRouter routing and HTTP 401 observation remain initial-decision history; its helper is retained for explicit diagnostics/tests only. [Setup and licences](../development/local-ai.md).
- **Bounded delegated identity:** [ADR-0012](ADR-0012-secure-delegation-demo.md) accepts the supported RFC 7523 broker, current exact grants and limited synthetic writes. It does not authorize general recurring spending or preview features.
- **Local operating quality:** P2-02 at `cd3c7d5` adds private telemetry, dependency readiness, graceful shutdown, load/soak and encrypted cold recovery with explicit RPO/RTO procedures. It does not add a replicated production deployment or automated off-host backups. [Runbook](../development/operations.md).

[what exists today](../../README.md#what-exists-today) and [remaining tasks](../../TODO.md) supersede earlier checkpoint summaries without changing the local-only delivery target.
