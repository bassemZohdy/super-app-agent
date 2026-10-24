# Payment/automation planning and cleanup — 24 October 2026

Historical initial-pass status: **planning completed; payment/automation implementation not started at that point**. See the backlog review below for the subsequent implementation status. Baseline source: `283521a`. User request: clean up documentation/files first, then plan proper demo simulation for payment accounts, bills/top-ups/fines, wallet/cards, autopay and automatic services.

## Cleanup completed before adding the plan

- Reconciled the documentation index and TODO implementation baseline, distinguished delivered provider/delegation/local-AI results, and added [an evidence register](README.md). Current counts are 130 tests/18 builds from the delivered baseline; earlier dated counts remain unchanged in their original reports.
- Corrected the recording guide's historical/current result distinction and index wording that conflated an earlier fixture transcript with the asserted browser recording.
- Removed `docs/recordings/delegation/latest.webm`, a **7,338,964-byte, SHA-256-identical** duplicate of the retained successful dated run. The viewer points directly to that canonical file, and the recorder publishes future viewers with a dated source path instead of copying another WebM. Prior successful runs, screenshots, manifests and historical records remain retained.
- Reviewed current setup, security, architecture/provider/service-contract/renderer/testing guides and linked their planned payment scope explicitly, with live contracts separated from proposed resources. Existing runtime state and compatibility fixtures remain outside this cleanup.

## Planning delivered

[The design](../architecture/payment-automation-demo.md) records current code limitations and the proposed domain/state/ownership model. [TODO](../../TODO.md#payment-accounts-and-automation-demo--planned-backlog) contains **50 unique unchecked implementation tasks**, with component reuse/creation, responsible discipline, acceptance criteria, dependencies and risk-first sequencing:

| Group | Count | Scope |
| --- | --- | --- |
| PAY-01–PAY-21 | 21 | Linked biller accounts, saved synthetic cards, quotes, journal/holds/orders, settlement claims, wallet/card payments, recharges, fines, refunds and reconciliation |
| AUTO-01–AUTO-15 | 15 | Explicit finite mandates, exact short-lived grants, persistent worker, schedules/dry-run, autopay/reloads, fines, parking/renewals, notifications and revoke controls |
| SIM-01–SIM-06 | 6 | Isolated business clock, provider lifecycles, issuer presets, boundary/delivery faults, authenticated controls and run inspection |
| QA-01–QA-08 | 8 | Security, money invariants, races/restart, positive/failure E2E, shell parity, readable recording and documentation/startup gates |

The source review identified a needed settlement-claim/refund serialization boundary: a previously retrieved GET payment proof can become stale across service calls. PAY-10 plans claim/ack/release state and conservative unknown-outcome handling; it is not a claim that this race is fixed in the running demo.

Automation defaults to off and requires separate consent. Existing small delegated credits do not authorize recurring bills. New tasks retain no-preview Keycloak, local open-source inference, explicit confirmation for unsupported services, synthetic-only cards/funds and current ownership boundaries. Business-time simulation cannot alter JWT security time. The plan does not close production/native or prior platform criteria.

## Validation of this pass

- Backlog audit: 50 unique unchecked task IDs; every task names reused/modified/created components, acceptance and valid dependencies; dependency graph is acyclic.
- Existing recorder syntax, ESLint, strict E2E harness type-checking, local Markdown links and source secret-pattern checks pass.
- Four existing recording contract/range/containment/publication tests pass.
- Actual browser playback of canonical delegation media: duration **63.56 seconds**, readyState 4, no media error; seeking to 46 seconds succeeds.
- Removed duplicate compared byte-for-byte by SHA-256 with retained canonical media.

No new financial runtime behavior, endpoint, mandate, worker or simulator control was enabled. The full application/inference/payment integration suites were not rerun for a planning/recording-reference change; their latest delivered results remain linked in the evidence register.

## Backlog and cleanup review — 24 October 2026

The current planning pass preserves existing payment/simulator implementation changes and dated evidence. TODO now tracks **50 tasks: 5 delivered foundations and 45 open** (PAY: 4/21, AUTO: 0/15, SIM: 1/6, QA: 0/8). The current lifecycle/preview evidence is a working-tree addition after journal `58dc0dd`; it must not be mistaken for the initial planning result above.

- Corrected stale all-unchecked counts, baseline/evidence descriptions, inventory-test counts and the distinction between the implemented preview clock and future execution controls.
- Added delivery checkpoints and a scenario-to-task map in TODO for owned accounts/cards, bills, wallet/mobile/toll top-ups, fines, grouped checkout/refunds, bounded autopay, parking/renewals and recovery.
- Audited tracked files for temporary files, logs, backups and byte-identical documentation/artifacts. No tracked temporary files/logs/backups were found. Consolidated the duplicate revoked-consent screenshot into its canonical dated recording artifact and updated the report link; dated evidence remains available.
- Preserved private environment files, runtime databases, model downloads, installed dependencies and existing implementation changes. No application behavior or automation activation was changed by this planning review.

Validation for this review:

- Local Markdown links pass across all 55 documents; source/docs secret-pattern checks pass.
- Backlog audit passes: 50 unique IDs, 5 delivered/45 open, component dispositions and acceptance criteria on every task, valid references and no dependency cycles.
- Tracked temporary/log/backup and byte-identical documentation/artifact audits pass after consolidation. `git diff --check` passes.
- Application and financial integration suites were not rerun for this documentation/file-maintenance pass. Historical feature test counts above remain observations of their original source.
