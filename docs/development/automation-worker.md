# Automation worker

A local, off-by-default worker (`services/automation-worker`) that drives one leased job at a time through the authority path built under AUTO-03: prepare the execution, obtain its one credential from the broker, and present it to the dedicated execution route. It holds no authority of its own. Nothing enqueues jobs yet; schedules arrive with AUTO-06.

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

## Outbox

`job_outbox` has at most one row per job and kind (`PREPARED`, `SKIPPED`, `SETTLED`, `FAILED`, `HELD`, `REQUIRES_ACTION`), written in the same transaction as the state change. It is what AUTO-14 will turn into notifications.

## Evidence

`services/test/automation-worker.test.ts` covers identity, fencing, a two-connection race, restart at each persisted step, retry rules, final states and the absence of the credential from every database file. The real-stack scenario is in `scripts/e2e/automation-execution.ts`.
