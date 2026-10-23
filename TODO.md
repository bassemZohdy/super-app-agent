# Super App Agent — current backlog

**As of 23 October 2026.** This is the **current implementation plan**, not a count of features already in production. Completed historical demo tasks and their original 100% checkmarks are preserved in [the archived demo backlog](docs/history/demo-backlog-pre-production.md).

## Status legend

- **Implemented (demo):** source exists and uses simulated data/contracts; not production validated.
- **Configured:** settings/manifests exist, but integration/runtime compatibility is unverified.
- **Proposed:** architecture/design only.
- **Verified:** requires recorded passing builds/tests against the claimed target environment. **Do not equate source inspection with verified execution.**

## Baseline

| Area | Status | Evidence / caveat |
| --- | --- | --- |
| Five domain simulator modules | Implemented (demo) | In-process calls; global fixture data, no verified agencies |
| React shell + mini-app examples | Implemented (demo) | Direct source imports; no remote signed MFE loader |
| Angular and Flutter sample shells | Implemented (demo) | Build/behavior parity not evidenced in current review |
| Custom UI/event protocol | Implemented (demo) | Not official AG-UI or A2UI |
| JWT validation and session/action guard | Implemented (demo baseline) | RS256/JWKS, process-local, no production browser login |
| Gateway configuration | Configured | Actual supported YAML/schema and traffic path not demonstrated |
| Optional OpenRouter preview | Implemented (demo) | Free by default; model output does not route journeys |
| Genuine LangGraph orchestration | Proposed | No framework SDK or persistent graph/checkpointer in source |
| Real domain authorization/delegation | Not implemented | Required for real citizen/payment data |
| Persistent transaction/workflow engine | Not implemented | Required for recovery, scheduled/proactive jobs |

## Prioritized implementation work

### P0 — Fix before any real user, money, identity or government data

- [ ] **P0-01** Implement production React/Flutter (and Angular if retained) OIDC Authorization Code + PKCE flows; token lifecycle, logout/revocation; remove demo markers from production release.
- [ ] **P0-02** Authenticated, resumable, user-scoped SSE with real bearer handling, origin policy, stream backpressure, event IDs and replay.
- [ ] **P0-03** Enforce subject/resource/tenant authorization in each domain service, including propagation of actor/delegator identity and consent scopes.
- [ ] **P0-04** Introduce resource-and-quote-bound HITL user authorization for mutations; bind approval to amount, recipient, time window, resource and immutable server quote.
- [ ] **P0-05** Durable session/workflow persistence, TTL, key rotation/revocation strategy, rehydration and multi-instance session ownership.
- [ ] **P0-06** Domain-owned durable idempotency, outbox/transactional guarantees, partial-failure compensation and reconciliation for composite payments.
- [ ] **P0-07** Remove seeded credentials/unrestricted origins from production identity/gateway configs; pin supported images, harden secrets and deployment permissions.
- [ ] **P0-08** Run and record baseline `npm test` / `npm run build` / React UI smoke + isolated real Keycloak integration; fix failures. No passed result was produced by this docs-only change.

### P1 — Make the agent-centric concept real

- [ ] **P1-01** Define capability IDs, input/output schemas, risk metadata, owner, version and consent requirements in the catalog.
- [ ] **P1-02** Decouple graph from direct business imports with authenticated, typed adapter interfaces.
- [ ] **P1-03** Integrate genuine LangGraph or selected runtime (real graph nodes, tool schemas, checkpoints, interrupts); ensure model output can influence *permitted* plans.
- [ ] **P1-04** Add deterministic durable workflow executor for cross-domain sequences, scheduled tasks, retries, cancellation and proactive jobs.
- [ ] **P1-05** Evaluate model routing and agent planning against fixed task sets; budgets/latency/safety checks with free-first tests and opt-in paid models.
- [ ] **P1-06** Implement standard AG-UI event adapter and official A2UI renderer for web (generic Lit WC) + Flutter; version and conformance tests.
- [ ] **P1-07** Implement real MCP tool transport/invocation and A2A only where remote agents are needed.
- [ ] **P1-08** Validate actual agentgateway.dev deployment: supported config, LLM/MCP/A2A traffic, governance/limits, observability and security.
- [ ] **P1-09** Define secure signed manifest/mini-app runtime and independent deployment strategy; preserve no-agent manual journey access.
- [ ] **P1-10** Build user-bound consent lifecycle (grant/view/update/revoke), dynamic authorization and delegated-agent chain checks.

### P2 — Production engineering and experience quality

- [ ] **P2-01** Accessibility, Arabic/RTL, performance, offline behavior, Flutter-native behavior and renderer parity.
- [ ] **P2-02** Distributed tracing, SLOs, load tests, chaos/failure injection, HA/DR and capacity planning.
- [ ] **P2-03** Vulnerability/dependency/image scans, SBOM, trusted build/release pipeline, signed artifacts and audit retention.
- [ ] **P2-04** Public reference OpenAPI/MCP/A2A contracts, examples, developer onboarding and interop verification.

## Documentation maintenance

- [x] Consolidate README, docs index, as-built architecture, API inventory, runtime, frontend and target architecture.
- [x] Correct official AG-UI vs A2UI naming and call existing implementation *custom*.
- [x] Revisit ADR-0001 through ADR-0008 and add agent-first ADR-0009 as **Proposed**.
- [x] Document authentication, free-model test policy and production blockers.
- [x] Preserve historical demo task checklist and label recordings historical.
- [ ] Attach actual command/CI outputs, dependency verification and reproducible runtime validation to the next release gate.

## Completion policy

A task cannot be marked verified solely by documentation, a test declaration, an accepted ADR, a passing mock test, or a gateway YAML file. Provide CI execution link or a dated manual test report showing target environment, results and known exceptions.

References: [Documentation index](docs/INDEX.md), [SECURITY.md](SECURITY.md), [target architecture](docs/architecture/target-architecture.md).
