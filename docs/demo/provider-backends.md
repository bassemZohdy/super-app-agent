# Provider backend demonstration

This is a local integration environment, not an integration with the named real entities. Producer: the provider-simulator package. Consumers: the application microservices. Contract version: 2.0.0, OpenAPI 3.1. This demo security migration changes authentication while retaining `/v1` resource schemas. Sign in again for the provider audience; service-header impersonation clients must migrate. Future breaking resource changes require explicit versioning and migration.

## Service and account boundaries

Each provider runs the same HTTP runtime with its own `PROVIDER_ID`, SQLite file and named volume. The provider owns business rules and records. Application services never read a provider’s database. Both layers validate input, and the provider checks resource/account ownership on every operation.

Interactive user tokens include `agent-core` and `provider-api`. Application and provider services verify them independently, including expected client/user role and ownership from signed `sub`. Applications forward the user bearer; `X-User-Subject` cannot override it. General service-header impersonation is denied in the reference profile; a separate machine lane reads captured payment proofs.

Delegated calls use the separate trusted broker, supported RFC 7523 and private-key client authentication. Providers validate its short-lived user token and check the current exact-operation grant/token binding online. See the [delegation guide](../development/delegation.md) for consent, key isolation, runner access and limits. Existing internal subjects/account IDs are preserved. Legacy fixtures retain their earlier explicit compatibility profile.

## Retained machine credentials

| Client ID | Provider grants | Demo client secret |
| --- | --- | --- |
| service-ride | RTA, payments | demo-ride-secret |
| service-food | DEWA, payments | demo-food-secret |
| service-wallet | Police, DEWA, RTA, payments | demo-wallet-secret |
| service-catalog | DLD, DEWA, RTA | demo-catalog-secret |
| service-profile | none; owns application profile storage | demo-profile-secret |
| service-telecom | Etisalat, du, payments | demo-telecom-secret |
| provider-settlements | payments read only | demo-settlements-secret |

Roles are `provider:<entity>`; the settlement verifier gets only `provider:payments:read`. Confidential clients have browser and password grants disabled. The browser uses the public `superapp-shell` client; service secrets are never sent to a shell. Secrets above are intentionally public, seeded local-demo credentials.

## REST contracts

Source: `services/provider-simulator/src/contracts.ts`. Generate checked-in contracts with `npm run openapi:generate`. `npm test` checks schema validity and exact agreement with the runtime. Each simulator serves its contract at `/openapi.json`. Public health/docs endpoints do not return account records.

Account operations require a signed interactive user token or a registered broker token plus current grant. Caller user headers confer no authority. Delegated account enumeration is denied; each grant targets one exact owned operation. POST requests require JSON and `Idempotency-Key` (1–200 printable ASCII characters). Body limits are 64 KiB. Unknown fields are rejected by request schemas. Lists currently return at most 100 records; pagination is not implemented.

Errors are `{success:false, code, error}` with 400/401/403/404/409/402/503 as appropriate; body-size rejection uses 413. Replay with the same key and canonical request returns the saved status/body. A changed method, path or body under the same account/key returns 409. Keys persist for the lifetime of the provider database; this is intentionally longer than the Redis conversation TTL.

```bash
# Supply the user token privately from normal login; ACCOUNT_ID is owned.
curl http://localhost:4107/v1/accounts/ACCOUNT_ID/wallet \
  -H 'Authorization: Bearer USER_ACCESS_TOKEN'
```

Never put real tokens in documentation, URLs, terminal recordings or committed files.

## Embedded databases

Each entity uses `node:sqlite`, WAL mode, a busy timeout and explicit write transactions. Accounts, resources and idempotency responses live in that entity’s database. Domain resources are JSON records keyed by account/kind/resource ID; SQL tables enforce ownership references and unique idempotency keys. Each new demo account is seeded on first access. Application profile/preferences and dining orders use separate account-scoped application SQLite files.

A default wallet starts with 1500 AED in **simulated funds**. Personal and household accounts have independent balances, bills, subscriptions, parking sessions and transaction history. No real Emirates ID is created in integration profiles. The earlier singleton fixture balances and identities are retained only in the legacy fixture mode.

## Payment flow

The gateway accepts integer `amountMinor` in AED fils, and a simulated funding source: `wallet`, `demo_approved`, or `demo_declined`. Top-ups accept the latter two sources. Captures, declines, refunds and idempotency responses are persisted atomically. A declined wallet payment does not debit funds. A captured payment can be refunded once; wallet-funded captures return funds to the wallet. A card-simulated capture/refund does not change the wallet.

For bills, fines, parking and Salik, the application service obtains the authoritative amount, captures payment, then submits its ID to the entity. The entity retrieves that payment with its read-only settlement client and checks account, captured status, merchant, resource reference, amount and refund status. A payment proof cannot be applied twice. The provider does not trust a browser-supplied amount as a quote.

Payment capture and provider settlement are **separate local transactions**. A timeout can leave a captured charge and an unpaid bill. Idempotency permits lookup/recovery, but no distributed atomic transaction or automatic compensation is claimed. The concierge blocks further mutations when an outcome is uncertain. Refunds do not automatically reverse a previously applied provider settlement; reconciliation is a separate operational task.

Unified checkout calls each provider settlement once; integration mode skips the old graph's follow-on duplicate payments. Move-in calls DLD, DEWA and an RTA residential permit operation, instead of charging a 720-hour parking meter. These multi-step flows remain deterministic demo workflows.

## Redis conversations

`SESSION_STORE=redis` is mandatory in the integrated Compose stack. Records include owner subject, selected account, last 100 conversation messages, current surface/revision and reconciliation state. Default idle TTL is 3600 seconds; configurable range is 60–86400. Existing sessions cannot be moved to a different account. React stores only the selected account/session reference in browser session storage and can list, restore or delete a conversation.

A per-session Redis lease uses SET NX PX, a unique token, renewal and a fenced save/release. Another replica or overlapping request receives `SESSION_BUSY`. Lease ownership is checked before each application mutation. Redis errors fail closed; there is no fallback to a fresh memory session. Active operations extend retention until their final save.

Redis stores the last 100 SSE events per session and publishes to subscribers on other core instances. Streams remain process-local sockets. Redis AOF with `appendfsync everysec` preserves demo state across normal restarts, with a possible recent-write loss on a crash. This is not a production high-availability deployment or durable workflow engine.

## Useful endpoints

- `GET /api/auth/config`: public browser issuer/client ID, never a secret.
- `GET /api/accounts`: verified user and owned account choices.
- `GET /api/sessions`: owned conversation summaries.
- `GET /api/sessions/{id}`: owned transcript/current surface.
- `DELETE /api/sessions/{id}`: delete an owned idle conversation.
- Intent/action bodies include `accountId`; streams include `accountId` as a query reference, never a token.
- `service-telecom` exposes `/telecom/{etisalat|du}/{subscriptions|plans|bills}` plus bill payment and plan-change routes.

## Verification

`npm run demo:verify` exercises real local Keycloak user/service tokens, REST calls through both application layers, cross-user denial, Redis restore, payment replay/conflict/decline/refund, role denial, telecom APIs and stale-action rejection. `npm run test:redis` tests cross-client locking, fenced saves, replay and exact empty-array preservation. See the [current validation report](../reports/2026-10-24-demo-completion.md) for browser/restart evidence and limits. `demo:up` now waits for public endpoint readiness; `demo:verify` separately exercises real authentication and persistence.

`npm run demo:verify:journeys` verifies paid RTA parking, DEWA settlement, both telecom bills, fine settlement, unified checkout of already-paid resources, and DLD/DEWA/RTA move-in. It intentionally changes only seeded demo records and simulated funds. It can be rerun against already-settled bills.

For an actual restart check:

```bash
npm run demo:verify:restart
```

This prepares its own proposal, restarts core/Redis/payment containers, waits for readiness, resumes the same approval, verifies one simulated top-up and removes its own session/temporary record. Run it without concurrent wallet-changing checks. The temporary record contains no token. Direct low-level scripts retain `--prepare`/`--verify` for debugging; normal use requires only the command above.

## Graph, approval and manual route additions

Integrated Redis now also holds bounded LangGraph root checkpoints and persisted review interrupts. Completed/replaced/cancelled continuations are removed; outstanding entries share the session TTL. This enables ordinary restart resume, not a general scheduler/compensation platform.

The owned session response includes current approval and a bounded lifecycle history. `POST /api/a2ui/cancel` invalidates a pending proposal. `GET /api/services` and `POST /api/manual/prepare` expose eleven bundled routes without a model call; React can open `/services/wallet` directly. The authenticated official MCP transport is at core `/mcp`; application descriptors remain metadata. [MCP guide](../development/mcp.md).

All integrated JWT verification now includes access-token type and authenticated online introspection via the separate `cityside-verifier` client/audience. Run `npm run demo:realm` when upgrading an existing realm and sign in again. The [demo target ADR](../adr/ADR-0011-local-demo-target.md) records retained and deferred requirements.
