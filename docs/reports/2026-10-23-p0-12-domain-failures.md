# P0-12 execution evidence — 23 October 2026

Base: P0-09 PR #4, commit `7e4b8ee33b013da0774a27b883fd6d855467c305`, on merged-main baseline `ba911e2`. Implementation branch: `fix/p0-12-domain-failures`. Linux x64, Node 24.19.0 / npm 11.9.0. No model API, real identity/provider/payment, workflow enablement or deployment was used.

| Check | Actual result |
| --- | --- |
| `npm test` | PASS: 67/67, no skipped tests |
| `npm run build -- --force` | PASS: all 14 JS workspace tasks, no cache hits |
| `git diff --check` | PASS |

## Behavior verified

- Insufficient-funds fine payment is rejected with HTTP 400/FAILED, unchanged wallet/fines/ledger and a warning HTTP/SSE surface, rather than a cleared-fines receipt.
- After wallet payment succeeds, an injected ride rejection produces HTTP 409/PARTIALLY_COMPLETED, identifies the succeeded/failed steps and prevents food ordering.
- A wallet write that applies and then throws yields HTTP 502/UNKNOWN, stops later effects and requires reconciliation. Retrying the old approval does not debit again. Missing or contradictory success receipts are also UNKNOWN.
- A failed read returns a controlled outage response without fabricated data or leaked internal strings.
- Interleaved requests keep effect tracking isolated through AsyncLocalStorage. Actual HTTP and SSE failure surfaces agree.
- Move-in planning has no mutation steps and presents pending approval instead of claiming activation.
- Existing positive fine-payment simulation now adds sufficient fixture funds before confirmation and verifies that unpaid fines are actually cleared; its old success assertion hid a real rejection.

## Limits

This is checked result propagation for in-process simulators, not full P1-02 remote adapters. PENDING tracking is internal to synchronous domain calls. Step tracking and approval consumption are not durable, distributed or concurrency-safe; P0-05/P0-06/P0-10 remain open. The core stops effects and exposes partial/unknown states; automatic compensation and real reconciliation are not implemented.

Minimal required receipt fields are checked, not full domain response schemas. Current fixture card fallback, USD/AED mixing and composite accounting are still P0-06/P1-13 blockers. Success means the simulator reported acceptable outcomes, not that real agencies or payments were contacted. Flutter/browser non-2xx UX remains P1-12. Real Keycloak, native Flutter, Docker and visual browsers were not run.

## Actual command output

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> super-app-agent-monorepo@1.0.0 test
> node --experimental-strip-types --import ./scripts/test-env.ts --test packages/protocol-core/test/*.ts services/test/*.ts test/*.ts

✔ validateUIComponentNode: accepts valid component primitives (1.104826ms)
✔ validateUIComponentNode: rejects invalid component type (0.307964ms)
✔ validateAGUISurface: accepts valid surface payload (0.395146ms)
✔ validateAGUISurface: rejects invalid version (0.161324ms)
✔ createA2UIMessage: properly wraps A2-UI envelope (0.284519ms)
✔ validateA2UIMessage: validates nested AG-UI surface on A2UI_RENDER_SURFACE (0.422578ms)
✔ agent-core: health check endpoint (49.439348ms)
✔ agent-core: ride intent classifies correctly and returns valid AG-UI surface (15.527934ms)
✔ agent-core: food intent classifies correctly and returns valid AG-UI surface (1.876831ms)
✔ agent-core: wallet intent classifies correctly and returns valid AG-UI surface (4.260467ms)
✔ agent-core: composite multi-domain intent orchestrates ride, food, and wallet (12.559095ms)
✔ agent-core: action loop handles book_ride dispatch (1.924473ms)
✔ agent-core: action loop handles topup_wallet (4.717677ms)
✔ capability catalog exposes unique versioned contracts and conservative risk/consent metadata (48.100212ms)
✔ all capability JSON Schemas compile and accept the corresponding simulator response (186.078885ms)
✔ P0-12: insufficient funds returns failure JSON and failure SSE surface without clearing fines (67.754656ms)
✔ P0-12: composite stops at rejected second effect and records exact partial outcome (8.184527ms)
✔ P0-12: effect applied then exception yields UNKNOWN; no later effect or unsafe retry (2.091925ms)
✔ P0-12: unavailable read rejects the intent without fabricated surface or upstream details (0.624592ms)
✔ P0-12: nominal 200/error mutation response is not accepted as success (0.978146ms)
✔ P0-12: incomplete mutation receipt is UNKNOWN rather than an undefined-value success card (0.734108ms)
✔ P0-12: operation tracking remains isolated between interleaved requests (4.065393ms)
✔ P0-12: actual HTTP action and SSE render expose the same failed outcome (66.000751ms)
✔ P0-12: move-in planning does not claim activation before approval (18.042396ms)
✔ replay is session-bound and bounded by count, TTL, session count and bytes (2.037474ms)
✔ slow writers wait for drain and disconnect at the byte limit (0.352772ms)
✔ SSE parser preserves multi-line UTF-8 data across CR/LF and byte boundaries (4.283231ms)
✔ real HTTP stream verifies signed bearer, user ownership, origin, replay and expiry (2181.278709ms)
✔ browser stream reconnects with bearer headers and cursor, resets stale replay, and stops on 401 (502.432831ms)
✔ P0-09: wallet payments/topups reject coercion, invalid precision, bounds and currency without mutation (56.973904ms)
✔ P0-09: unified settlement rejects malformed/negative/oversized nested totals and keeps ledger unchanged (5.652226ms)
✔ P0-09: valid decimal money uses exact minor-unit arithmetic and enforces aggregate balance ceiling (3.990389ms)
✔ P0-09: mobility validates required IDs, integer durations, exact resource and accumulated bounds (10.746441ms)
✔ P0-09: food, utility, fine and housing mutations require explicit valid resources (7.870142ms)
✔ P0-09: profile preferences are bounded, enum-checked and non-coercing at every nesting level (7.743846ms)
✔ P0-09: malformed domain roots/queries never throw or mutate via direct invocation (3.745991ms)
✔ P0-09: core rejects malformed envelopes/action fields before consuming or creating state (11.112383ms)
✔ P0-09: real HTTP handlers reject invalid JSON bodies, nested inputs and coerced money (108.230021ms)
✔ service-ride: health, ride options, booking and tracking (39.311179ms)
✔ service-food: health, restaurant search, create order and tracking (7.733365ms)
✔ service-wallet: health, balance, payment and topup (11.067385ms)
✔ service-catalog: health, miniapps list and tool registry (2.448113ms)
✔ OpenRouter defaults to free router and never charges without explicit opt-in (4.873772ms)
✔ security: rejects fabricated JWTs instead of trusting decoded claims (2.02876ms)
✔ security: verified JWT sessions belong to the authenticated subject (121.781179ms)
✔ service-profile: health check endpoint (38.570894ms)
✔ service-profile: retrieve profile and verify VIP tier (0.745785ms)
✔ service-profile: retrieve and update user preferences (4.980303ms)
✔ service-profile: prompt-context generates tailored LLM instructions (3.563816ms)
✔ service-profile: MCP protocol tool definitions (2.754805ms)
✔ E2E Life Scenario 1: Commuter Morning Rush - Ride Hailing & Tracking (49.443925ms)
✔ E2E Life Scenario 2: Evening Dinner - Food Discovery & Kitchen Prep (8.235893ms)
✔ E2E Life Scenario 3: Wallet Management - Balance, Ledger & Top-Up (4.667431ms)
✔ E2E Life Scenario 4: Composite Multi-Agent Orchestration with HITL Checkout (4.208098ms)
✔ E2E Life Scenario 5: Concierge Ecosystem & Mini-App Catalog Exploration (1.406291ms)
✔ E2E Life Scenario 6: Financial Guardrail - Insufficient Balance Protection (0.203857ms)
✔ E2E Life Scenario 7: A2-UI Protocol Validation & Rejection Guardrails (0.16572ms)
✔ E2E Life Scenario 8: User Profile Personalization & Adaptive AG-UI Surfaces (8.297286ms)
✔ E2E Life Scenario 9: Keycloak OIDC Token Authentication & Security Rejection (1.009273ms)
✔ E2E Life Scenario 10: Smart Mobility - RTA Parking Meter Activation & Extension (6.298291ms)
✔ E2E Life Scenario 11: Smart Mobility - Salik Toll Tag Status & Instant Recharge (2.024364ms)
✔ E2E Life Scenario 12: Smart Utilities - DEWA Telemetry & Bill Settlement (3.222111ms)
✔ E2E Life Scenario 13: Citizen Safety - Dubai Police Traffic Fines Clearance (5.22431ms)
✔ E2E Life Scenario 14: Smart Housing - Ejari Move-In Autonomous Onboarding (18.739949ms)
✔ E2E Life Scenario 15: Unified Municipal Settlement across DEWA, Police & Salik (4.175048ms)
✔ E2E Life Scenario 16: UAE PASS National Identity & Digital Asset Registry (0.295076ms)
✔ E2E SuperApp Agent Journey: Complete Composite Multi-Service User Flow (57.922344ms)
ℹ tests 67
ℹ suites 0
ℹ pass 67
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3012.104684

```

```text
@superapp/shell-angular:build: 
@superapp/shell-angular:build: Output location: /workspace/scratch/e697290ceee3/super-app-agent/apps/shell-angular/dist
@superapp/shell-angular:build: 

 Tasks:    14 successful, 14 total
Cached:    0 cached, 14 total
  Time:    6.785s 

```
