# Application APIs

The six application services expose the REST operations that the shell and agent call for city services. This guide covers what they are, how to call them with a Keycloak bearer token, which probes they serve, and how the OpenAPI contract is generated and tested. Start the stack with [local development](local-development.md); this page does not repeat that setup.

## Services and ports

Each service is a Node HTTP server built by `createApplicationServer` in [application.ts](../../packages/backend-kit/src/application.ts). Ports come from `.env.example`:

| Service | Port variable | Default port | Domain |
| --- | --- | --- | --- |
| `service-ride` | `PORT_SERVICE_RIDE` | 4001 | RTA rides, parking, Salik tolls, EV charging |
| `service-food` | `PORT_SERVICE_FOOD` | 4002 | DEWA utilities and restaurant orders |
| `service-wallet` | `PORT_SERVICE_WALLET` | 4003 | Wallet, traffic fines, unified checkout |
| `service-catalog` | `PORT_SERVICE_CATALOG` | 4004 | DLD housing, mini-app and capability catalog |
| `service-profile` | `PORT_SERVICE_PROFILE` | 4005 | User profile and preferences |
| `service-telecom` | `PORT_SERVICE_TELECOM` | 4006 | Etisalat and du prepaid and postpaid lines |

Each `services/service-*/src/index.ts` reads `PORT` (defaulting to the port above) and listens on `0.0.0.0`. The `service-telecom` entry point defaults to 4006 the same way.

## Integrated and legacy modes

The services have two modes, selected by `PROVIDER_INTEGRATION` (`.env.example` sets `false`; `docker-compose.demo.yml` sets `true`).

- **Integrated (`PROVIDER_INTEGRATION=true`)**: every route except the probes requires a bearer token, validates the request, and calls the provider simulators. This is the only mode that documents and enforces auth.
- **Legacy fixtures (`PROVIDER_INTEGRATION=false`)**: requests go straight to the in-process fixture handler. There is no bearer check and no per-user account isolation. Do not expose this mode beyond local tests.

## Calling an operation

1. Obtain a Keycloak access token for a user with the `superapp-user` realm role (demo users and login steps are in [local development](local-development.md)).
2. Send the request to the owning service port with `Authorization: Bearer <token>`. Optional `X-Account-Id: <account-id>` selects the account to act on; it must be owned by the signed-in user, or the call fails with `403 ACCOUNT_FORBIDDEN`. Without it, the user's personal account is used.
3. Optional `X-Request-Id` is kept (truncated to 200 characters) and feeds the provider idempotency keys and references.

```bash
curl -H "Authorization: Bearer <token>" -H "X-Account-Id: <account-id>" \
  http://localhost:4003/wallet/balance
```

POST bodies must be `application/json`. Responses are JSON with `success` on envelope responses, and errors use `{ "success": false, "code": "...", "error": "..." }`.

Request handling order in `createApplicationServer` (integrated mode): probes, then bearer verification, then `readJsonBody`, then `validateRequest` (skipped for `/accounts` and for all `service-telecom` routes, which validate prepaid routes inside `integratedRequest`), then `integratedRequest`. Unmatched integrated paths return `404 NOT_FOUND`.

### Bearer token rules

`verifyJwt` in [jwt.ts](../../packages/backend-kit/src/jwt.ts) is called with audience `KEYCLOAK_AUDIENCE` (default `agent-core`). A token is accepted only when:

- the header `alg` is `RS256` and `kid` is present;
- the claim `iss` equals `KEYCLOAK_ISSUER`;
- the claim `typ` is `Bearer`;
- `aud` includes the configured audience;
- `sub` is present and `exp` is in the future and within the maximum lifetime;
- the signature verifies against a key from `KEYCLOAK_JWKS_URL` (or the issuer's `protocol/openid-connect/certs`);
- every scope in `KEYCLOAK_REQUIRED_SCOPES` is present, when that variable is set;
- online introspection succeeds when `KEYCLOAK_INTROSPECTION_URL` is set, or when `NODE_ENV` is `production`.

The application layer ([application.ts](../../packages/backend-kit/src/application.ts)) then requires `realm_access.roles` to include `superapp-user`, and rejects `preferred_username` values that start with `service-account-`. Any failure returns `401 UNAUTHENTICATED`.

## Probes

Probes are answered before bearer auth, so they work in integrated mode without a token.

| Endpoint | Response | What it checks |
| --- | --- | --- |
| `GET /live` | `200 {"status":"live","service":...}` | Process is serving HTTP. Nothing else. |
| `GET /ready` | `200 {"status":"ready",...}` or `503 {"status":"not_ready",...}` | Only that the in-process handler function exists. Provider reachability is not probed; provider failures surface per request as `503 PROVIDER_UNAVAILABLE`. |
| `GET /health` | `200 {"status":"ok","service":...,"integration":...}` | `integration` is `rest-providers` in integrated mode and `legacy-fixtures` otherwise. |

Probe responses use `Cache-Control: no-store`. The 503 body contains no internal details. These probes are not part of the OpenAPI contract.

## OpenAPI contract

The contract is `packages/backend-kit/openapi/application-apis.openapi.json` (OpenAPI 3.1.0, title "Cityside Application APIs"). It is built from `APPLICATION_OPERATIONS` in [application-openapi.ts](../../packages/backend-kit/src/application-openapi.ts).

- Regenerate after changing any route, operation or validation contract:

  ```bash
  npm run openapi:generate:apps
  ```

- Validated routes take their request schema from `requestSchema` in [request-validation.ts](../../packages/protocol-core/src/request-validation.ts), so the request contract cannot drift from the validator.
- Every operation declares `bearerAuth` and lists `X-Account-Id` and `X-Request-Id` headers. Each operation's `servers` entry points at its service port on `localhost`.

### What the contract test enforces

[application-openapi.test.ts](../../services/test/application-openapi.test.ts) (run by `npm test`) checks that:

1. the checked-in JSON is byte-equal to the generator output and validates as OpenAPI 3.1;
2. every validated operation exists in the protocol-core route table, and each static path segment appears in the handler sources;
3. there are no duplicate `method path` pairs;
4. the `bearerAuth` scheme is HTTP bearer with format `JWT`.

If test 1 fails, run `npm run openapi:generate:apps` and commit the regenerated file.

## Limits

- **agent-core `/api` routes are not in the contract.** Only the six application services are documented.
- **Legacy fixture mode has no auth.** The contract describes only `PROVIDER_INTEGRATION=true`.
- **Response schemas are shallow.** Success responses list top-level keys only (`additionalProperties: true`). Many operations are documented as passthrough of provider data, and their shape is not described.
- **Probes and `/health` are not documented** in the contract.
- **Path aliases:** `POST /pay/multi-agency` is an alias of `POST /pay/unified` and is listed in the contract as its own operation, not excluded.
- **Telecom bodies** for passthrough operations use manual schemas rather than the validator.

## Environment variables

| Variable | Used for | Where verified |
| --- | --- | --- |
| `PROVIDER_INTEGRATION` | Selects integrated mode | `.env.example`, `application.ts` |
| `PORT`, `PORT_SERVICE_RIDE` to `PORT_SERVICE_TELECOM` | Listen port and documented port | `services/service-*/src/index.ts`, `.env.example` |
| `KEYCLOAK_ISSUER` | Required `iss` claim | `.env.example`, `jwt.ts` |
| `KEYCLOAK_AUDIENCE` | Audience checked (default `agent-core`) | `.env.example`, `application.ts`, `jwt.ts` |
| `KEYCLOAK_JWKS_URL` | Signing-key source | `.env.example`, `jwt.ts` |
| `KEYCLOAK_REQUIRED_SCOPES` | Space-separated scopes that must be present | `.env.example`, `jwt.ts` |
| `KEYCLOAK_INTROSPECTION_URL`, `KEYCLOAK_INTROSPECTION_CLIENT_ID`, `KEYCLOAK_INTROSPECTION_CLIENT_SECRET` | Online token check (secret is never written in docs) | `.env.example`, `jwt.ts` |
| `NODE_ENV` | Forces introspection when `production` | `.env.example`, `jwt.ts` |
| `APP_DATA_DIR` | Directory for per-service SQLite files (default `.data/application`) | `.env.example`, `application.ts` |
| `SERVICE_CLIENT_SECRET` | Fallback confidential client secret for provider calls; a per-service variable such as `SERVICE_RIDE_CLIENT_SECRET` is preferred | `application.ts` (not in `.env.example`) |

Keep secrets in `.env`, not in code or docs.
