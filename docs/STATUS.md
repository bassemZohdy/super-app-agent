# Current implementation and verification status

Reviewed **24 October 2026**, against application checkpoint **`4bde222`**. Documentation maintenance after this checkpoint does not add runtime capabilities. [Run the app](development/local-development.md) · [Full backlog](../TODO.md) · [Evidence register](reports/README.md).

## Delivered demo

| Area | Current implementation | Explicit limit |
| --- | --- | --- |
| Runtime | Concierge plus six application APIs and seven account-scoped provider simulators; real HTTP boundaries and SQLite persistence | Synthetic city records and funds; no real agency, UAE PASS, bank or PSP integration |
| Identity | Keycloak 26.6.4 pinned by digest; browser PKCE, signed ownership checks, introspection and separate RFC 7523 broker | Local HTTP/seeded credentials; no preview features, custom actor mapper, multi-hop authority or production approval |
| Conversation | Bounded LangGraph review/execute flow, Redis ownership/leases/checkpoints/replay, explicit approval and cancellation, authenticated MCP | Deterministic routing; no model-selected tool plan, autonomous scheduler or general workflow/compensation engine |
| Text/voice | Internal local Qwen/llama.cpp, KittenTTS and Whisper; React/Angular voice settings and reviewable English/Arabic dictation | English synthesis; physical/native/Arabic-speech evaluation open. OpenRouter helper is historical diagnostics only |
| Payments | Linked billers/synthetic saved cards; finite wallet/card reviews; bills, exact fines, prepaid/toll recharges, wallet funding, grouped checkout, original-source refunds, events, recovery and statements | Sequential cross-provider effects, truthful partial/UNKNOWN states; no real cards or automatic spending |
| Authority | Owner/workspace/source lifecycle fences, bounded explicit delegation, non-executable recurring mandate records | AUTO-03 permits/shared budgets/occurrences and the actual worker path remain unimplemented |
| Simulator | Persistent preview business clock, issuer scenarios and partial lifecycle fixtures | Preview clock does not execute payments; full network controls, failpoints and automated service simulation remain open |
| UI | React primary demo/manual routes/payment workspace; Angular and Flutter comparison shells | Full payment, accessibility, localization and device parity remain open |
| Operations | Fifteen Node processes with private telemetry/metrics, five correlation IDs, dependency readiness, bounded logs/backpressure and graceful shutdown; encrypted cold restore and fenced single-writer rehearsal | No production replicated HA, scheduled off-host backup service or immutable compliance audit archive |

## Backlog disposition

Counts come from task IDs in [TODO.md](../TODO.md); task groups overlap and have different acceptance scopes. These are inventory counts, not completion percentages.

| Group | Total | Checked | Open |
| --- | ---: | ---: | ---: |
| P0 platform/security | 14 | 3 | 11 |
| P1 platform/functionality | 16 | 4 | 12 |
| P2 engineering/experience/operations | 6 | 1 | 5 |
| OBO identity-delegation plan | 36 | 11 | 25 |
| PAY payment extension | 21 | 20 | 1 |
| AUTO consent/automatic services | 15 | 2 | 13 |
| SIM simulation | 6 | 2 | 4 |
| QA payment-extension acceptance | 8 | 0 | 8 |

The selected payment extension has **50 tasks: 24 checked, 26 open**. PAY-08 is partial pending actual automatic/manual caller qualification; SIM-01 is checked only for its preview foundation. SIM-02, AUTO-04, QA-01 and QA-02 have partial work but stay open. P2-02 is checked for the selected local demo boundary. No additional task is closed by this documentation cleanup.

AUTO-03 is a proposed implementation contract with an archived unfinished prototype, not active application code. Later platform work did not enable recurring payments. Do not resume that prototype or treat mandate approval as execution authority without its existing acceptance gates.

## Latest executed application checks

At `4bde222`, `npm run check` passed **533 offline Node tests**, **18 workspace builds**, ESLint, E2E TypeScript, Markdown links and source-secret checks. The actual Node 24.21.0 Compose image passed 17 targeted operations tests. The [operations report](reports/2026-10-24-operations.md) records signed partial-journey checks, 10-second load, 60-second soak, encrypted restore and copied Keycloak/Redis boot/login. Signed payment-obligation browser/HTTP recovery also passed. Earlier full browser, Flutter and local-AI checks retain their separately dated evidence; they are not relabeled as rerun by documentation maintenance.

Recorded read load: 273.7 requests/s, p95 28.2 ms, zero errors. Recorded paced soak: p95 12.9 ms, zero errors, 1.2 MiB RSS growth after warm-up. These exclude inference capacity. Isolated durable-state recovery took 554 ms; copied Keycloak/Redis checks took 24.1 seconds, excluding operator investigation and full application promotion.

The last operations inspection identified **six existing pending broker jobs** and `STUCK_DURABLE_WORK`; they were retained for original-operation reconciliation. Readiness passed. An alert is not permission to retry, discard history or synthesize a completed result. [Operator runbook](development/operations.md).

## Reading current and historical material

Use this page for the implemented boundary, [TODO.md](../TODO.md) for remaining acceptance criteria, [guides](INDEX.md) for commands and contracts, and the [handoff](development/handoff.md) for continuation. Dated reports/recordings state what was verified at their own checkpoints. Their old test counts, earlier hosted-model observations and then-open features are historical facts. ADR amendments and target documents state which decisions were superseded or remain proposed. GitHub Actions remain disabled until explicitly authorized.
