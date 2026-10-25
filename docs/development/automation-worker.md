# Automation worker

A local, off-by-default worker (`services/automation-worker`) that drives one leased job at a time through the authority path built under AUTO-03: prepare the execution, obtain its one credential from the broker, and present it to the dedicated execution route. It holds no authority of its own. Jobs are enqueued by the scheduler below, or by hand in tests.

## Enabling it

The worker refuses to start unless `AUTOMATION_WORKER_ENABLED=true`, never runs when `NODE_ENV=production`, and needs `AUTOMATION_RUN_ID` (an isolated payments run), the `automation-worker` client secret (`AUTOMATION_WORKER_CLIENT_SECRET` or `AUTOMATION_WORKER_CLIENT_SECRET_FILE`) and the provider and broker URLs. There is no Compose service. `npm run demo:verify:automation-execution` shows it against the real stack.

## Jobs

One job is one rule version, occurrence and target: the id is a hash of `(mandateId, policyVersion, occurrenceKey, target)`, so enqueueing again, or from another process, returns the same job, and a revised rule is a different job. The preparation request key is derived from the job id, so every retry is the same preparation.

States: `QUEUED → PREPARING → PREPARED → CREDENTIALING → EXECUTING`, then `SETTLED`, `SKIPPED`, `FAILED` or `HELD`. `HELD` means the outcome is unknown or needs a person (an unknown capture, a lost credential); the worker does not touch it again. The one exception is a card challenge, held with reason `REQUIRES_ACTION`: the worker parks it for a wait and polls the owner's answer (see Needs the owner below).

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
- A balance threshold (`LOW_BALANCE`) fires one job per dip. Firing, the sequence number (`THR:n`) and the job are one transaction. The trigger stays disarmed while the balance stays below the threshold and re-arms when it recovers, and it fires again only after a new qualifying external debit: a payment from the wallet counts, while the reload's own credit, a top-up and a refund of a reload do not, so the reload cannot loop on itself (see Wallet reloads).
- Event-driven triggers (new fine, parking ending) schedule nothing here.

The loop runs the scheduler only when `AUTOMATION_SCHEDULE_ENABLED=true` in addition to `AUTOMATION_WORKER_ENABLED`; both are off by default. The business clock stays separate from security time: the scheduler takes `now` as a parameter, so a simulator clock can drive it without touching token expiry.

## Wallet reloads

A `WALLET_RELOAD` rule keeps a wallet funded from an approved card. When the balance is below the rule's threshold, preparation computes one finite amount (the rule's reload amount, never past its target balance, at least AED 1 and at most the funding limit, within the per-payment cap and the period and lifetime budget), reserves it and creates the gateway's funding order for that card inside the same transaction. The order is marked automatic: the ordinary approve, execute, challenge and cancel routes refuse it, and only the dedicated execution route admits it, with the same one-time permit, freshness check and release rules as a bill payment.

Capture and wallet credit share one local transaction, so there is no provider chain. Only one funding order can be open for a wallet at a time, so two threshold events cannot open two reloads; a second occurrence is refused while one is active. At admission the rule must still be approved and the balance must still be below the threshold for the same amount, so an owner top-up or a revoked rule stops it. A decline fails the job as requiring action, a challenge holds it, and neither is retried or switched to another source; because the trigger stays disarmed until the balance recovers, a card that keeps failing is not charged repeatedly.

## Toll and prepaid recharges

A `RECHARGE` rule keeps one toll tag or prepaid number topped up. The scheduler reads the balance of exactly that target at its own provider and fires when it is below the rule's threshold; the only event that can fire it again is usage recorded on that same target (a recharge, a refund or usage on another line, tag or provider cannot). Preparation checks the target is active, the approved amount is still one of its denominations and would not carry the balance past the rule's target, then asks the source provider for a recharge quote and reserves it with an automatic payment order that only the dedicated execution route can admit, exactly like a bill. The quote is the payable: if the balance moves before admission (more usage, or the owner recharging by hand) it no longer matches, admission refuses it and the reservation is released.

Cost, count and cooldown caps are shared with every other rule, and a rule has at most one unfinished recharge, so two low-balance events cannot open two. Funding is the rule's own wallet or approved card and nothing else: short funds or a decline fail the job as requiring action and charge nothing, and no job starts another, so a failed recharge never causes a wallet reload or any other charge (chains of one automatic payment funding another stay off).

## Fines

Automatic fine payment is a separate, opt-in rule (`FINE_PAYMENT`): the owner approves one plate, a finite list of fine types, a per-fine amount cap and period and lifetime counts. Without such a rule fines stay manual. Every unpaid fine of the plate is its own occurrence (`FINE:<fine id>`), announced once by the scheduler however many times it looks; paid fines are never announced again.

Each occurrence is judged on the fine's current record at preparation, not on the event that announced it. A fine that is paid or withdrawn, a type the owner did not approve, a simulated restriction on the fine (`paymentRestricted`) and an amount above the cap are all skipped with a reason (`FINE_NOT_PAYABLE`, `FINE_TYPE_NOT_APPROVED`, `FINE_REQUIRES_REVIEW`, `OVER_PER_PAYMENT_CAP`), move nothing, reserve nothing, and are recorded as requiring action so the owner can decide. A discount applied before preparation is honoured, so the rule pays the current amount. Once a fine is reserved by an execution the source provider refuses to amend or restrict it, and admission re-reads the record anyway.

An automatic and a manual payment of one fine cannot both proceed: a manual review that already holds the fine makes preparation refuse it, a prepared execution makes a manual review of the same fine refuse, and either way the fine settles once with one debit. Fines that arrive together are paid one at a time: a mandate's cooldown between preparations is a wait (the job is retried after it under the same identity), not a failure, and the period and lifetime counts still bound the total.

## Parking extensions

A `PARKING_EXTENSION` rule binds one session (ticket, plate and zone) with a maximum number of hours, an end time and the usual cost, count and cooldown caps. When the session is within the rule's minutes of ending, the scheduler announces one occurrence per session expiry (`PARK:<ticket>:<expiry>`); extending moves the expiry, so the next extension is a new occurrence and not a repeat. Everything is judged on the current session at preparation:

- the session must exist, be running and unexpired, and match the bound plate and zone; a departed session (`SESSION_ENDED`), an expired one (`SESSION_EXPIRED`, never revived), a missing one (`SESSION_NOT_FOUND`) or another plate or zone (`SESSION_MISMATCH`) is skipped, so a session is never created or inferred;
- one more hour must stay within the rule's maximum hours (`MAXIMUM_DURATION_REACHED`) and end time (`END_TIME_REACHED`), which bounds any overnight stay; those two ask the owner to decide;
- the hour is priced by the zone's tariff and must fit the per-payment cap.

The source provider issues a quote for exactly that session state, and the extension is paid by an automatic order that only the dedicated execution route can admit, like any other payment. The order is bound to the session instead of a linked biller, and a manual order cannot take such a quote. The session only grows when an admitted, captured and settled order applies the quote while the session is exactly as quoted: departure, expiry or any other change after preparation makes the quote stale, admission refuses it, and nothing is charged. A rule has one unfinished extension at a time, an extension cannot be refunded, and the legacy manual extension still needs its own proof of payment.

## Subscription renewals

A `SUBSCRIPTION_RENEWAL` rule renews one billing period at a time (`CAL:YYYY-MM`). `renewalEligibility` (`packages/protocol-core/src/automation-eligibility.ts`) allows it only for an active subscription, from the one unpaid invoice issued for exactly that period, at exactly the current plan price and inside the cap. A plan change or repricing (`TARIFF_CHANGED`), a lapsed subscription, an uninvoiced or ambiguous period and a restricted invoice are skipped with a reason and recorded as requiring action; an already-paid period is never paid again. The paid order carries the receipt. `automationEligibility` is a default-deny map from catalog capabilities to mandate operations: plan changes, tenancy and utility activation, rides, dining, parking activation and the rest stay review-required and inherit no financial mandate authority.

## What the owner is told

- **Before a run:** when a rule's next run is inside the lead time (24 hours by default), the scheduler records one `UPCOMING_RUN` notice per rule and occurrence in `job_notices` (a reminder, not a job; it moves nothing and a paused or expired rule announces nothing).
- **Needs the owner:** a declined card, a card over its limit, short wallet funds and similar failures end the job as `FAILED` and record a `REQUIRES_ACTION` outbox event. A card challenge holds the job (`HELD`, reason `REQUIRES_ACTION`) and records the same event, then the worker parks it for `challengeWaitMs` (60 seconds by default) and asks the broker once per wait for the owner's answer. While the answer is pending nothing is recorded and no credential exists. If the owner rejects it, the job fails with `CHALLENGE_REJECTED` and a `CHALLENGE_ANSWERED` event with `decision: REJECT`, and nothing else runs. If the owner approves it, the broker issues one resumed credential for the same execution and operation, the job records `CHALLENGE_ANSWERED` with `decision: APPROVE` as it moves to `EXECUTING`, and the same order is executed once more. A resume that cannot be confirmed (an unreachable broker, or a crash while the resumed credential is being requested) is held for reconciliation, and a refused resume holds with its reason; neither is asked again. The worker never tries another source, a lower amount or a different invoice for that occurrence, and the failed occurrence is not retried.
- **Review needed:** a skip that only the owner can resolve (an unapproved fine type, a restricted fine, an amount above the cap, a parking session at its maximum hours or end time) is recorded as `REQUIRES_ACTION`.
- **Everything else:** a skip, a settlement, a held unknown outcome or an ordinary failure records `SKIPPED`, `SETTLED`, `HELD` or `FAILED`.

An invoice is chosen at preparation: the earliest-due unpaid, unreserved invoice that is within the rule's per-payment cap. An invoice above the cap is skipped, never lowered, and does not hold up a smaller one behind it. Paid and withdrawn invoices are never offered. Wallet, card, DEWA, Etisalat and du invoices follow the same path.

## Outbox

`job_outbox` has at most one row per job and kind (`PREPARED`, `SKIPPED`, `SETTLED`, `FAILED`, `HELD`, `REQUIRES_ACTION`, `CHALLENGE_ANSWERED`), written in the same transaction as the state change. The owner inbox turns these into entries (`services/automation-worker/src/inbox.ts`).

The inbox is served by `GET /api/payments/automation-inbox` (`services/agent-core/src/automation-inbox.ts`) and shown in the React payments panel. The owned rule set comes from the provider's owner-scoped mandate list, so only the signed-in owner's entries are returned, and switching account re-reads them. The response carries the request's `requestId`; each entry's `id` is the source key the worker derived (`job:<job>:<kind>` or `notice:<rule>:<occurrence>:<kind>`), so polling never duplicates an entry. The feed is polled rather than streamed. The worker's job store is read per request and closed again, and a missing store is an empty inbox rather than a new file. The panel has no answer buttons yet: approving or rejecting a held challenge still goes through the existing challenge route.

## Evidence

`services/test/automation-worker.test.ts` covers identity, fencing, a two-connection race, restart at each persisted step, retry rules, final states and the absence of the credential from every database file. The real-stack scenario is in `scripts/e2e/automation-execution.ts`.

## Kill switch and owner pause (AUTO-15)

The operator's global kill switch is a persisted flag in the worker's job store (`kill_switch`). Engaging it with `node --experimental-strip-types scripts/automation-kill-switch.ts engage --reason "<why>"` (release with `release`, check with `status`; `AUTOMATION_JOBS_DB` names the store, and a missing store is an error, never a new file) changes three things. No new job is claimed. A job that has finished a step stops before its next one, untouched, and carries on after release. A credential already issued while the switch engages is held as `KILL_SWITCH_ENGAGED` and is never presented or replayed; the provider's permit then expires unused and its reservation is released by the provider's own sweep. A restart keeps the switch engaged. Its authentication is the local operator: whoever can write the worker's store. An authenticated broker-scoped admin route and a panel control are still open.

An owner's pause-all (`POST /api/payments/mandates/pause-all`, with `requestKey`) pauses each approved rule at its current version, under a key derived from the request and the rule. A rule that cannot be paused is reported with its reason and left as it is; retrying with the same key does not repeat the pauses that succeeded. Pausing stops new runs only. It does not reverse a payment that was already committed.
