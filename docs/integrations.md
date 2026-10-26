# Integrations and client contract

The focused agent has one functioning adapter: `FinesAdapter`, calling fixture-backed REST endpoints in the same Node process. `services/agent-core/fixtures/fines.json` supplies account-isolated seed data. SQLite retains changes and receipts; fully paid accounts are never reseeded on subsequent reads.

The `Tool<I,O>` interface declares identity, description, protocol, Zod input/output schemas, required permission, consequential flag, timeout and invocation. Execution context supplies verified subject/workload, correlation ID, fresh-authority callback and ephemeral authorization header. Consequential calls require an original idempotency key. The payment input also carries an exact persisted consent ID. No generic enterprise bus, dynamic external URL or remotely managed registry is introduced. A service with an existing REST API does not need MCP.

MCP, A2A, SOAP and controlled browser execution are protocol values at the extension boundary, not implemented transports in this entry point. The existing integrated MCP server remains in its original path. Add a real protocol adapter only for a concrete service, with its own authority, schema, timeout and retry tests.

## HTTP API

All `/api/agent` calls use `Authorization: Bearer ...`. Every transition needs a caller-generated `Idempotency-Key` of at most eighty safe characters. Use one key per logical request, and reuse it only with the identical request. Do not put credentials in URLs or conversation text.

| Method and route | Body and behavior |
| --- | --- |
| `POST /api/agent/threads` | Create an owner-bound thread; returns `threadId` |
| `GET /api/agent/threads/{id}` | Inspect saved result and pending approval; no inference |
| `POST /api/agent/threads/{id}/messages` | `{"message":"Show outstanding fines"}` or `{"message":"Pay fine-1"}` |
| `POST /api/agent/threads/{id}/resume` | `{"approvalId":"server-issued UUID","decision":"approve"}`; `reject` and `cancel` also accepted |
| `POST /api/agent/threads/{id}/cancel` | Cancel an unsettled review/session; unknown payments require reconciliation |
| `POST /api/agent/threads/{id}/recover` | Continue/reconcile only the saved original operation |
| `GET /live` | Process liveness |
| `GET /ready` | SQLite accessibility and successful startup configuration; does not claim model availability |

Results contain `threadId`, `status`, `reply`, `fines`, `receipt`, `approval`, `next`, `uiContract` and `surface`. Fine/quote/receipt money is integer fils, currency AED. A receipt always includes `simulated:true`. `approval` is non-null only while the native graph is interrupted; all quote fields must be displayed before confirmation.

`Accept: text/event-stream` on transitions emits `progress` events with `{node,correlationId}`, then `result` with the same result object. `error` terminates a started stream safely. This is bounded application SSE, not official AG-UI, token streaming or replayable event sourcing. After disconnect, inspect the thread rather than assuming cancellation; executing requests can finish after the transport disconnects.

The `surface` uses the existing Cityside `AGUISurfacePayload` schema and validates against `validateAGUISurface`. This is explicitly `cityside-compat-v1`, not official A2UI conformance. Button bindings contain `action:"agent.resume"`, `approvalId` and `decision`. A host adapter handles that action by sending only `{approvalId,decision}` to `/resume`. The existing shell is not silently redirected to the new endpoint. `npm run agent:client` is the small executable interaction client; pass a saved thread ID to inspect/resume after restart.

## Configuration

`npm run agent:init` creates private `.env.agent` once, with random local test credentials. The test identity lasts seven days; regenerating configuration is an explicit local operation. `npm start` reads that file. Defaults are loopback port 4300 and `.data/agent.sqlite`. Set `AGENT_PORT`, `AGENT_HOST`, `AGENT_DB_PATH` and `AGENT_SIMULATOR_URL` together when changing addressing. The simulator URL is trusted deployment configuration, never user or model output.

For actual model-selected plans set `AGENT_PLANNER=compatible`, `AGENT_LLM_BASE_URL=http://your-local-model:port/v1/`, `AGENT_LLM_MODEL` and optional `AGENT_LLM_KEY`. The base URL must end in `/`. The endpoint must implement chat completions with JSON-object output. There is no hosted default or fallback. `fixture` is an explicit deterministic demo/test planner, not natural-language model evidence.

### Explicit OpenRouter setup

When hosted inference is selected, keep `OPENROUTER_API_KEY` in the server process environment and run `npm run agent:init -- --openrouter` before the first startup. This generates private local test identity/workload credentials and selects the existing compatible planner at `https://openrouter.ai/api/v1/` with `openrouter/free`; it never copies the API key into a file. Existing `.env.agent` files are preserved; to change an existing fixture configuration, set `AGENT_PLANNER=compatible`, `AGENT_LLM_BASE_URL=https://openrouter.ai/api/v1/` and `AGENT_LLM_MODEL=openrouter/free` in that private file.

The compatible planner reads `OPENROUTER_API_KEY` only for the exact HTTPS OpenRouter endpoint. `AGENT_LLM_KEY` remains an explicit override for a configured endpoint; the shared OpenRouter key is never forwarded to other hosts. OpenRouter models must be `openrouter/free` or end in `:free`, and each request caps provider prompt/completion prices at zero. Redirects are refused and provider failures remain errors, without a fixture or paid fallback. Sent conversation text goes to OpenRouter only when this configuration is explicitly selected; records and payments remain synthetic. See the [provider API](https://openrouter.ai/docs/api_reference/overview) and [free router](https://openrouter.ai/openrouter/free).

`npm run agent:verify:model` makes real, synthetic English/Arabic list/pay/clarification/out-of-scope and follow-up calls. Its declared smoke threshold is every expected intent correct within fifteen seconds per call. It stops on an unavailable or invalid provider response, prints no credentials/raw response, and cannot substitute mocked inference for a pass. A smoke pass alone is not a broad model-quality evaluation.

`AGENT_AUTH=keycloak` reuses the existing verified JWT contract and its `KEYCLOAK_*` settings. Required user scopes are `fines:read` and, for payment, `fines:pay`; the existing demo realm is not automatically broadened. `AGENT_WORKLOAD_KEY` protects the internal simulator calls, and `AGENT_WORKLOAD_ID` identifies the configured acting application. See [security](security.md) for the demo identity boundary.
