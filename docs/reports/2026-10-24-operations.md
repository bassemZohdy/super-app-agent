# P2-02 — local observability, capacity and recovery

Executed 24 October 2026 against the selected synthetic local demo. This completes P2-02 at that boundary. [Operating runbook](../development/operations.md) · [Backlog](../../TODO.md).

## Implemented behavior

All fifteen Node processes now share bounded server/client/tool spans, request/run/workflow/tool/approval correlation, redacted JSON completion logs and authenticated `/ops/state` plus Prometheus `/ops/metrics`. Diagnostics have a separate private key, reject browser origins/application bearer credentials, normalize paths and omit bodies, query strings, tokens and owner/payment data. Process rings retain 1,000 spans; metric dimensions are bounded. Compose rotates Node logs and checks critical-dependency readiness. Core checks Redis, applications/providers check their own SQLite stores, and the broker checks its grants store. Liveness stays independent.

Stuck HTTP work, durable original capture attempts/pending broker jobs, admission saturation/rejection and bounded SSE disconnects have diagnostic signals and optional Prometheus alert rules. Normal operator inspection correctly surfaced **six pre-existing pending broker jobs**, with an oldest age over sixteen hours. They were preserved for explicit original-operation reconciliation; this task did not execute, delete or manufacture success for them. `ops:inspect` therefore returned nonzero for the existing `STUCK_DURABLE_WORK` alert while service readiness passed.

Encrypted cold backups fence writers, reject unclean exits, preserve the complete service state/configuration set and restart the original running service set. Restore authenticates/decompresses/checks file hashes before writing, refuses overwrite/unsafe paths/links, and creates a fresh private directory. The encryption key is excluded from the runtime configuration copy. Local failover requires fencing the previous writer; no distributed/multi-writer HA is claimed.

## Executed qualification

The signed HTTP fixture used real local Keycloak and Redis, isolated provider/application databases and disabled inference. It prepared an owned housing review, accepted its server-bound action, committed the DLD proposal and interrupted DEWA. The gateway returned UNKNOWN with no false composite success. Inspection found **32 linked spans**, including the server-approved workflow/approval, generated tool identity, successful DLD hop and failed downstream client hop. Access checks and `/live`/`/ready` passed for core, six applications and seven providers; normal-stack readiness separately included the broker.

| Check | Observed result | Gate |
| --- | --- | --- |
| Signed `/api/accounts` read load, 10 s, eight workers | 2,737 successful reads; **273.7 requests/s**; **28.2 ms p95**; zero failures | ≥5 requests/s, p95 <1 s, ≤1% failures |
| Paced read soak, 60 s | 286 successful reads; **12.9 ms p95**; zero failures; **1.2 MiB** peak RSS growth after warm-up | p95 <1 s, ≤1% failures, <128 MiB growth |
| Private operations access | Missing/wrong key, bearer-only and browser Origin rejected | Separate operator authorization |
| Correlation/privacy | Parent links and all five IDs verified; concurrent requests isolated; sensitive payload/path/query/header values absent | Positive and adversarial assertions |
| Capacity/failure | Held-work detection, real admission rejection, actual SSE writer overflow, dependency readiness failure with live process | Bounded fail-closed behavior |
| Graceful shutdown | Original active response completes before exit 0; hung drain exits 1 | Backup rejects unclean shutdown |

Local runtime: Node **26.3.0**; the actual Compose Node image reported **24.21.0** and passed all **17 targeted tests** (telemetry, request IDs, shutdown and encrypted restore). Load measurements include colocated fixture processes and exclude model/voice performance. The load raised process RSS during warm-up; only the subsequent paced soak is checked against the growth budget.

`npm run check` passed lint, E2E TypeScript, Markdown links, source-secret checks, **533 offline tests** and **18 workspace builds**. The signed browser/HTTP `demo:verify:payment-obligations` regression also passed concurrent reservation exclusion, response loss plus provider restart, original capture recovery, replay isolation and explicit cancellation. Existing recording screenshots were preserved. Five optional alert examples parsed as YAML; a production Prometheus deployment/rule evaluation is not claimed.

## Recovery rehearsal

`npm run ops:verify:recovery` created the actual financial/broker schemas and a dedicated real Redis AOF instance. It retained a committed credit/journal, transport replay key, pending grant job, revoked grant, owned approval, serialized LangGraph checkpoint/pending writes, expiration TTL and issuer signing key. It stopped and removed the old Redis writer, encrypted a consistent checkpoint, deleted only its isolated source directory, restored into a new directory and promoted one replacement writer. The following passed:

- Financial integrity/journal/balance match; duplicate transport identity remains blocked.
- The original pending grant request replays its original job; a new request stays reconciliation-blocked. Revocation remains effective.
- Approval, graph values/pending writes and positive TTL survive; the original signing identity still verifies signatures.
- Redis outage makes core readiness 503 while liveness remains 200; the old container is removed before promotion.
- Zero committed records from the quiesced checkpoint were lost; isolated recovery took **554 ms**, below the 120-second target.

The actual normal Compose cold backup then captured **35 files / 42,289,477 original bytes** across all providers/applications, broker, Redis, Keycloak and configuration. It was written with mode **0600**, restored through `ops:restore` into a fresh directory, and checked to exclude `OPS_BACKUP_KEY`. A disposable copy of its **real Keycloak 26.6.4 H2 realm** booted on an isolated port and authenticated the seeded citizen; its copied Redis AOF also booted and answered PING. The copied dependency boot/login checks took **24.1 seconds**; this timing does not include operator investigation or full application promotion. Normal volumes were retained and normal-stack readiness passed after restart.

The initial rehearsal caught exit 137 in PID-1 Node containers and refused a checkpoint. A minimal container experiment reproduced exit 137 without init versus exit 143 with init. The final implementation adds init and bounded graceful request draining, closes SSE/idle connections and fails the checkpoint on a forced or failed drain. The successful backup used that shutdown path.

Private machine-readable summaries and the encrypted archive remain under ignored `.data/operations/` and `.data/backups/`; no key, token, live identity or raw database record is published in this report. Restore copies used for rehearsal can be removed after verification.

## Acceptance limits

The runbook sets a ≤24-hour scheduled-backup RPO objective, plus pre-upgrade checkpoints, and a ≤10-minute full demo RTO objective. Meeting the RPO requires the documented operator schedule and separate private backup/key storage; no automatic off-host backup service is installed. The measured record-loss result concerns the quiesced checkpoint, not effects after an older backup. The tested failover is a fenced single-writer promotion with actual durable-state and dependency recovery; the procedure explicitly requires signed readiness/reconciliation checks before opening traffic. Production replication/automatic failover, extended endurance tests, distributed fencing, production identity storage and compliance retention require separate qualification.
