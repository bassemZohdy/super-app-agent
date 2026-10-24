# Local development

## Recommended integrated stack

Use Node.js 24+, npm and Docker Compose. Native SQLite is built into Node; no native database package is installed.

```bash
npm ci --ignore-scripts
cp .env.example .env  # only when .env does not already exist
npm run demo:up
npm run dev:react
```

Open http://localhost:3000. `demo:up` waits for Keycloak realm discovery and all six application, seven provider, broker and concierge health endpoints. First startup includes realm/database initialization, the internal speech image build and roughly 1.4 GB of pinned model downloads; allow several minutes. `local-ai:up` waits separately for AI readiness. [Local AI setup, licences and troubleshooting](local-ai.md). The readiness deadline defaults to 180 seconds; override `DEMO_READY_TIMEOUT_MS` (1000–600000) for slower machines. `npm run demo:wait` repeats this check without changing containers. Readiness does not replace authenticated acceptance checks or Redis verification. Browser login uses authorization code + S256 PKCE. Demo users are `bassem` and `demo-commuter`, password `demo123`. Each has separate personal/household accounts. Select an account in the sidebar; account changes start or restore that account's conversation. Saved conversations can be restored/deleted through the React history control.

`npm run dev:angular` serves http://localhost:3001 with Keycloak login and account selection. Flutter requires Flutter 3.47+ / Dart 3.13+; run `cd apps/shell-flutter && flutter pub get` first. `npm run dev:flutter` uses Chrome at port 3002. The checked-in web bootstrap supports web builds; native platform projects and device execution remain open. Its sign-in uses a local-demo password grant with seeded accounts and tokens held in memory; native PKCE/device validation remains pending; authenticated Dart SSE now has parser/reconnect/lifecycle tests. For another backend host, pass `--dart-define=GATEWAY_URL=http://your-host:4000`.

## Processes and ports

- Concierge 4000; application APIs 4001–4006.
- RTA 4101, DEWA 4102, Etisalat 4103, du 4104, Police 4105, DLD 4106, payments 4107.
- Keycloak 8085, Redis 6379, trusted delegation broker 4010. Compose binds published backend ports to 127.0.0.1.
- React 3000, Angular 3001, Flutter 3002 when configured.
- Internal voice 4200 and conversation 4201 are private Docker services without published host ports; the model volume is shared read-only with llama.cpp.

The Compose demo mounts the checkout read-only into Node 24 containers, including already installed pure-JavaScript backend dependencies. Persistent SQLite files use separate named volumes; Redis AOF and Keycloak data also have their own volumes. Do not start `dev:backend` while the integrated stack owns the ports. Standalone service Dockerfiles now copy the monorepo and install dependencies; the reference demo does not require building those images.

```bash
npm run demo:logs
npm run demo:verify
npm run test:redis
npm run demo:verify:manual
npm run demo:verify:security
npm run demo:verify:restart # restarts core, Redis and payments; then verifies resume
npm run local-ai:verify
npm run local-ai:test
npm run local-ai:browser
npm run check
npm run demo:down  # preserves named volumes
```

## Configuration

`docker-compose.demo.yml` explicitly enables `PROVIDER_INTEGRATION=true`, `DOMAIN_TRANSPORT=http`, `SESSION_STORE=redis` and `DEMO_AUTH=false`. These override fixture defaults in `.env.example`. The stack has no silent fallback to legacy data or memory sessions.

| Variable | Purpose |
| --- | --- |
| ENABLE_LOCAL_LLM | true in Compose; false for deterministic text |
| CONVERSATION_SERVICE_URL | private llama.cpp endpoint; fixed local hosts only |
| VOICE_SERVICE_URL | private internal speech endpoint; fixed local hosts only |
| KEYCLOAK_INTROSPECTION_URL / CLIENT_ID / CLIENT_SECRET | authenticated per-request active-token verification; Compose uses cityside-verifier |
| HTTP_MAX_CONCURRENT / HTTP_REQUESTS_PER_MINUTE | bounded per-process admission defaults: 64 / 300 |
| KEYCLOAK_ISSUER / PUBLIC_ISSUER | exact token issuer / public browser issuer |
| KEYCLOAK_JWKS_URL / TOKEN_URL | reachable container or host certificate/token endpoints |
| SERVICE_CLIENT_SECRET | a single application process's confidential client secret |
| SERVICE_*_CLIENT_SECRET | per-service secrets for a shared local process |
| PROVIDER_SETTLEMENT_SECRET | read-only payment-proof verifier client |
| PROVIDER_<ENTITY>_URL | provider base URL |
| PROVIDER_ID / PROVIDER_DB_PATH | one provider instance and its SQLite file |
| APP_DATA_DIR | application-owned profile/order SQLite storage |
| REDIS_URL / SESSION_TTL_SECONDS | Redis endpoint and idle retention, 60–86400 seconds |

Known demo service secrets and grants are documented in the [provider guide](../demo/provider-backends.md). They are intentionally local-only. Preserve existing `.env` keys; do not copy secrets into source control. Restart affected containers after source edits; recreate them with `docker compose -f docker-compose.demo.yml up -d --force-recreate SERVICE_NAME` after environment edits; backend containers do not run a source watcher.

Keycloak imports `services/keycloak/realm-export.json` only when the realm does not exist. Changes to that file do not overwrite an existing realm. Reconcile an existing local realm with `npm run demo:realm`; this updates demo clients/roles without deleting databases. Keycloak 26.6.4 introspection requires the verifying client in the token audience. The demo realm maps `cityside-verifier` into user/service access tokens; run `demo:realm` after updating an existing realm, then sign in again. [Upgrade documentation](https://www.keycloak.org/docs/26.6.4/upgrading/index.html). Password grants remain enabled only to support local verifier/Flutter demo flows.

## Lightweight fixture runner

For offline historical scenarios without Docker: set `DEMO_AUTH=true`, `PROVIDER_INTEGRATION=false`, `DOMAIN_TRANSPORT=local`, `SESSION_STORE=memory`, `ENABLE_LOCAL_LLM=false`, then run `npm run dev:backend`. This runner reads `.env`, boots the five legacy APIs plus agent core, and retains singleton fixtures/process-local sessions. It does not offer integrated user/account isolation. Tests configure this mode explicitly and do not call text/speech inference or use cloud credentials.

The older `docker-compose.yml` and agentgateway YAML are compatibility/reference artifacts. Use `docker-compose.demo.yml` for verified provider integration. No gateway is needed in the verified application-to-provider path.

## Troubleshooting

- Sign-in not ready: check `npm run demo:logs` and wait for Keycloak realm import.
- 401/403: confirm the token audience, user role, service grant and account ownership; a user token cannot call a provider directly.
- 409 SESSION_BUSY: another request holds the lease. 409 account mismatch: start a conversation for the selected account.
- Session store unavailable: check Redis; the application does not create a replacement memory session.
- Payment decline: check the simulated wallet or choose a permitted demo funding source through the provider API. Never submit real card data.
- Partial/unknown settlement: inspect the provider payment/bill status and reconcile; do not blindly repeat a charge with a new key.
- Local model/voice unavailable: run `npm run local-ai:up` and inspect voice/conversation logs. First inference loads speech engines. Busy errors are bounded capacity refusals; wait or type. The app does not fall back to hosted inference. Set `ENABLE_LOCAL_LLM=false` and recreate core for deterministic text. Physical microphone access needs browser permission and a secure origin (localhost is supported).
- Angular build worker killed in a restricted environment: allow local build workers and use build concurrency 2.
- Flutter: use the documented SDK and run pub get before analyze/test/build. Web compilation and widget checks pass in the current report; native platform/device execution remains open.

## Delegated access

The reference `demo:up` also reconciles the supported JWT-grant IdP, private-key broker client, scope policy and existing-user links. Applications forward signed interactive identity to providers; the independent broker holds its own grant/key volume. Open Delegated access in React/Angular or the Flutter shield control. [Full setup, contracts, verification and rollback](delegation.md). Use `npm run demo:delegation:realm` for a manual idempotent reconciliation, then sign in again if audiences changed. General service-header impersonation is denied in this reference profile.

## Payment/automation planning status

The running React demo now has saved synthetic card/biller-link management and quote review. It has no new card-funded execution, journal, autopay scheduler or business-clock controls yet. [Current payment setup](payment-accounts.md). [The design](../architecture/payment-automation-demo.md) and [backlog](../../TODO.md#payment-accounts-and-automation-demo--planned-backlog) define the next work. Do not invent new environment flags or reset live demo volumes to follow that plan; startup/migration/scenario commands will be documented as their implementation lands.
