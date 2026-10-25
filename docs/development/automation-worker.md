# Automation worker

A local, off-by-default worker (`services/automation-worker`) that drives one leased job at a time through the authority path built under AUTO-03: prepare the execution, obtain its one credential from the broker, and present it to the dedicated execution route. It holds no authority of its own. Jobs are enqueued by the scheduler below, or by hand in tests.

## Enabling it

The worker refuses to start unless `AUTOMATION_WORKER_ENABLED=true`, never runs when `NODE_ENV=production`, and needs `AUTOMATION_RUN_ID` (an isolated payments run), the `automation-worker` client secret (`AUTOMATION_WORKER_CLIENT_SECRET` or `AUTOMATION_WORKER_CLIENT_SECRET_FILE`) and the provider and broker URLs. There is no Compose service. `npm run demo:verify:automation-execution` shows it against the real stack.

## Jobs

One job is one rule version, occurrence and target: the id is a hash of `(mandateId, policyVersion, occurrenceKey, target)`, so enqueueing again, or from another process, returns the same job, and a revised rule is a different job. The preparation request key is derived from the job id, so every retry is the same preparation.

States: `QUEUED → PREPARING → PREPARED → CREDENTIALING → EXECUTING`, then `SETTLED`, `SKIPPED`, `FAILED` or `HELD`. `HELD` means the outcome is unknown or needs a person (an unknown capture, a card challenge, a lost credential); the worker does not touch it again.

## Leases and fencing

`claim` hands out the oldest runnable job under a lease and raises the job's fence on every claim. Every renewal, attempt record and state change must present the fence while the lease is live, so a worker whose lease lapsed, or that lost a race, is rejected and simply stops. Two workers on one database file never run the same job. The step in flight when a lease is taken over is idempotent at the provider (the permit is consumed once and an admitted execution only resumes).

## Persisted before dispatched

The state and an append-only attempt row are written before the step they describe. Steps carry these rules:

- **Prepare** retries under the original request key and gives up after a bounded number of attempts, because nothing is known to have moved.
- **Credential** is requested once per job. A definitive refusal fails the job. A transient failure is retried only because a retry can only replay or be refused. An already-issued credential, or an outage that exhausts the retries, holds the job.
- **Execute** retries only the same credential while it is alive. A provider rejection before funds fails the job (the provider has released the reservation); a captured-but-unsettled order, a challenge or a lost response holds it.
- **Restart** while a credential was in flight or in use holds the job (`CREDENTIAL_LOST_AFTER_RESTART`). The credential is never written to the database, the outbox, the attempt log or the logs, so it cannot be recovered, and a fresh one is never requested.

## Scheduling

`Scheduler.tick(now)` (`scheduler.ts`) turns approved rules, the clock and the calendar calculator in `packages/protocol-core/src/mandate-schedule.ts` into jobs. It reads the rules from the worker-scoped view of the run (`GET /internal/automation-runs/{runId}/rules`, plus `/rules/{mandateId}/invoices` and `/balance`), which only the `automation-worker` identity may call and which reserves nothing.

- A rule schedules only while it is approved and inside its start and expiry window; time never revives consent.
- Calendar rules produce one occurrence per local month (`CAL:YYYY-MM`) with the rule's `LAST_DAY` or `SKIP` month-end behaviour in its own time zone. Invoice-due rules produce one occurrence per due date (`INV:YYYY-MM-DD`) three local days, or the rule's `daysBefore`, ahead at 09:00.
- `tick` is a function of the rules, the occurrence keys already recorded for the rule under any version, and `now`. Repeating it, running it from two processes or advancing time in small or large steps gives the same jobs, and a revised rule never repeats an occurrence an earlier version handled.
- After downtime only the latest missed occurrence stays pending; earlier ones are recorded as final `SKIPPED` jobs with reason `MISSED_CATCH_UP`, so nothing becomes a burst of charges and every skip is visible.
- A balance threshold (`LOW_BALANCE`) fires one job per dip. Firing, the sequence number (`THR:n`) and the job are one transaction, the trigger stays disarmed while the balance stays below the threshold, and it re-arms when the balance recovers. Requiring a qualifying external debit before re-arming belongs to AUTO-09.
- Event-driven triggers (new fine, parking ending) schedule nothing here.

The loop runs the scheduler only when `AUTOMATION_SCHEDULE_ENABLED=true` in addition to `AUTOMATION_WORKER_ENABLED`; both are off by default. The business clock stays separate from security time: the scheduler takes `now` as a parameter, so a simulator clock can drive it without touching token expiry.

## What the owner is told

- **Before a run:** when a rule's next run is inside the lead time (24 hours by default), the scheduler records one `UPCOMING_RUN` notice per rule and occurrence in `job_notices` (a reminder, not a job; it moves nothing and a paused or expired rule announces nothing).
- **Needs the owner:** a declined card, a card over its limit, short wallet funds and similar failures end the job as `FAILED` and record a `REQUIRES_ACTION` outbox event; a card challenge holds the job (`HELD`) and records the same event. The worker never tries another source, a lower amount or a different invoice for that occurrence, and the failed occurrence is not retried.
- **Everything else:** a skip, a settlement, a held unknown outcome or an ordinary failure records `SKIPPED`, `SETTLED`, `HELD` or `FAILED`.

An invoice is chosen at preparation: the earliest-due unpaid, unreserved invoice that is within the rule's per-payment cap. An invoice above the cap is skipped, never lowered, and does not hold up a smaller one behind it. Paid and withdrawn invoices are never offered. Wallet, card, DEWA, Etisalat and du invoices follow the same path.

## Outbox

`job_outbox` has at most one row per job and kind (`PREPARED`, `SKIPPED`, `SETTLED`, `FAILED`, `HELD`, `REQUIRES_ACTION`), written in the same transaction as the state change. It is what AUTO-14 will turn into notifications.

## Evidence

`services/test/automation-worker.test.ts` covers identity, fencing, a two-connection race, restart at each persisted step, retry rules, final states and the absence of the credential from every database file. The real-stack scenario is in `scripts/e2e/automation-execution.ts`.
