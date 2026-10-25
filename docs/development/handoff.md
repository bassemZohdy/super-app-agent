# Current demo handoff — 24 October 2026

Application checkpoint **`cd3c7d5`** is on GitHub `main`. It includes P2-02 operations/recovery and the previously delivered manual payment/identity/local-AI work. This page is the current continuation guide; the [earlier `e9135ff` handoff](../history/handoff-2026-10-24-e9135ff.md) is retained as history. [Current status](../STATUS.md) · [Backlog](../../TODO.md).

## Run and inspect

- React: http://localhost:3000; core: http://localhost:4000; Keycloak: http://localhost:8085.
- Synthetic users: `bassem` or `demo-commuter`, password `demo123`.
- `npm run demo:wait` checks existing health metadata and critical-dependency readiness. Use `npm run dev:react` when port 3000 is free. [Full setup](local-development.md).
- `npm run ops:inspect` collects private diagnostics after `ops:init` and loading its key into the Node containers. Six existing pending broker jobs were flagged at the last inspection; retain their original identities for reconciliation. [Operations](operations.md).
- Existing volumes, issuer keys, model caches, successful recordings and personal local configuration remain preserved. No data reset is part of documentation cleanup.

## Verified application checkpoint

`npm run check` passed 533 Node tests, 18 workspace builds, lint, E2E TypeScript, document links and source-secret checks. Signed load/soak, a partial provider journey, payment-obligation replay/recovery and encrypted financial/Redis/issuer plus copied Keycloak/Redis recovery passed. See [executed evidence](../reports/2026-10-24-operations.md). Dated recordings and Flutter/local-AI results retain their original scopes; no new recording or device test is implied.

## Remaining work

The payment extension remains **24 checked / 26 open**. Mandates still return `executionEnabled:false`; no scheduler or unattended payment lane is enabled. P2-02 is complete only for the single-writer local demo. Production HA, off-host backup automation, full shell/device parity and the other open acceptance gates remain in TODO.md.

AUTO-03 and its [proposed implementation contract](../architecture/automation-permit-contract.md) remain the dependency gate for recurring execution. Before implementing effects, complete current-consent/owner/source checks, atomic shared amount/count/cooldown/occurrence reservations, controlled RFC 7523 issuance/binding and provider admission. Prove actual automatic/manual races, uncertainty, restart, revocation and definitive failure release before closing AUTO-03 or PAY-08.

The prior unfinished prototype is retained locally at `.data/handoff/auto03-draft-20261024T150507Z` as reference material, not validated code. Its order/mandate hooks and prototype modules are absent from the active implementation. Documentation maintenance does not reactivate it. GitHub Actions remain disabled without a separate explicit instruction.
