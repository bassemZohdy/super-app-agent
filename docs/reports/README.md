# Execution evidence register

This register records what was verified, when, against which revision and with which limits. It does not track tasks (open work is only in [TODO.md](../../TODO.md)) and does not describe the system (see the [README](../../README.md#what-exists-today)). The latest focused application evidence is [React fines and workspace panes](2026-10-26-react-fines.md), implementation **`9041913`**, including repository offline checks/builds and the self-contained desktop/phone browser journeys. It does not extend the full compatibility operating qualification at **`cd3c7d5`**, 24 October 2026, whose real Compose/identity/operations boundary is recorded below. Earlier [P1 parity and AUTO-03 preparation evidence](2026-10-25-p1-parity-automation-preparation.md) remains a dated focused checkpoint.

## Focused agent milestone

[One-process LangGraph/SQLite agent](2026-10-26-simple-agent.md) records the fines slice, native checkpoint/restart and duplicate-effect verification. It is separate from the legacy Compose operating qualification below.

[React fines and workspace panes](2026-10-26-react-fines.md) records browser adoption, exact review/restart/recovery, shared pane controls, repository gates and the unsuccessful real OpenRouter smoke attempt. Live model qualification is not inferred from deterministic browser success.

## Latest operating qualification

| Evidence | Verified scope | Limit |
| --- | --- | --- |
| [P2-02 operations and recovery](2026-10-24-operations.md) | Private correlation/metrics, signed partial journey, 10-second read load, 60-second soak, shutdown, encrypted financial/Redis/issuer restore and copied Keycloak/Redis boot/login; 533 tests/18 builds | Local single-writer demo; six pre-existing pending broker jobs retained for reconciliation. No production HA or inference-capacity claim |

### Recorded operating measurements (at `cd3c7d5`)

The actual Node 24.21.0 Compose image passed 17 targeted operations tests. Read load of 10 seconds: 273.7 requests/s, p95 28.2 ms, zero errors. Paced 60-second soak: p95 12.9 ms, zero errors, 1.2 MiB RSS growth after warm-up. These exclude inference capacity. Isolated durable-state recovery took 554 ms; copied Keycloak/Redis boot and login took 24.1 seconds, excluding operator investigation and full application promotion. Signed payment-obligation browser and HTTP recovery also passed.

The last operations inspection identified **six existing pending broker jobs** and `STUCK_DURABLE_WORK`; they were retained for original-operation reconciliation, and readiness passed. An alert is not permission to retry, discard history or synthesize a completed result. See the [operator runbook](../development/operations.md).

Dated reports and recordings state what was true at their own checkpoint. Their test counts, earlier hosted-model observations and then-open features are historical facts. ADR amendments and target documents state which decisions were superseded or remain proposed. GitHub Actions remain disabled until explicitly authorized.

## Earlier feature checkpoints — historical

Each row below states what its dated report verified and what remained open **then**. Counts and earlier missing features are not current release totals; use the README and TODO.md for the current state. Foundational snapshots include `283521a`, `65fec3c` and `58dc0dd`. Production certification is not implied.

| Evidence | Verified scope | Interpretation at that checkpoint |
| --- | --- | --- |
| [Production dependency triage](2026-10-24-dependency-triage.md) | `npm audit --omit=dev`: five advisories; ajv then upgraded to 8.20.0, leaving four | Evidence-based dispositions. Angular major upgrade needs a decision; zod via LangChain has no same-major fix and needs a reviewed LangChain change |
| [Gateway business reservations and original attempts](2026-10-24-payment-obligations.md) | 397 tests, 18 builds; signed invoice/manual-fine/recharge races, original UNKNOWN/restart/recovery, legacy overlap migration and paced UI | PAY-08 advanced but remains open for actual automatic-caller qualification; no new scheduled authority |
| [Current owner/workspace lifecycle](2026-10-24-payment-lifecycle.md) | 386 tests, 18 builds; signed permission/source/grant/session fences, actual Keycloak disablement, paced UI, twelve retained journeys and normal restart preservation | PAY-21 delivered; shared automatic reservations/permits, worker/simulator and parity/QA gates remain open |
| [Automation authority review](2026-10-24-automation-security.md) | 371 tests, 18 builds; isolated exact-image signed authority/read/write compatibility and byte-preserved normal broker restart | AUTO-02 contract/hardening delivered; scheduled spending disabled until permit/budget/entitlement gates pass |
| [Statements and receipt history](2026-10-24-payment-history.md) | 358 tests, 18 builds; real signed 116-entry/117-operation pagination, unknown/decline/challenge, removed-source detail and partial funding return | PAY-20 delivered; source/owner lifecycle, automatic admission and simulator/QA gates remain open |
| [Owned payment reconciliation](2026-10-24-payment-reconciliation.md) | 345 tests, 18 builds; signed before/after-commit loss, gateway restart, reversal loss, blocked source and saved outcome browser | PAY-19 delivered; statements, automatic admission and general simulator/QA gates remain open |
| [Retained signed event qualification](2026-10-24-legacy-payment-events.md) | 330 tests, 18 builds; legacy parking/restart/inspection and mixed stored financial callback HTTP | PAY-18 delivered for current manual paths; recovery workbench, operator fault controls and automation/QA gates remain open |
| [Conversational funding reviews](2026-10-24-payment-surfaces.md) | 317 tests, 18 builds, signed explicit review/challenge/restart/recovery and updated twelve journeys | PAY-07 delivered; automation admission and remaining manual recovery/simulator/QA gates remain open |
| [Finite mandate consent](2026-10-24-payment-mandates.md) | 306 tests, 18 builds, six signed policy families and actual provider restart | AUTO-01 delivered; no automatic execution, editor, budget reservation or scheduler |
| [Isolated issuer scenarios](2026-10-24-issuer-scenarios.md) | 292 tests, 18 builds, eight operator-configured signed browser outcomes and pending restart | SIM-03 delivered; general controls/failpoints and remaining PAY-18 paths stay open |
| [Signed financial status events](2026-10-24-payment-events.md) | 278 tests, 18 builds, actual callback/lost-response recovery and terminal-reversal browser | Initial PAY-18 infrastructure evidence; the later retained-path report completes current manual-path coverage |
| [Original-source refunds](2026-10-24-payment-refunds.md) | 264 tests, 18 builds; source/issuer/journal reversal and paced UI scenarios | PAY-17 delivered; events, consolidated recovery, statements and automatic services retain their gates |
| [Grouped checkout](2026-10-24-checkout-groups.md) | 245 tests, 18 builds, three paced real-Keycloak group scenarios | PAY-16 evidence; the later refund report adds PAY-17, while events, automation and shell parity retain their separate gates |
| [Wallet/card provider recharges](2026-10-24-provider-recharges.md) | 231 tests, 18 builds and six real-Keycloak paced recharge journeys | PAY-15 evidence; the later grouped-checkout report adds PAY-16, while refunds and automation remain open |
| [Exact-set fine payments](2026-10-24-fine-checkout.md) | 214 tests, 18 builds; exact-set capture, lifecycle and recovery coverage | PAY-06/PAY-14 delivered; remaining payment/automation gates retain separate criteria |
| [Saved-card wallet funding](2026-10-24-wallet-funding.md) | Focused funding/HTTP tests and real-Keycloak paced capture/credit/reload browser | PAY-13 delivered; refunds and automation remain open |
| [Wallet/card bill checkout](2026-10-24-payment-checkout.md) | 188 tests, 18 builds, twelve journeys, challenged-card receipt and wallet execution browsers | PAY-09–PAY-12 delivered; other payables/refunds/automation remain open |
| [Settlement/refund exclusion](2026-10-24-settlement-claims.md) | 180 tests, 18 builds; source/gateway race tests and real-Keycloak paid/refund/non-application checks | Historical claim/refund guard evidence; later bill-checkout report covers order-capture integration |
| [Stored authorization and issuer](2026-10-24-payment-authorization.md) | 171 tests, 18 builds, twelve journeys, setup/lifecycle browser and real-Keycloak challenge/holds/limits/expiry checks | PAY-05 delivered; capture/settlement, cross-path reservation and automation remain open |
| [Provider-owned payable revisions](2026-10-24-payables.md) | 162 tests, 18 builds; source revision/lifecycle and isolated signed-owner settlement checks | PAY-06 progress; stored-order capture admission and claim/refund gates remain open |
| [Lifecycle and preview simulation](2026-10-24-lifecycle-simulator.md) | 155 tests, 18 builds, twelve journeys, lifecycle/prepaid browser, and cross-process preview CLI | PAY-03/PAY-04 guard contracts and initial SIM-01; issuer/automation producers remain open |
| [Payment journal](2026-10-24-payment-ledger.md) | 143 tests, 18 builds, twelve existing journeys, setup browser and actual three-wallet migration/backup proof | PAY-02 delivered; executable saved-card orders and automation remain open |
| [Payment accounts](2026-10-24-payment-accounts.md) | 136 tests, 18 builds and real-Keycloak isolated setup/quote/browser checks | PAY-01 delivered; no new financial execution or automation |
| [Local AI](2026-10-24-local-ai.md) | 130 Node tests, 18 builds, 12 browser journeys, four speech API tests, actual CPU text/speech/dictation, synthetic browser capture/playback, Flutter analysis/six tests, delegation security | Text/speech baseline; physical/native/Arabic speech limits remain |
| [Delegation](2026-10-24-delegation-demo.md) | Exact-image RFC 7523, separate broker, current grants, bounded writes/revocation, paced browser evidence | Supported no-preview demo; later AUTO-01 supplies consent records; automatic execution remains disabled |
| [Demo completion](2026-10-24-demo-completion.md) | Provider/Redis/manual/MCP/restart/security and then-current 114 tests/17 builds | Earlier stage; hosted-model observations are historical |
| [Provider browser recording](../recordings/runs/20261024T010609Z-video/report.md) | Twelve isolated journeys, 34 checks, measured pacing and then-current 120 tests/17 builds | Canonical dated recording, independent of later model changes |
| [Older reports](../INDEX.md#evidence-and-provenance) | 23 October checks and original fixture scenarios | Preserve original observations; not current feature claims |

## Setup and planning records

[Local development](../development/local-development.md) · [Local AI](../development/local-ai.md) · [Delegation](../development/delegation.md) · [Operations](../development/operations.md) · [what exists today](../../README.md#what-exists-today).

[Payment/automation planning and cleanup](2026-10-24-payment-planning.md) preserves the original 50-task plan and its earlier 5-checked/45-open review. The delivered ledger moved to the changelog; 24 items remain open, finite consent records are delivered and recurring execution remains disabled. [TODO](../../TODO.md) retains the remaining acceptance criteria; the superseded checkpoint handoffs were removed with their delivered record kept in the [changelog](../CHANGELOG.md).
