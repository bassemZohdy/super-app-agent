import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWalletRequest as wallet, balance, transactions, policeFines, server as walletServer } from '../service-wallet/src/index.ts';
import { executeRideRequest as ride, activeParkingMeters, activeRides, salikBalance, server as rideServer } from '../service-ride/src/index.ts';
import { executeFoodRequest as food, activeUtilityBill, activeOrders, server as foodServer } from '../service-food/src/index.ts';
import { executeProfileRequest as profile, currentPreferences, server as profileServer } from '../service-profile/src/index.ts';
import { executeCatalogRequest as catalog, server as catalogServer } from '../service-catalog/src/index.ts';
import { getOrCreateSession, executeCoreRequest as core, sessions, server as coreServer } from '../agent-core/src/index.ts';
import { MAX_MONEY, toMinor, fromMinor } from '../../packages/protocol-core/src/request-validation.ts';

const snapshot = () => JSON.stringify({ balance, transactions, policeFines, meters: [...activeParkingMeters],
  rides: [...activeRides], salikBalance, bill: activeUtilityBill, orders: [...activeOrders],
  preferences: currentPreferences, sessions: [...sessions] });
function rejects(run: () => { status: number; data: any }, status = 400) {
  const before = snapshot();
  const result = run();
  assert.equal(result.status, status);
  assert.ok(result.data.error);
  assert.equal(snapshot(), before, 'Rejected request must not mutate any domain state');
}

test('P0-09: wallet payments/topups reject coercion, invalid precision, bounds and currency without mutation', () => {
  const invalid = [NaN, Infinity, -Infinity, -1, 0, 1.001, 0.30000000000000004, 1e-9,
    MAX_MONEY + 0.01, Number.MAX_VALUE, 'Infinity', '1', '1junk', true, null, [], {}];
  for (const path of ['/wallet/pay', '/wallet/topup']) {
    for (const amount of invalid) rejects(() => wallet('POST', path, {}, { amount, ...(path.endsWith('/pay') ? { purpose: 'Test' } : {}) }));
    rejects(() => wallet('POST', path, {}, { amount: 1, currency: 'AED', ...(path.endsWith('/pay') ? { purpose: 'Test' } : {}) }));
  }
  rejects(() => wallet('POST', '/wallet/pay', {}, { amount: 1 }));
  rejects(() => wallet('POST', '/wallet/topup', {}, { amount: 1, userId: 'someone-else' }));
});

test('P0-09: unified settlement rejects malformed/negative/oversized nested totals and keeps ledger unchanged', () => {
  for (const path of ['/pay/unified', '/pay/multi-agency']) {
    for (const body of [{}, { items: [] }, { items: 'wrong' }, { items: [null] },
      { items: [{ agency: 'Test', purpose: 'Review', amount: -10 }] },
      { items: [{ agency: 'Test', purpose: 'Review', amount: '10' }] },
      { items: [{ agency: 'Test', purpose: 'Review', amount: 1, untrusted: true }] },
      { items: [{ agency: 'Test', purpose: 'Review', amount: 1 }], currency: 'USD' },
      { items: [{ agency: 'A', purpose: 'Review', amount: MAX_MONEY }, { agency: 'B', purpose: 'Review', amount: MAX_MONEY }] }]) {
      rejects(() => wallet('POST', path, {}, body));
    }
  }
});

test('P0-09: valid decimal money uses exact minor-unit arithmetic and enforces aggregate balance ceiling', () => {
  const start = toMinor(balance);
  for (const amount of [0.1, 0.2, 0.29]) assert.equal(wallet('POST', '/wallet/topup', {}, { amount }).status, 200);
  assert.equal(toMinor(balance), start + 59);
  const paid = wallet('POST', '/wallet/pay', {}, { amount: 0.29, purpose: 'Exact cents', currency: 'USD' });
  assert.equal(paid.status, 200);
  assert.equal(toMinor(balance), start + 30);
  const total = wallet('POST', '/pay/unified', {}, { currency: 'AED', items: [
    { agency: 'A', purpose: 'Exact cents', amount: 0.1 }, { agency: 'B', purpose: 'Exact cents', amount: 0.2 },
  ] });
  assert.equal(total.status, 200);
  assert.equal(total.data.grandTotal, 0.3);
  assert.equal(toMinor(balance), start);
  assert.equal(wallet('POST', '/wallet/topup', {}, { amount: fromMinor(MAX_MONEY * 100 - toMinor(balance)) }).status, 200);
  rejects(() => wallet('POST', '/wallet/topup', {}, { amount: 0.01 }));
  assert.equal(wallet('POST', '/wallet/pay', {}, { amount: MAX_MONEY - 100, purpose: 'Reset test funds' }).status, 200);
});

test('P0-09: mobility validates required IDs, integer durations, exact resource and accumulated bounds', () => {
  const valid = { zoneId: 'zone_101b', durationHours: 1, plateNumber: 'SYNTHETIC' };
  for (const path of ['/mobility/parking/activate', '/parking/activate']) {
    for (const durationHours of [-1, 0, '2', '2junk', 1.5, Infinity, 721]) rejects(() => ride('POST', path, {}, { ...valid, durationHours }));
    for (const field of Object.keys(valid)) {
      const input = { ...valid }; delete input[field];
      rejects(() => ride('POST', path, {}, input));
    }
    rejects(() => ride('POST', path, {}, { ...valid, zoneId: 'missing-zone' }), 404);
  }
  const meter = ride('POST', '/parking/activate', {}, valid).data.meter;
  rejects(() => ride('POST', '/parking/extend', {}, { ticketId: 'missing-ticket', additionalHours: 1 }), 404);
  const extended = ride('POST', '/parking/extend', {}, { ticketId: meter.ticketId, additionalHours: 1 });
  assert.equal(extended.status, 200);
  assert.equal(extended.data.meter.totalFee, 6, 'Use the selected zone tariff, not a constant');
  rejects(() => ride('POST', '/parking/extend', {}, { ticketId: meter.ticketId, additionalHours: 720 }));
  rejects(() => ride('POST', '/mobility/ev/start', {}, { chargerId: 'missing', plateNumber: 'SYNTHETIC' }), 404);
  rejects(() => ride('POST', '/rides/book', {}, { driverId: 'missing' }), 404);
  for (const amount of [-10, 0, '100', 'Infinity', Infinity, 1.001, MAX_MONEY + 1]) {
    rejects(() => ride('POST', '/salik/recharge', {}, { amount }));
  }
});

test('P0-09: food, utility, fine and housing mutations require explicit valid resources', () => {
  rejects(() => food('POST', '/orders/create', {}, { restaurantId: 'rest_1', items: [] }));
  rejects(() => food('POST', '/orders/create', {}, { restaurantId: 'missing', items: ['item_diavola'] }), 404);
  rejects(() => food('POST', '/orders/create', {}, { restaurantId: 'rest_1', items: ['missing'] }), 404);
  rejects(() => food('POST', '/orders/create', {}, { restaurantId: 'rest_1', items: ['item_diavola', 'item_diavola'] }));
  for (const path of ['/utilities/pay', '/bill/pay']) {
    rejects(() => food('POST', path));
    rejects(() => food('POST', path, {}, { billId: 'missing' }), 404);
  }
  for (const path of ['/fines/pay', '/fines/settle']) {
    rejects(() => wallet('POST', path));
    rejects(() => wallet('POST', path, {}, { fineIds: ['missing'] }), 404);
    rejects(() => wallet('POST', path, {}, { fineIds: ['DP-2026-894102', 'DP-2026-894102'] }));
  }
  for (const path of ['/housing/move-in', '/move-in']) {
    rejects(() => catalog('POST', path));
    rejects(() => catalog('POST', path, {}, { contractNumber: 'missing' }), 404);
  }
});

test('P0-09: profile preferences are bounded, enum-checked and non-coercing at every nesting level', () => {
  for (const body of [{ dietary: ['Invented'] }, { dietary: ['Vegan', 'Vegan'] }, { mobility: [] },
    { mobility: { ecoFriendlyOnly: 'true' } }, { mobility: { preferredTier: '' } },
    { ui: { theme: 'invented' } }, { ui: { denseMode: 1 } }, { ui: { accentColor: 'url(javascript:bad)' } },
    { ui: { unknown: 'x' } }, { conciergeTone: {} }, { userId: 'other' },
    JSON.parse('{"mobility":{"__proto__":{"admin":true}}}')]) {
    rejects(() => profile('POST', '/profile/preferences', {}, body));
  }
  assert.equal(profile('POST', '/profile/preferences', {}, { dietary: [], mobility: { quietRide: true }, ui: { theme: 'dark', accentColor: '#aAbB00' } }).status, 200);
});

test('P0-09: malformed domain roots/queries never throw or mutate via direct invocation', () => {
  for (const [handler, path] of [[wallet, '/wallet/topup'], [ride, '/rides/book'], [food, '/orders/create'],
    [profile, '/profile/preferences'], [catalog, '/housing/move-in']] as const) {
    for (const body of [null, [], 'string', 1, true]) rejects(() => handler('POST', path, {}, body));
    rejects(() => handler('GET', '/health', { unexpected: 'x' }));
  }
});

test('P0-09: core rejects malformed envelopes/action fields before consuming or creating state', async () => {
  const sid = 'validation_core_session';
  for (const body of [null, [], { sessionId: sid, text: 'hello', extra: true },
    { sessionId: sid, text: 'hello', handshake: { platform: 'react' } }]) {
    const before = snapshot();
    assert.equal((await core('POST', '/api/a2ui/intent', {}, body)).status, 400);
    assert.equal(snapshot(), before);
  }
  assert.equal((await core('POST', '/api/a2ui/intent', {}, { sessionId: sid, text: 'show my wallet' })).status, 200);
  for (const payload of [{}, { amount: '50' }, { amount: NaN }, { amount: 1.001 }, { amount: 50, extra: true }]) {
    const before = snapshot();
    assert.equal((await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision, action: 'topup_wallet', payload })).status, 400);
    assert.equal(snapshot(), before);
  }
  assert.equal((await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision, action: 'constructor', payload: {} })).status, 403);
  assert.equal((await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision, action: 'topup_wallet', payload: { amount: 50 } })).status, 200);
});

test('P0-09: real HTTP handlers reject invalid JSON bodies, nested inputs and coerced money', async t => {
  for (const [server, path, body] of [[walletServer, '/wallet/topup', { amount: 'Infinity' }],
    [rideServer, '/parking/activate', { zoneId: 'zone_302a', durationHours: -1, plateNumber: 'SYNTHETIC' }],
    [foodServer, '/orders/create', { restaurantId: 'rest_1', items: 'wrong' }],
    [profileServer, '/profile/preferences', { ui: { denseMode: 'yes' } }],
    [catalogServer, '/housing/move-in', {}],
    [coreServer, '/api/a2ui/intent', { sessionId: 'http_validation_session', text: ['wrong'] }]] as const) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    const url = `http://127.0.0.1:${(server.address() as any).port}${path}`;
    for (const input of [body, null]) {
      const before = snapshot();
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'VALIDATION_ERROR');
      assert.equal(snapshot(), before);
    }
  }
});
