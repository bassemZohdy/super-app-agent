# Reproducible issuer scenarios — 24 October 2026

SIM-03 adds authenticated isolated-run configuration for all eight named issuer outcomes. Pending decisions reserve finite capacity without capture, survive reopen/restart and remain separate from customer challenges and execution. The normal demo cannot be armed through HTTP/env controls; normal/copied data cannot become a new issuer run.

Source: the commit introducing `issuer-scenarios.ts`, payment contract 1.9.0 and payment-provider OpenAPI 2.12.0. [Usage, controls and migrations](../development/issuer-scenarios.md).

## Verification

- Fourteen focused tests cover named outcomes, ordinary-customer/operator denial, active-use and retry guards, real expiry, pending payment/funding behavior, original frozen refund failure, path/pristine/run binding, conditional OpenAPI and nonempty issuer/order/funding migration with retained balances and backups.
- `npm test`: 292 passing tests; `npm run build`: all 18 packages pass. Lint, E2E TypeScript and generated OpenAPI checks pass.
- All eight real-Keycloak browser cases pass, including customer/operator separation, a pending authorization surviving an actual provider restart, and a failed refund returning no money. [Paced recording](../recordings/issuer-scenarios/index.html): 132.60 seconds, with six-second reviews and eight-second outcomes. [Refund failure screenshot](assets/issuer-refund-failure.png).
- `npm run test:e2e`: all 12 existing browser journeys pass.
- `npm run demo:verify:payment-ledger`: three wallet balances, sealed journal entries and existing financial history survive the pending-aware schema migrations and service restart; the normal database has no issuer-scenario controls installed.
- `npm run demo:wait` and `npm run demo:verify:inventory` pass against the normal running stack. Signed-owner reads preserve funds/history, and the isolated control route returns 404 there.
- Documentation links pass across 77 Markdown documents; source/document secret checks and `git diff --check` pass. The selected backlog now has 17 delivered slices and 33 open.

The run operator is a startup-bound verified identity, not a new global admin role. Credentials never enter persisted scenario metadata. SIM-05's broader lifecycle/control UI, SIM-04 faults and the remaining PAY-18 event-path qualification stay open; no production or automatic-spending authority is implied.
