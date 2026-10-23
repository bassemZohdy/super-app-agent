# Service and action contract inventory

**All endpoints below are demo handlers**, not authenticated live agency APIs. They are implemented in `services/service-*/src/index.ts` and called **as imported functions by agent-core**. The HTTP servers expose similar endpoints for demonstration; direct imports bypass network-level gateway/policy boundaries.

## Agent ingress API

| HTTP | Path | Behavior |
| --- | --- | --- |
| GET | `/health` | Public health JSON; historical `agentCore: "LangGraph"` marker is **not actual runtime proof** |
| GET | `/api/a2ui/stream?sessionId=...` | Custom SSE events, auth requirement; local `demo=1` bypass available only with explicit `DEMO_AUTH=true` |
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
| `service-catalog` | 4004 | `GET /miniapps`, `GET /tools`, `GET /housing/ejari`, `POST /housing/move-in` | Catalog and housing mixed for demo |
| `service-profile` | 4005 | `GET /profile`, `GET /profile/preferences`, `POST /profile/preferences`, `GET /profile/prompt-context` | Mutable demo preferences, not a per-subject persistent database |

Paths have some short aliases; the canonical examples above are taken from the code. Do not infer REST response stability or full authorization from them.

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

## Contract evolution

1. Split service domain boundaries by real business ownership.
2. Define versioned OpenAPI schemas for REST and/or real MCP tool contracts with authorization/consent metadata.
3. Move calls to authenticated network interfaces with service identity, trace propagation and timeouts.
4. Enforce business policies at each domain boundary, not only inside the agent.
5. Add capability registry versioning, tenant isolation, approval receipts and audit traces.

See [target architecture](target-architecture.md).
