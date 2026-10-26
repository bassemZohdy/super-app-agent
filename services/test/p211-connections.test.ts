import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionRegistry, ManifestRefused, PROVIDERS, bindOperation, callsFor, clearCalls, providerBase, readManifest, recordCall } from '../../packages/backend-kit/src/connections.ts';

const base = new URL('http://localhost:4107');
const doc = (over: Record<string, unknown> = {}) => ({ openapi: '3.1.0', paths: { '/v1/accounts/{accountId}/wallet': { get: { operationId: 'getWallet' } }, '/v1/accounts/{accountId}/topups': { post: { operationId: 'createTopup' } } }, ...over });
const refuses = (document: unknown, pattern: RegExp) => assert.throws(() => readManifest(document, base), error => error instanceof ManifestRefused && pattern.test(error.reason));

test('P2-11: a well-formed document lists its operations by ID, in order', () => {
  assert.deepEqual(readManifest(doc(), base), [{ operationId: 'createTopup', method: 'POST', path: '/v1/accounts/{accountId}/topups' }, { operationId: 'getWallet', method: 'GET', path: '/v1/accounts/{accountId}/wallet' }]);
  assert.equal(readManifest(doc({ servers: [{ url: '/' }, { url: 'http://localhost:4107/v1' }, { url: 'http://127.0.0.1:34107' }] }), base).length, 2, 'a relative, own-host or local server is fine, on any port');
  assert.equal(readManifest(doc({ servers: [{ url: 'http://provider-payments:4107' }] }), new URL('http://provider-payments:4107')).length, 2, 'and the host of the provider itself');
});

test('P2-11: a malformed or relocated document is refused, with the reason', () => {
  refuses(null, /not an object/);
  refuses([], /not an object/);
  refuses(doc({ openapi: '2.0' }), /not OpenAPI 3\.1/);
  refuses(doc({ paths: undefined }), /no paths/);
  refuses(doc({ paths: {} }), /no operations/);
  refuses(doc({ servers: [{ url: 'https://evil.example/v1' }] }), /points away/);
  refuses(doc({ servers: [{ url: '//evil.example' }] }), /points away/);
  refuses(doc({ servers: [{ url: 'http://payments.evil.example:4107' }] }), /points away/);
  refuses(doc({ servers: [{ url: 'https://localhost.evil.example' }] }), /points away/);
  refuses(doc({ servers: 'x' }), /servers entry is malformed/);
  refuses(doc({ servers: [{}] }), /no address/);
  for (const path of ['/v1/../admin', '//evil.example/x', '/v1/a?x=1', '/v1/a#frag', 'v1/relative', '/v1/%2e%2e/x', '/v1/a\\b', 'http://evil.example/x'])
    refuses(doc({ paths: { [path]: { get: { operationId: 'x' } } } }), /not a plain path/);
  refuses(doc({ paths: { '/a': { get: {} } } }), /no valid operationId/);
  refuses(doc({ paths: { '/a': { get: { operationId: '1bad' } } } }), /no valid operationId/);
  refuses(doc({ paths: { '/a': { get: { operationId: 'same' } }, '/b': { get: { operationId: 'same' } } } }), /used twice/);
});

test('P2-11: a call is bound by operation ID to the provider\'s own origin, and nothing else', () => {
  const operations = readManifest(doc(), base);
  const bound = bindOperation(operations, 'getWallet', { accountId: 'acc_1' }, base);
  assert.equal(bound.method, 'GET');
  assert.equal(bound.url.href, 'http://localhost:4107/v1/accounts/acc_1/wallet');
  assert.equal(bindOperation(operations, 'getWallet', { accountId: 'a/b c' }, base).url.pathname, '/v1/accounts/a%2Fb%20c/wallet', 'parameters are encoded, never spliced');
  for (const [id, params] of [['unknown', {}], ['getWallet', {}], ['getWallet', { accountId: '..' }], ['getWallet', { accountId: '' }], ['getWallet', { accountId: 'a\\b' }]] as const)
    assert.throws(() => bindOperation(operations, id, params, base), ManifestRefused, `${id} ${JSON.stringify(params)}`);
});

test('P2-11: providers are read from a fixed set of addresses, and the environment may only move a known one', () => {
  assert.equal(providerBase('dewa', {}).href, 'http://localhost:4102/');
  assert.equal(providerBase('payments', {}).href, 'http://localhost:4107/');
  assert.equal(providerBase('rta', { PROVIDER_RTA_URL: 'http://rta.internal:9' }).href, 'http://rta.internal:9/');
  assert.throws(() => providerBase('evil', {}), ManifestRefused);
  assert.throws(() => providerBase('../x', {}), ManifestRefused);
});

test('P2-11: the registry caches for 30 seconds, rereads on demand, refuses redirects and shows a refusal as a state', async () => {
  let clock = 1_000, reads = 0;
  const bodies: Array<() => Response> = [];
  const registry = new ConnectionRegistry({ now: () => clock, fetcher: async (url, init) => { reads++; assert.equal(init.redirect, 'error', 'a redirect is never followed'); assert.equal(url.pathname, '/openapi.json'); return bodies.shift()!(); } });
  const ok = () => new Response(JSON.stringify(doc()), { status: 200 });
  bodies.push(ok);
  const first = await registry.check('payments');
  assert.equal(first.ok, true);
  assert.equal(first.operations.length, 2);
  assert.equal((await registry.check('payments')) , first, 'served from the cache');
  clock += 29_999; await registry.check('payments');
  assert.equal(reads, 1);
  clock += 2; bodies.push(ok); await registry.check('payments');
  assert.equal(reads, 2, 'a read after 30 seconds');
  bodies.push(ok); await registry.check('payments', true);
  assert.equal(reads, 3, 'a forced check reads at once');

  bodies.push(() => new Response(JSON.stringify(doc({ servers: [{ url: 'https://evil.example' }] })), { status: 200 }));
  const relocated = await registry.check('payments', true);
  assert.deepEqual([relocated.ok, relocated.operations.length, relocated.problem], [false, 0, 'A server points away from the provider.']);
  bodies.push(() => new Response('<html>', { status: 200 }));
  assert.equal((await registry.check('dewa')).problem, 'The document is not valid JSON.');
  bodies.push(() => new Response('{}', { status: 503 }));
  assert.equal((await registry.check('du')).problem, 'The provider answered 503.');
  bodies.push(() => new Response('x'.repeat(2_000_001), { status: 200 }));
  assert.equal((await registry.check('police')).problem, 'The document is too large.');
});

test('P2-11: a redirect and an unreachable provider are refused without leaking where they pointed', async () => {
  const redirecting = new ConnectionRegistry({ fetcher: async () => { throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') }); } });
  assert.equal((await redirecting.check('rta')).problem, 'The provider redirected, which is refused.');
  const down = new ConnectionRegistry({ fetcher: async () => { throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 10.0.0.9:80') }); } });
  assert.equal((await down.check('rta')).problem, 'The provider could not be reached.');
  assert.equal((await new ConnectionRegistry({ fetcher: async () => new Response('{}') }).checkAll()).length, PROVIDERS.length);
});

test('P2-11: the call record is per owner, bounded, newest first, and keeps no account or object id', () => {
  clearCalls();
  recordCall('owner-a', { at: 1, provider: 'payments', method: 'GET', path: '/v1/accounts/acc_0123456789abcdef/wallet', status: 200, ms: 5 });
  recordCall('owner-a', { at: 2, provider: 'police', method: 'POST', path: '/v1/accounts/acc_0123456789abcdef/payment-orders/order_12345678-aaaa/approve', status: 409, code: 'PAYABLE_CHANGED', ms: 9 });
  recordCall('owner-b', { at: 3, provider: 'dewa', method: 'GET', path: '/v1/accounts/acc_other/bills', status: 200, ms: 3 });
  const mine = callsFor('owner-a');
  assert.deepEqual(mine.map(call => call.at), [2, 1]);
  assert.equal(mine[0].path, '/v1/accounts/{account}/payment-orders/{id}/approve');
  assert.equal(mine[1].path, '/v1/accounts/{account}/wallet');
  assert.equal(callsFor('owner-b').length, 1);
  assert.deepEqual(callsFor('nobody'), []);
  for (let i = 0; i < 80; i++) recordCall('owner-a', { at: 10 + i, provider: 'rta', method: 'GET', path: '/v1/accounts/x/parking', status: 200, ms: 1 });
  assert.equal(callsFor('owner-a').length, 50, 'bounded per owner');
  clearCalls();
});

test('P2-11: the gateway route lists every provider with its state and only the signed-in owner\'s calls', async () => {
  const { executeCoreRequest: core } = await import('../agent-core/src/index.ts');
  clearCalls();
  recordCall('demo', { at: 5, provider: 'payments', method: 'GET', path: '/v1/accounts/acc_x/wallet', status: 200, ms: 4 });
  recordCall('someone-else', { at: 6, provider: 'dewa', method: 'GET', path: '/v1/accounts/acc_y/bills', status: 500, code: 'BOOM', ms: 4 });
  const result = await core('GET', '/api/connections');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.providers.map((entry: { provider: string }) => entry.provider), [...PROVIDERS]);
  for (const entry of result.data.providers) assert.deepEqual(Object.keys(entry).filter(key => !['problem'].includes(key)).sort(), ['checkedAt', 'ok', 'operations', 'provider']);
  assert.ok(result.data.calls.every((call: { provider: string }) => call.provider !== 'dewa'), 'another owner\'s calls are not shown');
  assert.equal((await core('GET', '/api/connections', {}, { refresh: '2' })).status, 400, 'refresh takes only 1');
  clearCalls();
});
