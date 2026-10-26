/** Resident intent: a payment that the world has moved out from under must stop, say why, and leave everything as it was (QA-05).
 *  A bill changes after the review, the wallet no longer covers the amount, or a challenge is left unanswered until it expires.
 *  Each journey asserts the stored effects: no hold, no debit, no issuer capture, no fallback to another source, and no blind retry. */
import { PaymentLedger } from '../../../services/provider-simulator/src/payment-ledger.ts';
import { expect, scenarioTest as test } from '../stack.ts';

const journalOf = (db: import('node:sqlite').DatabaseSync, accountId: string) => db.prepare("SELECT kind, wallet_delta FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING' ORDER BY rowid").all(accountId).map(row => ({ ...row })) as Array<{ kind: string; wallet_delta: number }>;
const holdsOf = (db: import('node:sqlite').DatabaseSync, accountId: string) => db.prepare('SELECT reference, amount_minor, status FROM payment_wallet_holds WHERE account_id=?').all(accountId).map(row => ({ ...row }));

test('a bill that changes after the review cannot be approved on the old price, and a new review is the way forward', async ({ resident, residentApi, stack }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db, dewa = stack.stores.get('dewa')!.db;
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const linked = resident.waitForResponse(r => new URL(r.url()).pathname === '/api/payments/billing-accounts' && r.request().method() === 'POST');
  await panel.getByRole('button', { name: /^Link DEWA/ }).click();
  await linked;
  const bill = (await call('overview')).data.payables.find((p: { provider: string; status: string }) => p.provider === 'dewa' && p.status === 'UNPAID');
  const order = (await call('orders', { provider: 'dewa', payableId: bill.id, expectedPayableRevision: bill.revision, methodId: 'wallet', expectedMethodVersion: 1 })).data.order as { id: string; version: number; approvalDigest: string };

  // The utility revises the bill after the resident reviewed it.
  const book = stack.payableBook('dewa');
  book.amend(accountId, bill.id, book.get(accountId, bill.id).revision, { amountMinor: 45000 });

  await resident.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();
  const article = panel.getByRole('article', { name: `Authorization review ${order.id}`, exact: true });
  await article.waitFor();
  const response = resident.waitForResponse(r => new URL(r.url()).pathname === '/api/payments/orders/approve' && r.request().method() === 'POST');
  await article.getByRole('button', { name: 'Approve authorization for AED 420.40', exact: true }).click();
  const answer = await response;
  expect([answer.status(), (await answer.json()).code], 'the stale approval is refused with a reason').toEqual([409, 'PAYABLE_CHANGED']);
  await resident.getByText(/The current obligation changed or is unavailable\. Review it again\./).first().waitFor();

  // Nothing moved, and the order is exactly where it was.
  expect(journalOf(payments, accountId)).toEqual([]);
  expect(holdsOf(payments, accountId), 'no funds were held at the old price').toEqual([]);
  expect((await call('overview')).data.wallet).toEqual({ balanceMinor: 150000, heldMinor: 0, availableMinor: 150000, currency: 'AED' });
  expect((await call('overview')).data.orders.find((o: { id: string }) => o.id === order.id).state, 'the order still awaits approval and was not approved or failed').toBe('AWAITING_APPROVAL');
  const stored = dewa.prepare("SELECT body FROM resources WHERE account_id=? AND kind='bill'").all(accountId).map(row => JSON.parse(String((row as { body: string }).body)) as { billId: string; status: string; totalAmount: number }).filter(b => b.billId.startsWith('DEWA-'));
  expect(stored.map(b => [b.status, b.totalAmount]), "the utility's bill is unpaid at its new price").toEqual([['UNPAID', 450]]);

  // Not a blind retry: replaying the same approval is refused the same way, and a fresh review at the new price is the way forward.
  const replay = await call('orders/approve', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest });
  expect([replay.status, replay.data.code]).toEqual([409, 'PAYABLE_CHANGED']);
  expect(holdsOf(payments, accountId)).toEqual([]);
  const fresh = (await call('overview')).data.payables.find((p: { id: string }) => p.id === bill.id);
  const newReview = () => call('orders', { provider: 'dewa', payableId: fresh.id, expectedPayableRevision: fresh.revision, methodId: 'wallet', expectedMethodVersion: 1 });
  expect((await newReview()).status, 'a second review while the stale one is open is refused').toBe(409);
  const cancelled = resident.waitForResponse(r => new URL(r.url()).pathname === '/api/payments/orders/cancel' && r.request().method() === 'POST');
  await article.getByRole('button', { name: 'Cancel authorization review', exact: true }).click();
  expect((await cancelled).status(), 'the resident cancels the stale review on the page').toBe(200);
  expect(holdsOf(payments, accountId)).toEqual([]);
  const second = await newReview();
  expect([second.status, second.data.order.quote.totalMinor], 'a new review quotes the new price').toEqual([200, 45000]);
  expect(journalOf(payments, accountId), 'still nothing in the journal').toEqual([]);
  expect((await call('overview')).data.wallet.balanceMinor).toBe(150000);
});

test('a wallet that no longer covers the amount fails the payment with no hold, no debit and no fallback to another source', async ({ resident, residentApi, stack }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db;
  const issuerRows = () => (payments.prepare('SELECT count(*) AS n FROM payment_card_authorizations WHERE account_id=?').get(accountId) as { n: number }).n;
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  // A card with plenty of room exists, so a fallback would be possible if the product were willing to do one.
  await panel.getByRole('textbox', { name: 'Card nickname', exact: true }).fill('Spare card');
  let response = responseFor('methods');
  await panel.getByRole('button', { name: 'Add demo card', exact: true }).click();
  await response;
  response = responseFor('billing-accounts');
  await panel.getByRole('button', { name: /^Link Traffic fines/ }).click();
  await response;
  // Draw the wallet down with a real journal entry, leaving less than the fines.
  new PaymentLedger(stack.payments).record(accountId, 'PAYMENT', 'test-draw-down', 145000, 'wallet');
  expect((await call('overview')).data.wallet.balanceMinor).toBe(5000);
  const drawDown = journalOf(payments, accountId);
  expect(drawDown).toEqual([{ kind: 'PAYMENT', wallet_delta: -145000 }]);

  const unpaid = ((await call('overview')).data.payables as Array<{ id: string; obligationId: string; kind: string; status: string }>).filter(p => p.kind === 'FINE' && p.status === 'UNPAID');
  const group = panel.getByRole('group', { name: 'Select traffic fines to pay together', exact: true });
  for (const fine of unpaid) await group.getByRole('checkbox', { name: new RegExp(fine.obligationId) }).check();
  await panel.getByRole('combobox', { name: 'Payment source', exact: true }).selectOption('wallet');
  response = responseFor('fine-selection-preview');
  await group.getByRole('button', { name: 'Review selected fines', exact: true }).click();
  await response;
  response = responseFor('orders');
  await panel.getByRole('button', { name: 'Create authorization review', exact: true }).click();
  const created = await response;
  expect(created.status(), 'a review is only a quote; it reserves nothing').toBe(200);
  const order = (await created.json()).order as { id: string; version: number; approvalDigest: string };
  expect(holdsOf(payments, accountId)).toEqual([]);

  const article = panel.getByRole('article', { name: `Authorization review ${order.id}`, exact: true });
  response = responseFor('orders/approve');
  await article.getByRole('button', { name: 'Approve authorization for AED 420.00', exact: true }).click();
  const failed = (await (await response).json()).order as { state: string; failureCode: string };
  expect([failed.state, failed.failureCode], 'the approval fails with the exact reason').toEqual(['FAILED', 'INSUFFICIENT_AVAILABLE_FUNDS']);
  await article.getByText('State: FAILED · INSUFFICIENT_AVAILABLE_FUNDS', { exact: true }).waitFor();

  // Nothing was held or debited, and the spare card was never used: the payment does not quietly change its source.
  expect(holdsOf(payments, accountId)).toEqual([]);
  expect(journalOf(payments, accountId), 'no entry beyond the draw-down').toEqual(drawDown);
  expect((await call('overview')).data.wallet).toEqual({ balanceMinor: 5000, heldMinor: 0, availableMinor: 5000, currency: 'AED' });
  expect(issuerRows(), 'no issuer authorization: no fallback to the card').toBe(0);
  expect((await call('overview')).data.orders.filter((o: { id: string }) => o.id !== order.id), 'no other order was created').toEqual([]);

  // Not a blind retry: the same approval again, or paying the failed order, leaves everything as it is.
  const replay = await call('orders/approve', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest });
  expect([200, 409]).toContain(replay.status);
  expect((await call('orders/execute', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest })).status, 'a failed order is not payable').toBeGreaterThanOrEqual(400);
  expect(holdsOf(payments, accountId)).toEqual([]);
  expect(journalOf(payments, accountId)).toEqual(drawDown);
  expect(issuerRows()).toBe(0);
});

test('a challenge nobody answers in time is refused, and the order moves nothing', async ({ resident, residentApi, stack, scenario }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db;
  const issuer = (orderId: string) => payments.prepare('SELECT state, body FROM payment_card_authorizations WHERE account_id=? AND order_id=?').all(accountId, orderId).map(row => ({ state: (row as { state: string }).state, body: JSON.parse(String((row as { body: string }).body)) as { expiresAt: string; challengeId: string } }));
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  // In an isolated run the operator, not the resident, gives a card its challenge.
  const method = (await call('methods', { preset: 'approved', nickname: 'Unattended challenge card' })).data.method as { id: string; version: number };
  const configured = await scenario.admin('/configuration', { accountId, methodId: method.id, expectedMethodVersion: method.version, expectedRevision: 0, preset: 'challenge', requestKey: crypto.randomUUID() });
  expect(configured.status, 'the operator gives the card its challenge').toBe(200);
  await resident.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();
  const funding = panel.getByRole('region', { name: 'Add wallet funds', exact: true });
  await funding.getByRole('spinbutton', { name: 'Wallet top-up amount (AED)', exact: true }).fill('50.00');
  await funding.getByRole('combobox', { name: 'Wallet top-up card', exact: true }).selectOption(method.id);
  let response = responseFor('wallet-funding-orders');
  await funding.getByRole('button', { name: 'Review wallet top-up', exact: true }).click();
  const order = (await (await response).json()).order as { id: string; version: number; approvalDigest: string };
  const article = funding.getByRole('article', { name: `Wallet funding review ${order.id}`, exact: true });
  response = responseFor('wallet-funding-orders/approve');
  await article.getByRole('button', { name: 'Authorize wallet top-up of AED 50.00', exact: true }).click();
  await response;
  await article.getByText('State: REQUIRES_ACTION', { exact: true }).waitFor();
  const waiting = issuer(order.id);
  expect(waiting.map(row => row.state), 'the issuer is waiting for the resident').toEqual(['REQUIRES_ACTION']);

  // An hour passes with no answer; the resident then tries to approve the challenge.
  scenario.clock.advance(60 * 60_000);
  expect(scenario.clock.now(), 'the authorization is now past its expiry').toBeGreaterThan(Date.parse(waiting[0].body.expiresAt));
  response = responseFor('wallet-funding-orders/challenge');
  await article.getByRole('button', { name: 'Approve wallet top-up challenge', exact: true }).click();
  const late = await response;
  expect([late.status(), (await late.json()).code], 'a late answer is refused with a reason').toEqual([409, 'APPROVAL_CHANGED']);
  expect(issuer(order.id), 'the first late answer leaves the issuer record as it was').toEqual(waiting);

  // Nothing moved: no journal entry, no capture, the same wallet.
  expect(journalOf(payments, accountId)).toEqual([]);
  expect((await payments.prepare("SELECT count(*) AS n FROM payment_card_authorizations WHERE account_id=? AND state='CAPTURED'").get(accountId) as { n: number }).n).toBe(0);
  expect((await call('overview')).data.wallet).toEqual({ balanceMinor: 150000, heldMinor: 0, availableMinor: 150000, currency: 'AED' });
  expect((await call('overview')).data.cardBalances.find((b: { sourceId: string }) => b.sourceId === method.id)).toMatchObject({ spentMinor: 0, heldMinor: 0 });

  // The next attempt is refused the same way and records the expiry: the same authorization, expired, never approved or captured.
  const again = await call('wallet-funding-orders/challenge', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest, challengeId: waiting[0].body.challengeId, decision: 'APPROVE' });
  expect([again.status, again.data.code]).toEqual([409, 'APPROVAL_CHANGED']);
  const expired = issuer(order.id);
  expect(expired.map(row => row.state)).toEqual(['EXPIRED']);
  expect(expired[0].body).toMatchObject({ challengeId: waiting[0].body.challengeId, failureCode: 'AUTHORIZATION_EXPIRED' });
  const exec = await call('wallet-funding-orders/execute', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest });
  expect(exec.status, 'the top-up cannot be executed').toBe(409);
  expect(issuer(order.id)).toEqual(expired);
  expect(journalOf(payments, accountId)).toEqual([]);
  expect((await call('overview')).data.fundingOrders.map((o: { id: string; state: string; failureCode?: string }) => [o.id, o.state, o.failureCode]), 'the order itself is failed, with the reason').toEqual([[order.id, 'FAILED', 'AUTHORIZATION_EXPIRED']]);
  expect((await call('overview')).data.wallet.balanceMinor).toBe(150000);
});
