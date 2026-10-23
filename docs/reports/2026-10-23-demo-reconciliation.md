# Integrated demo reconciliation — 23 October 2026

Scope agreed for this pass: complete/validate the latest local demo, repair defects found during validation, and reconcile current documentation. Production architecture and external provider integrations remain tracked separately in [TODO](../../TODO.md).

## Source and environment

Pulled `origin/main` with `git pull --ff-only`: `b771a33` → `057141339fe3caa03995e75905cb20762b6ce846`. Results below apply to that source plus the uncommitted fixes accompanying this report. No commit/push is implied. Historical [provider-demo evidence](2026-10-23-provider-demo.md) retains its original environment/results.

macOS; host Node 26.3.0 / npm 11.16.0; Docker Desktop engine 29.6.2; reference Node 24 Alpine services, Keycloak 26.6.4 and Redis 8.2 Alpine. Flutter 3.47.5 / Dart 3.13.4; application constraints now require Flutter 3.47+ / Dart 3.13+. Browser checks use Chrome against localhost. Dependencies installed with `npm ci --ignore-scripts`; Flutter dependencies have a checked-in application lockfile.

All accounts, funds, records, credentials and entity integrations are local/synthetic. No actual city service or payment provider was contacted. The direct OpenRouter probe sent a short connectivity prompt through the existing server key; demo requests used synthetic service context.

## Requirements and evidence

| Requirement / check | Result and precise boundary |
| --- | --- |
| Latest source and clean dependency install | Fast-forward pull and locked npm install passed |
| Node regression suite | `npm test`: 100 passed, no failures/skips; includes controlled inference, signed local HTTP, provider/OpenAPI/payment/SQLite and malformed-envelope coverage |
| JS/TypeScript production builds | 17/17 workspace tasks passed after the final code fixes; final incremental run executed the two changed workspaces and reused 15 prior passing checks. The pulled baseline also passed all 17 with no cache. |
| Startup readiness | `demo:wait` checks the imported Keycloak realm, concierge integration/store configuration, all six application health endpoints and seven SQLite provider health endpoints. Ready-stack pass and unavailable-concierge timeout/nonzero exit verified |
| Redis integration | `npm run test:redis` passed across independent clients: ownership/account denial, leases, fencing, empty arrays, transcript/surface persistence, replay and pub/sub |
| Authenticated stack | `npm run demo:verify` passed: real seeded Keycloak user/service tokens, two users/accounts, session restore/denial, payment replay/conflict/decline/refund, service grants, telecom and stale actions |
| Provider journeys | `npm run demo:verify:journeys` passed: exact RTA capture/replay, DEWA proof/settlement, both telecom bills, fine/unified settlement and DLD/DEWA/residential-permit move-in |
| Ordinary restart recovery | Prepared a session, restarted agent-core/Redis/payment-provider containers, waited for readiness, then verified owner/account, transcript, surface revision and wallet; verifier cleaned its record/session |
| React browser | Real demo-commuter PKCE login, Alex identity, 1500 AED wallet surface, visible OpenRouter key failure, account switch clearing/restoring the workspace, transcript reload, and preserved model-error status after reload passed |
| Angular browser | Real seeded Keycloak login, Alex/account controls, provider-backed wallet and visible model error checked; corrected neutral greeting verified after reload |
| Flutter | Strict analysis reports no issues; both phone/desktop account-switch and saved-transcript widget tests pass; web build passes. Native platform/auth/SSE/speech execution is not covered |
| OpenRouter | Real HTTPS request reached the API; configured key was rejected with HTTP 401. Successful generated replies require a valid private key. Controlled generation/context/error tests pass |

Readiness is an endpoint startup check, not a proof of authenticated provider access, Redis HA or business recovery. The first verifier attempt ran before Keycloak had completed initial import and failed with a closed connection. Root cause: `demo:up` formerly returned as soon as containers started. It now invokes bounded readiness polling automatically. A failed readiness check leaves containers available for inspection and returns nonzero.

## Defects fixed in this pass

- `validateA2UIMessage` dereferenced null render data. A failing regression reproduced the crash; the validator now rejects nonobject payloads, invalid render modes, non-finite/negative timestamps, oversized IDs and envelope/surface session mismatches without throwing.
- Flutter hid account controls in the narrow-layout branch. The selector now sits above both layouts; switching clears the previous conversation, surface, choices and draft. Widget tests exercise phone and desktop account/session references.
- Flutter saved-session restoration unconditionally removed the last transcript message when applying a surface. Restoration now applies a surface without appending/removing transcript entries; tests preserve the final saved reply even when the surface lacks assistantMessage.
- Flutter had no checked-in web bootstrap despite a documented Chrome run command. Added it, a fixed web port (3002), dependency lock and explicit analysis/toolchain configuration. Resolved deprecated widget/color APIs and unsafe implicit dynamic assignments found by strict analysis.
- Saved model errors were lost from the React indicator after reload. Session GET now returns persisted inference status, which React restores; a controlled failure/restore regression covers it.
- Angular/Flutter welcome text named Bassem independently of the authenticated user. Initial greetings are now neutral.
- Reconciled current README/security/setup/testing, architecture, ADR implementation statuses, package descriptions and backlog. Historical reports/recordings remain dated; task IDs and open production acceptance criteria are preserved.

## Reproduce

```bash
npm ci --ignore-scripts
npm run demo:up
npm test
npm run build -- --concurrency=2
npm run test:redis
npm run demo:verify
npm run demo:verify:journeys
npm run demo:verify:restart -- --prepare
docker compose -f docker-compose.demo.yml restart agent-core redis provider-payments
npm run demo:wait
npm run demo:verify:restart
cd apps/shell-flutter
flutter pub get
flutter analyze
flutter test
flutter build web
```

Run provider mutations sequentially; they intentionally change simulated records/funds. `demo:down` preserves named databases. Do not remove volumes to rerun a check without deciding to reset that synthetic data.

## Remaining limits

A valid OpenRouter key is required for successful live generation. Set it privately in the ignored `.env` and recreate agent-core; remember that an exported shell variable overrides Compose `.env` interpolation. Public `/health` reports configured/enabled state, not provider authentication. Neural TTS and real microphone/speaker behavior remain unverified.

Flutter web analysis/compilation and controlled widget tests do not establish native PKCE/SSE/speech, device lifecycle, full renderer parity or native distribution. Browser smoke is scoped rather than a complete automated accessibility/conformance suite. Source-mounted demo containers are not clean-image production deployment evidence.

Single-node SQLite/Redis, AOF crash-loss windows, cross-service capture/settlement reconciliation, trusted actor headers, browser sessionStorage tokens, real provider contracts, production quotes/consent/audit, global quotas, HA/backups, dependency remediation, genuine agent/workflow runtimes and official protocol/MCP/gateway integration remain open. `npm run lint` still has no meaningful workspace lint tasks. Installation reported dependency advisories; no framework/security upgrade is claimed in this pass.

Final hygiene: local link targets checked across all 35 Markdown files; `git diff --check` passed. Dated historical reports and recordings were preserved. Changes remain in the working tree for review.
