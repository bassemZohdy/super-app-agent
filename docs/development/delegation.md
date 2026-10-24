# Secure delegation demo — operation and contracts

This is the implemented local synthetic profile from [ADR-0012](../adr/ADR-0012-secure-delegation-demo.md). [Design analysis](../architecture/secure-identity-delegation.md) explains the trust choices; [executed evidence](../reports/2026-10-24-delegation-demo.md) distinguishes tested behavior from remaining production requirements. RFC 7523 is used for identity federation, with application-owned consent and authorization.

## Start and try

```bash
npm ci --ignore-scripts
npm run demo:up
npm run dev:react
```

`demo:up` now waits for broker readiness and runs `demo:delegation:realm`. Existing user UUIDs and provider state are preserved. This provisions the JWT-grant IdP, private-key broker client, explicit optional scopes/downscoping policy, service runner and links for existing enabled demo users. The reference realm is synthetic; the reconciler is not a production identity-linking enrollment flow.

Sign in at localhost:3000 with a seeded demo account. Open **Delegated access**, explicitly approve the displayed wallet-read or AED 1 synthetic-credit grant, review it, then choose **Run approved operation**. Inspect audit history and **Revoke consent**. The Angular shell has the same controls in its Delegated access section. Flutter exposes them through its shield icon; native-device execution remains unverified. These controls are independent of conversation surface approvals.

The user interface presets expire after five minutes. API grants can last 60–3600 seconds; reads allow 1–10 executions. The only delegated write is `payments POST /topups` with the exact body `{amountMinor, source:"demo_approved"}`, AED 1–10, and `maxOperations:1`. The UI approves exactly AED 1. A grant is not a promise that money can be spent generally. Other mutations are denied.

## Components and identity

| Component | Role |
| --- | --- |
| Keycloak 8085 | Supported JWT authorization grant; linked internal user; private-key client authentication; scope policy; 90-second client token cap |
| Agent-core 4000 | UI/MCP facade; forwards the authenticated caller to the broker; no signing keys or grant database |
| Delegation broker 4010 | Independent assertion issuer/client; durable consent, token bindings, operation reservations and audit |
| Providers 4101–4107 | Verify token, owner and exact current grant before executing; signed interactive user lane remains separate |
| Runner service client | Execute existing grants only; cannot create user consent or choose arbitrary subjects |

The OAuth actor is `delegation-broker`, in `azp`. There is no custom `act` mapper and no claim of native RFC 8693 delegation. The initiating human/service is recorded separately. The assertion's external subject is `cityside:<internal user UUID>`; Keycloak links it to the existing internal token subject. Tokens/assertions stay in broker memory and never enter LangGraph, Redis checkpoints, API results or audit rows.

## API contract

All browser calls use `/api/delegation` on agent-core with a normal signed user bearer. Do not place tokens in URLs, documentation or terminal recordings. Owner/account are checked server-side. No endpoint accepts a user-subject override or arbitrary actor.

| Method and path | Contract |
| --- | --- |
| GET `/grants` | List the signed-in owner's most recent 100 grants |
| POST `/grants` | Explicit consent: `accountId`, `provider`, `method`, `path`, exact `body`, `purpose`, `expiresInSeconds`, `maxOperations` |
| GET `/grants/{id}` | Inspect an owned grant |
| POST `/grants/{id}/narrow` | Only reduce `maxOperations` and `expiresAt`; increments version; no expansion |
| DELETE `/grants/{id}` | Revoke owned grant; increments version; repeat withdrawal is safe |
| GET `/grants/{id}/history` | Last 200 audit events, without credentials |
| GET `/grants/{id}/operations` | Last 100 execution states/results for owner investigation |
| POST `/grants/{id}/execute` | Stable `requestKey` of 8–100 letters/digits/underscores/hyphens; owner preview or authenticated runner |

Broker-only `/api/delegation/authorize` checks the presented delegated token and exact provider/account/method/path/body. Providers call it without positive caching. It consumes the operation reservation atomically; it does not return the token. Public broker `/api/delegation/jwks` and `/client-jwks` expose distinct signing/public authentication keys. These endpoints are not proxied by the conversational facade. Direct broker requests reject browser Origin headers; the shell uses the origin-checked core facade.

Missing user authentication returns 401, policy/ownership/expiry/limit mismatch 403, pending/uncertain execution 409, and identity/authority outages fail closed. Exact completed request-key replays return the recorded result without reissuing a token or reexecuting. Revoked grants deny new execution even if an old token is still active in Keycloak. Malformed/bounded-body protections come from the shared HTTP policy.

The broker validates Keycloak output against expected internal user, actual client, scope, permitted audiences, lifetime and claim profile before registering its token fingerprint. A signed custom assertion grant ID is not assumed to be copied into the token. The application never accepts a caller-supplied grant header as proof.

## Persistence, limits and revocation

`delegation-data` is mounted only into the broker at `/data/delegation`; it contains grants, bindings, operation states and audit, plus separate issuer/client RSA keys under `keys/`. Key files are generated with owner-only permissions. The generated runner secret is in ignored `.data/delegation/runner-secret` on the developer host; never publish it. File-backed keys are a demo mechanism, not KMS/HSM protection.

Grants are bound to exact Keycloak issuer, user, actor, account and operation. Changing issuer or narrowing a grant invalidates old bindings. Counts are consumed at the provider's online authorization point, under a SQLite write transaction. Revocation before that point denies; an already authorized in-flight operation may complete. No committed external effect is reversed by withdrawal. This demo's one-write limit is not a generalized financial budget/approval/compensation ledger.

Unknown/pending operations block additional work on that grant. Use the operations/history endpoints and the provider's persisted idempotency record to investigate `delegation-<operationId>`. Do not reset state or issue a replacement grant to repeat an uncertain effect until its business outcome is known. Automated reconciliation/compensation and an operator remediation API remain open; no arbitrary reset endpoint is provided. WAL transactions survive normal reopen, not every production failure mode.

All seven providers independently check the grant. The common `provider-api` audience is a demo trust domain; production requires a reviewed per-resource audience scheme. A separate machine proof reader may retrieve captured charges; it cannot perform general user operations. Ordinary application requests forward the signed interactive user token rather than a human identity header. Standalone legacy fixtures retain their older explicit compatibility behavior and are not the reference security profile.

## Verify and record

```bash
npm run demo:verify:delegation
npm run demo:verify:delegation:security
npm run demo:verify
npm run demo:verify:journeys
npm run demo:verify:manual
npm run demo:verify:security
npm run record:delegation
```

The delegation verifier logs in to the actual Keycloak, checks both user and machine execution, exercises all seven provider reads, creates one bounded AED 1 synthetic credit and revokes its grants. Run wallet-changing checks serially. The attack script runs inside the trusted broker container solely to exercise controlled test signing keys; it never prints JWTs. Production must not expose such test tooling to untrusted workloads.

The [delegation video](../recordings/delegation/index.html) uses real Chrome, six-second review holds and eight-second results, after asserted state waits. It preserves prior runs and only promotes a successful recording. It uses the running synthetic stack, unlike the separate twelve-chapter recorder that isolates provider state. `DELEGATION_APP_URL` selects the running React URL; `E2E_BROWSER_CHANNEL` defaults to `chrome`. The recording includes one synthetic AED 1 credit and revokes both grants.

## Configuration and rotation boundary

| Variable | Demo purpose |
| --- | --- |
| DELEGATION_ENABLED | Explicitly true in the reference Compose demo; disabled in legacy fixture mode |
| DELEGATION_AUTHORITY_URL | Core/provider backchannel to broker; host default localhost:4010 |
| DELEGATION_DB_PATH | Authoritative grant SQLite path |
| DELEGATION_KEY_DIR | Separate private-key directory, mounted only to broker |
| DELEGATION_ISSUER | Exact assertion issuer; default localhost:4000/api/delegation, an identifier rather than the JWKS location |
| DELEGATION_KEYCLOAK_BACKCHANNEL | Reconciler's JWKS origin reachable from Keycloak; Compose default delegation-broker:4010 |

For manual reconciliation run `npm run demo:delegation:realm`, then sign in again if audiences changed. Reconciliation is idempotent and refuses to overwrite a conflicting existing identity link. It is limited to the seeded local user population; production provisioning/pagination/lifecycle belongs to the remaining identity tasks.

Emergency demo disable: stop runner submissions, revoke active grants, disable the broker client/IdP through reviewed Keycloak administration, and stop the broker container. Preserve databases and keys for investigation. Providers deny delegated execution while the authority is unavailable; interactive login remains available. Do not add a service-header fallback.

Key rollover, key compromise response, restoration of replay state, maintained patch selection, TLS, production database, vault/KMS, HA, sender constraints and independent security review remain OBO-06/OBO-30/OBO-34–OBO-36. Do not rotate by deleting live key files: overlap/retirement procedures need their own tested implementation. This demo profile explicitly refuses production-mode activation.

## Explicit broker profile and automation boundary

The broker's reviewed legacy read profile is independent of the growing OpenAPI inventory. It includes owned inventory/balance/ordinary history routes across the seven providers; exact paths live in [policy.ts](../../services/delegation/src/policy.ts). Interactive financial reviews, mandate management, reconciliation, new statement/history workbenches, source admissions/reversals and settlement recovery are outside that profile. Read rights require a deliberate profile change. The one explicit legacy wallet credit remains AED 1–10 with one execution and its original exact source/body.

Unknown top-level authority fields are rejected. Normalized consent terms are copied. Active use revalidates stored grants under the current profile; obsolete grants retain their original body/audit and may be inspected/revoked, but cannot execute. Token registration checks the live fingerprint/lifetime, same pending job, owner/actor/version and exact operation digest. Only an authorized job can become completed; stale terminal acknowledgements cannot replace its result.

`npm run demo:verify:automation-security` uses temporary provider/broker data with real local Keycloak. An isolated trusted issuer container mounts existing keys read-only; the host/agent runtime receives no issuer keys or delegated tokens. Temporary identity configuration is permission-restricted and deleted. Blocked probes move no money; a separately approved legacy AED 1 control credits its temporary wallet once to verify compatibility. The test removes its own container and temporary databases and preserves normal funds/authority records. Direct provider status probes use fresh sockets across restart; no mutation is automatically retried.

`npm run demo:verify:delegation:restart` briefly stops the normal broker, hashes its existing grants/bindings/jobs/audit read-only, restarts it and proves byte preservation. Run it serially with delegation actions; no volume reset, key replacement or money change occurs.

[The AUTO-02 threat model](../architecture/payment-automation-security.md) defines who may consent, derive jobs, reserve budgets, mint assertions, admit, revoke and reconcile. Scheduled money remains disabled until AUTO-03/PAY-08/PAY-21/AUTO-15 gates pass. Token fingerprint binding limits context/use; it does not prevent a possessor racing the same intended bearer request. [Evidence](../reports/2026-10-24-automation-security.md).
