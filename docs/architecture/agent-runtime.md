# Agent runtime: actual behavior and evolution

## As-built (not LangGraph)

The only orchestrator entry points are `SuperAppAgentGraph.executeIntent(state, prompt, onProgress)` and `resumeWithAction(state, action, payload, onProgress)` in `services/agent-core/src/langgraph/graph.ts`.

They are static TypeScript methods: no LangGraph StateGraph/checkpointer is imported, and `services/agent-core/package.json` does not declare a LangGraph dependency. The graph label in code, health checks and documentation is historical/nomenclature only.

### Planning today

- Append user text to process-local `messages`.
- Read a shared demo profile context.
- Match English text substrings such as parking, ride, utilities, fine, wallet and housing to select `concierge`, `ride`, `food`, `wallet` or `composite`.
- If `ENABLE_LIVE_LLM=true` and an OpenRouter key is present, call a compatible chat completion; **ignore the returned completion** for planning/routing.
- Execute scenario-specific TypeScript functions, often synchronously (direct imports).
- Build a hardcoded UI tree using `build*Surface` functions, update `currentSurface`, and return.

This can demo a multi-service workflow but cannot generalize to new capabilities without code changes. Text can be misclassified (for example, utility flows live inside a food-named service), and profile context is not reliably tied to a real user identity.

### Action today

`resumeWithAction` is a series of branches such as `activate_parking`, `extend_parking`, `pay_utilities_bill`, `pay_police_fines`, `confirm_smartcity_checkout`, `confirm_movein`, `book_ride`, `order_food`, `confirm_composite_checkout`, `topup_wallet` and `update_preferences`.

The agent-core API checks that the event action was present on the latest surface. It also guards some client values (`amount`, `durationHours`, `zoneId`, `plateNumber`, `ticketId`), selected choice membership and repeated submits for a given surface. No downstream service enforces genuine delegated user authorization; process-local duplicate checks are not durable.

### Persistence

`SuperAppAgentState` stores `sessionId`, messages, active domain, optional current surface, pending action, checkpoint ID and metadata. The latter fields are mostly placeholders. Session map, SSE listeners and consumed-action set live in the Node process. Restart loses them and there is no long-running schedule, resumed external event, event log or transactional outbox.

## Model interface

`getOpenRouterConfig` selects `openrouter/free` by default. `invokeOpenRouterChat` uses fetch to an OpenAI-compatible completion URL with 20-second timeout, `max_tokens: 300` and temperature 0.1. A non-`:free` paid model needs an explicit opt-in. No key yields a local JSON demo fallback without a network request. Free-model availability and consistency depend on the provider.

**Important:** enabling the preview does not make the app autonomous. Real tool selection, model output validation, safe tool execution and a bounded planner have not been wired.

## Target Option A: agent-first but bounded

The **Concierge** should manage user goals, journey context, plan revisions, explainability and UI selection. It should not become the payment authority, identity broker, repository of personally identifiable records or a compulsory gateway for every call.

### Proposed responsibilities

| Layer | Contract |
| --- | --- |
| Concierge planner | Choose next allowed capability, ask for missing context, track goal and task status |
| Capability registry | Authoritative catalog of descriptions, input/output schema, action risk, permitted UI surfaces and policy references |
| Deterministic workflow executor | Retries, scheduled jobs, long-running waits, failure/compensation and versioned state |
| Domain API/MCP adapter | Invoke capability through authenticated typed interfaces; capability owners enforce resource authorization |
| Experience composer | Choose A2UI template/generated surface, with strict schema and action references |
| Host shell | Render UI, manage navigation, preserve device-specific session and request user confirmation |
| Policy/consent | Validate actor, subject, delegation chain, scopes, resource, time and explicit approval |

### Autonomy levels

1. **Assist:** answer/prepare; no external mutation.
2. **Delegate:** execute user-requested operations with explicit task/amount/resource-bound approval.
3. **Proactive:** run pre-authorized event-driven tasks under bounded consent policies, with audit/revocation.

Safety is a domain policy, not merely a model prompt. “Agent selected a tool” never implies “the user authorized that transaction.”

## Evolution gates

- Define a versioned capability registry and independent domain tool interface.
- Implement a real agent framework/runtime (e.g. LangGraph) behind an adapter; confirm the actual dependency and use its genuine checkpoints/interrupts.
- Introduce durable workflow execution where required, separate from nondeterministic agent planning.
- Add user-bound consent, transaction quote, domain authorization and audit before mutable civic/finance actions.
- Add evaluation for intent accuracy, tool safety, model spend, replay/recovery and latency.
- Replace custom UI/event boundaries with standards-compatible AG-UI + A2UI adapters.

See [target architecture](target-architecture.md) and [backlog](../../TODO.md).
