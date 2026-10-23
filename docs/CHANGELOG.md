# Documentation changelog

## 24 October 2026 — publication cleanup

Reconciled the source/evidence references for GitHub publication, fixed the ADR index table, included the browser cancellation screenshot, consolidated typed action discovery and removed redundant endpoint checks. Repeated code/document/security-pattern, Flutter and integrated demo gates before committing. Private environment values, local databases, builds and caches remain excluded. Historical reports and recordings remain dated.

## 24 October 2026 — demo target, checkpointed approval runtime and security gates

Implemented a real LangGraph prepare/review/execute graph with bounded Redis checkpoints and tested restart resume; authenticated official MCP transport; model-independent bundled service routes; expiring digest-bound approvals and cancellation; shared access-token/JWKS/introspection checks with real logout revocation; byte/deadline/admission HTTP limits; Flutter authenticated SSE; corrected resource tracking; free-provider/model request budgets; and executable ESLint/docs/secret gates. Configured the supplied environment key privately; OpenRouter still returns 401. Updated current docs and retained production requirements. [Decision](adr/ADR-0011-local-demo-target.md) · [Evidence](reports/2026-10-24-demo-completion.md).

## 23 October 2026 — latest demo validation and documentation reconciliation

Pulled `0571413`, validated real local Keycloak/provider/Redis/payment journeys and ordinary restart recovery, and reproduced OpenRouter’s 401 for the configured key. Added startup readiness polling, safe envelope validation and regressions, Flutter web/bootstrap/strict-analysis/widget checks, desktop account switching and transcript restoration fixes, neutral default greetings, and preserved model-error status on conversation reload. Reconciled all current guides/ADR/backlog/package claims while preserving dated reports and open production criteria. [Current evidence](reports/2026-10-23-demo-reconciliation.md).

## 23 October 2026 — integrated provider demo and Cityside interface

Added seven account-scoped SQLite provider simulators and generated OpenAPI 3.1 contracts; application REST adapters and a telecom service; real local Keycloak client credentials and browser PKCE; Redis conversation ownership, TTL, fenced leases, history and shared SSE replay; payment capture/decline/refund, proof checks and persistent idempotency. Unified/move-in adapters avoid legacy duplicate effects. Updated the React/Angular/Flutter design and made OpenRouter replies visible with context and explicit failures. Added the reference Compose stack, provider/Redis/integration verification and refreshed current architecture/security/setup documentation. Historical reports remain unchanged; [current evidence](reports/2026-10-23-provider-demo.md) supersedes their implementation baseline.

## 2026-10-23 — Voice and conversational chat

- Add React/Angular microphone drafts, English/Arabic recognition locale controls, optional spoken replies, visible errors/text fallback and audio cancellation on editing, sending, tab hide and teardown.
- Carry committed assistant messages with surfaces over HTTP/SSE; display replies in all shells. Add bounded deterministic context follow-ups, proposal explanations, greetings/help and approval cancellation. Chat assent never dispatches a mutation.
- Merge #6/#7; refresh backlog, document native/multilingual/runtime boundaries under P1-16/P1-03/P0-05.
- 84 tests and 14 forced JS builds pass. Actual microphone/speaker/browser/native verification remains open. [Voice guide](architecture/voice-and-conversation.md).

## 2026-10-23 — P1-12 dispatch and response handling (partial)

- Omit absent selections, initialize choices from the active surface, reset on revision replacement and reject ambiguous multi-group dispatch. Preserve advertised action parameters in Angular/Flutter.
- Validate web surfaces, read non-2xx bodies, show errors/warning surfaces, clear loading on all request outcomes and prevent duplicate local requests. Deduplicate current HTTP/SSE surface revisions.
- 77 tests and 14 forced JS build tasks pass. Browser/native validation, full form/component parity, event ordering and connection state remain open. [Evidence](reports/2026-10-23-p1-12-dispatch.md).

## 2026-10-23 — P0-10 session coordination

- Merge P0-09/P0-12 into main; refresh backlog baseline.
- Reject overlapping session transitions and stale action revisions; rotate UUID revisions on success/failure and remove timestamp-based consumed-action history.
- Preserve approvals on input rejection, allow refresh after definitive failure, and block partial/unknown sessions pending reconciliation. Update every action caller.
- 72 tests pass; 14 forced JS build tasks pass. [Evidence](reports/2026-10-23-p0-10-session-transitions.md). Distributed durability and provider reconciliation remain open.

## 2026-10-23 — P0-12 domain failure and partial-outcome propagation

- Route graph domain calls through checked result handling with per-request effect tracking; do not render success for rejected operations, thrown writes or incomplete receipts.
- Return stable FAILED / PARTIALLY_COMPLETED / UNKNOWN outcomes, matching failure surfaces over HTTP/SSE, completed-step summaries and refresh/reconciliation guidance. Stop later effects after failure; do not silently compensate or retry.
- Mark move-in plans pending approval before activation; skip empty fine settlements in composite simulation.
- Correct the positive fine-payment E2E scenario to provision sufficient fixture funds and assert fines actually clear. Add nine regression groups for real rejection, partial effects, ambiguous writes, malformed receipts, outages, request isolation, HTTP/SSE agreement and proposal-only planning.
- 67 tests and 14 forced JS build tasks pass; [evidence](reports/2026-10-23-p0-12-domain-failures.md). Durable idempotency, payment fallback/currency semantics and actual reconciliation remain P0-06/P0-10.

## 2026-10-23 — P0-09 runtime validation and money invariants

- Merged PR #2 to main, including PR #3 and the remaining-task review backlog.
- Added shared non-coercing runtime schemas across core/domain HTTP and in-process handlers; capability/tool inputs use the same source (capability versions 2.0.0).
- Reject malformed roots, undeclared/nested fields, numeric strings, non-finite/over-precision/negative/excessive amounts and missing mutation resource IDs before state changes.
- Use integer minor units for wallet, toll, order and parking amounts; enforce aggregate ceilings and validate exact selected mutation resources.
- Strengthened catalog success tests and added nine regression groups covering financial attacks, nested validation, resource selection and real HTTP boundaries. Clean install, 58 tests and 14 forced build tasks pass; [evidence](reports/2026-10-23-p0-09-validation.md).
- Domain authorization/quotes, false success, transaction durability, real Keycloak/browser/native validation remain open tasks.

## 2026-10-23 — Backlog implementation: capabilities, streams and build gates

- Completed P1-01 discovery: 32 stable capability IDs, version/owner, JSON Schemas, risk and consent metadata; catalog/list/detail/tool discovery endpoints and contract tests.
- Implemented backend/web portion of P0-02: authenticated scoped SSE, bounded replay, expiry, origin rejection, backpressure, shared React/Angular fetch client and transport regressions. Flutter/login/durable replay remain open.
- Fixed P0-08 baseline failures: package-manager metadata, Angular workspace, mini-app TypeScript configs, housing workspace, Node source type-checking, incorrect HTTP JSON response calls, crypto types and personalization scenario requiring its own active profile surface.
- Verified clean installation, 49 automated tests and all 14 JS workspace build tasks. Added a separate disposable real-Keycloak runner; Docker is unavailable, and browser installation failed, so those execution gates remain open.
- Updated README/security/architecture/development docs and TODO with [recorded evidence](reports/2026-10-23-release-gates.md); no workflows enabled or model API calls made.

## 2026-10-23 — Full documentation reconciliation

- Replaced misleading `README.md` claims of full agentic autonomy/official protocol support with an **as-built prototype** description and free-model/no-key quick start.
- Added [index](INDEX.md) and detailed [local development](development/local-development.md), [testing](development/testing.md), [agent runtime](architecture/agent-runtime.md), [service contracts](architecture/service-contracts.md), [frontend/mini-apps](architecture/frontend-and-miniapps.md), and [target architecture](architecture/target-architecture.md) guides.
- Rewrote [system overview](architecture/system-overview.md) to show direct TypeScript service calls, in-memory state and custom HTTP/SSE protocol.
- Corrected public AG-UI/A2UI terminology in [protocol guide](architecture/protocol-ag-ui-a2-ui.md); distinguished advertised `GET /mcp` tool listings from verified protocol-compliant MCP servers.
- Revisited ADR-0001–0008 with implementation statuses, and added [ADR-0009](adr/ADR-0009-agent-first-with-bounded-authority.md) for proposed Option A.
- Reorganized [TODO](../TODO.md) into prioritized P0/P1/P2 work, preserving the old historical demo checklist under [history](history/demo-backlog-pre-production.md).
- Expanded [SECURITY](../SECURITY.md) into explicit threat boundaries and release gates; marked recordings and E2E transcripts **historical**.

Documentation work is **docs-only** and does not itself validate a successful build, Keycloak integration, agentgateway syntax, model interoperability or production behavior.

