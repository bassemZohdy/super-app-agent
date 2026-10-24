# Isolated issuer outcome scenarios

SIM-03 supplies eight named issuer outcomes through authenticated run configuration: approved, declined, limit, expired, disabled, challenge, pending and refund failure. These controls run only in an explicitly isolated issuer instance. The normal demo provider has no issuer-control routes, and production mode rejects their installation.

## Run and record

```sh
npm run simulator:issuer
npm run demo:verify:issuer-scenarios
npm run record:issuer-scenarios
```

The first two execute the same asserted matrix without presentation pauses. The recorder adds six-second reviews/challenges/pending attention and eight-second outcomes. All use real local Keycloak/Redis, temporary provider/application SQLite, separate browser ports and disabled model calls. Start the normal Keycloak/Redis demo first. The temporary run is intentionally cleaned up at the end; the recording and screenshot are retained. [Viewer](../recordings/issuer-scenarios/index.html) · [Evidence](../reports/2026-10-24-issuer-scenarios.md).

The launcher authenticates the local demo operator (`bassem`), verifies its actual JWT and binds that subject to a new isolated run. The customer (`demo-commuter`) signs in independently. This is a capability scoped to that one local run, not a new global Keycloak admin role. No bearer token enters configuration, audit, issuer attempts or checkpoints. The existing preview business-clock store supplies the parent run identity; issuer/JWT deadlines still use real security time.

## Outcomes

| Operator preset | Effect |
| --- | --- |
| `approved` | Ordinary finite authorization/capture after exact customer approval |
| `declined` | Persistent CARD_DECLINED; no capture or wallet credit |
| `limit` | AED 10 effective issuer limit; the matrix's AED 50 request declines |
| `expired` | Current owned source becomes expired; new review/authorization denies |
| `disabled` | Current owned source becomes disabled; new review/authorization denies |
| `challenge` | Human owner must approve/reject its exact one-time challenge |
| `pending` | Finite card capacity reserved, no capture; operator resolves only the issuer decision, followed by separate customer execution |
| `refund-failure` | Capture may succeed, but the original issuer refuses its return; no wallet/card value is restored by that failed return |

Each configuration increments source and configuration revisions. An active quote/hold prevents changing that source's outcome. A limit cannot be reduced below net captured spend. The authorization freezes run ID, preset and configuration revision, so later configuration cannot change an already-captured refund-failure decision. A removed card cannot be silently replaced.

In this isolated mode, customer card requests can create only neutral `approved` metadata, and each card must be configured by the run operator before issuer authorization. Changing a payment body, adding another unconfigured card or answering a human challenge cannot select or resolve a run outcome. Ordinary users cannot re-enable a source kept expired/disabled by run policy. The normal demo retains its earlier five saved-card presets for compatibility; those are separate from this operator-controlled run mechanism.

## Operator API and confinement

Payment contract **1.13.0**, payment-provider OpenAPI **2.17.0**. The isolated server's OpenAPI adds the following routes; normal generated/provider OpenAPI omits them.

| Isolated route | Body / authorization |
| --- | --- |
| `GET /internal/issuer-scenarios/{runId}` | Current configured sources and pending issuer references; only the bootstrap-bound interactive JWT subject |
| `POST /internal/issuer-scenarios/{runId}/configuration` | `accountId`, `methodId`, `expectedMethodVersion`, `expectedRevision`, named `preset`, `requestKey` |
| `POST /internal/issuer-scenarios/{runId}/pending` | `accountId`, original `orderId`, `decision: APPROVE or DECLINE`, `requestKey` |

Configuration starts at revision zero before a source is configured. Exact retries reuse their stored result; changed terms under the same key conflict. Status reads return current state, while repeated write responses remain snapshots. Strict shared schemas reject caller URLs, paths, clocks, card numbers, arbitrary outcomes and additional fields. No endpoint seeds/resets balances or changes ownership.

The server must receive an explicit trusted `issuerScenario` context at construction. It has no environment flag or ordinary API input that can arm controls. The database must be the fixed `payments.sqlite` within a dedicated resolved `cityside-e2e-*` or `cityside-issuer-*` run directory. A first installation requires a pristine database; normal/copied financial records cannot be armed even after copying them into an isolated directory. A reopened run must match its stored run ID, operator and canonical root, and cannot silently reopen as a normal database without that original context. These checks precede configuration schema writes and do not modify rejected data.

`issuer_scenario_runs`, `issuer_scenario_config`, `issuer_scenario_requests` and `issuer_scenario_audit` persist authority/configuration, exact operator request identities and safe audit fields. At most 100 configured sources and 1000 revisions per source are supported in one run. Metadata contains fixed synthetic masks/presets, references and decisions; it accepts no PAN/CVV, private key or user credential.

## Pending authorization semantics

The issuer's `PENDING` authorization maps to `AUTHORIZATION_PENDING` on stored payment and wallet-funding reviews. It counts against finite available card capacity and remains a lifecycle dependency. It cannot capture, settle, credit a wallet, execute later group lines or expose a human challenge button.

Only the run operator can resolve an actual pending issuer record for the exact original owner-approved review, source/version, amount/digest and real deadline. This action cannot resolve a human challenge, fabricate an authorization or extend expiry. After APPROVE, the customer refreshes and explicitly uses Pay/Add (or continues its already-approved group); issuer resolution alone moves no funds. DECLINE closes without capture. Owner cancellation or real-time expiry releases capacity and prevents a later operator decision. Pending state, hold and configuration survive database reopen and an actual provider-server restart in the matrix.

## Upgrade and rollback

The issuer, payment-order and wallet-funding state constraints/indexes now include pending states. Existing rows, immutable quotes/digests, source IDs, captures/returns, journal entries and transaction identities are copied unchanged within migration transactions. First migration creates consistent SQLite backups:

- `.before-issuer-pending-v2.sqlite`
- `.before-issuer-order-pending-v3.sqlite` (older pre-capture schemas keep their existing capture-migration backup)
- `.before-funding-pending-v2.sqlite`

The normal stack gains pending-aware schemas without a run configuration or control capability. Its balances/history remain unchanged. Before rollback to code that lacks pending states, finish or cancel pending operations and preserve consistent source/gateway snapshots. Do not discard pending records, reset balances or reinterpret a captured result as a new attempt. New opt-in pending notifications require the coordinated current event decoder; ordinary normal-mode flows do not emit this scenario state.

## Verified boundary and remaining work

Fourteen focused tests cover all named outcomes, exact configuration/decision retries, ordinary-user and operator denial, active-use substitution guards, real-time expiry, original source binding, pending stored payments, persistent reopen, pristine/path/run confinement, shared contract denial and nonempty schema migration/backup preservation. The real signed browser matrix verifies all eight presets and a pending provider restart, with exact card/wallet effects and no fallback.

SIM-05 remains open for broader run lifecycle/reset/export, role-managed control UI and kill switches; SIM-04 retains broader boundary/callback failpoints. PAY-18 retains legacy raw-capture/parking event coverage and remaining cross-path qualification. This feature grants no unattended spending authority and does not enable preview Keycloak features or a production deployment.
