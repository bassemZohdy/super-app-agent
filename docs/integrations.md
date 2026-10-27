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

The `surface` uses the existing Cityside `AGUISurfacePayload` schema and validates against `validateAGUISurface`. This is explicitly `cityside-compat-v1`, not official A2UI conformance. Button bindings contain `action:"agent.resume"`, `approvalId` and `decision`. The React fines adapter handles that action by sending only `{approvalId,decision}` to `/resume`. Results include the bounded saved `messages` for restoration, selected review rows with AED display values, and a truthful `cancelled` status after thread cancellation. `npm run agent:client` remains the small executable interaction client; pass a saved thread ID to inspect/resume after restart.

## React fines workspace

Run `npm start` and `npm run dev:react`, then open `/services/fines` on the React server (normally `http://localhost:3000`). The concierge navigation also links to **Fines**. This route uses a lazy-loaded adapter and the existing renderer; all other journeys keep their current APIs. No compatibility Compose stack is needed for the fines route. Vite proxies `/api/agent` to loopback port 4300; set server-side `AGENT_PROXY_URL` when changing the agent address. A deployed frontend needs an equivalent same-origin proxy; the Vite development proxy is not a deployment qualification.

For `AGENT_AUTH=test`, copy the `token` field from `AGENT_TEST_IDENTITIES` in ignored `.env.agent` into **Access token**. For Keycloak mode use a current user token with the configured fines scopes; no identity roles are widened by the shell. The browser token stays only in memory, the sign-in field clears immediately, and sign-out discards the client. Only the conversation ID is saved in session storage. A refresh requires sign-in again and an authenticated inspection of the saved thread; another owner cannot restore it. Do not enter the OpenRouter key into the browser.

The conversation is first and service details second by default, side by side at 50/50 on desktop and stacked on a phone. Drag the separator with mouse or touch to resize; keyboard Left/Right changes the split, Home/End reaches usable bounds, and Enter or a double-click resets to 50/50. The main concierge uses view switching on a narrow phone. Supported segmented screens keep panes and controls clear of a book or clamshell hinge. The icon-only **Swap panes** button changes visual, reading and keyboard order. Each pane has a **Maximize** icon; clicking the same control again restores the split view, preserving drafts, messages and the review. There is no separate layout menu, restore button or minimize mode. A new review reopens the details pane and focuses its heading. These controls are shared with the main compatibility concierge.

Design brief: retain Cityside's Avenir/system type, primary teal, white background, slate text/borders and semantic error/focus tokens from `ui-tokens`; use the existing renderer, a left-aligned conversation and a distinct exact-payment review. Keep one primary confirmation, secondary reject/cancel actions, labelled controls, visible focus and 44px targets. Mobile reflows the panes without a detail overlay, and the shared reduced-motion stylesheet applies. New styles contain no raw colors, hosted fonts or images.

Transitions consume named SSE `progress`, `result` and `error` frames. The authoritative result replaces the panel/transcript. Approval dispatch must match the displayed approval ID; repeated clicks are locked while pending. A connection failure blocks replacement messages and payments until **Recover saved operation** has checked the original operation. **Inspect saved conversation** is read-only; **Cancel conversation** closes a settled/reviewing thread and is unavailable during an unknown outcome. After a process restart, inspection restores the exact saved review. Cancellation never implies a dispatched payment was undone.

### Existing LiteLLM server

The main concierge supports `CONVERSATION_PROVIDER=litellm` with exported `LITELLM_BASE_URL`/`LITELLM_URL` and `LITELLM_API_KEY`. Set `LITELLM_MODEL=glm-5.3` or another advertised identifier such as `MiMo-V2.6-Flash-RL`; [conversation setup](development/local-ai.md#select-a-conversation-provider) describes limits and the local/OpenRouter alternatives. Server keys and internal correlation/approval headers never enter hosted request bodies or the browser.

The focused fines planner uses `AGENT_LLM_PROVIDER=litellm` in private `.env.agent`. Leave `AGENT_LLM_BASE_URL` empty to reuse the existing LiteLLM base, and select `AGENT_LLM_MODEL=glm-5.3`. An explicit base must exactly match the configured gateway before its key can be reused. It defaults to 512 output tokens and 45 seconds for LiteLLM; `AGENT_LLM_MAX_TOKENS` (64–1024) and `AGENT_LLM_TIMEOUT_MS` (100–60000) set bounded overrides. `AGENT_LLM_RESPONSE_FORMAT=prompt` requests plain JSON and still strictly validates the returned plan; `json_object` is available for compatible servers supporting that API parameter. Local/OpenRouter retain their existing defaults. Restart the agent after changing configuration; a model reply never grants approval or execution authority.

## Configuration

`npm run agent:init` creates private `.env.agent` once, with random local test credentials. The test identity lasts seven days; regenerating configuration is an explicit local operation. `npm start` reads that file. Defaults are loopback port 4300 and `.data/agent.sqlite`. Set `AGENT_PORT`, `AGENT_HOST` and `AGENT_DB_PATH` when changing addressing; the in-process simulator URL follows the listening address (a wildcard host maps to `127.0.0.1`) unless `AGENT_SIMULATOR_URL` names another one, which is required when `AGENT_PORT` is 0. The simulator URL is trusted deployment configuration, never user or model output.

The in-process simulator serves fines (`GET /simulator/v1/fines`, `POST /simulator/v1/payments`) and, for the vehicle renewal journey, `GET /simulator/v1/vehicles` (`vehicles:read`) and `POST /simulator/v1/renewals` (`vehicles:renew`). A renewal needs the workload key, consent bound to its exact quote and the original operation key. It is refused with `FINES_OUTSTANDING` while any fine is unpaid, with `QUOTE_STALE` when the vehicle or fee changed or the vehicle was already renewed, and a repeated key returns the original receipt. Renewal and fines payment are separate effects that commit separately; nothing is atomic across them.

For actual model-selected plans set `AGENT_PLANNER=compatible`, `AGENT_LLM_BASE_URL=http://your-local-model:port/v1/`, `AGENT_LLM_MODEL` and optional `AGENT_LLM_KEY`. The base URL must end in `/`. The endpoint must implement chat completions with JSON-object output. There is no hosted default or fallback. `fixture` is an explicit deterministic demo/test planner, not natural-language model evidence.

### Explicit OpenRouter setup

When hosted inference is selected, keep `OPENROUTER_API_KEY` in the server process environment and run `npm run agent:init -- --openrouter` before the first startup. This generates private local test identity/workload credentials and selects the existing compatible planner at `https://openrouter.ai/api/v1/` with `openrouter/free`; it never copies the API key into a file. Existing `.env.agent` files are preserved; to change an existing fixture configuration, set `AGENT_PLANNER=compatible`, `AGENT_LLM_BASE_URL=https://openrouter.ai/api/v1/` and `AGENT_LLM_MODEL=openrouter/free` in that private file.

The compatible planner reads `OPENROUTER_API_KEY` only for the exact HTTPS OpenRouter endpoint. `AGENT_LLM_KEY` remains an explicit override for a configured endpoint; the shared OpenRouter key is never forwarded to other hosts. OpenRouter models must be `openrouter/free` or end in `:free`, and each request caps provider prompt/completion prices at zero. Redirects are refused and provider failures remain errors, without a fixture or paid fallback. Sent conversation text goes to OpenRouter only when this configuration is explicitly selected; records and payments remain synthetic. See the [provider API](https://openrouter.ai/docs/api_reference/overview) and [free router](https://openrouter.ai/openrouter/free).

`npm run agent:verify:model` makes real, synthetic English/Arabic list/pay/clarification/out-of-scope and follow-up calls. Its declared smoke threshold is every expected intent correct within fifteen seconds per call. It stops on an unavailable or invalid provider response, prints no credentials/raw response, and cannot substitute mocked inference for a pass. A smoke pass alone is not a broad model-quality evaluation.

`AGENT_AUTH=keycloak` reuses the existing verified JWT contract and its `KEYCLOAK_*` settings. Required user scopes are `fines:read` and, for payment, `fines:pay`; the existing demo realm is not automatically broadened. `AGENT_WORKLOAD_KEY` protects the internal simulator calls, and `AGENT_WORKLOAD_ID` identifies the configured acting application. See [security](security.md) for the demo identity boundary.
