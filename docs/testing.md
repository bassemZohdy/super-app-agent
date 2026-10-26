# Focused agent verification

```bash
npm ci --ignore-scripts
npm rebuild better-sqlite3
npm run check:agent
npm run check
```

`check:agent` type-checks the agent and focused tests, then executes deterministic unit, HTTP/SQLite integration and restart tests. `check` also runs the existing repository gates and workspace builds. The existing vendored-skill assertion accepts both Python 3.12 and 3.14 argparse formatting; its optional pytest check is skipped if pytest is unavailable. Existing Docker/browser/device integration commands are separate and must not be inferred from offline test success.

| Test category | Executable evidence |
| --- | --- |
| Unit | `services/test/simple-agent.test.ts`: strict schemas, fixture intent/context routing, stable quote digest, configuration refusal, unavailable LLM, tool timeout/failure and idempotency precondition |
| HTTP + actual file-backed SQLite | `services/agent-core/test/orchestrator.integration.test.ts`: multi-turn list/pay, conditional routing, durable interrupt, approved payment, duplicate request/receipt, independent auth, cross-owner refusal, revocation, rejection/cancellation, expiry, changed quotes, invalid model plans, bounded execution, compatibility surface validation, SSE and credential exclusion from database tables |
| Actual process restart | `services/agent-core/test/restart.test.ts`: spawn the real entry point, obtain approval, SIGKILL, restart on the same file, compare restored approval, approve, SIGKILL/restart again, replay the request and retain the same receipt |
| Lost-response reconciliation | Commit the actual simulator effect over HTTP, inject a lost reply, close/reopen the application database, recover with the original key and assert exactly one simulator payment |

Default tests use a deterministic planner and isolated opaque-token test authority. They do not claim inference quality, actual government services, a real identity-provider integration for the new path or a financial payment. The SQLite saver and transaction engine are real, not database mocks. PostgreSQL testing is not required for the chosen embedded demo and no PostgreSQL runtime is included.

The official saver has a native `better-sqlite3` dependency. `npm rebuild better-sqlite3` is necessary after an installation using `--ignore-scripts`; on platforms without a prebuilt binary, a local compiler toolchain is needed. Mirror dependencies and image/native artifacts before air-gapped installation; normal runtime needs no hosted service.

Container/Compose, Kubernetes/OpenShift and actual React/Angular/Flutter integration remain distinct verification boundaries. The executable CLI demonstrates the new API; compatibility payload schema validation does not prove that a shell has been migrated.

Execution results for the implementation milestone belong in the dated [evidence report](reports/2026-10-26-simple-agent.md).
