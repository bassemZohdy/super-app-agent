# Isolated preview scenario clock

SIM-01 supplies an operator CLI and reusable persisted business clock for the demo simulator. This first slice is **preview-only**: it emits descriptive due events and never calls providers, charges funds, issues credentials or activates a rule. SIM-02 has partial lifecycle/event fixtures, and the separate [SIM-03 issuer scenarios](issuer-scenarios.md) are delivered. Complete event/usage generation, general failure controls, authenticated admin UI and automatic execution retain their own SIM/AUTO gates.

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

## Lifecycle events from the source providers

`engine.lifecycle` (`services/provider-simulator/src/lifecycle-events.ts`) is the trusted seam through which a source provider's own world changes. It is not an HTTP route and no citizen request can reach it.

| Event | Effect at the source |
| --- | --- |
| `INVOICE_ISSUED` | One new invoice for an owned DEWA account or Etisalat/du subscription |
| `INVOICE_CYCLE` | Up to twelve monthly invoices (deterministic ids, due day 1–28, shorter months clamp); a period that already exists in any state is skipped, never recreated |
| `FINE_DISCOUNT_CHANGED` | A police fine's discount changes against its current revision; the payable amount and revision follow |
| `USAGE_RECORDED` | Toll or prepaid usage lowers the balance (never below zero) and bumps the target version, which makes any open recharge quote unpayable |
| `PARKING_DEPARTED` | The parking session ends; its paid-until time stops at departure and it can no longer be extended |

Every event has a stable id and lands in an immutable `provider_lifecycle_events` table. Redelivery returns the first outcome without a second bill, balance change or state change; reusing an id with different content is `EVENT_CONFLICT`. A malformed event throws and leaves no record. An event the current state no longer allows (a paid or withdrawn invoice, a moved revision, an ended session, a target the account does not own) is stored as `REJECTED` under its id, so redelivering it later cannot succeed against changed state. Subscription renewals are monthly `INVOICE_CYCLE` events on the subscription id. Payment-side duplicate and stale-event guards are covered by `services/test/sim02-lifecycle.test.ts`.

## Evidence

Seven unit/integration tests cover persistence/reopen, deterministic fixtures, ordered/idempotent events, owner/revision/bounds, scoped reset, two connections, provider-data containment even when sharing a test database, and real-time JWT behavior after a 31-day business jump. `simulator:verify` executes separate CLI processes and checks create/advance/status/replay/reset, invalid backward advance and exact fixture restoration. [Current evidence](../reports/2026-10-24-lifecycle-simulator.md) · [Full backlog](../../TODO.md).

## Authenticated issuer outcomes

[SIM-03 issuer scenarios](issuer-scenarios.md) reuse isolated run identity for a separate finite financial matrix. `npm run simulator:issuer` authenticates a startup-bound operator and customer, exercises all eight outcomes and restarts the pending provider before resolution. It does not advance this preview clock or enable controls on normal provider data. `npm run simulator:console` adds the operator page for an isolated run (see [the scenario console](issuer-scenarios.md#scenario-console)); broad failpoints retain the SIM-04 gate.
