import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { balance, transactions, executeWalletRequest } from '../service-wallet/src/index.ts';
import { createProviderServer } from '../provider-simulator/src/index.ts';
import { accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { MAX_MONEY, toMinor } from '../../packages/protocol-core/src/request-validation.ts';
import { MAX_PAYMENT_MINOR, WALLET_FUNDING_LIMITS } from '../../packages/protocol-core/src/payments.ts';

// Money routes covered offline:
//  - service-wallet POST /wallet/topup and /wallet/pay (in-process, validateRequest + moneySchema)
//  - provider-simulator (payments) POST /v1/accounts/{id}/topups, /wallet-funding-orders, /charges (HTTP, JWT, OpenAPI)
// Not reachable offline: integrated application POST /wallet/topup (requires live provider services via
// PROVIDER_INTEGRATION) and wallet funding approve/execute (covered by wallet-funding.test.ts at engine level).

const walletSnapshot = () => JSON.stringify({ balance, transactions });
const HOSTILE_JS_AMOUNTS: unknown[] = [0, -1, -0.01, NaN, Infinity, -Infinity, 'NaN', '100', null, {}, true];
// Raw JSON literals so NaN/Infinity and string/null/object/boolean forms reach the HTTP validator unchanged.
const HOSTILE_JSON_LITERALS = ['0', '-1', '-0.01', 'NaN', 'Infinity', '-Infinity', '"NaN"', '"100"', 'null', '{}', 'true'];

test('service-wallet /wallet/topup: hostile amounts are rejected and leave balance and transactions unchanged', () => {
  for (const amount of HOSTILE_JS_AMOUNTS) {
    const before = walletSnapshot();
    const result = executeWalletRequest('POST', '/wallet/topup', {}, { amount });
    assert.equal(result.status, 400, `amount ${String(amount)} must be rejected`);
    assert.ok(result.data.error, `amount ${String(amount)} must return an error message`);
    assert.equal(walletSnapshot(), before, `amount ${String(amount)} must not mutate wallet state`);
  }
});

test('service-wallet /wallet/topup and /wallet/pay: sub-cent and above-minimum fractional AED are rejected', () => {
  for (const amount of [0.001, 10.005]) {
    for (const [path, body] of [['/wallet/topup', { amount }], ['/wallet/pay', { amount, purpose: 'Fraction test' }]] as const) {
      const before = walletSnapshot();
      assert.equal(executeWalletRequest('POST', path, {}, body).status, 400, `${path} ${amount} must be rejected`);
      assert.equal(walletSnapshot(), before, `${path} ${amount} must not mutate wallet state`);
    }
  }
});

test('service-wallet /wallet/topup: amounts above the documented maximum and the balance ceiling are rejected', () => {
  const overMax = MAX_MONEY + 0.01;
  const before = walletSnapshot();
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: overMax }).status, 400);
  assert.equal(walletSnapshot(), before, 'above-maximum amount must not mutate wallet state');
  // MAX_MONEY itself passes the per-request schema, but the wallet balance ceiling (MAX_MONEY) rejects it from a non-zero balance.
  assert.ok(toMinor(balance) < MAX_MONEY * 100);
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: MAX_MONEY }).status, 400);
  assert.equal(walletSnapshot(), before, 'balance-ceiling overflow must not mutate wallet state');
});

test('service-wallet /wallet/topup: exact minimum and exact balance-ceiling headroom are accepted, one cent more is rejected', () => {
  const start = toMinor(balance);
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 0.01 }).status, 200);
  assert.equal(toMinor(balance), start + 1, 'minimum accepted amount credits exactly one fil');
  const headroom = MAX_MONEY * 100 - toMinor(balance);
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: headroom / 100 }).status, 200);
  assert.equal(toMinor(balance), MAX_MONEY * 100, 'balance ceiling is reached exactly');
  const before = walletSnapshot();
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 0.01 }).status, 400);
  assert.equal(walletSnapshot(), before, 'one fil above the ceiling must not mutate wallet state');
});

// ---- Provider simulator (payments) HTTP harness, same JWT/JWKS pattern as provider-simulators.test.ts ----
async function paymentsHarness(t: test.TestContext) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk: any = publicKey.export({ format: 'jwk' }); jwk.kid = 'amount-test'; jwk.use = 'sig'; jwk.alg = 'RS256';
  const jwks = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); });
  jwks.listen(0, '127.0.0.1'); await once(jwks, 'listening'); t.after(() => jwks.close());
  const previous = { KEYCLOAK_ISSUER: process.env.KEYCLOAK_ISSUER, KEYCLOAK_JWKS_URL: process.env.KEYCLOAK_JWKS_URL };
  process.env.KEYCLOAK_ISSUER = 'http://test-issuer';
  process.env.KEYCLOAK_JWKS_URL = `http://127.0.0.1:${(jwks.address() as any).port}`;
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  // Service workload token (service-wallet) for compatibility routes; the signed-in shell owner token for
  // stored funding reviews, which the provider accepts only from an interactive owner.
  const mint = (interactive = false) => {
    const claims = interactive
      ? { sub: 'alice', azp: 'superapp-shell', realm_access: { roles: ['superapp-user'] }, preferred_username: 'alice' }
      : { azp: 'service-wallet', realm_access: { roles: ['provider:payments'] } };
    const a = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
    const b = Buffer.from(JSON.stringify({ iss: 'http://test-issuer', sub: 'machine', typ: 'Bearer', aud: 'provider-api', exp: Math.floor(Date.now() / 1000) + 300, ...claims })).toString('base64url');
    return `${a}.${b}.${sign('RSA-SHA256', Buffer.from(`${a}.${b}`), privateKey).toString('base64url')}`;
  };
  const { server, store } = createProviderServer('payments', ':memory:');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  const root = `http://127.0.0.1:${(server.address() as any).port}/v1/accounts/${accountIdFor('alice')}`;
  // rawBody is sent verbatim so non-JSON literals (NaN, Infinity) reach the validator as-is.
  const call = (method: string, path: string, rawBody?: string, key: string = randomUUID(), interactive = false) => fetch(root + path, {
    method,
    headers: { Authorization: `Bearer ${mint(interactive)}`, 'X-User-Subject': 'alice', 'Content-Type': 'application/json', 'Idempotency-Key': key },
    ...(rawBody !== undefined ? { body: rawBody } : {}),
  });
  const json = async (response: Response) => response.json() as Promise<any>;
  const snapshot = async () => JSON.stringify({ wallet: await json(await call('GET', '/wallet')), transactions: await json(await call('GET', '/transactions')) });
  const balanceMinor = async () => (await json(await call('GET', '/wallet'))).balanceMinor as number;
  return { call, json, snapshot, balanceMinor, root };
}

test('provider /topups: hostile amountMinor values are rejected with no balance or transaction change', async t => {
  const h = await paymentsHarness(t);
  for (const literal of HOSTILE_JSON_LITERALS) {
    const before = await h.snapshot();
    const response = await h.call('POST', '/topups', `{"amountMinor":${literal},"source":"demo_approved"}`);
    assert.equal(response.status, 400, `amountMinor ${literal} must be rejected`);
    assert.equal(await h.snapshot(), before, `amountMinor ${literal} must not mutate state`);
  }
  // Missing amount and unsupported source are validator errors too.
  const before = await h.snapshot();
  assert.equal((await h.call('POST', '/topups', '{"source":"demo_approved"}')).status, 400);
  assert.equal((await h.call('POST', '/topups', '{"amountMinor":100,"source":"demo_unknown"}')).status, 400);
  assert.equal(await h.snapshot(), before);
});

test('provider /topups: fractional minor units are rejected by the integer schema', async t => {
  const h = await paymentsHarness(t);
  const before = await h.snapshot();
  for (const literal of ['0.5', '1000.5']) {
    assert.equal((await h.call('POST', '/topups', `{"amountMinor":${literal},"source":"demo_approved"}`)).status, 400, `${literal} minor must be rejected`);
  }
  assert.equal(await h.snapshot(), before, 'fractional minor amounts must not mutate state');
});

test('provider /topups: amounts above the schema maximum and the funding maximum are rejected', async t => {
  const h = await paymentsHarness(t);
  const before = await h.snapshot();
  // Schema ceiling is MAX_PAYMENT_MINOR; the compatibility top-up is further bounded by WALLET_FUNDING_LIMITS.maxMinor.
  assert.equal((await h.call('POST', '/topups', `{"amountMinor":${MAX_PAYMENT_MINOR + 1},"source":"demo_approved"}`)).status, 400);
  assert.equal((await h.call('POST', '/topups', `{"amountMinor":${WALLET_FUNDING_LIMITS.maxMinor + 1},"source":"demo_approved"}`)).status, 400);
  assert.equal(await h.snapshot(), before, 'overflowing top-up must not mutate state');
});

test('provider /topups: exact funding minimum and maximum are accepted and credit exactly their amount', async t => {
  const h = await paymentsHarness(t);
  const start = await h.balanceMinor();
  const minimum = await h.call('POST', '/topups', `{"amountMinor":1,"source":"demo_approved"}`);
  assert.equal(minimum.status, 200, 'compatibility top-up minimum is one fil (createInternal minimum 1)');
  assert.equal(await h.balanceMinor(), start + 1);
  const maximum = await h.call('POST', '/topups', `{"amountMinor":${WALLET_FUNDING_LIMITS.maxMinor},"source":"demo_approved"}`);
  assert.equal(maximum.status, 200, 'compatibility top-up maximum is WALLET_FUNDING_LIMITS.maxMinor');
  assert.equal(await h.balanceMinor(), start + 1 + WALLET_FUNDING_LIMITS.maxMinor);
});

test('provider /topups: a duplicate with the same Idempotency-Key credits once; a reused key with a new amount conflicts', async t => {
  const h = await paymentsHarness(t);
  const start = await h.balanceMinor();
  const key = randomUUID();
  const body = '{"amountMinor":500,"source":"demo_approved"}';
  const first = await h.call('POST', '/topups', body, key);
  const replay = await h.call('POST', '/topups', body, key);
  assert.equal(first.status, 200);
  assert.equal(replay.status, first.status);
  assert.deepEqual(await h.json(replay), await h.json(await h.call('POST', '/topups', body, key)), 'replays return the stored response');
  assert.equal(await h.balanceMinor(), start + 500, 'same-key retries must credit exactly once');
  const conflict = await h.call('POST', '/topups', '{"amountMinor":600,"source":"demo_approved"}', key);
  assert.equal(conflict.status, 409);
  assert.equal(await h.balanceMinor(), start + 500, 'a conflicting reuse of the key must not credit');
});

test('provider /wallet-funding-orders: hostile, fractional and out-of-range amounts are rejected; funding moves no money', async t => {
  const h = await paymentsHarness(t);
  const card = await h.json(await h.call('POST', '/payment-methods', '{"preset":"approved","nickname":"Amount matrix card"}'));
  const methodId = card.method.id, expectedMethodVersion = card.method.version;
  const orderBody = (literal: string) => `{"amountMinor":${literal},"methodId":"${methodId}","expectedMethodVersion":${expectedMethodVersion}}`;
  const before = await h.snapshot();
  for (const literal of [...HOSTILE_JSON_LITERALS, '0.5', `${WALLET_FUNDING_LIMITS.minMinor - 1}`, `${WALLET_FUNDING_LIMITS.maxMinor + 1}`]) {
    assert.equal((await h.call('POST', '/wallet-funding-orders', orderBody(literal), randomUUID(), true)).status, 400, `funding amount ${literal} must be rejected`);
  }
  assert.equal(await h.snapshot(), before, 'rejected funding reviews must not mutate wallet or transactions');
});

test('provider /wallet-funding-orders: exact minimum and maximum reviews are accepted, and a second open review is refused', async t => {
  const h = await paymentsHarness(t);
  const card = await h.json(await h.call('POST', '/payment-methods', '{"preset":"approved","nickname":"Boundary card"}'));
  const start = await h.balanceMinor();
  const create = (literal: number) => h.call('POST', '/wallet-funding-orders', `{"amountMinor":${literal},"methodId":"${card.method.id}","expectedMethodVersion":${card.method.version}}`, randomUUID(), true);
  const minimum = await create(WALLET_FUNDING_LIMITS.minMinor);
  assert.equal(minimum.status, 200);
  const review = (await h.json(minimum)).order;
  assert.equal(review.quote.amountMinor, WALLET_FUNDING_LIMITS.minMinor);
  assert.equal(await h.balanceMinor(), start, 'a review alone must not credit the wallet');
  assert.equal((await create(WALLET_FUNDING_LIMITS.minMinor)).status, 409, 'only one open funding review per wallet');
  assert.equal((await h.call('POST', `/wallet-funding-orders/${review.id}/cancel`, `{"expectedVersion":${review.version}}`, randomUUID(), true)).status, 200);
  const maximum = await create(WALLET_FUNDING_LIMITS.maxMinor);
  assert.equal(maximum.status, 200);
  assert.equal((await h.json(maximum)).order.quote.amountMinor, WALLET_FUNDING_LIMITS.maxMinor);
  assert.equal(await h.balanceMinor(), start, 'an open maximum review must not credit the wallet');
});

test('provider /charges with source wallet: hostile and overflowing amounts are rejected without spending', async t => {
  const h = await paymentsHarness(t);
  const before = await h.snapshot();
  const literals = [...HOSTILE_JSON_LITERALS, '0.5', `${MAX_PAYMENT_MINOR + 1}`];
  for (const literal of literals) {
    const response = await h.call('POST', '/charges', `{"amountMinor":${literal},"merchant":"superapp","reference":"amount:matrix","source":"wallet"}`);
    assert.equal(response.status, 400, `charge amount ${literal} must be rejected`);
  }
  assert.equal(await h.snapshot(), before, 'rejected charges must not mutate wallet or transactions');
});
