# Service and action contract inventory

**All endpoints below are demo handlers**, not authenticated live agency APIs. They are implemented in `services/service-*/src/index.ts` and called **as imported functions by agent-core**. The HTTP servers expose similar endpoints for demonstration; direct imports bypass network-level gateway/policy boundaries.

## Agent ingress API

| HTTP | Path | Behavior |
| --- | --- | --- |
| GET | `/health` | Public health JSON; `agentCore: "deterministic-demo-router"` reflects the current runtime |
| GET | `/api/a2ui/stream?sessionId=...` | Bearer-authenticated SSE, bounded process-local replay via `Last-Event-ID`, expiry, origin and backpressure checks; see [stream contract](event-stream.md) |
| POST | `/api/a2ui/intent` | Body `{ sessionId, text, handshake? }`; require auth, user-bind session, deterministic classification |
| POST | `/api/a2ui/action` | Body `{ sessionId, action, payload }`; existing authorized surface required |

Example:

```bash
curl -X POST http://localhost:4000/api/a2ui/intent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer demo-local' \
  -d '{"sessionId":"sess_services_001","text":"Check my Salik balance"}'
```

`demo-local` is accepted only if the backend is explicitly in nonproduction demo mode. A valid real JWT otherwise requires configured issuer/audience/JWKS.

## Domain modules

| Service | Default port | Representative simulated endpoints | Remarks |
| --- | --- | --- | --- |
| `service-ride` | 4001 | `GET /mobility/parking/zones`, `POST /mobility/parking/activate`, `POST /mobility/parking/extend`, `GET /mobility/salik/balance`, `POST /mobility/salik/recharge`, `GET /mobility/ev/chargers`, `GET /rides/options`, `POST /rides/book` | Includes mobility and legacy ride examples |
| `service-food` | 4002 | `GET /utilities/bill`, `GET /utilities/consumption`, `POST /utilities/pay`, `GET /restaurants/search`, `POST /orders/create` | Utilities grouped with food for demo convenience, not a recommended bounded context |
| `service-wallet` | 4003 | `GET /fines/check`, `POST /fines/pay`, `POST /pay/unified`, `GET /wallet/balance`, `GET /wallet/transactions`, `POST /wallet/pay`, `POST /wallet/topup` | Shared fixture ledger; combined agencies are **not** an atomic distributed transaction |
| `service-catalog` | 4004 | `GET /miniapps`, `GET /tools`, `GET /capabilities`, `GET /capabilities/:id`, `GET /housing/ejari`, `POST /housing/move-in` | Catalog and housing mixed for demo |
| `service-profile` | 4005 | `GET /profile`, `GET /profile/preferences`, `POST /profile/preferences`, `GET /profile/prompt-context` | Mutable demo preferences, not a per-subject persistent database |

Paths have some short aliases; the canonical examples above are taken from the code. Do not infer REST response stability or full authorization from them.

### Versioned capabilities (P1-01)

`GET /capabilities` returns `schemaVersion: "1.0.0"` and 32 version-2 capability definitions combining metadata in `services/service-catalog/src/capabilities.json` with enforced input schemas in `packages/protocol-core/src/request-validation.ts`. `GET /capabilities/:id` resolves a stable dotted ID. `/tools` keeps its discovery envelope and adds capability IDs/version to every entry.

Each definition includes owner service, semantic version, input/output JSON Schemas, risk, mutation/confirmation flags, subject-bound consent scopes, delegation policy, HTTP mapping and a synthetic example. Inputs reject undeclared fields in contract validation; output envelopes describe success/error shapes while nested domain objects remain extensible. All 32 schemas are compiled and checked against simulator responses by Ajv in tests.

All core/domain request handlers now enforce the shared input schemas before state mutation, including direct in-process calls. Scopes and consent metadata are **not** authorization enforcement; output contracts still describe simulation envelopes. Authenticated typed adapters (P1-02), domain enforcement (P0-03) and consent lifecycle (P1-10) must apply them before real invocation. The registry does not advertise an MCP/A2A transport or authorize its callers. Version output contract changes explicitly; do not silently reuse an ID/version for incompatible semantics.

### Tool “MCP” descriptors

Several services expose `GET /mcp` to return JSON tool listings, and the catalog exposes `GET /tools`. These are **not sufficient** to claim a standards-compatible MCP server: no demonstrated official MCP transport, JSON-RPC initialization, typed invocation flow, auth and error handling were validated. The agent graph directly invokes TypeScript handlers.

### Action names used by deterministic graph

`activate_parking`, `extend_parking`, `pay_utilities_bill`, `pay_police_fines`, `confirm_smartcity_checkout`, `confirm_movein`, `book_ride`, `order_food`, `confirm_composite_checkout`, `topup_wallet` and `update_preferences`.

Not every action is available on every UI surface. The backend rejects actions absent from the active surface and rejects some altered values, but **a UI offer does not replace an authoritative permission check**. Domain actions need subject binding, server-derived quotes, idempotency keys, status/reconciliation and consent enforcement before any real mutations.

## Scenarios supported as simulations

- Parking activation and extension; Salik balance/recharge; EV charger discovery.
- Utility consumption/bill/payment; traffic fines check/settlement; wallet balance/top-up.
- Ejari move-in; personalized preferences.
- Composite “ride + food” and municipal payment/move-in journeys.

These examples reference government brands to illustrate integration use cases. **No real DubaiNow/TAMM/UAE PASS or agency account is accessed.**

## Runtime validation (P0-09)

Core and domain handlers reject invalid roots, undeclared fields, malformed nested preferences, non-finite numbers, numeric strings and excess precision with HTTP 400 (`VALIDATION_ERROR`). The catalog and legacy `/mcp` descriptor inputs use the same schema source; no type coercion, implicit defaults or extra-field stripping is enabled. Invalid or missing selected mutation resources never choose the first fixture.

Capability versions are now **2.0.0** because required mutation inputs changed. The discovery envelope `schemaVersion` remains 1.0.0. Update clients to send:

| Operation | Required body fields |
| --- | --- |
| Parking activation | `zoneId`, integer `durationHours`, `plateNumber` |
| Parking extension | `ticketId`, integer `additionalHours` |
| EV start | `chargerId`, `plateNumber` |
| Ride booking / food order | `driverId` / `restaurantId` and nonempty unique `items` IDs |
| Utility payment | `billId` |
| Fine payment | Nonempty unique `fineIds` list |
| Unified settlement | Nonempty `items` with `agency`, `purpose`, numeric `amount` |
| Housing move-in | `contractNumber` |
| Wallet payment / top-up / toll recharge | Numeric `amount`; payment also requires `purpose` |

Demo amounts accept at most two decimal places, from 0.01 to 1,000,000, with the same aggregate total/balance ceiling. Arithmetic uses integer minor units. Duration is a positive integer capped at 720 hours including cumulative extension. These are **demo limits**, not actual agency/tariff policy. Optional currency is fixed to USD on legacy wallet APIs and AED on civic settlement/toll APIs; the shared fixture ledger still mixes legacy/civic scenarios and requires replacement under P0-06/P1-13.

Read resource fallback/tracking, real domain authorization, immutable quotes, false-success propagation, card fallback and durable transaction guarantees remain separate backlog tasks. See [validation evidence](../reports/2026-10-23-p0-09-validation.md).

## Contract evolution

1. Split service domain boundaries by real business ownership.
2. Define versioned OpenAPI schemas for REST and/or real MCP tool contracts with authorization/consent metadata.
3. Move calls to authenticated network interfaces with service identity, trace propagation and timeouts.
4. Enforce business policies at each domain boundary, not only inside the agent.
5. Apply the versioned capability registry in typed adapters; add tenant isolation, approval receipts and audit traces.

See [target architecture](target-architecture.md).

