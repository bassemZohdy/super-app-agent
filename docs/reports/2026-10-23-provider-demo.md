# Provider demo verification — 23 October 2026

Scope: the Cityside interface and OpenRouter repair, seven provider REST APIs, OpenAPI 3.1 contracts, application adapters, Keycloak browser/client authentication, SQLite isolation and Redis conversations. This report supersedes earlier fixture-only reports for the current demo; historical reports and recordings remain unchanged.

## Executed environment

Node 24.15.0 on macOS; Docker Desktop 29.4.3; Node 24 Alpine application/provider containers; Keycloak 26.6.4; Redis 8.2 Alpine. Reference configuration: `docker-compose.demo.yml`. All records, funds, credentials and entities are synthetic/local. No real government, telecom or payment service was contacted.

## Verification

| Check | Result |
| --- | --- |
| Default regression suite | 99 passed, 0 failed; no Docker required |
| Monorepo production/type builds | 17 of 17 workspace tasks passed |
| Redis integration | Passed: two independent clients, owner/account denial, renewed locks, fenced save/release, history, empty-array persistence, pub/sub and replay |
| Live local Keycloak stack verifier | Passed: two user logins, owned accounts, session restore/denial, actual service credentials and wrong-service denial, payment capture/replay/conflict/decline/refund, telecom discovery and stale actions |
| Full provider journeys | Passed: RTA captured tariff/replay, DEWA bill/proof, Etisalat and du payment, fine settlement, unified checkout without double payment, DLD/DEWA/RTA move-in |
| Actual container restart | Passed: prepared session owner/account, transcript, surface revision and SQLite wallet survived restart of agent-core, Redis and payment provider |
| React browser | Passed: S256 PKCE sign-in, personal/household switch, separate wallets, saved conversations, reload restoration, logout, mobile menu/settings and no horizontal overflow |
| Angular browser | Passed: real demo-commuter sign-in, Alex profile, two account choices and no horizontal overflow; production bundle built |
| Flutter | Source updated; SDK unavailable, so compilation/native execution not verified |
| OpenRouter live call | HTTPS connection failed in this environment; actual key validity/generated replies remain unverified. Controlled model-response tests and visible-error behavior passed |

The default suite validates the generated contracts with Swagger Parser, checks equality with their runtime generator, tests account-isolated SQLite reopen persistence, real signed provider HTTP authorization, payment arithmetic/proof handling and service-token caching. Redis remains a separate opt-in integration test so default tests do not require Docker.

## Defects caught during this work

- Model calls were disabled and completions discarded. Replies now use bounded history/service context and reach HTTP/SSE; failures are visible.
- Empty JSON arrays were changed to objects by Lua cjson during session save. State is now serialized in JavaScript and written atomically with a fencing check; a regression covers empty table reloads.
- The wallet service's RTA grant was missing from the provider allowlist. The allowlist now agrees with the realm, checked by a complete service-grant matrix regression.
- Unified checkout could charge/settle providers twice or report old bill amounts as new charges. Integrated adapters settle once and report actual newly captured totals.
- The legacy move-in path activated a 720-hour meter. Integration mode uses a residential permit operation and explicit DEWA connection.

## Practical limits

This is not a production certification. SQLite and Redis are single-node demo storage. AOF `everysec` has a crash-loss window. Capture and provider settlement are separate transactions; orphan captures/partial outcomes require reconciliation, and a refund does not reverse an entity settlement automatically. Trusted service actor headers are not cryptographic delegated consent. Browser sessionStorage is not a hardened token vault. Flutter native PKCE/SSE, online revocation, global quotas, backup/HA, dependency remediation, durable workflows, production consent/audit and official UI/protocol adapters remain open.

The dependency audit reports advisories in the existing dependency tree; this change does not claim a clean security audit or perform unrelated framework major upgrades. `npm audit --omit=dev` reported 4 advisories (2 high, 2 moderate, 0 critical); these include the existing Angular/Ajv tree. A separate framework/dependency upgrade pass remains required. No real API key, access token, local database or browser recording is committed.
