# Agent runtime

`SuperAppAgentGraph.executeIntent` and `resumeWithAction` remain handwritten asynchronous TypeScript methods. No LangGraph runtime or checkpointer is installed.

Intent handling records a user turn, reads that user's profile/preferences, deterministically classifies mobility, utilities, wallet, telecom, housing or composite requests, awaits domain operations, and builds a custom surface. General conversational follow-ups retain the current proposal. Model output is used as the assistant reply rather than discarded.

With `DOMAIN_TRANSPORT=http`, `callDomainAsync` calls the application microservices through REST with the verified user's bearer token, selected account and correlation reference. Those services use confidential Keycloak clients to call independent provider simulators. Legacy mode retains synchronous imported handlers for fixture tests.

Actions must be offered by the current revision and pass the payload/choice checks. Integration surfaces bind telecom provider and bill references in addition to the existing protected fields. A chat response such as “yes” does not execute a payment. Domain/provider validation remains authoritative. This is a demo approval mechanism, not a complete immutable quote/consent system.

Integration mode delegates unified checkout and move-in orchestration to the application adapters. It skips legacy graph follow-on writes, preventing double fine payment or the artificial 720-hour residential parking charge. Partial or unknown mutations cause a warning surface and block further session actions pending reconciliation.

OpenRouter receives the last 12 user/assistant messages and bounded current surface data. The configured key stays server-side. Default: `openrouter/free`, 60-second timeout, 1200 output tokens, paid-model opt-in. Explicit `ENABLE_LIVE_LLM=false` selects deterministic replies; a missing key makes no model call. Provider/network failures become visible messages, not fabricated generated answers. No successful real OpenRouter response is claimed in the latest environment because HTTPS connectivity failed.

Redis integration persists up to 100 messages, the surface/revision and reconciliation state. It provides owner/account binding, expiring leases, fenced saves and shared SSE replay. This is conversation persistence, not a versioned durable workflow engine, scheduler, outbox, multi-agent planner, or automatic compensation system.

Further work: policy-bound capability selection, formal quote/consent records, provider recovery/status workflows, standards adapters and production evaluation. See [target architecture](target-architecture.md) and [backlog](../../TODO.md).
