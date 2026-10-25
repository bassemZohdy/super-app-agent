# P1 parity slices and the AUTO-03 preparation checkpoint — 25 October 2026

Executed 25 October 2026 on top of application checkpoint `cd3c7d5`. Delivered as `7eb6e3e` (multi-group surface dispatch) and `79d767a` (P1 parity slices, AUTO-03 checkpoint 1). No real payment, identity or government system was contacted; all entities and funds are simulated.

## Commands and results

- `node --experimental-strip-types --test services/test/automation-runs.test.ts` — **7/7 pass** (AUTO-03 checkpoint 1).
- `node --experimental-strip-types --test services/test/p1-parity.test.ts` — **3/3 pass** (P1-12/P1-13/P1-14 slices).
- `node --experimental-strip-types --test services/test/surface-action-scoping.test.ts services/test/surface-client.test.ts services/test/approval-bindings.test.ts` — all non-network cases pass; the five HTTP-dependent cases fail in this sandbox identically to checkpoint `cd3c7d5`.
- Full offline suite: **562 tests, 516 pass, 46 fail**. The 46 failures are byte-identical (by test name) to a stashed-checkpoint `cd3c7d5` run in the same environment; they are Windows sandbox limits (symlink `EPERM`, SIGTERM handling, localhost sockets and database-reopen locking), not regressions.
- `npm run lint` — pass. `npm run check:docs` — pass (101 documents). The full `npm run check` gate including workspace builds was not executed in this environment; `cd3c7d5` remains the latest executed full qualification (533 tests, 18 builds).

## Delivered boundaries

- **P1-12:** surfaces with several choice groups dispatch a `selectedChoices` map; single-group surfaces keep `selectedChoice`. Approval validates the exact per-group map. Dispatches advertised only by disabled buttons are rejected explicitly with `ACTION_DISABLED`.
- **P1-13:** parking/ride/food dispatches no longer fall back to hardcoded demo resources; a missing selection fails closed with a visible 409. Controlled `HttpError` rejections keep their status and message at the gateway boundary.
- **P1-14:** choice-group validation enforces non-empty bounded option ids/titles and a coherent `selectedId`; the fuzz suite covers the new rules.
- **AUTO-03 checkpoint 1:** run-scoped preparation and owned inspection in a pristine, persisted isolated run (`services/provider-simulator/src/automation-runs.ts`). Exact worker/operator identities; server-owned due-invoice resolution for DEWA/Etisalat/du bill mandates with fail-closed unsupported operations; one transaction reserving shared period/lifetime amount and count, cooldown, occurrence and payable exclusion shared with the manual admission path; immutable preparation records with a bound digest and bounded admission window; recorded skip reasons without capacity consumption; identity cannot be rebound, normal/copied data cannot be armed, reopen requires the original context. No credential is issued, no order is created, no funds move; mandates keep `executionEnabled:false`.

## Not delivered here

AUTO-03 checkpoints 2–4 (exact-image credential issuance, provider admission and effects, the concurrent/outage/restart qualification matrix), the Compose wiring of the isolated provider lookup, full `npm run check` in a non-sandboxed environment, and the remaining P1-12/P1-13/P1-14 acceptance items recorded in [TODO](../../TODO.md).
