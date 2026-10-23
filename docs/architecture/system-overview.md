# System overview — implemented demo

The recommended runtime is `docker-compose.demo.yml`. It runs a real local Keycloak, Redis, six application APIs, seven provider API instances, and agent-core. The provider names describe simulators, not actual government/telecom connectivity.

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
  App->>KC: Client credentials grant
  KC-->>App: Provider-audience service token
  App->>Provider: REST + service token + trusted actor
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

Applications keep compatibility routes: mobility (4001), food/utilities (4002), wallet (4003), catalog/housing (4004), profile (4005), and telecom (4006). Providers run on 4101–4107. Application services verify user JWTs; provider services independently verify client identity, audience, realm role and account ownership. Each provider has its own SQLite volume. Profile/preferences and dining orders are persisted by their owning application service.

Redis owns conversation persistence, account binding, leases and event replay/pubsub. HTTP responses and SSE render events use the same revision. Keys expire after configurable inactivity; messages are capped at 100. SQLite business records and idempotency responses outlive conversation expiry. Logout removes browser tokens and Keycloak login state; stored conversations remain owner-protected until deletion or expiry.

The `dev:backend` runner and direct `execute*Request` exports remain a separate legacy fixture mode for offline scenarios and regression tests. They use singleton fixtures and process-local sessions. They do not provide integrated-mode isolation or durability.

A real LangGraph prepare/review/execute graph wraps the handwritten deterministic service router, with Redis-backed approval interrupts. Authenticated MCP and manual bundled routes enter the same guarded core. OpenRouter supplies grounded conversational text, not transaction authority. UI/event envelopes are project-specific rather than official AG-UI/A2UI. Remote MFE federation, agentgateway compatibility, durable workflows and production consent are still targets.

[Provider details and failure semantics](../demo/provider-backends.md) · [Authentication/security](../../SECURITY.md) · [Current verification](../reports/2026-10-24-demo-completion.md)
