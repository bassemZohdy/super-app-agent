# Grouped checkout

PAY-16 adds an owned, durable group of one to ten child payment orders using one explicitly selected wallet or saved card. Each provider settles separately. A later failure preserves earlier receipts; unknown work blocks later lines until the original payment is inspected. No split tender, source fallback or cross-provider atomic settlement is implied.

## Use the React demo

1. Open **Payment accounts**, link the billers and save a synthetic card if desired.
2. Under **Pay several items**, choose current linked bills/fines and one funding source. A current recharge preview also becomes available for grouping.
3. **Save group for review** freezes the source/version, each quote, child order identity and combined total. No money moves.
4. Read every line and **Approve group**. Approval alone moves no funds. **Continue grouped payment** authorizes and pays sequentially, stopping before later lines on decline, challenge, changed terms or an uncertain outcome.
5. Answer each card challenge in the named child authorization review, then continue the group. Each challenge remains bound to its own amount/source/order. A challenge is never answered automatically.
6. Inspect confirmed receipts and the confirmed subtotal. Refresh/reload retains the group. Continuing a group skips settled children and recovers any original capture before paying later lines.

**Stop remaining group payments** fences new dispatch and cancels not-started child reviews. It does not undo a confirmed payment. Existing captures keep their original child recovery controls; a definitive failed child requires a fresh review of the unpaid obligations rather than a new charge against the old identity.

## APIs and persistence

Payment contract **1.9.0**, payment-provider OpenAPI **2.12.0**. Provider paths are relative to `/v1/accounts/{accountId}` and require the interactive owner token. Machine and delegated tokens cannot use group routes. POST requires `Idempotency-Key`.

| Provider route | Request / behavior |
| --- | --- |
| `GET /checkout-groups` | Owned groups with current child states/receipts |
| `GET /checkout-groups/{id}` | Authoritative read after a lost response |
| `POST /checkout-groups` | `items: [{provider, payableId, expectedPayableRevision}]`, `methodId`, `expectedMethodVersion` |
| `POST /checkout-groups/{id}/approve` | `expectedVersion`, `approvalDigest`; exact group consent |
| `POST /checkout-groups/{id}/execute` | Same decision shape; sequential authorize/capture/recover |
| `POST /checkout-groups/{id}/cancel` | `expectedVersion`; stop remaining dispatch |

Core POST routes are `/api/payments/checkout-groups` and `/api/payments/checkout-groups/{approve,execute,cancel}`. Include `accountId`, a fresh explicit-action `requestKey`, and `orderId` for actions (this is the group ID). `GET /api/payments/overview` includes `checkoutGroups`.

A repeated POST key returns its stored response snapshot. Read current status from GET/overview; a new explicit continue action uses a new key and the same group/child identities. Source prices, receipts, children, per-line methods and overrides cannot be supplied in the group request. Source reads happen before the atomic local group/child creation transaction. Current ownership, biller/source versions, holds, admission and capture rules still revalidate independently at the effect boundary.

Already-paid source records are excluded and labelled without another child/debit; an entirely paid selection returns `CHECKOUT_EMPTY`. Duplicate or overlapping obligations (including a fine both individually and in a selection), stale revisions, unlinked billers and invalid combined totals deny creation atomically. All children use the selected source snapshot. The current demo retains its 100-child review history limit and ten-line group cap; pagination remains PAY-20.

`payment_checkout_groups` is additive metadata with immutable child references/digest, source snapshot, approval/cancellation and redacted last failure code. Existing journals, orders, receipts and balances are preserved. Group status and confirmed subtotal derive from authoritative child orders; the metadata cannot assert settlement. Source network calls occur between committed transitions. Existing version/hold/admission guards prevent concurrent executions from duplicating a child capture. A cancelled group cannot authorize a child after an awaited preflight returns. Capture-started children reconcile separately.

## Existing unified action

`POST /pay/unified` and its alias keep the civic DEWA/fines/AED 100 Salik composition and existing response fields. They now persist one plan and checkout group under the original owner/account/request identity before any payment dispatch. A retry resumes original children and the original recharge intent after settlement changes source balances. Changed body terms under that identity conflict. Successful responses include the group and per-line confirmed receipts; stopped outcomes include the group/earlier receipts without a success receipt.

The compatibility call defaults to the wallet. Optional `methodId` and `expectedMethodVersion` select one saved source for every child and must be supplied together. Legacy caller `items` amounts remain informational: current providers determine payable totals. The full conversation-selected funding review is still PAY-07; automation gets no authority from this compatibility adapter.

## Verification and limits

```sh
node --experimental-strip-types --import ./scripts/test-env.ts --test services/test/checkout-groups.test.ts services/test/checkout-group-application.test.ts
npm run demo:verify:checkout-groups
npm run record:checkout-groups
```

The browser harness uses real local Keycloak/Redis, temporary provider/application SQLite and disabled model inference. The recording holds reviews/challenges six seconds and outcomes eight seconds; it publishes only after all assertions pass. [Recording](../recordings/checkout-groups/index.html) · [Evidence](../reports/2026-10-24-checkout-groups.md).

A consolidated reconciliation workbench, paginated statements, automatic rules and Angular/Flutter group parity retain their separate backlog tasks. No payment provider or identity feature is enabled beyond the existing supported demo profile.

[Original-source refunds](payment-refunds.md) now cancel eligible full bills/fine sets or reverse bounded unused recharge/funding value. Confirmed returns annotate original receipts and group children; uncertain reversals keep their original ID and do not restore funds.

[Signed financial status events](payment-events.md) append with stored order/source transitions and arrive as owned inspection hints. Callbacks never authorize funds or replace authoritative provider lookup. SIM-03 now supplies named issuer scenarios; legacy event-path qualification keeps PAY-18 in progress.

[Isolated issuer scenarios](issuer-scenarios.md) add operator-bound named outcomes and `AUTHORIZATION_PENDING`. Pending card capacity cannot capture/credit or dispatch later group lines; the original real-time deadline and separate customer execution remain enforced. Normal providers expose no run controls.
