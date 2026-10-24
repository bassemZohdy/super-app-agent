# Cityside — Super App Agent

A runnable city-services demo with a conversational concierge, independently persisted provider APIs, Keycloak authentication, Redis sessions, and a checkpointed LangGraph approval flow. RTA, DEWA, Etisalat, du, Dubai Police and Dubai Land Department are **simulated entities**. Payments use simulated funds; no real government or financial system is connected.

## Run the integrated demo

Requires Node.js 24+, npm, and Docker Compose. Install dependencies before starting the containers: the demo mounts this checkout and its installed backend dependencies read-only.

```bash
npm ci --ignore-scripts
cp .env.example .env  # first setup only; preserve an existing .env
npm run demo:up
npm run dev:react
```

Open [React](http://localhost:3000), sign in with Keycloak, and choose **bassem** or **demo-commuter**, password **demo123**. Each user has separate personal and household accounts. `demo:up` waits for Keycloak, broker and application/provider health, then safely reconciles the demo identity/delegation configuration. The first setup builds the internal CPU speech service and downloads roughly 1.4 GB of revision-pinned open-source text/voice models. No cloud key is required. Set `ENABLE_LOCAL_LLM=false` for deterministic text replies; speech remains local. [Local AI setup and licences](docs/development/local-ai.md).

Open **Delegated access** to approve bounded wallet reads or one exact AED 1 synthetic credit, run the approved operation, inspect audit history and revoke consent. A separate trusted broker uses supported Keycloak RFC 7523, private-key client authentication and current provider-side grant checks. No preview features or custom actor mapper are used. [Delegation guide](docs/development/delegation.md) · [Decision](docs/adr/ADR-0012-secure-delegation-demo.md) · [Verification](docs/reports/2026-10-24-delegation-demo.md) · [Paced recording](docs/recordings/delegation/index.html).

`npm run dev:angular` serves the Angular shell at http://localhost:3001. Flutter has local-demo sign-in and account/history controls. Use Flutter 3.47+ and Dart 3.13+; web compilation and widget checks are covered in the current report. Native execution remains unverified.

```bash
npm run demo:wait       # readiness only; also run automatically by demo:up
npm run demo:verify:journeys # all provider payment and move-in flows
npm run demo:verify     # real local Keycloak + REST + payments + Redis checks
npm run test:redis      # distributed locks, ownership, JSON persistence and replay
npm run demo:verify:manual   # bundled routes + cancellation + authenticated MCP
npm run demo:verify:security # access/ID token separation and logout revocation
npm run demo:verify:delegation # linked identity, workload, seven providers and bounded write
npm run demo:verify:delegation:security # real assertion attacks and token/grant revocation
npm run demo:verify:restart  # resume a saved LangGraph approval after restart
npm run local-ai:verify # actual local text → speech → dictation checks
npm run local-ai:test   # private speech API security and boundary tests
npm run check          # ESLint, docs/secrets, Node tests and workspace builds
npm run demo:logs
npm run demo:down       # stops containers; preserves databases
```

Do not run the integrated stack and `dev:backend` simultaneously: both use ports 4000–4006. [Full setup, credentials and troubleshooting](docs/development/local-development.md).

## What runs

```mermaid
flowchart LR
  Shell[React / Angular / Flutter] -->|User access token| Core[Concierge API]
  Shell -->|Sign in| KC[Keycloak]
  Core --> Redis[(Redis sessions / locks / replay)]
  Core -->|REST + user identity + account| Apps[Application microservices]
  Apps -->|Signed interactive user token| Providers[RTA / DEWA / Etisalat / du / Police / DLD]
  Core -->|Explicit consent / execution facade| Broker[Trusted delegation broker]
  Broker -->|RFC 7523 + private-key client authentication| KC
  Broker --> Grants[(Grant / binding / operation SQLite)]
  Broker -->|Bound short-lived user token| Providers
  Providers -->|Current grant check| Broker
  Apps --> Payments[Payment gateway simulator]
  Providers -->|Check captured payment| Payments
  Providers --> SQLite[(Separate SQLite database per entity)]
  Payments --> Ledger[(Payment SQLite ledger)]
  Core -->|Bounded conversation| LLM[Local llama.cpp / Qwen]
  Core -->|Speech / dictation| Voice[Internal KittenTTS / Whisper]
```

| Layer | Components | Persistence / responsibility |
| --- | --- | --- |
| Shells | Cityside React, Angular, Flutter | Presentation, sign-in and account selection; browsers use code + PKCE |
| Concierge | `services/agent-core` | LangGraph prepare/review/execute graph, authenticated MCP, manual routes and bound approvals |
| Application APIs | ride, food/utilities, wallet, catalog/housing, profile, telecom | Validate user JWTs and accounts; forward signed interactive identity to providers |
| Delegation | Separate broker on 4010 | Explicit consent, private-key JWT exchange, exact token/grant bindings and atomic execution limits; keys isolated from agent-core |
| Provider APIs | `services/provider-simulator`, seven independently configured instances | Versioned REST, OpenAPI 3.1, verified user/grant authorization, account-owned SQLite state and idempotency |
| Local AI | CPU llama.cpp/Qwen, internal KittenTTS/Whisper | Private Docker services, pinned model volume; no hosted inference |
| Identity | Seeded Keycloak realm | End-user authentication and distinct confidential service accounts |
| Session store | Redis with append-only persistence | Owner/account binding, transcript, surfaces, reconciliation state, TTL, leases and shared SSE replay |

The food-named application service still owns utilities for compatibility. `service-telecom` integrates both telecom entities. Profile/preferences and food orders use account-scoped application SQLite storage. The lightweight fixture runner remains available for historical scenarios and tests; it is not the isolated integration stack.

## Provider APIs and OpenAPI

| Simulator | Port | OpenAPI | Main resources |
| --- | --- | --- | --- |
| RTA | 4101 | [Contract](services/provider-simulator/openapi/rta.openapi.json) | parking, rides, Salik, EV charging, residential permits |
| DEWA | 4102 | [Contract](services/provider-simulator/openapi/dewa.openapi.json) | meter consumption, bills, connections |
| Etisalat | 4103 | [Contract](services/provider-simulator/openapi/etisalat.openapi.json) | subscriptions, plans, bills |
| du | 4104 | [Contract](services/provider-simulator/openapi/du.openapi.json) | subscriptions, plans, bills |
| Dubai Police | 4105 | [Contract](services/provider-simulator/openapi/police.openapi.json) | fines and settlements |
| Land/tenancy | 4106 | [Contract](services/provider-simulator/openapi/dld.openapi.json) | tenancy and move-in proposals |
| Payment gateway | 4107 | [Contract](services/provider-simulator/openapi/payments.openapi.json) | wallets, top-ups, capture, declines, refunds, transaction history |

Each exposes `/health` and `/openapi.json`. Protected resources use `/v1/accounts/{accountId}/…`; writes require `Idempotency-Key`. See [provider integration guide](docs/demo/provider-backends.md) for grants, examples, exact payment semantics and limits.

## Model behavior and limits

Local Qwen2.5-1.5B-Instruct replies use bounded recent messages and current service results. llama.cpp runs CPU-only behind the authenticated core; model errors stay visible. `/health` probes actual model readiness. Requests enforce a 24 KiB context budget, 192 output tokens, a 45-second timeout and per-actor call/concurrency limits. The retained OpenRouter diagnostic/helper is historical and unused by application inference; an existing private key is neither needed nor forwarded by the demo.

React and Angular offer **Conversation settings → Voice studio** with four local presets, speed, preview and stop controls. Dictation becomes an editable draft; **Send** and service confirmation stay explicit. English spoken replies are opt-in; English/Arabic dictation is available, with Arabic replies as text. No browser speech/cloud fallback or voice cloning is enabled. [Voice behavior](docs/architecture/voice-and-conversation.md) · [Original sample](docs/assets/voice/rashid-preview.wav) · [Executed checks](docs/reports/2026-10-24-local-ai.md).

LangGraph runs prepare → persisted review interrupt → confirmed execution, with Redis checkpoints in integrated mode. Routing remains deterministic; the model supplies conversation text. Official AG-UI/A2UI, scheduled/compensating workflows, production consent, remote mini-app loading and real government integrations remain outside this demo. The legacy AG-UI/A2-UI names describe a project-specific JSON surface and event protocol.

The demo uses known credentials, local HTTP, Redis AOF `everysec`, and embedded databases. It is intended for local development. [Security boundaries](SECURITY.md), [remaining work](TODO.md), [execution evidence](docs/reports/README.md).

React service links also work directly, for example [Wallet](http://localhost:3000/services/wallet), without a prior concierge proposal or model call. The bundled route registry and authenticated MCP transport are described in [the demo target decision](docs/adr/ADR-0011-local-demo-target.md) and [MCP guide](docs/development/mcp.md).

## Record the demo

`npm run test:e2e` checks twelve authenticated browser journeys against isolated temporary provider data. `npm run test:video` records the same journeys with **6-second review and 8-second receipt pauses**, then creates MP4/WebM, captions and measured chapters. Your running demo data is preserved. [Setup, pacing and artifact guide](docs/development/recording.md).

```bash
npm run recordings:serve
```

Watch [the latest recording](http://localhost:3300) or open its [checked-in viewer](docs/recordings/index.html).

## Payment accounts and planned automation

Open **Payment accounts** in React to save synthetic card presets, link provider-verified biller references and review a fresh quote with your chosen source. Prepaid/vehicle discovery, defaults, disabled cards, account switching, source versions and active-use removal guards are checked; the preview does not move funds. Linked bill/fine history now shows source-owned revisions, due/closed states and seeded prior cycles. Bill service payments share the stored wallet-order flow. [Guide and compatibility](docs/development/payment-accounts.md) · [Executed checks](docs/reports/2026-10-24-payment-checkout.md).

[Stored authorization reviews](docs/development/payment-authorization.md) now support explicit owner approval, finite card/wallet holds, one-time demo challenges and cancellation. Bills now have a separate explicit Pay action with provider admission, capture, recovery and confirmed receipts. Run `npm run demo:verify:payment-authorization` for its isolated browser verification.

Current wallet payments now append balanced journal entries, with one-time legacy balance migration and checked posted/held/available funds. [Journal and recovery guide](docs/development/payment-ledger.md) · [Live migration evidence](docs/reports/2026-10-24-payment-ledger.md).

The [payment backlog](TODO.md#payment-accounts-and-automation-demo--planned-backlog) tracks 50 tasks: 13 slices delivered and 37 open. The remaining work covers broader payable/review integration, mobile/toll top-ups, grouped checkout and refunds, bounded autopay/automatic services and deterministic clock/failure simulation. [Full design](docs/architecture/payment-automation-demo.md).

Use `npm run simulator:verify` to try the persisted preview-only business clock across separate processes. It emits descriptive due events and resets its isolated run without touching provider funds. [Commands and limits](docs/development/simulator.md) · [Lifecycle/scenario evidence](docs/reports/2026-10-24-lifecycle-simulator.md). Other payable types, refunds/reversals and automatic execution remain in the backlog.

## Documentation

[Documentation index](docs/INDEX.md) · [System overview](docs/architecture/system-overview.md) · [Provider contracts](docs/architecture/service-contracts.md) · [Session and stream behavior](docs/architecture/event-stream.md) · [Testing](docs/development/testing.md) · [Change history](docs/CHANGELOG.md)

License: MIT.

[Settlement claims and refund guards](docs/development/settlement-claims.md) now protect existing provider payments from stale-proof/refund races. Old unrefunded captures are conservatively marked unknown until source reconciliation; the migration preserves balances and history. Bill capture is now enabled through approved orders; autopay remains open.

[End-to-end wallet/card bill payments](docs/development/payment-checkout.md): authorize, explicitly Pay, inspect a provider-confirmed receipt, or recover the original pending payment. Existing conversational bill payments share the same wallet-order path.

[Saved-card wallet funding](docs/development/wallet-funding.md) now provides review, bound authorization/challenge, explicit card capture and one balanced wallet credit. [Watch its paced recording](docs/recordings/wallet-funding/index.html) or run `npm run record:wallet-funding`.

[Exact-set fine payments](docs/development/fine-checkout.md) now support wallet and saved cards, current discounts/restrictions, shared per-fine reservations and confirmed receipts. [Paced recording](docs/recordings/fine-checkout/index.html).
