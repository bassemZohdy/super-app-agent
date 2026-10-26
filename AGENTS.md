# Working agreement for coding agents

Cityside is a local, synthetic city-services demo (ADR-0011). Nothing here touches real money, agencies or hosted infrastructure.

## The loop

1. Read [TODO.md](TODO.md) only. It is the single tracker of open work and is short on purpose. Do not load the changelog, reports or ADRs unless the task needs them.
2. Take the first unfinished step on the **critical path** (`AUTO-14` → `AUTO-15` → …). Work off the path only when it is blocked, and say why in the commit message.
3. Make the smallest change that completes one sub-step. Write the test first for security and money behavior.
4. Run the narrowest test while iterating, then the checks below before you stop.
5. In the **same commit**: tick the sub-step in `TODO.md` (or delete the task when its `Done when` holds) and run `npm run progress`, add one entry to `docs/CHANGELOG.md`, and update the guide you changed.

## Commands

| Purpose | Command |
| --- | --- |
| One test file | `node --experimental-strip-types --import ./scripts/test-env.ts --test services/test/<file>.ts` |
| All offline tests | `npm test` |
| Docs, links, task bullets | `npm run check:docs` |
| Before pushing a checkpoint | `npm run check` (lint, E2E types, docs, secrets, local-only policy, tests, builds) |

Node 24 is the supported floor (`.nvmrc`). Integration and browser suites need the Compose stack (`npm run demo:up`); say so when you did not run them instead of implying they passed.

## Documentation rules

- Task status lives in `TODO.md` and nowhere else. Never add status tables, counts, percentages, "handoff" or "status" files, or progress paragraphs to the README, index, guides or ADRs. `npm run check:docs` rejects them.
- `README.md#what-exists-today` changes only when a capability appears or disappears. `docs/INDEX.md` changes only when a guide is added. An evidence report in `docs/reports/` is written per milestone, not per slice, and names the revision it ran against.
- A `TODO.md` bullet states only what is still open, then `Done when`. Anything longer belongs in the guide for that area.

## Safety rules that must keep holding

- Mandates keep returning `executionEnabled:false` and no worker, credential or scheduled write is enabled until a schedule enqueues jobs and AUTO-15's pause and kill-switch gates pass (the AUTO-03 credential and AUTO-05 worker gates already do).
- Money is integer fils. Every effect is idempotent, persisted before dispatch and retried only with its original identity. An unknown outcome blocks replacement until reconciled.
- Tokens, assertions, keys and client secrets never appear in logs, errors, audit rows, tests output or documents. Use `packages/backend-kit/src/redact.ts`.
- Do not widen a grant, scope, audience or role to make a test pass. Do not add a fallback that silently reaches shared fixtures or a default resource.
- Do not enable or edit disabled GitHub workflows, add paid or external services, or push to a remote unless asked.

## Commits

`type(scope): summary (TASK-ID)`, one commit per sub-step, tests and docs included. Keep unrelated cleanup out of the commit.
