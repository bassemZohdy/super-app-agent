# Local development

## Default focused demo

Use Node.js 24 and npm. Run `npm ci --ignore-scripts`, `npm rebuild better-sqlite3`, `npm run agent:init`, then `npm start`. In another terminal, run `npm run agent:client`. This starts one process on loopback port 4300 with `.data/agent.sqlite`; the private `.env.agent` configuration is generated once. No external database, identity service, simulator or model download is required for explicit fixture mode. See [configuration and API](../integrations.md) and [focused verification](../testing.md).

The official LangGraph SQLite saver uses a native `better-sqlite3` binding; rebuild it after an installation using `--ignore-scripts`. For the optional container path use `docker compose -f compose.agent.yml up --build`; container execution needs separate qualification.

`npm run agent:verify:container` qualifies the same agent as one container (it needs Docker and a private `.env.agent` from `npm run agent:init`). It builds `services/agent-core/Dockerfile.simple` from this checkout and runs `compose.agent.yml` as its own project, `super-app-agent-qualify`, with an empty SQLite volume that it removes at the end, so it never touches the data of a `compose.agent.yml` run of your own. It checks `/ready`, that a bad credential is refused, that the process runs as uid 1001 and writes its volume, that a pending approval survives a restart with the same identity, that approving once pays once (the same key returns the same receipt, a new key is refused with 409) and that the receipt survives another restart, and that SIGTERM stops it in under the 35-second grace period with exit code 0. It needs no Redis, PostgreSQL, external simulator or model download, and port 4300 free. It exercises the fixture planner over the HTTP API; the React path and a real local planner are P1-03 and P1-05.

## Network isolation of the compatibility stack

In `docker-compose.demo.yml` the backends (providers, services, gateway, broker, Redis, Keycloak) are on the default network, which is `internal`: it has no route to the host network or the internet and nothing on it publishes a port. One container, `edge-relay` (`scripts/port-relay.ts`), is attached to that network and to an `edge` network and publishes every loopback port (4000 to 4006, 4010, 4101 to 4107, 6379 and the Keycloak port) by forwarding each to exactly one fixed service named in its `RELAY_ROUTES`; a route to anything but a plain service name is refused at start, and a client cannot change where a connection goes. Host-side tools, browsers and the Keycloak public address (`KC_HOSTNAME`) keep using the same loopback ports. `npm run verify:network` checks a running stack: only the relay publishes ports, and from every backend a connection to the internet fails, with the same probe succeeding from the relay as the control (against the qualification stack: `npm run qualify -- run -- npm run verify:network`). The optional `voice` and `conversation` containers are on the same internal network, so they cannot download models; fetch those with `npm run local-ai:up` as before. Recreate a running stack to apply it: `docker compose -f docker-compose.demo.yml up -d --remove-orphans`.

## A qualification stack beside the interactive one

`npm run qualify -- up` starts a second copy of the demo stack for qualification runs, so a test can wipe and rewrite its data without touching yours. It is the same `docker-compose.demo.yml` with project `cityside-qualify` (separate containers, network and named volumes), every published port shifted by 30000 (gateway 34000, Keycloak 38085, payments 34107; clear of the 14000 range the in-process browser journeys use) and credentials generated once into the ignored `.data/qualification/stack.env` (mode 0600, preserved across runs, never printed). `npm run qualify -- run -- <command>` runs any script against it with every endpoint set explicitly and nothing inherited from your shell that could point at the interactive stack (for example `npm run qualify -- run -- npm run demo:verify`); the scripts read the same variables as before, shifted by `DEMO_PORT_OFFSET`. `npm run qualify -- down` removes only the `cityside-qualify` project and its volumes; the launcher refuses any other project name or an interactive port. Both stacks can run together. The imported realm still carries the seeded demo client secrets, so those are shared until the realm is generated per stack.

For the primary fines UI, also run `npm run dev:react` and open `/services/fines` on the reported React port. The conversation and service details have shared icon-only swap and maximize/restore controls. Click a maximized pane’s size icon again to restore the split view. Sign in with the private local test token; [browser authentication, proxy and recovery](../integrations.md#react-fines-workspace) explains the boundary. To explicitly use the exported OpenRouter key, initialize with `npm run agent:init -- --openrouter` on a fresh setup, or follow [switching an existing configuration](../integrations.md#explicit-openrouter-setup).

## Recommended integrated stack

This section is the optional compatibility stack used by existing shells and advanced simulated payment/delegation journeys. Use Node.js 24+, npm and Docker Compose. Those legacy business stores use Node's built-in SQLite; the focused saver additionally requires the binding described above.

```bash
npm ci --ignore-scripts
test -f .env || cp .env.example .env  # preserve existing configuration
npm run demo:up
npm run dev:react
```

Open http://localhost:3000. `demo:up` waits for Keycloak realm discovery and all six application, seven provider, broker and concierge health metadata and `/ready` endpoints. First startup includes realm/database initialization, the internal speech image build and roughly 1.4 GB of pinned model downloads; allow several minutes. `local-ai:up` waits separately for AI readiness. [Local AI setup, licences and troubleshooting](local-ai.md). The readiness deadline defaults to 180 seconds; override `DEMO_READY_TIMEOUT_MS` (1000–600000) for slower machines. `npm run demo:wait` repeats this check without changing containers. Readiness does not replace authenticated acceptance checks or Redis verification. Browser login uses authorization code + S256 PKCE. Demo users are `bassem` and `demo-commuter`, password `demo123`. Each has separate personal/household accounts. Select an account in the sidebar; account changes start or restore that account's conversation. Saved conversations can be restored/deleted through the React history control.

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
| ENABLE_LOCAL_LLM | enables the explicitly selected text provider; false for deterministic text |
| CONVERSATION_PROVIDER | local (default), openrouter or litellm; no automatic fallback |
| LITELLM_BASE_URL / LITELLM_URL / LITELLM_API_KEY | existing server endpoint and provider-specific key, used only when selected |
| LITELLM_MODEL / LITELLM_MAX_TOKENS | advertised text model and bounded output limit; defaults glm-5.3 / 512 |
| OPENROUTER_MODEL / OPENROUTER_API_KEY | explicit free-model inference at the official HTTPS endpoint |
| CONVERSATION_SERVICE_URL | private llama.cpp endpoint; fixed local hosts only |
| VOICE_SERVICE_URL | private internal speech endpoint; fixed local hosts only |
| KEYCLOAK_INTROSPECTION_TIMEOUT_MS | limit for the active-token check, 1000–12000 ms (default 8000); past it the request is refused |
| KEYCLOAK_INTROSPECTION_URL / CLIENT_ID / CLIENT_SECRET | authenticated per-request active-token verification; Compose uses cityside-verifier |
| OPS_API_KEY / OPS_BACKUP_KEY | private diagnostics / CLI-only encrypted backups; generate with `npm run ops:init` |
| OBSERVABILITY_LOGS / OPS_STUCK_MS | payload-free completion logs / stuck-work threshold (default 120 seconds) |
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
| SESSION_MAX_PER_OWNER / SESSION_MAX_TOTAL / SESSION_IDLE_SECONDS | in-memory conversation bounds (defaults 25, 1000 and `SESSION_TTL_SECONDS`): the owner's least recently used thread is evicted first, a thread with a request in flight never is, and a new thread is refused with `SESSION_LIMIT_REACHED` (429) when every candidate is busy |

Known demo service secrets and grants are documented in the [provider guide](../demo/provider-backends.md). They are intentionally local-only. Preserve existing `.env` keys; do not copy secrets into source control. After pulling source changes, run `npm run demo:refresh` to reconcile the checked-in demo identity configuration and recreate the compatibility API processes against the current checkout. It preserves SQLite/Redis/Keycloak volumes, leaves the focused API separate, and does not start automation workers or download models. A plain Compose `up -d` may keep an old Node process even though its source mount has changed, causing supported service or payment pages to return `Not found`. Use `npm run demo:verify:manual` afterwards to verify every advertised service with real local authentication. Restart affected containers after isolated source edits; recreate them with `docker compose -f docker-compose.demo.yml up -d --force-recreate SERVICE_NAME` after environment edits; backend containers do not run a source watcher.

Keycloak imports `services/keycloak/realm-export.json` only when the realm does not exist. Changes to that file do not overwrite an existing realm. Reconcile an existing local realm with `npm run demo:realm`; this updates demo clients/roles without deleting databases. Keycloak 26.6.4 introspection requires the verifying client in the token audience. The demo realm maps `cityside-verifier` into user/service access tokens; run `demo:realm` after updating an existing realm, then sign in again. [Upgrade documentation](https://www.keycloak.org/docs/26.6.4/upgrading/index.html). Password grants remain enabled only to support local verifier/Flutter demo flows.

For private telemetry, stuck-work signals, SLO/load checks and encrypted cold backup/restore, follow the [operations runbook](operations.md). Do not stop/reset volumes to clear a pending-job alert; inspect the original operation. [what exists today](../../README.md#what-exists-today).

## Lightweight fixture runner

For offline historical scenarios without Docker: set `DEMO_AUTH=true`, `PROVIDER_INTEGRATION=false`, `DOMAIN_TRANSPORT=local`, `SESSION_STORE=memory`, `ENABLE_LOCAL_LLM=false`, then run `npm run dev:backend`. This runner reads `.env`, boots the five legacy APIs plus agent core, and retains singleton fixtures/process-local sessions. It does not offer integrated user/account isolation. Tests configure this mode explicitly and do not call text/speech inference or use cloud credentials.

Use `compose.agent.yml` for the focused agent or `docker-compose.demo.yml` for retained provider integration. The unused gateway candidate and older default Compose file have been removed; specify the intended Compose file explicitly.

## Refreshing the workspace

Use npm 11.9.0, pinned by `packageManager`, with `package-lock.json`; the repository has no pnpm workspace. After pulling changes, run `npm ci --ignore-scripts` and `npm rebuild better-sqlite3` to replace stale dependencies and prepare the focused SQLite saver. If npm 12 is active, use `npm exec --yes --package=npm@11.9.0 -- npm rebuild better-sqlite3`: npm 12 can report a successful rebuild while blocking the native dependency's install script. Run `npm run check:agent` for the focused boundary and `npm run check` for repository checks before starting the next task in `TODO.md`.

Build output (`dist/`), Turbo/Angular caches and `.playwright-mcp/` are disposable. Remove only those generated paths when cleaning a checkout. Preserve private `.env` files, `.data/`, SQLite databases, Docker volumes and checked-in recording evidence; a blanket `git clean -fdX` would also delete private configuration and local data.

## Reproducible start, release controls and rollback

Every step below has a command, and each claim a test or a verifier that fails when it stops being true.

| Concern | How it is reproduced | What fails if it drifts |
| --- | --- | --- |
| Start | `npm run demo:up` (Compose, Keycloak realm, providers, gateway); `npm run demo:verify` and `npm run demo:verify:security` check the running stack. | the two verifiers |
| Seed | Provider fixtures come from `services/provider-simulator/src/fixtures.json` and a per-account seed, so a fresh run always starts from AED 1500.00 in the wallet and the same fines, bills and prepaid lines. A reset of an isolated run recreates its own seed (`npm run simulator:console`). | `services/test/sim05-reset.test.ts` and the seeded-fixture tests in the simulator suite |
| Migrations | Schema changes are additive and run on open. The ones that rewrite constraints copy the old file first to a `.before-<change>.sqlite` backup beside it (see the issuer, fine-checkout and payment-events guides). Reopening is idempotent. | the restart and reopen tests, `npm run demo:verify:restart` |
| Clock | Real time signs and expires tokens. The business clock of an isolated run moves only through the operator (`npm run simulator:console`, or `scenario.clock.advance` in the browser journeys) and never revives an expired token. | `services/test/sim05-console.test.ts` (no provider route moves time) and the simulator clock tests |
| Scenarios | Card presets and named failpoints are chosen by the run's operator, never by the resident. | the issuer-scenario and failure journeys under `test/browser/failures/` |
| Recovery | `npm run ops:verify:recovery` restores an encrypted checkpoint, fences the old writer and checks the financial tables, revocation and signing identity. | the verifier |
| Rollback | Restore the cold checkpoint ([operations](operations.md#restore-and-fenced-failover)) or the `.before-*` backup of the one database, and run the previous code. A migration never deletes a row. | the recovery verifier |

### Automation stays off until it is selected and consented

`services/test/qa08-release-controls.test.ts` pins these defaults against the real files:

- The worker starts only with `AUTOMATION_WORKER_ENABLED=true`, never when `NODE_ENV=production`, and then still needs an isolated `AUTOMATION_RUN_ID` and a client credential.
- Scheduling (enqueuing jobs from rules) is a second opt-in, `AUTOMATION_SCHEDULE_ENABLED=true`; without it no work is created.
- No compose file or example environment defines the worker or turns either switch on.
- Rules keep returning `executionEnabled:false`; consent alone never runs a payment, and the kill switch stops new runs ([automation worker](automation-worker.md)).
- No payment-provider SDK, hosted telemetry or feature-flag service is a dependency of any workspace package, and `npm run check:local-only` rejects hosted SDKs, deploy commands and remote assets.

## Troubleshooting

- Sign-in not ready: check `npm run demo:logs` and wait for Keycloak realm import.
- 401/403: confirm the token audience, user role, service grant and account ownership; provider user access requires `provider-api`, the expected interactive client/role and ownership; machine settlement/eligibility callers have separate narrow contracts.
- 409 SESSION_BUSY: another request holds the lease. 409 account mismatch: start a conversation for the selected account.
- Session store unavailable: check Redis; the application does not create a replacement memory session.
- Payment decline: check the simulated wallet or choose a permitted demo funding source through the provider API. Never submit real card data.
- Partial/unknown settlement: inspect the provider payment/bill status and reconcile; do not blindly repeat a charge with a new key.
- Local model/voice unavailable: run `npm run local-ai:up` and inspect voice/conversation logs. First inference loads speech engines. Busy errors are bounded capacity refusals; wait or type. The app does not fall back to hosted inference. Set `ENABLE_LOCAL_LLM=false` and recreate core for deterministic text. Physical microphone access needs browser permission and a secure origin (localhost is supported).
- Pointing the Angular shell at another gateway: set `SHELL_GATEWAY_URL` to a bare http(s) origin and rebuild (`SHELL_GATEWAY_URL=https://gateway.example.test npm run build --workspace=apps/shell-angular`). The build writes `src/environments/environment.ts` from it before compiling; unset, it writes the committed default `http://localhost:4000`, so a plain build changes no file.
- `npm run dev:backend` listens on the port of each `DEMO_*_URL` (the usual 4000 to 4005 by default) on `127.0.0.1`; set `DEV_BACKEND_HOST=0.0.0.0` only when a device on your network must reach it. It is a development runner, not a production profile.
- Angular build worker killed in a restricted environment: allow local build workers and use build concurrency 2.
- Flutter: use the documented SDK and run pub get before analyze/test/build. Web compilation and widget checks pass in the current report; native platform/device execution remains open.

## Delegated access

The reference `demo:up` also reconciles the supported JWT-grant IdP, private-key broker client, scope policy and existing-user links. Applications forward signed interactive identity to providers; the independent broker holds its own grant/key volume. Open Delegated access in React/Angular or the Flutter shield control. [Full setup, contracts, verification and rollback](delegation.md). Use `npm run demo:delegation:realm` for a manual idempotent reconciliation, then sign in again if audiences changed. General service-header impersonation is denied in this reference profile.

## Payment and automation status

React supports saved synthetic cards/biller links, reviewed wallet/card bills/fines/recharges, wallet funding, grouped checkout, original-source refunds, events, statements, owned recovery and current owner/source lifecycle. Wallet effects use the [balanced journal and one-time migration](payment-ledger.md). Finite mandate records and partial lifecycle/issuer scenarios are available; AUTO-03 authority, the autopay worker/scheduler and general authenticated scenario controls remain planned. [Current payment setup](payment-accounts.md). [The design](../architecture/payment-automation-demo.md) and [backlog](../../TODO.md) define the next work. Do not invent new environment flags or reset live demo volumes to follow that plan; startup/migration/scenario commands will be documented as their implementation lands.

The optional `npm run simulator` operator CLI stores preview-only scenarios under `.data/simulator`, with no backend port or provider call. [Commands/ownership/bounds](simulator.md). `npm run simulator:verify` repeats its cross-process persistence/reset proof. This CLI cannot execute financial scenarios. Separate [issuer scenarios](issuer-scenarios.md) are delivered; general network admin controls/failpoints remain future work.

Finite interactive authorization reviews are available without a new environment flag. [Try stored reviews and challenges](payment-authorization.md). Reload updated payments/core containers when backend source changes; no Keycloak feature or authority expansion is required.

Current settlement uses five separate provider claim clients. `npm run demo:realm` reconciles their narrow roles; optional `PROVIDER_{NAME}_CLAIM_SECRET` values must match each source container and realm. The shared proof client stays read-only. [Settlement protocol, migration and recovery](settlement-claims.md).

[Bill checkout](payment-checkout.md) is enabled for signed-in owners. Reload payments/source providers and food/wallet/telecom applications together when upgrading this contract; their legacy bill routes now use stored execution. The migration verifier performs this coordinated restart without clearing volumes.

Saved-card wallet funding is available in React Payment accounts. After backend changes, use the serial `npm run demo:verify:payment-ledger` restart/preservation check, then `npm run demo:wait` and `npm run demo:verify:inventory`. [Funding guide](wallet-funding.md).

[Owner/workspace lifecycle](payment-lifecycle.md) requires the new reader/operator realm clients and `ELIGIBILITY_ENFORCEMENT=true` in reference Compose. Reconcile the checked-in realm and recreate changed services as documented there; never reset volumes to upgrade. The operator secret belongs only to the separate loopback CLI.
