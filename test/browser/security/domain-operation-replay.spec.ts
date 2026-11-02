import { expect, isolatedTest as test } from '../stack.ts';
import { providerOperationKey, walletChargeKey } from '../../../packages/backend-kit/src/provider-client.ts';

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
      body: JSON.stringify({ restaurantId: 'rest_1', items }),
    });
    return { status: response.status, data: await response.json() as { order?: { orderId: string }; code?: string } };
  };
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
