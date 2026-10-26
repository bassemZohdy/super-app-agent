/** Resident intent: a payment source that fails must fail visibly and exactly (QA-05). The operator of an isolated run makes a saved card
 *  expired, disabled, declined, over its limit or unable to refund; the resident acts on the page. Beside the page the journey asserts
 *  that nothing moved: no journal entry, no wallet change, no held funds, no capture at the issuer, no fallback to another source, and
 *  that repeating the action is not a blind retry. */
import { expect, scenarioTest as test } from '../stack.ts';

test.describe.configure({ mode: 'serial' });

test('an expired or disabled card cannot fund the wallet, and nothing falls back to another source', async ({ resident, residentApi, stack, scenario }) => {
  const { accountId, call } = residentApi, db = stack.payments.db;
  const journal = () => (db.prepare("SELECT count(*) AS n FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING'").get(accountId) as { n: number }).n;
  const issuerRows = (methodId: string) => (db.prepare('SELECT count(*) AS n FROM payment_card_authorizations WHERE account_id=? AND source_id=?').get(accountId, methodId) as { n: number }).n;
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const start = (await call('overview')).data;
  expect(start.fundingOrders).toHaveLength(0);

  for (const preset of ['expired', 'disabled'] as const) {
    const method = (await call('methods', { preset: 'approved', nickname: `Scenario ${preset}` })).data.method as { id: string; version: number };
    const input = { accountId, methodId: method.id, expectedMethodVersion: method.version, expectedRevision: 0, preset, requestKey: crypto.randomUUID() };
    const configured = await scenario.admin('/configuration', input);
    expect(configured.status, `the operator makes the card ${preset}`).toBe(200);
    expect((await scenario.admin('/configuration', input, residentApi.token)).status, 'the resident cannot choose the outcome').toBe(403);
    const version = configured.data.method.version as number;

    const refused = await call('wallet-funding-orders', { amountMinor: 5000, methodId: method.id, expectedMethodVersion: version });
    expect(refused.status, `a ${preset} card cannot start a top-up`).toBe(409);
    await resident.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();
    await panel.getByRole('region', { name: 'Saved funding methods', exact: true }).getByText(`Scenario ${preset} ·•••• 4242`, { exact: true }).waitFor();

    expect((await call('overview')).data.wallet.balanceMinor, 'the wallet is unchanged').toBe(150000);
    expect(journal(), 'nothing was written to the journal').toBe(0);
    expect(issuerRows(method.id), 'the issuer never saw an authorization').toBe(0);
    expect((await call('overview')).data.fundingOrders, 'no order was created, and none against another source').toHaveLength(0);
    expect(stack.payments.db.prepare("SELECT count(*) AS n FROM payment_wallet_holds WHERE account_id=?").get(accountId)).toEqual({ n: 0 });
  }
});

test('a declined card and a card over its limit fail with an exact reason, move nothing and are not retried blindly', async ({ resident, residentApi, stack, scenario }) => {
  const { accountId, call } = residentApi, db = stack.payments.db;
  const journal = () => (db.prepare("SELECT count(*) AS n FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING'").get(accountId) as { n: number }).n;
  const issuer = (orderId: string) => db.prepare('SELECT order_id, source_id, state, body FROM payment_card_authorizations WHERE account_id=? AND order_id=?').all(accountId, orderId) as Array<{ order_id: string; source_id: string; state: string; body: string }>;
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();

  for (const [preset, code] of [['declined', 'CARD_DECLINED'], ['limit', 'CARD_LIMIT_EXCEEDED']] as const) {
    const method = (await call('methods', { preset: 'approved', nickname: `Scenario ${preset}` })).data.method as { id: string; version: number };
    const configured = await scenario.admin('/configuration', { accountId, methodId: method.id, expectedMethodVersion: method.version, expectedRevision: 0, preset, requestKey: crypto.randomUUID() });
    expect(configured.status).toBe(200);
    const created = await call('wallet-funding-orders', { amountMinor: 5000, methodId: method.id, expectedMethodVersion: configured.data.method.version });
    expect(created.status).toBe(200);
    const order = created.data.order as { id: string; version: number; approvalDigest: string };
    await resident.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();
    const article = panel.getByRole('article', { name: `Wallet funding review ${order.id}`, exact: true });
    await article.waitFor();
    const response = resident.waitForResponse(r => new URL(r.url()).pathname === '/api/payments/wallet-funding-orders/approve' && r.request().method() === 'POST');
    await article.getByRole('button', { name: 'Authorize wallet top-up of AED 50.00', exact: true }).click();
    const failed = (await (await response).json()).order as { state: string; failureCode: string };
    expect([failed.state, failed.failureCode], `${preset} is a persistent, exact denial`).toEqual(['FAILED', code]);

    expect((await call('overview')).data.wallet.balanceMinor, 'no credit').toBe(150000);
    expect(journal(), 'no journal entry').toBe(0);
    expect((await call('overview')).data.cardBalances.find((b: { sourceId: string }) => b.sourceId === method.id), 'nothing captured or held on the card').toMatchObject({ spentMinor: 0, heldMinor: 0 });
    // The issuer's own record: one declined attempt for this order, with the reason and the operator's preset, and no capture anywhere.
    const rows = issuer(order.id);
    expect(rows, 'exactly one issuer attempt').toHaveLength(1);
    expect([rows[0].source_id, rows[0].state]).toEqual([method.id, 'DECLINED']);
    expect(JSON.parse(rows[0].body)).toMatchObject({ amountMinor: 5000, state: 'DECLINED', failureCode: code, scenario: { runId: scenario.runId, preset } });
    expect((db.prepare("SELECT count(*) AS n FROM payment_card_authorizations WHERE account_id=? AND state='CAPTURED'").get(accountId) as { n: number }).n, 'nothing was captured').toBe(0);

    // Not a blind retry: the same approval again gives the same answer and no second attempt, and a failed order cannot be executed.
    const replay = await call('wallet-funding-orders/approve', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest });
    expect([200, 409], 'the replay is answered, not run again').toContain(replay.status);
    expect(issuer(order.id), 'still one issuer attempt after the replay').toHaveLength(1);
    expect((await call('wallet-funding-orders/execute', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest })).status, 'a failed order is not executable').toBeGreaterThanOrEqual(400);
    expect(journal()).toBe(0);
    expect((await call('overview')).data.wallet.balanceMinor).toBe(150000);
  }
});

test('a refund the issuer declines fails visibly, restores nothing and is not retried blindly', async ({ resident, residentApi, stack, scenario }) => {
  const { accountId, call } = residentApi, db = stack.payments.db;
  type Entry = { kind: string; reference: string; wallet_delta: number; finalized: number };
  const journal = () => db.prepare("SELECT kind, reference, wallet_delta, finalized FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING' ORDER BY rowid").all(accountId) as Entry[];
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');

  // A card whose refunds the issuer will decline, funded for real first so there is something to refund.
  const method = (await call('methods', { preset: 'approved', nickname: 'Scenario refund-failure' })).data.method as { id: string; version: number };
  const configured = await scenario.admin('/configuration', { accountId, methodId: method.id, expectedMethodVersion: method.version, expectedRevision: 0, preset: 'refund-failure', requestKey: crypto.randomUUID() });
  expect(configured.status).toBe(200);
  let order = (await call('wallet-funding-orders', { amountMinor: 5000, methodId: method.id, expectedMethodVersion: configured.data.method.version })).data.order as { id: string; version: number; approvalDigest: string; state: string };
  await resident.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();
  const article = panel.getByRole('article', { name: `Wallet funding review ${order.id}`, exact: true });
  let response = responseFor('wallet-funding-orders/approve');
  await article.getByRole('button', { name: 'Authorize wallet top-up of AED 50.00', exact: true }).click();
  order = (await (await response).json()).order;
  response = responseFor('wallet-funding-orders/execute');
  await article.getByRole('button', { name: 'Add AED 50.00 to wallet', exact: true }).click();
  order = (await (await response).json()).order;
  expect(order.state).toBe('SETTLED');
  expect((await call('overview')).data.wallet.balanceMinor).toBe(155000);
  const afterFunding = journal();
  expect(afterFunding.map(e => [e.kind, e.wallet_delta, e.finalized])).toEqual([['TOPUP', 5000, 1]]);

  // The refund the issuer declines.
  const review = await call('refunds', { origin: 'WALLET_FUNDING', orderId: order.id, expectedVersion: order.version, amountMinor: 5000, reason: 'Configured issuer refund failure' });
  expect(review.status).toBe(200);
  const refund = review.data.refund as { id: string; version: number; approvalDigest: string };
  await resident.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();
  const card = panel.getByRole('article', { name: `Refund review ${refund.id}`, exact: true });
  response = responseFor('refunds/execute');
  await card.getByRole('button', { name: 'Approve refund of AED 50.00', exact: true }).click();
  const failed = (await (await response).json()).refund as { state: string; failureCode: string };
  expect([failed.state, failed.failureCode]).toEqual(['FAILED', 'ISSUER_REFUND_DECLINED']);
  await card.getByText(/Refund state: FAILED/).waitFor();

  // Nothing was restored or recorded as refunded: the wallet and journal are as they were, the refund is FAILED, the card shows no refund.
  expect(await call('overview').then(r => r.data.wallet), 'the wallet keeps the credit it got').toEqual({ balanceMinor: 155000, heldMinor: 0, availableMinor: 155000, currency: 'AED' });
  expect(journal(), 'no REFUND entry was written').toEqual(afterFunding);
  expect(db.prepare('SELECT id, state, origin FROM payment_refunds WHERE account_id=?').all(accountId)).toEqual([{ id: refund.id, state: 'FAILED', origin: 'WALLET_FUNDING' }]);
  expect(db.prepare('SELECT count(*) AS n FROM payment_card_refunds WHERE account_id=?').get(accountId), 'the issuer recorded no refund').toEqual({ n: 0 });
  expect((await call('overview')).data.cardBalances.find((b: { sourceId: string }) => b.sourceId === method.id)).toMatchObject({ refundedMinor: 0, spentMinor: 5000, heldMinor: 0 });

  // Not a blind retry: executing the same refund again, or recovering it, reports the same failure and changes nothing.
  const again = await call('refunds/execute', { orderId: refund.id, expectedVersion: refund.version, approvalDigest: refund.approvalDigest });
  expect([200, 409]).toContain(again.status);
  if (again.status === 200) expect(again.data.refund.state).toBe('FAILED');
  expect((await call('refunds/recover', { orderId: refund.id })).data.refund.state).toBe('FAILED');
  expect(journal()).toEqual(afterFunding);
  expect(db.prepare('SELECT count(*) AS n FROM payment_card_refunds WHERE account_id=?').get(accountId)).toEqual({ n: 0 });
  expect((await call('overview')).data.wallet.balanceMinor).toBe(155000);

  // A reload shows the same failure and the same money.
  await resident.reload();
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1550.00', { exact: true }).waitFor();
  expect(journal()).toEqual(afterFunding);
});
