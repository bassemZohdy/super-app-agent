# Service contracts

There are two REST boundaries in integrated mode: concierge → application APIs using the user's access token, and application → provider using Keycloak client credentials plus trusted user/account context. HTTP errors never silently select the old shared fixtures.

| Application | Port | API responsibility | Provider |
| --- | --- | --- | --- |
| service-ride | 4001 | `/mobility/*`, `/rides/*` | RTA, payments |
| service-food | 4002 | `/utilities/*`, dining compatibility routes | DEWA, payments; local account-scoped dining records |
| service-wallet | 4003 | `/wallet/*`, `/fines/*`, `/pay/unified` | payments, Police, DEWA, RTA |
| service-catalog | 4004 | `/miniapps`, `/capabilities`, `/housing/*` | DLD, DEWA, RTA |
| service-profile | 4005 | `/profile`, preferences, prompt context, `/accounts` | application-owned account-scoped SQLite |
| service-telecom | 4006 | `/telecom/{etisalat|du}/*` | Etisalat, du, payments |

Application compatibility request schemas remain in `packages/protocol-core/src/request-validation.ts`. Provider operation/request/response contracts are generated from `services/provider-simulator/src/contracts.ts` into the seven [OpenAPI files](../../services/provider-simulator/openapi). `npm run openapi:generate` refreshes them and the default tests validate their syntax and equality with the runtime.

Provider routes are versioned under `/v1/accounts/{accountId}`. Each operation verifies a machine JWT and account ownership. Writes require a persistent idempotency key. Money capture uses integer AED fils; entity bills and tariffs are authoritative. Providers verify captured payment proofs before settlement. Details, exact endpoints, grants, failures and examples are in the [provider guide](../demo/provider-backends.md).

Private application records come from verified user claims and selected membership, rather than a shared singleton. Client-selected user IDs are not accepted. The core only accepts the user's personal or household account references and binds a conversation to one of them.

The capability catalog and custom UI metadata do not themselves implement consent, production delegated authority, independent mini-app deployment, or official MCP/AG-UI/A2UI conformance. Legacy direct handlers are preserved for offline fixture tests and have different durability/isolation guarantees.

## Concierge entry points

The authenticated core `/mcp` transport exposes account/capability/conversation discovery and the normal guarded intent/action operations. Its schemas reuse the HTTP request contracts. Application `GET /mcp` descriptors remain compatibility metadata; see [the MCP guide](../development/mcp.md).

Manual `/api/manual/prepare` selects one of eleven server-owned bundled service IDs. It bypasses model calls but uses the same session ownership, approval, effect and result path as concierge proposals. Unknown service IDs cannot load remote code. `POST /api/a2ui/cancel` invalidates the current one-time proposal; it does not reverse completed provider effects.
