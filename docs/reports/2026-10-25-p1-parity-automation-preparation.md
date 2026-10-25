# P1 parity slices and the AUTO-03 preparation checkpoint — 25 October 2026

Executed 25 October 2026 on top of application checkpoint `cd3c7d5`. Delivered as `7eb6e3e` (multi-group surface dispatch), `79d767a` (P1 parity slices, AUTO-03 checkpoint 1), `46ee6c8` (P2-05 request-body validation) and `87730b1` (P1-14 telecom route contracts). No real payment, identity or government system was contacted; all entities and funds are simulated.

## Commands and results

- `node --experimental-strip-types --test services/test/automation-runs.test.ts` — **7/7 pass** (AUTO-03 checkpoint 1).
- `node --experimental-strip-types --test services/test/p1-parity.test.ts` — **3/3 pass** (P1-12/P1-13/P1-14 slices).
- `node --experimental-strip-types --test services/test/surface-action-scoping.test.ts services/test/surface-client.test.ts services/test/approval-bindings.test.ts` — all non-network cases pass; the five HTTP-dependent cases fail in this sandbox identically to checkpoint `cd3c7d5`.
- Full offline suite: **576 tests, 530 pass, 46 fail**. The 46 failures are byte-identical (by test name) to a stashed-checkpoint `cd3c7d5` run in the same environment; they are Windows sandbox limits (symlink `EPERM`, SIGTERM handling, localhost sockets and database-reopen locking), not regressions.
- `npm run lint` — pass. `npm run check:docs` — pass (101 documents). The full `npm run check` gate including workspace builds was not executed in this environment; `cd3c7d5` remains the latest executed full qualification (533 tests, 18 builds).

## Delivered boundaries

- **P1-12:** surfaces with several choice groups dispatch a `selectedChoices` map; single-group surfaces keep `selectedChoice`. Approval validates the exact per-group map. Dispatches advertised only by disabled buttons are rejected explicitly with `ACTION_DISABLED`.
- **P1-13:** parking/ride/food dispatches no longer fall back to hardcoded demo resources; a missing selection fails closed with a visible 409. Controlled `HttpError` rejections keep their status and message at the gateway boundary.
- **P1-14:** choice-group validation enforces non-empty bounded option ids/titles and a coherent `selectedId`; the fuzz suite covers the new rules. The telecom `subscriptions`, `plans` and `bills` reads and the path-parameterized bill payment are registered in the request-validation registry and enforced by the shared gate; the registry template matcher now supports mid-path parameters uniformly (previously only trailing parameters matched, so such routes silently skipped validation), and POST routes with path parameters validate the body alongside captured parameters.
- **P2-05:** every application-server request body must be a plain JSON object in integrated and legacy modes, rejected with the established `VALIDATION_ERROR` contract; the telecom service and `/accounts` run the same per-route validation gate as every other service.
- **SIM-04/SIM-06 (completed):** the wallet funding path loses its response after the real atomic commit and the retry replays with one credit; the run-wide read-only inspection (balances, holds, non-terminal orders with mismatch reasons, settlement claims, pending events) is exposed through the operator-guarded internal controls.
- **AUTO-04 (manage actions):** pause/resume/skip-next/revoke mandate routes and the React management panel, with versioned one-shot skip consumption by the execution authority.
- **SIM-05 (failpoint controls):** guarded, run-scoped arming/clear/inspection of the named checkout failpoints by the isolated run's exact operator, with immutable audit, idempotent request keys and denial of ordinary users; an armed boundary loses the checkout response once and recovery keeps one debit.
- **AUTO-03 checkpoint 1:** run-scoped preparation and owned inspection in a pristine, persisted isolated run (`services/provider-simulator/src/automation-runs.ts`). Exact worker/operator identities; server-owned due-invoice resolution for DEWA/Etisalat/du bill mandates with fail-closed unsupported operations; one transaction reserving shared period/lifetime amount and count, cooldown, occurrence and payable exclusion shared with the manual admission path; immutable preparation records with a bound digest and bounded admission window; recorded skip reasons without capacity consumption; identity cannot be rebound, normal/copied data cannot be armed, reopen requires the original context. No credential is issued, no order is created, no funds move; mandates keep `executionEnabled:false`.

## Not delivered here

AUTO-03 checkpoints 2–4 (exact-image credential issuance, provider admission and effects, the concurrent/outage/restart qualification matrix), the Compose wiring of the isolated provider lookup, full `npm run check` in a non-sandboxed environment, and the remaining P1-12/P1-13/P1-14 acceptance items recorded in [TODO](../../TODO.md).
