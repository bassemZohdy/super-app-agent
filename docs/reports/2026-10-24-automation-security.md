# Automation authority review and hardening — 24 October 2026

AUTO-02 completes the local-demo security contract for expanded mandates and hardens the existing delegation broker. It does not enable scheduled spending. [Threat model, baseline manifest, findings and required admission contract](../architecture/payment-automation-security.md) · [ADR-0012 extension](../adr/ADR-0012-secure-delegation-demo.md#expanded-payment-mandate-boundary--auto-02).

## Review and executed controls

- The reviewed baseline is `fddcaaa5bc2b31f0ca2fd3224a036d058570da29`, with a reproducible eight-file source hash in the threat model. The assessed source remains in Git. Findings distinguish current permission/consent/storage weaknesses from future permit/budget/entitlement requirements and residual bearer risk. This is a scoped security review; human production/integration approval remains pending.
- Thirteen new tests exercise the real policy/SQLite boundaries. Seven initially failed on the preserved baseline, identifying implicit permission growth, ignored authority fields, returned-body aliasing, insufficient binding descriptors and unfenced completion. After hardening, all thirteen plus six retained delegation tests pass. They also prove exact user/actor/account/path/source/amount checks, actual two-connection admission/revocation ordering, terminal-state retention, original-ID unknown blocking across reopen, current policy/source invalidation and non-executable approved mandates.
- The broker’s reviewed read profile is now explicit and independent of OpenAPI growth. Known inventory reads remain available across seven providers; new interactive financial controls cannot acquire delegated consent implicitly. Stored grants outside the profile retain their records/history but cannot start/bind/authorize. Extra authority/model/mandate fields deny rather than being silently discarded.
- Token binding requires a SHA-256 fingerprint, a live bounded expiry, exact owner/actor/version/operation digest and an actual pending same-grant job. Completion requires the original authorized job; late callbacks cannot replace a terminal result. Counts and original operation IDs remain conservative after uncertainty or revocation.

## Signed local integration

`npm run demo:verify:automation-security` uses real local Keycloak and temporary broker/provider databases. The separate trusted issuer container mounts the existing key volume **read-only**, verified through Docker inspection. Key material and raw delegated assertions/access tokens remain inside that issuer container; the host/agent runtime receives none. Temporary identity configuration is permission-restricted and deleted; the test removes only its own container/data.

- Signed human, service and runner tokens cannot spoof another owner, create worker consent, self-approve with extra fields or access interactive financial execution/control/history lanes. Wrong-audience runner tokens fail authentication; valid-audience service tokens fail authorization.
- Real RFC 7523 tokens with write scope but no independent binding cannot credit/capture money. Bound read tokens cannot change the path/method or be used twice. An already-issued token is denied after current online grant revocation. Token hashes and original IDs provide correlation without recording the credential.
- Exact owner-consented read grants execute against all seven isolated providers; route/profile hardening retains the intended inventory/balance compatibility.
- A real approved mandate still returns `executionEnabled:false`; a stale disabled source cannot create new consent. Provider restart preserves that disabled execution state. Blocked probes leave wallet and transactions unchanged. A separate explicit legacy AED 1 grant credits the temporary wallet exactly once, including replay, proving compatibility without granting recurring authority.
- Direct test status reads use fresh sockets across an intentional provider restart. No money mutation is automatically retried after a transport failure. Identity, key and policy reconfiguration are not used to manufacture a passing outcome.

The integration’s accepted exact bearer request can still be raced by anyone possessing that token. AUTO-T08 deliberately records the one-admission bound rather than falsely claiming theft-proof or sender-constrained credentials. See [RFC 6750 bearer semantics](https://www.rfc-editor.org/rfc/rfc6750.html#section-1.2). Current owner/membership epochs and shared monetary budgets remain required future controls, contained today by rejecting all scheduled financial lanes.

## Verification boundary

- `npm test`: **371 passing tests**. All **18 workspace builds** pass. ESLint and E2E TypeScript cover the host harness, trusted issuer helper and restart verifier. The existing shared payment/OpenAPI contracts remain 1.12.0/2.16.0; no new financial route or Keycloak preview feature is enabled.
- `npm run demo:verify:delegation:restart` preserves existing **52 grants, 57 bindings, 58 jobs and 377 audit records** byte-for-byte across the normal broker restart. It creates no consent or financial effect. Normal source/provider wallet data is not reset or replaced.

Normal endpoint readiness and signed-owner inventory checks pass with wallet funds and transaction history unchanged. Local links pass across **88 Markdown documents**, source/document secret checks and `git diff --check` pass. No visual workflow changed in this checkpoint; existing financial recordings retain their earlier dated scope.

The reviewed future authority contract remains mandatory for AUTO-03, PAY-08, PAY-21 and AUTO-15: current consent/entitlement and exact server-derived terms; atomic shared amount/count/cooldown and payable/occurrence reservations; controlled short-lived credentials; current provider admission; retained unknown reservations and original-ID reconciliation. Passing the threat-model task does not complete those implementation gates. Selected backlog: **23 delivered slices / 27 open**.
