# Agent runtime

`services/agent-core/src/langgraph/runtime.ts` compiles a real LangGraph `StateGraph`: prepare → review interrupt → execute. The prepare node invokes the retained deterministic service router; optional model text explains the result. The graph never treats model prose or chat assent as authority to execute a mutation. [LangGraph documentation](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph).

Integrated mode uses `RedisGraphSaver` for the single root checkpoint namespace. Each proposal gets a fresh opaque thread ID; checkpoint entries expire with session TTL and the ID list is capped at 32. Replacement, cancellation and successful execution delete the relevant continuation. Fixture tests use `MemorySaver`. The core separately persists subject/account ownership, surface revision, transcript and approval before returning. Normal container restart tests resume a saved interrupt and execute one approved simulated top-up.

`SuperAppAgentGraph` in `graph.ts` remains the service coordinator. It reads profile/preferences, classifies mobility, utilities, wallet, telecom, housing or composite requests, awaits checked domain calls and builds the custom surface. With `DOMAIN_TRANSPORT=http`, calls carry the verified bearer token/account to application APIs, which use their own client credentials for provider APIs. Legacy fixtures use direct handlers.

`GET /api/services` lists eleven repository-bundled services. `POST /api/manual/prepare` selects a fixed server-owned route; it bypasses model execution and needs no prior conversation. React `/services/{id}` routes use it. Manual and concierge proposals share the same subject/account, input, approval, effect and failure checks. The core also offers [authenticated MCP](../development/mcp.md).

Approval records contain an ID, five-minute expiry, subject/account, revision and SHA-256 digest of the canonical view. Every offered payload field must match, with the selected choice bound to an advertised group. `POST /api/a2ui/cancel` revokes the current pending proposal and removes its continuation. Session history includes at most 50 approval lifecycle entries. This binds a demo proposal; it is not a cryptographic provider quote or a delegated grant service.

Unified checkout and move-in use application adapters in integrated mode. Checked failures stop later effects. Partial/unknown mutations produce truthful warning surfaces and block further requests in the conversation until reconciliation. A graph checkpoint does not make separate provider/payment transactions atomic, supply automatic compensation or guarantee recovery from every crash boundary.

OpenRouter receives bounded service context and up to the latest 12 turns: 24 KiB total, up to 4 KiB per conversational message, 1200 output tokens, a 60-second timeout, and at most 4000 returned characters. Requests use official HTTPS and a zero-priced provider ceiling. Per actor/account: 30 calls/hour, two concurrent calls; the process quota map has 1000 entries. This is a demo request budget, not distributed spend accounting. Remote TTS is off unless explicitly enabled.

A missing key or `ENABLE_LIVE_LLM=false` avoids model calls. Provider errors remain visible. The configured environment key reaches the container but is rejected with HTTP 401. `/health` reports configuration; successful live generation is still unverified. The manual routes remain usable.

Model-selected plans, general subgraphs/workflow migrations, schedules, proactive delegated effects, distributed compensation, HA, production evaluation and official UI adapters remain future work. [Demo decision](../adr/ADR-0011-local-demo-target.md) · [Backlog](../../TODO.md).
