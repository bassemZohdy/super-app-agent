# Cityside — Super App Agent

A runnable city-services demo with a conversational concierge, independently persisted provider APIs, Keycloak authentication, and Redis sessions. RTA, DEWA, Etisalat, du, Dubai Police and Dubai Land Department are **simulated entities**. Payments use simulated funds; no real government or financial system is connected.

## Run the integrated demo

Requires Node.js 24+, npm, and Docker Compose. Install dependencies before starting the containers: the demo mounts this checkout and its installed backend dependencies read-only.

```bash
npm ci --ignore-scripts
cp .env.example .env  # first setup only; preserve an existing .env
npm run demo:up
npm run dev:react
```

Open [React](http://localhost:3000), sign in with Keycloak, and choose **bassem** or **demo-commuter**, password **demo123**. Each user has separate personal and household accounts. Keycloak can take about 30 seconds to initialize on first start. An OpenRouter key in the ignored `.env` enables generated replies; the demo works without a key. Set `ENABLE_LIVE_LLM=false` for deterministic replies.

`npm run dev:angular` serves the Angular shell at http://localhost:3001. Flutter has a local-demo sign-in and account/history controls; its SDK is required and native execution has not been verified here.

```bash
npm run demo:verify:journeys # all provider payment and move-in flows
npm run demo:verify     # real local Keycloak + REST + payments + Redis checks
npm run test:redis      # distributed locks, ownership, JSON persistence and replay
npm test               # offline regression and OpenAPI contract tests
npm run build -- --concurrency=2
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
  Apps -->|Client credentials| KC
  Apps -->|Service token + trusted user context| Providers[RTA / DEWA / Etisalat / du / Police / DLD]
  Apps --> Payments[Payment gateway simulator]
  Providers -->|Check captured payment| Payments
  Providers --> SQLite[(Separate SQLite database per entity)]
  Payments --> Ledger[(Payment SQLite ledger)]
  Core -->|Grounded conversational replies| OR[OpenRouter]
```

| Layer | Components | Persistence / responsibility |
| --- | --- | --- |
| Shells | Cityside React, Angular, Flutter | Presentation, sign-in and account selection; browsers use code + PKCE |
| Concierge | `services/agent-core` | Intent/action API, deterministic routing, grounded model replies, surface approval checks |
| Application APIs | ride, food/utilities, wallet, catalog/housing, profile, telecom | Validate user JWTs and selected accounts; call providers using their own client credentials |
| Provider APIs | `services/provider-simulator`, seven independently configured instances | Versioned REST, OpenAPI 3.1, scoped service authorization, account-owned SQLite state and idempotency |
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

OpenRouter replies use the last 12 conversation messages and current service results. The actual generated text reaches HTTP/SSE clients; provider failures are shown explicitly. Keys remain server-side. The default model is `openrouter/free`; paid models require `OPENROUTER_ALLOW_PAID_MODELS=true` and there is no silent paid fallback.

Routing and service execution remain deterministic. This repository does not implement a genuine LangGraph runtime, official AG-UI/A2UI, a durable workflow engine, production consent, a secure remote mini-app registry, or production government integrations. The legacy AG-UI/A2-UI names describe a project-specific JSON surface and event protocol.

The demo uses known credentials, local HTTP, Redis AOF `everysec`, and embedded databases. It is intended for local development. [Security boundaries](SECURITY.md), [remaining work](TODO.md), [current verification](docs/reports/2026-10-23-provider-demo.md).

## Documentation

[Documentation index](docs/INDEX.md) · [System overview](docs/architecture/system-overview.md) · [Provider contracts](docs/architecture/service-contracts.md) · [Session and stream behavior](docs/architecture/event-stream.md) · [Testing](docs/development/testing.md) · [Change history](docs/CHANGELOG.md)

License: MIT.
