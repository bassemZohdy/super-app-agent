# Isolated preview scenario clock

SIM-01 supplies an operator CLI and reusable persisted business clock for the demo simulator. This first slice is **preview-only**: it emits descriptive due events and never calls providers, charges funds, issues credentials or activates a rule. Provider event/usage generation, failure controls, an authenticated admin panel and execution scenarios remain SIM-02–SIM-06/AUTO work.

## Run

Node 24+ is sufficient; Docker, a cloud key and a microphone are unnecessary.

```bash
npm run simulator:verify
npm run simulator -- create --seed morning
```

Create returns a `simrun_…` ID, revision, generation, business timestamps, fixtures and events. For the following commands replace `RUN_ID` and `REVISION` with the current output values:

```bash
npm run simulator -- status RUN_ID
npm run simulator -- advance RUN_ID --revision REVISION --seconds 180
npm run simulator -- reset RUN_ID --revision REVISION
```

Use `--key UNIQUE_REQUEST_KEY` for an explicit retry identity; otherwise the CLI generates one. Create accepts an optional `--at` ISO timestamp; default start is `2026-10-24T00:00:00.000Z`. Reusing the same create key/seed/start returns the same run with current state. Advance/reset retries with the same key and canonical operation return the recorded result (`replayed: true`) without changing state or emitting again. Reusing a key for another payload conflicts. A replayed mutation response is its original snapshot; use status for the current run state.

The seeded basic preview has a DEWA bill due after one minute, low-toll notice after two, parking expiry notice after three and telecom renewal notice after one business day. The bill variation/reference is derived from the seed; fixture IDs/data repeat for the same seed/start. Event IDs additionally bind the run and generation, with deterministic due-time ordering and one emission per fixture/generation. These are preview fixtures, not live provider obligations.

## Persistence, isolation and limits

Data lives only in `.data/simulator/preview.sqlite`, relative to this checkout, with independent run/fixture/event/request tables. The CLI has no database-path, provider-URL or arbitrary-operation option. It binds runs to the local OS operator; this is local filesystem/operator access, **not Keycloak admin authentication**. No HTTP simulator control endpoint exists. SIM-05 must supply verified admin identity before any network control is introduced.

Each run advances by at most 31 days per command, spans at most 366 days, and supports fewer than 1000 revisions; at most 32 runs per owner. Seed/start, request keys and revision inputs are bounded. Backward/invalid changes fail without mutation. Creation and clock/event updates use SQLite transactions; stale concurrent revisions conflict. Reset clears only that run's preview fixture/event state, restores the original seed/time, increments generation and preserves retry records. It does not delete a database or edit provider resources, idempotency records, balances or another run.

`SimulationRuns.clock(owner, runId)` returns an instance-scoped function for trusted business-time consumers. It never patches Date/global process time. JWT, key-cache, credential and authentication checks keep their real security clock. Runtime financial injection must later be bound to a verified isolated scenario; a caller-supplied clock/run ID must not alter normal account execution or grant authority. Current normal provider/card/ledger clocks are unchanged by preview commands.

## Evidence

Seven unit/integration tests cover persistence/reopen, deterministic fixtures, ordered/idempotent events, owner/revision/bounds, scoped reset, two connections, provider-data containment even when sharing a test database, and real-time JWT behavior after a 31-day business jump. `simulator:verify` executes separate CLI processes and checks create/advance/status/replay/reset, invalid backward advance and exact fixture restoration. [Current evidence](../reports/2026-10-24-lifecycle-simulator.md) · [Full backlog](../../TODO.md#payment-accounts-and-automation-demo--planned-backlog).
