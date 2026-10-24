# Local demo operations — P2-02

This runbook covers the synthetic, single-writer Docker demo in ADR-0011. It does not qualify production HA, distributed quotas, disaster recovery infrastructure or inference capacity. All commands run from the repository root. Keep deployment/Compose changes and maintenance commands sequential.

## Enable and inspect

```bash
npm run ops:init
# Recreate the Node services to load the new OPS_API_KEY, following normal demo startup.
npm run demo:up
npm run ops:inspect
# To collect one journey across all Node processes:
npm run ops:inspect -- <32-character-trace-id>
```

`ops:init` preserves existing configuration and generates missing random operations/encryption keys in ignored `.env`. Keep a separate secure copy of `OPS_BACKUP_KEY`; losing it makes backups unrecoverable. Never commit either key or copy it into a browser. Back up `.env` separately through an approved secret store if it contains other local configuration.

Each of the 15 Node processes exposes `GET /ops/state` and `/ops/metrics` only with `X-Ops-Key: <OPS_API_KEY>`. An unset key disables access (404); wrong credentials or a browser Origin return 403. Application bearer tokens do not authorize diagnostics. These management APIs sit outside the business OpenAPI contracts. `/ops/metrics` uses Prometheus text exposition; configure scrapers to send the private header, restrict management networking, and use TLS before any nonlocal deployment. `ops:inspect` returns nonzero for an unavailable service or an active/sticky alert.

The process ring retains 1,000 spans (last 200 returned per inspection), with a 2,048-active-operation ceiling. Metrics use bounded service/kind/category/method labels, never per-request/resource labels. JSON completion logs go to stdout; Compose rotates Node logs at 10 MB × 3 files per container. Rings and cumulative metrics reset at restart. Docker logs are local diagnostics, not a compliance audit archive. No external collector or new paid service is required.

## Follow a partial journey

Responses carry `X-Request-Id`, `X-Run-Id` and W3C `traceparent`. A valid request ID is echoed; invalid IDs receive a UUID. Trusted outbound calls forward trace/request/run/workflow/tool/approval context. Workflows use the owned session ID, domain/MCP calls create tool IDs, and approvals use server-owned review IDs. Incoming diagnostic headers convey no authorization. Existing business replay keys and consent checks continue to control effects.

Save the failed response's trace ID and run `ops:inspect -- <trace-id>`. Join each `parentSpanId` to its parent's `spanId`. Look for the last successful provider span and the following failed/unknown client/tool span. A client connection failure has no corresponding remote server span. The signed qualification deliberately commits a DLD move-in proposal, interrupts DEWA, and verifies a truthful UNKNOWN journey with all five correlation IDs. Never infer a completed composite transaction from one successful span.

Telemetry collects method, normalized route, service, status, duration and diagnostic IDs. It never collects bodies, query strings, raw URLs, account/user identifiers, authorization headers, model prompts or raw payment records. Unknown path segments become `:id`; arbitrary caller labels are fingerprinted before storage/logging. Completion lines also pass through the shared redactor. Do not add payload logging to diagnose a failure.

## Probes and alerts

| Probe | Meaning |
| --- | --- |
| `/live` | Process answers HTTP; independent of dependencies and normal request admission. |
| `/ready` on a provider | Its SQLite store answers `SELECT 1`; generic 503 on failure. |
| `/ready` on an application | Its handler exists and, in provider mode, its local SQLite store answers. Provider outages do not cascade to readiness. |
| `/ready` on the broker | Its local grant database answers; does not generate keys or mint assertions. |
| `/ready` on core | Redis connects and answers PING when persistent sessions are selected; fixture mode has no Redis prerequisite. |
| `/health` | Existing service metadata and model/voice status. Retained for compatibility. |

Readiness has a 2.5-second dependency deadline. `demo:wait` verifies both existing metadata and readiness. Compose checks Node readiness every ten seconds. Optional text/voice provider health remains visible in core `/health`; a speech/model outage does not disable independent manual payment inspection.

`/ops/state` exposes active work, age and `STUCK_WORK` after 120 seconds (`OPS_STUCK_MS` can lower it for exercises). Long-lived SSE connections are excluded from stuck-work detection. Payment diagnostics aggregate unresolved original capture attempts; broker diagnostics count pending jobs and their oldest start. `RECONCILIATION_REQUIRED` and `STUCK_DURABLE_WORK` survive a process restart because their source is SQLite. Aggregate values do not grant permission to inspect another owner's resources.

`REQUEST_SATURATION` warns at 80% of configured process concurrency. `CAPACITY_REJECTION` and `SSE_BACKPRESSURE` are sticky local signals: inspect cumulative counters and reset only through a deliberate restart after diagnosis. Normal HTTP limits remain 64 concurrent requests and 300 requests/minute/IP by default. SSE retains its 256 KiB write bound, 32-message validation queue and five streams/session limit. Backpressure disconnects a slow consumer; reconnect through the existing snapshot/replay protocol. Never blindly replay a financial action after disconnect.

Prometheus alert examples are in [operations-alerts.yml](../../ops/operations-alerts.yml): use counter rates for recent saturation/disconnects, p95 histograms for latency, 5xx rates for errors and gauges for stuck/reconciliation work. The local cumulative `ERROR_BUDGET` warning starts after 20 business requests exceed 1% 5xx; Prometheus windows are the preferred ongoing view. A telemetry-loss counter also records span eviction at the bounded retention limit. Inspect first; do not automatically restart or retry unknown operations.

## Qualification targets

| Check | Local demo gate |
| --- | --- |
| Signed read load | `GET /api/accounts`, eight workers, 10 seconds; ≥5 responses/s, p95 <1 s, ≤1% failed requests. |
| Read soak | One paced worker for 60 seconds; p95 <1 s, ≤1% failed requests, peak RSS growth <128 MiB after warm-up. |
| Failure behavior | Dependency/probe separation, failed provider hop, stuck work, admission rejection and bounded SSE writes. No false success or implicit retry. |
| Recovery | No lost records committed before the quiesced checkpoint; isolated durable-state promotion <120 s. |
| Full demo recovery objective | RTO ≤10 minutes; scheduled backup objective ≤24 hours RPO, plus a checkpoint before every upgrade/demo reset. |

Run `npm run ops:verify` with the normal Keycloak/Redis up and E2E ports free. It starts isolated application/provider databases, disables inference and uses signed seeded-user requests; load is read-only. It removes its owned conversation/checkpoint state. Run `npm run ops:verify:recovery` for actual isolated Redis AOF, financial journal/replay fences, pending/revoked grants, approvals, graph writes, TTL and issuer-key recovery. Both commands have finite workloads/deadlines and write private summaries under `.data/operations/`. The 60-second soak is a local demo qualification; it is not an endurance or model-performance claim.

Node containers use init and drain active HTTP requests on SIGTERM, closing SSE/idle connections first. A 70-second drain failure exits nonzero; Compose permits 90 seconds. Maintenance remains necessary: all writers must be fenced before a checkpoint.

## Cold backup

**Maintenance window:** stop user activity first. This command stops all currently running reference services, copies state only after shutdown checks, and restarts the same service set in `finally`. It never removes a normal volume. A forced/OOM storage-process termination aborts the checkpoint. Avoid concurrent `demo:up`, deployment, scheduler or backup processes.

```bash
npm run ops:backup -- /existing-private-directory/demo-checkpoint.enc
npm run demo:wait
```

The encrypted bundle includes all seven providers, six application SQLite stores, broker grants/jobs/bindings/audit and issuer keys, Redis persistence (sessions, graph, replay and locks), Keycloak H2/realm data, Compose/lockfile/realm configuration and a private runtime `.env` copy. The backup encryption key is explicitly omitted. Model caches, recordings and transient diagnostic rings are excluded. H2 and Redis are copied cold; copying a live H2 directory or SQLite main file without its WAL is unsupported.

Bundles use AES-256-GCM authenticated encryption, compression and per-file SHA-256 checks; files are created with 0600 and staging directories with 0700. The bounded demo format supports up to 256 MiB of original files and 10,000 files. Larger installations need a reviewed streaming/database-native backup system. Never place the archive inside its source tree. Keep the last seven daily verified checkpoints and one known-good pre-upgrade checkpoint in private storage on a separate device; remove obsolete copies only after verifying a newer restore. Check checkpoint age daily: the 24-hour RPO objective depends on this operator schedule; no scheduler or off-host replication is installed.

## Restore and fenced failover

```bash
npm run ops:restore -- /private/demo-checkpoint.enc /absolute/existing-parent/NEW-restore-directory
# Optional: boot the copied real Keycloak realm and Redis in isolated containers too.
npm run ops:verify:recovery -- /absolute/existing-parent/NEW-restore-directory
```

Restore authenticates and validates all contents before writing, refuses an existing destination, unsafe paths, links and linked ancestors, and never merges into live volumes. On macOS, use the physical parent path (`pwd -P`; `/private/tmp` rather than the `/tmp` symlink). Keep the original archive unchanged and retain the extracted copy privately; it contains signing keys and credentials.

For a host/storage failure or rollback:

1. Record the checkpoint time and incident time. Inspect partial/unknown originals and stop new effects. Confirm archive age meets the RPO objective; state after that checkpoint can be lost.
2. **Fence the old writer:** stop the full Compose project and any host `dev:backend` processes. Confirm none can restart against the old SQLite/H2/Redis directories. This demo has no leader election, replicated database or multi-writer mode. Preserve old volumes for investigation; never run `down -v`.
3. Restore into a new directory as above. Check out the recorded code revision and compare the restored Compose/lockfile/configuration with the intended version. Restore runtime secrets privately; keep the encryption key outside the extracted config. Do not silently combine a new realm, old broker keys and another Redis checkpoint.
4. Prepare a **new private Compose override**, mapping each restored service directory to its original data target: `redis:/data`, `keycloak:/opt/keycloak/data`, `delegation-broker:/data/delegation`, and each `provider-*`/`service-*` directory to `/data`. These names refer to extracted directories, not volume names. Match container ownership (Keycloak UID 1000; Redis image entrypoint manages its data ownership). Do not chmod secrets/world-readable. Base source/import mounts and endpoints remain required. Review `docker compose -f docker-compose.demo.yml -f /private/recovery.yml config --quiet` without printing resolved secrets.
5. Start dependencies, then exactly one set of broker/providers/applications/core with the same override. Wait for `/ready`, authenticate both seeded users, inspect wallet/journal/reconciliation, saved approvals and grant revocation. Confirm the original operation IDs and that replay fences still hold. Use `ops:verify:recovery` on a disposable extraction for destructive rehearsal; it never promotes normal state automatically.
6. Expired approvals/tokens/leases remain expired. Allow stale Redis locks to expire (up to 120 seconds); never delete locks to force an uncertain effect through. Pending/UNKNOWN captured work stays blocked until the existing explicit original-operation inspection/recovery proves the outcome. Never re-run an old consent or synthesize a replacement payment.
7. Measure time until readiness plus the signed checks succeed; record achieved RTO and actual checkpoint-age RPO. Open traffic only after these gates. Keep the previous volume set fenced. Rollback follows the same procedure and requires reconciling any effects committed after the older checkpoint.

The supported local availability pattern is restart of one writer or manual promotion to a fresh copy after fencing. Production HA would require a supported persistent Keycloak database, Redis replication/failover, shared transactional financial storage, distributed fencing, online revocation, off-host encrypted backups and a separate security/recovery qualification. That work remains outside this demo completion.

References: [W3C Trace Context](https://www.w3.org/TR/trace-context/), [Prometheus exposition format](https://prometheus.io/docs/instrumenting/exposition_formats/). [Executed P2-02 evidence](../reports/2026-10-24-operations.md).
