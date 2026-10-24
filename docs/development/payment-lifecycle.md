# Owner, workspace and funding lifecycle

PAY-21 adds current access checks to the local synthetic demo. Payment contract **1.14.0** and payments OpenAPI **2.18.0** retain the existing `/v1` paths. Automatic mandate execution remains disabled.

## What changes

Payments stores the authoritative owner-enabled and workspace-membership decisions. Immutable account ownership is not reassigned. Existing accounts start at permission version `1:1` without inserting permission rows, resetting funds or rewriting historical records. Owner and membership versions increase independently on every operator decision, including restoration. Owner disable covers both personal and household workspaces; membership revocation covers only the selected workspace.

A new payment, wallet-funding, refund or mandate review freezes the current permission version in its approval terms. Revoke-and-restore invalidates old authority. Restoring a card also increments its existing source version; it cannot revive an old challenge or change a rule to another card or wallet. Changing the default only affects future drafts. Active orders, holds and mandates still block card removal and biller archival.

Core, application services, source providers and broker read current eligibility without a positive permission cache. The gateway checks its own authoritative SQLite state again inside the final capture transaction. The broker checks before creating a grant, starting a job, minting an assertion, binding the resulting token and authorizing the provider operation. A grant does not acquire a new permission version when narrowed. Old records without a permission field retain their original bytes and are treated as version `1:1` at use.

Online Keycloak introspection independently rejects disabled users and inactive tokens. The local operator's owner switch is an application permission decision; it does not modify Keycloak user records. Direct Keycloak administration and payment permissions are separate authorities. Production identity-event synchronization and distributed automatic-admission fencing remain separate gates.

## Try the React experience

1. Sign in, select a workspace and open **Payment accounts**.
2. **Access & in-flight work** lists active original payment/funding IDs and approved/draft rules. It identifies changed permissions, source versions and biller links. Rule consent remains non-executable.
3. Use the separate operator command below to revoke the current membership, then select **Refresh payment accounts**. The panel hides financial details and explains the restriction. It keeps the selected workspace; it never selects another funding source to bypass the restriction.
4. Restore access using the current membership version. Refresh again. Old approvals still show `ELIGIBILITY_CHANGED`; cancel the original unspent review and explicitly create a fresh review. For a rule, explicitly revise and approve the exact policy again.
5. A captured/uncertain payment retains its original payment ID. Once access is restored, inspect/reconcile that operation. Do not make a replacement payment. Previously captured claims/proofs can still be acknowledged/released through their existing exact workload lanes; these lanes cannot admit a new capture.

Saved conversations retain their originating account and permission version. Current membership controls list/read/delete/stream access to the stored account even when a caller selects a different active workspace. A financial action from a prior permission version returns `ELIGIBILITY_CHANGED`; old history remains stored. Each delivered stream message rechecks identity and eligibility, with a bounded pending-message queue.

## Separate local operator

Upgrade an existing stack without resetting its volumes:

```bash
DELEGATION_ENABLED=false npm run demo:realm
# Reconcile the new reader/operator clients without reconfiguring existing delegation keys.
docker compose -f docker-compose.demo.yml up -d
npm run demo:wait
```

The operator is a loopback-only CLI. Its secret is never injected into the browser or application services. Obtain an existing account ID from the signed-in account selector or authenticated `/api/accounts` response. Replace `ACCOUNT` below; use the version returned by inspection and a new stable request key for each new decision.

```bash
npm run demo:payment-access -- inspect ACCOUNT
npm run demo:payment-access -- revoke-membership ACCOUNT 1 membership_revoke_001 'Demo membership restriction'
npm run demo:payment-access -- restore-membership ACCOUNT 2 membership_restore_001 'Demo membership restored'
npm run demo:payment-access -- disable-owner ACCOUNT 1 owner_disable_001 'Demo owner access disabled'
npm run demo:payment-access -- enable-owner ACCOUNT 2 owner_enable_001 'Demo owner access restored'
```

Expected version is the **owner** or **membership** version for the selected operation. Stale decisions return 409. Operator decisions atomically update the version and append immutable local before/after audit. An exact request-key replay returns the original decision, which may differ from current state; inspect again to see current eligibility. A changed body/operator/account with the same key conflicts. No monetary action is automatically retried or compensated.

`ELIGIBILITY_READER_SECRET` belongs to `provider-eligibility` with only `provider:eligibility:read`. `ELIGIBILITY_OPERATOR_SECRET` belongs to `eligibility-operator` with only `provider:eligibility:manage`. Local defaults are public synthetic fixtures. Production cannot use this CLI or these secrets. `ELIGIBILITY_ENFORCEMENT=true` is always set in reference Compose and isolated signed tests; offline fixture tests leave it off. Production API mode also requires enforcement, but the demo delegation service still refuses production activation.

## Contract and failure behavior

| Lane | Authorization and result |
| --- | --- |
| `GET /api/payments/eligibility` → `/v1/accounts/{accountId}/account-eligibility` | Signed owner; restricted accounts can read permission metadata only |
| `GET /api/payments/lifecycle` → `/v1/accounts/{accountId}/payment-lifecycle` | Current active signed owner; original orders, funding, rule references and blocked reasons |
| `GET /internal/account-eligibility/{accountId}` | Exact reader/operator client, provider audience, service identity and its dedicated role |
| `POST /internal/account-eligibility/{accountId}` | Exact operator only; `kind`, `enabled`, `expectedVersion`, `reason`, stable `Idempotency-Key`; owner derived from stored account |
| `GET /internal/account-lifecycle/{accountId}` | Exact operator only; inspect retained in-flight work while user access is restricted |

An unknown account can be initialized only through signed interactive account discovery. A reader cannot register an arbitrary user through a header. Invalid responses, reader authentication failures and an unavailable authority fail closed. OAuth workload credentials may be cached; permission decisions are not cached. No endpoint allows a browser to supply an owner override, permission epoch, signing key or management role.

Permission changes do not reverse a committed financial effect. The local gateway's atomic permission/capture fence does not claim a distributed transaction with Keycloak or another provider. Sensitive automatic execution must also satisfy PAY-08/AUTO-03/AUTO-15 reservations and admission fences; those tasks remain open. React exposes the lifecycle view; Angular/Flutter lifecycle UI parity remains QA-06.

## Verification

```bash
npm run demo:verify:payment-lifecycle
npm run record:payment-lifecycle
npm run demo:verify:automation-security
npm run demo:verify:payment-ledger
npm run demo:verify:delegation:restart
```

The lifecycle script uses real signed local Keycloak identities and isolated temporary SQLite state. Its management changes are scripted through the separate machine-authenticated lane, not browser controls. A temporary Keycloak user is created, disabled and deleted to test online invalidation; persistent demo users are never disabled. Recording holds are six seconds for review and eight seconds for restricted/restored outcomes. [Recording](../recordings/payment-lifecycle/index.html) · [Execution evidence](../reports/2026-10-24-payment-lifecycle.md).

[Business reservation evidence](payment-obligations.md) now appears in an expandable lifecycle view. It separates planned amounts and recorded capture from attempt uncertainty, and identifies overlapping legacy work without rewriting historical orders.
