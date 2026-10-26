# Super App Agent architecture

The focused entry point is `services/agent-core/src/orchestrator/main.ts`, run with `npm start`. It is an independent TypeScript application using first-party LangGraph.js. The 26 October 2026 implementation instruction supersedes the earlier proposal for a separate workflow executor. The later simplification instruction selects embedded SQLite instead of PostgreSQL for this demo.

```mermaid
flowchart TD
  Client["Super App client or executable CLI"] --> API["One Node.js agent API"]
  API --> Graph["One LangGraph.js orchestrator"]
  Graph --> Planner["Configured OpenAI-compatible planner"]
  Graph --> Policy["Deterministic authority and consent checks"]
  Policy --> Adapter["Governed REST fines adapter"]
  Adapter --> Simulator["Fixture-backed REST simulator in the same process"]
  Graph --> SQLite[("Embedded SQLite: native checkpoints")]
  Policy --> SQLite
  Simulator --> SQLite
```

| Existing component | Decision and reason |
| --- | --- |
| TypeScript strict mode, Node 24, LangGraph.js | Keep; already match the application |
| React, Angular, Flutter and shared component contracts | Keep; preserve working shells and return a validated compatibility surface |
| Agent orchestration | Simplify to an acyclic graph with a bounded model-selected fines plan |
| Persistence for the focused entry point | Replace custom Redis checkpoints with official `SqliteSaver`; one local file also stores minimal operational and simulated business state |
| External government/payment simulators | Simplify to JSON fixtures plus narrow HTTP handlers in the agent process; no external database or simulator service |
| Existing integrated provider, payment, broker and Redis stack | Isolate as the compatibility demo, available through its existing commands; do not delete working integrations or mutate their contracts |
| Separate workflow engine, generic DSL, registry service | Remove from the target design; none is added to runtime |
| MCP, A2A, SOAP and controlled browser adapters | Defer new implementations until a real service needs them; retain existing authenticated MCP in the compatibility demo |
| AG-UI, official A2UI and remote mini-app architecture | Defer protocol migration; SSE and existing Cityside component schemas cover this slice |
| PostgreSQL, distributed locks, HA | Defer; use a single process and persistent local SQLite volume |

The simulator intentionally shares the process and file to minimize setup. It still receives an HTTP request and independently checks user authority, workload key, consent, quote and idempotency. This demonstrates security boundaries without adding deployable components. It is not a production agency or financial system.

Run only one agent process against a database file. The in-process transition guard is not a distributed lock. A Kubernetes/OpenShift deployment needs one replica, Recreate rollout, a writable persistent volume, secrets supplied separately, and `/live` and `/ready` probes. Container and cluster execution require separate verification; the Dockerfile alone does not prove deployment.

The compatibility demo still uses `services/agent-core/src/index.ts` and its historical Redis flow. Its setup, scripts and domain services remain unchanged. Moving retained shell journeys onto the focused API is incremental application work, not permission to recreate a workflow platform.

See [flow](agent-flow.md), [integrations and API](integrations.md), [security](security.md), [testing](testing.md) and [remaining work](../TODO.md).

First-party API references checked during implementation: [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts), [checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers), [JavaScript SQLite saver](https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-sqlite). Existing LangGraph 1.5.2 is retained; SQLite saver 1.1.0 is pinned. No managed deployment or tracing service is required.
