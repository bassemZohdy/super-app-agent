# Payment lifecycle guards and preview simulation — 24 October 2026

Delivered PAY-03/PAY-04's owned-resource/lifecycle contracts and SIM-01's initial preview-only scenario clock after journal baseline `58dc0dd`. The publication commit for this report identifies the source. Actual issuer/order/mandate producers and financial execution integration remain their own tasks; these controls do not implement them.

## Provider and lifecycle behavior

- Etisalat/du now expose owned prepaid lines with a one-time 50 AED synthetic opening balance and stable IDs. Existing seeded accounts receive the new resource without replacing bills/subscriptions or resetting modified balances.
- Police exposes registered vehicles independently of unpaid fines. The twelve-journey browser harness now proves that the owned vehicle remains discoverable after all fines are settled.
- Biller discovery/link verification reads the signed owner from the source provider for subscription/prepaid/vehicle references. Cross-provider prepaid substitution denies. Entity contracts are additive 2.1; payment setup/related-use contracts are 2.2.
- `PaymentResourceUses` records bounded, account/version-checked ORDER/HOLD/MANDATE references. Active references block card removal and biller archive under the same provider transaction. Disabled methods reject new uses, while in-flight references remain visible. Release is final/idempotent and cannot resurrect an old use. Changing the default source never rewrites a dependency.
- React shows related blocking items and disables unsafe controls; bypassing the UI still returns `RESOURCE_IN_USE`. A caller cannot release these locks through a public endpoint.

The browser lifecycle cases bind real persisted use records through the **trusted internal isolated test fixture**, not through an issuer or running mandate. They prove the guard/API/UI contract. Future order, hold and mandate producers must bind/release this same contract atomically with their lifecycle; that wiring is not claimed complete here. A lifecycle reference never proves consent or payment authority.

## Scenario behavior

`SimulationRuns` and the local CLI persist run identity, deterministic preview fixtures, instance business time, generation, due events and retry results. Advance/reset is bounded and revision checked, emits each fixture once per generation and stays scoped to the selected run. No provider/payment/credential operation is dispatched. The CLI uses a fixed private data path and local OS operator identity; Keycloak admin controls and actual execution scenarios remain future work.

## Executed verification

- Full check: **155 Node tests and 18 workspace builds**, lint, strict harness, local links and source-secret checks pass.
- Eight payment-account tests include existing-account resource upgrades and preserved prepaid balances/paid records; three lifecycle tests cover all dependent kinds, account/version checks, replay/release, persistence/two connections and stale admission after archive.
- Seven scenario tests cover persistent deterministic runs, ordered/once-only events, scoped reset, bounds/ownership, concurrent revision rejection, normal-provider data containment and JWT security time. After a 31-day business advance, a signed real-time-valid token still verifies and an expired token remains rejected.
- The real-Keycloak/isolated-provider payment browser passes prepaid link/balance, wrong-provider denial, visible related-use blocks, exact API guard failures, private-release denial and trusted release, plus existing desktop/mobile/focus/account-reload checks.
- All twelve service journeys pass, including the new actual post-fine-payment vehicle-discovery assertion. Existing financial effects and no-double-payment checks remain green.
- `npm run simulator:verify` passes across separate CLI processes: three due preview events, no duplicate replay effects, rejected backward time and exact seeded reset. Preview data is isolated under ignored `.data/simulator`.

[Related-item UI](assets/payment-related-items.png) · [Payment setup](../development/payment-accounts.md) · [Scenario commands and boundaries](../development/simulator.md).

Saved-card authorization/capture, finite issuer limits, interactive challenges, stored quotes/orders, settlement/refund claims, provider lifecycle simulation, autopay and an admin scenario UI remain unimplemented. No Keycloak feature flags, cloud inference configuration or production release status changed in this pass.
