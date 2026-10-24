# System overview — implemented demo

The recommended runtime is `docker-compose.demo.yml`. It runs a real local Keycloak, Redis, six application APIs, seven provider API instances, agent-core and a separate trusted delegation broker on 4010. The provider names describe simulators, not actual government/telecom connectivity. [Delegation flow, grant contracts and key isolation](../development/delegation.md) · [ADR-0012](../adr/ADR-0012-secure-delegation-demo.md).

```mermaid
sequenceDiagram
  actor User
  participant Shell
  participant KC as Keycloak
  participant Core as Agent core
  participant Redis
  participant App as Application API
  participant Provider
  participant DB as Provider SQLite
  User->>Shell: Sign in and select account
  Shell->>KC: Authorization code + PKCE
  KC-->>Shell: User access token
  Shell->>Core: Intent or manual service + bearer + accountId
  Core->>Redis: Check owner/account and acquire lease
  Core->>App: REST + verified-user bearer + account reference
  App->>Provider: REST + signed interactive user token + account
  Provider->>DB: Check ownership and read account resources
  DB-->>Provider: Account-owned result
  Provider-->>App: Validated resource data
  App-->>Core: Application contract
  Core->>Core: LangGraph prepares surface; optional model text for chat
  Core->>Redis: Checkpoint review interrupt; save approval/state/events
  Core-->>Shell: Surface and assistant reply
  User->>Shell: Review and confirm, or cancel
  Shell->>Core: Action or cancellation + current revision + bearer
  Core->>Core: Validate ownership, expiry, view digest and exact parameters
  alt Confirm approved action
    Core->>Redis: Resume saved graph review
    Core->>App: Checked domain action
    App-->>Core: Confirmed result or truthful failure
  else Cancel pending proposal
    Core->>Redis: Delete saved graph continuation
  end
  Core->>Redis: Save new surface and bounded approval history
  Core-->>Shell: Result or cancellation surface
```

Applications keep compatibility routes: mobility (4001), food/utilities (4002), wallet (4003), catalog/housing (4004), profile (4005), and telecom (4006). Providers run on 4101–4107. Applications and providers verify signed user identity and ownership. A delegated broker token additionally needs a current exact grant/binding check; only the broker mounts its keys/grant volume. The separate settlement-proof client retains limited machine read access. Each provider has its own SQLite volume. Profile/preferences and dining orders are persisted by their owning application service.

Redis owns conversation persistence, account binding, leases and event replay/pubsub. HTTP responses and SSE render events use the same revision. Keys expire after configurable inactivity; messages are capped at 100. SQLite business records and idempotency responses outlive conversation expiry. Logout removes browser tokens and Keycloak login state; stored conversations remain owner-protected until deletion or expiry.

The `dev:backend` runner and direct `execute*Request` exports remain a separate legacy fixture mode for offline scenarios and regression tests. They use singleton fixtures and process-local sessions. They do not provide integrated-mode isolation or durability.

A real LangGraph prepare/review/execute graph wraps the handwritten deterministic service router, with Redis-backed approval interrupts. Authenticated MCP and manual bundled routes enter the same guarded core. Private CPU llama.cpp/Qwen supplies conversational text; internal KittenTTS/Whisper supplies English speech and English/Arabic draft dictation. No hosted text/speech inference is used. Model prose has no transaction authority. [Local AI setup](../development/local-ai.md). UI/event envelopes are project-specific rather than official AG-UI/A2UI. Remote MFE federation, agentgateway compatibility, durable workflows and production consent are still targets.

[Provider details and failure semantics](../demo/provider-backends.md) · [Authentication/security](../../SECURITY.md) · [Execution evidence](../reports/README.md)

The next [payment accounts/automation extension](payment-automation-demo.md) has delivered the first linked-biller/saved-method setup and non-executable preview slice in React. A balanced local journal and checked wallet projection are implemented. Owned prepaid/vehicle discovery, lifecycle guards and source-owned payable revisions/history are implemented, as is a separate preview-only scenario clock. Stored authorization reviews and finite issuer/wallet holds are implemented. Capture/settlement through stored bill orders is implemented. Fine/recharge execution, wallet funding, grouped checkout, original-source refunds and finite consent records are implemented. A worker and general execution-scenario controls remain planned; consent records alone cannot execute an automatic payment. [Current setup/API guide](../development/payment-accounts.md).

Existing provider HTTP settlement now adds a durable gateway claim and a local PENDING/APPLIED/RELEASED fence around proof consumption. Separate provider workload clients can acknowledge/release only their own merchant claims. Gateway refund admission checks those claims atomically; historical uncertain application stays blocked until reconciled. [Settlement protocol](../development/settlement-claims.md).

[Current lifecycle authority](../development/payment-lifecycle.md) adds authoritative owner/workspace permission epochs in payments, machine-authenticated eligibility reads, exact operator CAS/audit, core/application/provider/broker checks and atomic capture fencing. Financial/conversation history remains retained across restriction; restored access requires new approvals. React lists original in-flight identities without moving rules between sources or workspaces.

## Local operations plane (P2-02)

The Node boundaries share an AsyncLocalStorage correlation context, server/client/tool spans, bounded metrics and structured payload-free completion logs. Gateway, six applications, seven providers and broker expose private key-protected `/ops/state` and Prometheus `/ops/metrics`. Probes distinguish process liveness from each process's critical local SQLite/Redis dependency. Current durable capture/job aggregates complement process-local active work. Diagnostic IDs do not participate in authorization or money replay.

The reference deployment adds rotated Node logs, readiness checks, init and bounded graceful shutdown. Cold authenticated-encryption bundles preserve the complete durable service set and signing identity. Restore creates a fresh directory; operator fencing permits one writer to resume with original replay/consent controls. This is manual local availability and recovery, not a replicated production architecture. [Runbook](../development/operations.md) · [Executed evidence](../reports/2026-10-24-operations.md).
