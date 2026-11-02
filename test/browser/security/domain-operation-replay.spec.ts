import { expect, isolatedTest as test } from '../stack.ts';
import { providerOperationKey, walletChargeKey } from '../../../packages/backend-kit/src/provider-client.ts';
import { AccountDatabase } from '../../../services/provider-simulator/src/database.ts';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

test('wallet operation identity survives different trace IDs and rejects changed terms', async ({ residentApi, stack }) => {
  const wallet = () => residentApi.call('overview').then(result => result.data.wallet.balanceMinor as number);
  const before = await wallet();
  const charges = () => stack.stores.get('payments')!.list(residentApi.accountId, 'charge') as Array<{ id: string }>;
  const previousCharges = charges().length;
  const operation = '11111111-1111-4111-8111-111111111111:replay_test';
  const request = async (trace: string, amount: number) => {
    const response = await fetch(`http://localhost:${stack.corePort + 3}/wallet/pay`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': residentApi.accountId, 'X-Request-Id': trace, 'X-Operation-Id': operation },
      body: JSON.stringify({ amount, purpose: 'Replay test' }),
    });
    return { status: response.status, data: await response.json() as { charge?: { id: string }; code?: string } };
  };
  const first = await request('trace-first', 1), second = await request('trace-second', 1);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.data.charge?.id).toEqual(expect.any(String));
  expect(second.data.charge?.id).toBe(first.data.charge?.id);
  expect(charges()).toHaveLength(previousCharges + 1);
  expect(await wallet()).toBe(before - 100);
  const inspect = async (identity: string, accountId = residentApi.accountId) => fetch(`http://localhost:${stack.corePort + 3}/wallet/operations/${encodeURIComponent(identity)}`, { headers: { Authorization: `Bearer ${residentApi.token}`, 'X-Account-Id': accountId } });
  const found = await inspect(operation);
  expect(found.status).toBe(200);
  expect(((await found.json()) as { charge: { id: string } }).charge.id).toBe(first.data.charge?.id);
  expect((await inspect('missing-operation')).status).toBe(404);
  expect((await inspect('../invalid')).status).toBe(400);
  const store = stack.stores.get('payments')!, chargeId = first.data.charge!.id;
  const journal = () => store.db.prepare('SELECT * FROM payment_journal_entries WHERE account_id=? ORDER BY id').all(residentApi.accountId);
  const journalBefore = journal();
  const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
  const other = store.accounts(claims.sub).find(account => account.id !== residentApi.accountId);
  expect(other).toBeTruthy();
  const otherJournalBefore = store.db.prepare('SELECT * FROM payment_journal_entries WHERE account_id=?').all(other!.id);
  expect((await inspect(operation, other!.id)).status).toBe(404);
  expect(store.db.prepare('SELECT * FROM payment_journal_entries WHERE account_id=?').all(other!.id)).toEqual(otherJournalBefore);
  const saved = store.get<Record<string, unknown>>(residentApi.accountId, 'charge', chargeId)!;
  store.put(residentApi.accountId, 'charge', { ...saved, amountMinor: 999 }, chargeId);
  expect((await inspect(operation)).status).toBe(503);
  expect((await request('trace-changed-charge', 1)).status).toBe(503);
  store.put(residentApi.accountId, 'charge', saved, chargeId);
  const transaction = store.get<Record<string, unknown>>(residentApi.accountId, 'transaction', chargeId)!;
  store.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='transaction' AND id=?").run(residentApi.accountId, chargeId);
  expect((await inspect(operation)).status).toBe(503);
  expect((await request('trace-missing-transaction', 1)).status).toBe(503);
  store.put(residentApi.accountId, 'transaction', transaction, chargeId);
  const key = walletChargeKey(residentApi.accountId, 'superapp', operation);
  const record = store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(residentApi.accountId, key) as { fingerprint: string; status: number; body: string };
  store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run('{', residentApi.accountId, key);
  expect((await inspect(operation)).status).toBe(503);
  store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run(record.body, residentApi.accountId, key);
  store.db.prepare('DELETE FROM idempotency WHERE account_id=? AND key=?').run(residentApi.accountId, key);
  try {
    expect((await inspect(operation)).status).toBe(503);
    expect((await request('trace-missing-replay', 1)).status).toBe(503);
    const competing = await Promise.all([request('trace-missing-replay-race-one', 1), request('trace-missing-replay-race-two', 1)]);
    expect(competing.map(result => result.status)).toEqual([503, 503]);
    expect(charges()).toHaveLength(previousCharges + 1);
    expect(await wallet()).toBe(before - 100);
    const otherAccountPayment = await fetch(`http://localhost:${stack.corePort + 3}/wallet/pay`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': other!.id, 'X-Operation-Id': operation }, body: JSON.stringify({ amount: 1, purpose: 'Independent account' }),
    });
    expect(otherAccountPayment.status).toBe(200);
    store.db.prepare("UPDATE resources SET body='{' WHERE account_id=? AND kind='charge' AND id=?").run(residentApi.accountId, chargeId);
    expect((await request('trace-unreadable-charge', 1)).status).toBe(503);
    store.put(residentApi.accountId, 'charge', saved, chargeId);
    store.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='charge' AND id=?").run(residentApi.accountId, chargeId);
    expect((await inspect(operation)).status).toBe(503);
    expect((await request('trace-missing-charge-and-replay', 1)).status).toBe(503);
    store.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='transaction' AND id=?").run(residentApi.accountId, chargeId);
    expect((await inspect(operation)).status).toBe(503);
    expect((await request('trace-orphaned-journal', 1)).status).toBe(503);
    expect(store.get<{ balanceMinor: number }>(residentApi.accountId, 'wallet')!.balanceMinor).toBe(before - 100);
  } finally {
    store.put(residentApi.accountId, 'charge', saved, chargeId);
    store.put(residentApi.accountId, 'transaction', transaction, chargeId);
    store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)').run(residentApi.accountId, key, record.fingerprint, record.status, record.body);
  }
  expect((await request('trace-restored', 1)).data.charge?.id).toBe(chargeId);
  const noJournalId = '00000000-0000-4000-8000-000000000000';
  const fakeCharge = { ...saved, id: noJournalId }, fakeTransaction = { ...transaction, id: noJournalId };
  store.put(residentApi.accountId, 'charge', fakeCharge, noJournalId);
  store.put(residentApi.accountId, 'transaction', fakeTransaction, noJournalId);
  store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run(JSON.stringify({ success: true, charge: fakeCharge, transaction: fakeTransaction }), residentApi.accountId, key);
  expect((await inspect(operation)).status).toBe(503);
  expect((await request('trace-missing-journal', 1)).status).toBe(503);
  store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run(record.body, residentApi.accountId, key);
  store.db.prepare("DELETE FROM resources WHERE account_id=? AND id=? AND kind IN ('charge','transaction')").run(residentApi.accountId, noJournalId);
  expect(journal()).toEqual(journalBefore);
  expect(await wallet()).toBe(before - 100);
  const changed = await request('trace-third', 2);
  expect(changed.status).toBe(503);
  expect(changed.data.code).toBe('PROVIDER_OUTCOME_UNKNOWN');
  expect(await wallet()).toBe(before - 100);
  expect(charges()).toHaveLength(previousCharges + 1);
});

test('wallet panel explains unreadable account-wide payment evidence', async ({ resident, residentApi, stack }) => {
  const account = residentApi.accountId, store = stack.stores.get('payments')!;
  const response = await fetch(`http://localhost:${stack.corePort + 3}/wallet/pay`, {
    method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': account, 'X-Operation-Id': 'panel-review-operation' },
    body: JSON.stringify({ amount: 1, purpose: 'Review status test' }),
  });
  expect(response.status).toBe(200);
  const result = await response.json() as { charge: { id: string } }, id = result.charge.id;
  const transaction = store.get<Record<string, unknown>>(account, 'transaction', id)!;
  const charge = store.get<Record<string, unknown>>(account, 'charge', id)!;
  expect((await residentApi.call('overview')).data.wallet.walletPaymentReview).toBe('NOT_DETECTED');
  store.db.prepare("UPDATE resources SET body='{' WHERE account_id=? AND kind='transaction' AND id=?").run(account, id);
  try {
    const wallet = (await residentApi.call('overview')).data.wallet;
    expect(wallet.legacyPaymentReview).toBe('NOT_DETECTED');
    expect(wallet.walletPaymentReview).toBe('REQUIRED');
    await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
    const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
    await expect(panel.getByText('Some wallet payment records need review before new concierge wallet payments. Review your payment history; there is no automatic clearance.', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Load recovery cases', exact: true }).click();
    const issues = panel.getByRole('region', { name: 'Records needing manual review', exact: true });
    await expect(issues.getByText(`Unreadable transaction record · ${id}`, { exact: true })).toBeVisible();
    store.db.prepare("UPDATE resources SET body='{' WHERE account_id=? AND kind='charge' AND id=?").run(account, id);
    await panel.getByRole('button', { name: 'Load recovery cases', exact: true }).click();
    await expect(issues.getByText(`Unreadable payment record · ${id}`, { exact: true })).toBeVisible();
    for (let n = 0; n < 27; n++) store.db.prepare("INSERT INTO resources(account_id,kind,id,body) VALUES(?,'transaction',?,'{')").run(account, `paging-evidence-${n}`);
    await panel.getByRole('button', { name: 'Load recovery cases', exact: true }).click();
    await issues.getByRole('button', { name: 'Load more records needing review', exact: true }).click();
    await expect(issues.getByText('Unreadable transaction record · paging-evidence-26', { exact: true })).toBeVisible();
    await expect(issues.getByRole('button', { name: 'Load more records needing review', exact: true })).toHaveCount(0);
  } finally {
    store.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='transaction' AND id GLOB 'paging-evidence-*'").run(account);
    store.put(account, 'charge', charge, id); store.put(account, 'transaction', transaction, id);
  }
  expect((await residentApi.call('overview')).data.wallet.walletPaymentReview).toBe('NOT_DETECTED');
});

test('wallet operation identity is independent of an external payment reference', async ({ residentApi, stack }) => {
  const operation = 'external-reference-operation', account = residentApi.accountId;
  const store = stack.stores.get('payments')!, before = store.list(account, 'charge').length;
  const request = async (referenceId: string, identity = operation) => {
    const response = await fetch(`http://localhost:${stack.corePort + 3}/wallet/pay`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': account, 'X-Operation-Id': identity },
      body: JSON.stringify({ amount: 1, purpose: 'External booking', referenceId }),
    });
    return { status: response.status, data: await response.json() as { charge?: { id: string; reference: string; operationId?: string }; code?: string } };
  };
  const first = await request('booking-reference-a');
  expect(first.status).toBe(200);
  expect(first.data.charge?.reference).toBe('booking-reference-a');
  expect((await request('booking-reference-a')).data.charge?.id).toBe(first.data.charge?.id);
  expect((await request('booking-reference-b')).status).toBe(503);
  expect(first.data.charge?.operationId).toBe(operation);
  expect((await request('booking-reference-a', 'other-operation')).status).toBe(503);
  expect(store.list(account, 'charge')).toHaveLength(before + 1);
  const key = walletChargeKey(account, 'superapp', operation);
  const record = store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(account, key) as { fingerprint: string; status: number; body: string };
  const savedCharge = store.get<Record<string, unknown>>(account, 'charge', first.data.charge!.id)!;
  store.db.prepare('DELETE FROM idempotency WHERE account_id=? AND key=?').run(account, key);
  try {
    expect((await request('booking-reference-b')).status).toBe(503);
    expect((await request('booking-reference-a')).status).toBe(503);
    const { operationId: _operationId, ...chargeWithoutOperation } = savedCharge;
    store.put(account, 'charge', chargeWithoutOperation, first.data.charge!.id);
    expect((await request('booking-reference-b')).status).toBe(503);
    expect(store.list(account, 'charge')).toHaveLength(before + 1);
  } finally {
    store.put(account, 'charge', savedCharge, first.data.charge!.id);
    store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)').run(account, key, record.fingerprint, record.status, record.body);
  }
  const response = await fetch(`http://localhost:${stack.corePort + 3}/wallet/operations/${operation}`, { headers: { Authorization: `Bearer ${residentApi.token}`, 'X-Account-Id': account } });
  expect(response.status).toBe(200);
  const inspected = await response.json() as { operationId: string; charge: { id: string; reference: string } };
  expect(inspected.operationId).toBe(operation);
  expect(inspected.charge.id).toBe(first.data.charge?.id);
  expect(inspected.charge.reference).toBe('booking-reference-a');
});

test('legacy reference-only wallet payments hold ambiguous new operations', async ({ resident, residentApi, stack }) => {
  const account = residentApi.accountId, store = stack.stores.get('payments')!, legacyReference = 'legacy-booking-reference';
  const direct = async (reference = legacyReference) => {
    const response = await fetch(`http://localhost:${stack.corePort + 107}/v1/accounts/${account}/charges`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': walletChargeKey(account, 'superapp', reference) },
      body: JSON.stringify({ amountMinor: 100, merchant: 'superapp', reference, source: 'wallet' }),
    });
    return { status: response.status, data: await response.json() as { charge?: { id: string } } };
  };
  expect((await residentApi.call('overview')).data.wallet.legacyPaymentReview).toBe('NOT_DETECTED');
  const legacy = await direct(); expect(legacy.status).toBe(200);
  expect((await residentApi.call('overview')).data.wallet.legacyPaymentReview).toBe('REQUIRED');
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await expect(panel.getByText('Some wallet payment records need review before new concierge wallet payments. Review your payment history; there is no automatic clearance.', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Load recovery cases', exact: true }).click();
  const issues = panel.getByRole('region', { name: 'Records needing manual review', exact: true });
  await expect(issues.getByText(`Older wallet payment without an operation binding · ${legacy.data.charge!.id}`, { exact: false })).toBeVisible();
  await issues.getByRole('button', { name: `Inspect ${legacy.data.charge!.id}`, exact: true }).click();
  const inspected = panel.getByRole('article', { name: 'Recovery evidence', exact: true });
  await expect(inspected.getByRole('heading', { name: 'BLOCKED · AED 1.00', exact: true })).toBeVisible();
  const overviewRoute = '**/api/payments/overview?*';
  const incompleteOverview = structuredClone((await residentApi.call('overview')).data);
  delete incompleteOverview.wallet.walletPaymentReview;
  await resident.route(overviewRoute, route => route.fulfill({ status: 200, json: incompleteOverview }));
  await panel.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();
  await expect(panel.getByText('Unable to check whether concierge wallet payments need review.', { exact: true })).toBeVisible();
  await resident.unroute(overviewRoute);
  const pay = async (accountId: string, operation: string, referenceId?: string) => {
    const response = await fetch(`http://localhost:${stack.corePort + 3}/wallet/pay`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': accountId, 'X-Operation-Id': operation },
      body: JSON.stringify({ amount: 1, purpose: 'Booking', ...(referenceId ? { referenceId } : {}) }),
    });
    return { status: response.status, data: await response.json() as { charge?: { id: string; operationId?: string } } };
  };
  expect((await pay(account, 'original-operation', 'changed-reference')).status).toBe(503);
  expect((await pay(account, 'another-operation')).status).toBe(503);
  expect((await direct('another-legacy-reference')).status).toBe(503);
  const inspect = (identity: string) => fetch(`http://localhost:${stack.corePort + 3}/wallet/operations/${encodeURIComponent(identity)}`, { headers: { Authorization: `Bearer ${residentApi.token}`, 'X-Account-Id': account } });
  expect((await inspect('original-operation')).status).toBe(503);
  expect((await inspect(legacyReference)).status).toBe(200);
  expect(store.list(account, 'charge')).toHaveLength(1);
  expect((await direct()).data.charge?.id).toBe(legacy.data.charge?.id);
  const legacyReplay = await pay(account, legacyReference);
  expect(legacyReplay.status, JSON.stringify(legacyReplay.data)).toBe(200);
  expect(legacyReplay.data.charge?.id).toBe(legacy.data.charge?.id);
  const legacyKey = walletChargeKey(account, 'superapp', legacyReference);
  const record = store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(account, legacyKey) as { fingerprint: string; status: number; body: string };
  store.db.prepare('DELETE FROM idempotency WHERE account_id=? AND key=?').run(account, legacyKey);
  try {
    expect((await direct()).status).toBe(503);
    expect((await pay(account, legacyReference)).status).toBe(503);
    expect(store.list(account, 'charge')).toHaveLength(1);
  } finally { store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)').run(account, legacyKey, record.fingerprint, record.status, record.body); }
  const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
  const other = store.accounts(claims.sub).find(item => item.id !== account)!;
  const otherStatus = await fetch(`http://localhost:${stack.corePort + 107}/v1/accounts/${other.id}/wallet`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
  expect(otherStatus.status).toBe(200);
  expect((await otherStatus.json() as { legacyPaymentReview: string }).legacyPaymentReview).toBe('NOT_DETECTED');
  const normal = await pay(other.id, 'new-operation'); expect(normal.status).toBe(200);
  expect(normal.data.charge?.operationId).toBe('new-operation');
  expect((await pay(other.id, 'another-new-operation', 'new-booking-reference')).status).toBe(200);
});

test('direct wallet replay verifies evidence for any idempotency key', async ({ residentApi, stack }) => {
  const account = residentApi.accountId, store = stack.stores.get('payments')!;
  const reference = 'direct-replay-test', key = 'direct-replay-key';
  const request = async (requestKey = key) => {
    const response = await fetch(`http://localhost:${stack.corePort + 107}/v1/accounts/${account}/charges`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
      body: JSON.stringify({ amountMinor: 100, merchant: 'superapp', reference, source: 'wallet' }),
    });
    return { status: response.status, data: await response.json() as { charge?: { id: string }; code?: string } };
  };
  const first = await request();
  expect(first.status).toBe(200);
  const id = first.data.charge!.id;
  expect((await request()).data.charge?.id).toBe(id);
  expect((await request('another-direct-key')).status).toBe(503);
  const charge = store.get<Record<string, unknown>>(account, 'charge', id)!;
  const transaction = store.get<Record<string, unknown>>(account, 'transaction', id)!;
  const balance = store.get<{ balanceMinor: number }>(account, 'wallet')!.balanceMinor;
  try {
    store.put(account, 'charge', { ...charge, amountMinor: 999 }, id);
    expect((await request()).status).toBe(503);
    store.put(account, 'charge', charge, id);
    store.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='transaction' AND id=?").run(account, id);
    expect((await request()).status).toBe(503);
  } finally {
    store.put(account, 'charge', charge, id);
    store.put(account, 'transaction', transaction, id);
  }
  expect((await request()).data.charge?.id).toBe(id);
  expect(store.get<{ balanceMinor: number }>(account, 'wallet')!.balanceMinor).toBe(balance);
  expect((store.list(account, 'charge') as Array<{ id: string }>).filter(item => item.id === id)).toHaveLength(1);
});

test('food operation replay returns the original order across trace IDs and refuses changed terms', async ({ residentApi, stack }) => {
  const operation = '22222222-2222-4222-8222-222222222222:food_order';
  const request = async (trace: string, items: string[]) => {
    const response = await fetch(`http://localhost:${stack.corePort + 2}/orders/create`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': residentApi.accountId, 'X-Request-Id': trace, 'X-Operation-Id': operation },
      body: JSON.stringify({ restaurantId: 'rest_1', items, deliveryAddress: 'Test delivery address' }),
    });
    return { status: response.status, data: await response.json() as { order?: { orderId: string }; code?: string } };
  };
  const missingAddress = await fetch(`http://localhost:${stack.corePort + 2}/orders/create`, {
    method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': residentApi.accountId, 'X-Operation-Id': operation },
    body: JSON.stringify({ restaurantId: 'rest_1', items: ['item_diavola'] }),
  });
  expect(missingAddress.status).toBe(400);
  const first = await request('trace-first', ['item_diavola']), replay = await request('trace-second', ['item_diavola']);
  expect(first.status).toBe(200);
  expect(first.data.order?.orderId).toEqual(expect.any(String));
  expect(replay.status).toBe(200);
  expect(replay.data.order?.orderId).toBe(first.data.order?.orderId);
  const inspect = async (identity: string) => fetch(`http://localhost:${stack.corePort + 2}/orders/operations/${encodeURIComponent(identity)}`, { headers: { Authorization: `Bearer ${residentApi.token}`, 'X-Account-Id': residentApi.accountId } });
  const found = await inspect(operation);
  expect(found.status).toBe(200);
  expect(((await found.json()) as { order: { orderId: string } }).order.orderId).toBe(first.data.order?.orderId);
  expect((await inspect('missing-operation')).status).toBe(404);
  const changed = await request('trace-third', ['item_margherita']);
  expect(changed.status).toBe(409);
  expect(changed.data.code).toBe('IDEMPOTENCY_CONFLICT');
  const database = new AccountDatabase(join(process.env.APP_DATA_DIR!, 'service-food.sqlite'));
  const orderId = first.data.order!.orderId;
  const original = database.get<Record<string, unknown>>(residentApi.accountId, 'order', orderId)!;
  const row = database.db.prepare("SELECT id,body FROM resources WHERE account_id=? AND kind='food-order-operation'").get(residentApi.accountId) as { id: string; body: string };
  const binding = JSON.parse(row.body) as Record<string, unknown>, damaged = { ...original, status: 'PENDING' };
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)).digest('hex');
  try {
    database.put(residentApi.accountId, 'order', damaged, orderId);
    database.put(residentApi.accountId, 'food-order-operation', { ...binding, receiptDigest: digest(damaged) }, row.id);
    expect((await inspect(operation)).status).toBe(503);
    expect((await request('trace-damaged', ['item_diavola'])).status).toBe(503);
    const differentDestination = { ...original, deliveryAddress: 'Different destination' };
    database.put(residentApi.accountId, 'order', differentDestination, orderId);
    database.put(residentApi.accountId, 'food-order-operation', { ...binding, receiptDigest: digest(differentDestination) }, row.id);
    expect((await inspect(operation)).status).toBe(503);
    expect((await request('trace-different-destination', ['item_diavola'])).status).toBe(503);
  } finally {
    database.put(residentApi.accountId, 'order', original, orderId);
    database.put(residentApi.accountId, 'food-order-operation', binding, row.id);
    database.close();
  }
});

test('ride operation replay returns one booking across trace IDs and refuses a changed destination', async ({ residentApi, stack }) => {
  const operation = 'r'.repeat(200);
  const rides = () => stack.stores.get('rta')!.list(residentApi.accountId, 'ride') as Array<{ bookingId: string; dropoff: string }>;
  const before = rides().length;
  const request = async (trace: string, dropoff: string, identity = operation) => {
    const response = await fetch(`http://localhost:${stack.corePort + 1}/rides/book`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': residentApi.accountId, 'X-Request-Id': trace, 'X-Operation-Id': identity },
      body: JSON.stringify({ driverId: 'drv_3', dropoff, expectedFareMinor: 2800 }),
    });
    return { status: response.status, data: await response.json() as { booking?: { bookingId: string; dropoff: string }; code?: string } };
  };
  const [first, replay] = await Promise.all([request('trace-first', 'Downtown Dining'), request('trace-second', 'Downtown Dining')]);
  expect(first.status).toBe(200);
  expect(replay.status).toBe(200);
  expect(first.data.booking?.bookingId).toEqual(expect.any(String));
  expect(replay.data.booking).toEqual(first.data.booking);
  expect(first.data.booking?.dropoff).toBe('Downtown Dining');
  expect(rides()).toHaveLength(before + 1);
  const inspect = async (identity: string, accountId = residentApi.accountId) => fetch(`http://localhost:${stack.corePort + 1}/rides/operations/${encodeURIComponent(identity)}`, { headers: { Authorization: `Bearer ${residentApi.token}`, 'X-Account-Id': accountId } });
  const found = await inspect(operation);
  expect(found.status).toBe(200);
  expect(((await found.json()) as { booking: { bookingId: string } }).booking.bookingId).toBe(first.data.booking?.bookingId);
  expect((await inspect('missing-operation')).status).toBe(404);
  expect((await inspect('../invalid')).status).toBe(400);
  const store = stack.stores.get('rta')!, bookingId = first.data.booking!.bookingId;
  const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
  const otherAccount = store.accounts(claims.sub).find(account => account.id !== residentApi.accountId);
  expect(otherAccount).toBeTruthy();
  expect((await inspect(operation, otherAccount!.id)).status).toBe(404);
  const saved = store.get<Record<string, unknown>>(residentApi.accountId, 'ride', bookingId)!;
  store.put(residentApi.accountId, 'ride', { ...saved, dropoff: 'Altered destination' }, bookingId);
  expect((await inspect(operation)).status).toBe(503);
  expect((await request('trace-altered-booking', 'Downtown Dining')).status).toBe(503);
  store.put(residentApi.accountId, 'ride', saved, bookingId);
  store.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='ride' AND id=?").run(residentApi.accountId, bookingId);
  expect((await inspect(operation)).status).toBe(503);
  expect((await request('trace-missing-booking', 'Downtown Dining')).status).toBe(503);
  store.put(residentApi.accountId, 'ride', saved, bookingId);
  expect((await request('trace-restored-booking', 'Downtown Dining')).data.booking?.bookingId).toBe(bookingId);
  const key = providerOperationKey(operation, 'rta', '/rides/bookings');
  const record = store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(residentApi.accountId, key) as { fingerprint: string; status: number; body: string };
  const malformed = { ...saved, status: 'PENDING' };
  store.put(residentApi.accountId, 'ride', malformed, bookingId);
  store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run(JSON.stringify({ success: true, booking: malformed }), residentApi.accountId, key);
  try {
    expect((await inspect(operation)).status).toBe(503);
    expect((await request('trace-malformed-replay', 'Downtown Dining')).status).toBe(503);
    expect((await request('trace-malformed-replacement', 'Downtown Dining', 'replacement-ride')).status).toBe(503);
  } finally {
    store.put(residentApi.accountId, 'ride', saved, bookingId);
    store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run(record.body, residentApi.accountId, key);
  }
  store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run('{', residentApi.accountId, key);
  expect((await inspect(operation)).status).toBe(503);
  store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run(record.body, residentApi.accountId, key);
  store.db.prepare('DELETE FROM idempotency WHERE account_id=? AND key=?').run(residentApi.accountId, key);
  try {
    expect((await inspect(operation)).status).toBe(503);
    const retries = await Promise.all([request('trace-lost-one', 'Downtown Dining'), request('trace-lost-two', 'Downtown Dining')]);
    expect(retries.map(result => result.status)).toEqual([503, 503]);
    expect(rides()).toHaveLength(before + 1);
    store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)').run(residentApi.accountId, 'invalid-binding', 'invalid', 200, record.body);
    expect((await request('trace-invalid-binding', 'Downtown Dining')).status).toBe(503);
    store.db.prepare('DELETE FROM idempotency WHERE account_id=? AND key=?').run(residentApi.accountId, 'invalid-binding');
    store.db.prepare("UPDATE resources SET body='{' WHERE account_id=? AND kind='ride' AND id=?").run(residentApi.accountId, bookingId);
    expect((await request('trace-unreadable-booking', 'Downtown Dining')).status).toBe(503);
    store.put(residentApi.accountId, 'ride', saved, bookingId);
    expect((await request('trace-other-operation', 'Downtown Dining', 'another-ride')).status).toBe(503);
    expect((await inspect(operation, otherAccount!.id)).status).toBe(404);
    const otherBooking = await fetch(`http://localhost:${stack.corePort + 1}/rides/book`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': otherAccount!.id, 'X-Operation-Id': operation },
      body: JSON.stringify({ driverId: 'drv_3', dropoff: 'Downtown Dining', expectedFareMinor: 2800 }),
    });
    expect(otherBooking.status).toBe(200);
  } finally {
    store.put(residentApi.accountId, 'ride', saved, bookingId);
    store.db.prepare('DELETE FROM idempotency WHERE account_id=? AND key=?').run(residentApi.accountId, 'invalid-binding');
    store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)').run(residentApi.accountId, key, record.fingerprint, record.status, record.body);
  }
  expect((await request('trace-restored-record', 'Downtown Dining')).data.booking?.bookingId).toBe(bookingId);
  const changed = await request('trace-third', 'Other destination');
  expect(changed.status).toBe(503);
  expect(changed.data.code).toBe('PROVIDER_OUTCOME_UNKNOWN');
  expect(rides()).toHaveLength(before + 1);
  const separate = await request('trace-fourth', 'Downtown Dining', `${'r'.repeat(199)}s`);
  expect(separate.status).toBe(200);
  expect(separate.data.booking?.bookingId).not.toBe(first.data.booking?.bookingId);
  expect(rides()).toHaveLength(before + 2);
});


test('direct ride replay verifies the original booking for any idempotency key', async ({ residentApi, stack }) => {
  const account = residentApi.accountId, store = stack.stores.get('rta')!;
  const request = async (key = 'direct-ride-key') => {
    const response = await fetch(`http://localhost:${stack.corePort + 101}/v1/accounts/${account}/rides/bookings`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ driverId: 'drv_3', dropoff: 'Downtown Dining', expectedFareMinor: 2800 }),
    });
    return { status: response.status, data: await response.json() as { booking?: { bookingId: string }; code?: string } };
  };
  const first = await request(); expect(first.status).toBe(200);
  const id = first.data.booking!.bookingId, booking = store.get<Record<string, unknown>>(account, 'ride', id)!;
  const record = store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(account, 'direct-ride-key') as { fingerprint: string; status: number; body: string };
  expect((await request()).data.booking?.bookingId).toBe(id);
  try {
    const wrongRoute = { ...booking, dropoff: 'Other destination' };
    store.put(account, 'ride', wrongRoute, id);
    const altered = await request(); expect(altered.status).toBe(503); expect(altered.data.code).toBe('PROVIDER_OUTCOME_UNKNOWN');
    store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run(JSON.stringify({ success: true, booking: wrongRoute }), account, 'direct-ride-key');
    expect((await request()).status).toBe(503);
    store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run(record.body, account, 'direct-ride-key');
    store.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='ride' AND id=?").run(account, id);
    expect((await request()).status).toBe(503);
  } finally { store.put(account, 'ride', booking, id); store.db.prepare('UPDATE idempotency SET body=? WHERE account_id=? AND key=?').run(record.body, account, 'direct-ride-key'); }
  expect((await request()).data.booking?.bookingId).toBe(id);
  store.db.prepare('DELETE FROM idempotency WHERE account_id=? AND key=?').run(account, 'direct-ride-key');
  try {
    expect((await request()).status).toBe(503);
    expect((await request('another-direct-key')).status).toBe(503);
    expect(store.list(account, 'ride')).toHaveLength(1);
  } finally {
    store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)').run(account, 'direct-ride-key', record.fingerprint, record.status, record.body);
  }
  expect((await request()).data.booking?.bookingId).toBe(id);
  expect((store.list(account, 'ride') as Array<{ bookingId: string }>).filter(item => item.bookingId === id)).toHaveLength(1);
});
