# Local development

## Recommended integrated stack

Use Node.js 24+, npm and Docker Compose. Native SQLite is built into Node; no native database package is installed.

```bash
npm ci --ignore-scripts
cp .env.example .env  # only when .env does not already exist
npm run demo:up
npm run dev:react
```

Open http://localhost:3000. Keycloak initializes its demo realm on first startup; allow about 30 seconds. Browser login uses authorization code + S256 PKCE. Demo users are `bassem` and `demo-commuter`, password `demo123`. Each has separate personal/household accounts. Select an account in the sidebar; account changes start or restore that account's conversation. Saved conversations can be restored/deleted through the React history control.

`npm run dev:angular` serves http://localhost:3001 with Keycloak login and account selection. Flutter requires its SDK; `npm run dev:flutter` uses Chrome. Its sign-in uses a local-demo password grant with seeded accounts and tokens held in memory; native PKCE and SSE parity remain pending. For another backend host, pass `--dart-define=GATEWAY_URL=http://your-host:4000`.

## Processes and ports

- Concierge 4000; application APIs 4001–4006.
- RTA 4101, DEWA 4102, Etisalat 4103, du 4104, Police 4105, DLD 4106, payments 4107.
- Keycloak 8085, Redis 6379. Compose binds published backend ports to 127.0.0.1.
- React 3000, Angular 3001, Flutter 3002 when configured.

The Compose demo mounts the checkout read-only into Node 24 containers, including already installed pure-JavaScript backend dependencies. Persistent SQLite files use separate named volumes; Redis AOF and Keycloak data also have their own volumes. Do not start `dev:backend` while the integrated stack owns the ports. Standalone service Dockerfiles now copy the monorepo and install dependencies; the reference demo does not require building those images.

```bash
npm run demo:logs
npm run demo:verify
npm run test:redis
npm test
npm run build -- --concurrency=2
npm run demo:down  # preserves named volumes
```

## Configuration

`docker-compose.demo.yml` explicitly enables `PROVIDER_INTEGRATION=true`, `DOMAIN_TRANSPORT=http`, `SESSION_STORE=redis` and `DEMO_AUTH=false`. These override fixture defaults in `.env.example`. The stack has no silent fallback to legacy data or memory sessions.

| Variable | Purpose |
| --- | --- |
| OPENROUTER_API_KEY | Optional server-side key; never exposed through Vite |
| OPENROUTER_MODEL | `openrouter/free` by default |
| ENABLE_LIVE_LLM | false for deterministic replies; true enables a configured key |
| OPENROUTER_ALLOW_PAID_MODELS | paid inference requires explicit true |
| KEYCLOAK_ISSUER / PUBLIC_ISSUER | exact token issuer / public browser issuer |
| KEYCLOAK_JWKS_URL / TOKEN_URL | reachable container or host certificate/token endpoints |
| SERVICE_CLIENT_SECRET | a single application process's confidential client secret |
| SERVICE_*_CLIENT_SECRET | per-service secrets for a shared local process |
| PROVIDER_SETTLEMENT_SECRET | read-only payment-proof verifier client |
| PROVIDER_<ENTITY>_URL | provider base URL |
| PROVIDER_ID / PROVIDER_DB_PATH | one provider instance and its SQLite file |
| APP_DATA_DIR | application-owned profile/order SQLite storage |
| REDIS_URL / SESSION_TTL_SECONDS | Redis endpoint and idle retention, 60–86400 seconds |

Known demo service secrets and grants are documented in the [provider guide](../demo/provider-backends.md). They are intentionally local-only. Preserve existing `.env` keys; do not copy secrets into source control. Restart affected containers after editing source or environment; backend containers do not run a source watcher.

Keycloak imports `services/keycloak/realm-export.json` only when the realm does not exist. Changes to that file do not overwrite an existing realm. Reconcile an existing local realm with `npm run demo:realm`; this updates demo clients/roles without deleting databases. Password grants remain enabled only to support local verifier/Flutter demo flows.

## Lightweight fixture runner

For offline historical scenarios without Docker: set `DEMO_AUTH=true`, `PROVIDER_INTEGRATION=false`, `DOMAIN_TRANSPORT=local`, `SESSION_STORE=memory`, then run `npm run dev:backend`. This runner reads `.env`, boots the five legacy APIs plus agent core, and retains singleton fixtures/process-local sessions. It does not offer integrated user/account isolation. Tests configure this mode explicitly and do not use your OpenRouter key.

The older `docker-compose.yml` and agentgateway YAML are compatibility/reference artifacts. Use `docker-compose.demo.yml` for verified provider integration. No gateway is needed in the verified application-to-provider path.

## Troubleshooting

- Sign-in not ready: check `npm run demo:logs` and wait for Keycloak realm import.
- 401/403: confirm the token audience, user role, service grant and account ownership; a user token cannot call a provider directly.
- 409 SESSION_BUSY: another request holds the lease. 409 account mismatch: start a conversation for the selected account.
- Session store unavailable: check Redis; the application does not create a replacement memory session.
- Payment decline: check the simulated wallet or choose a permitted demo funding source through the provider API. Never submit real card data.
- Partial/unknown settlement: inspect the provider payment/bill status and reconcile; do not blindly repeat a charge with a new key.
- OpenRouter network failure: check machine HTTPS and provider availability; the app shows the failure. Disable live replies explicitly for a deterministic demo.
- Angular build worker killed in a restricted environment: allow local build workers and use build concurrency 2.
- Flutter: install the SDK. Flutter compilation/native execution is not covered by the latest verification.
