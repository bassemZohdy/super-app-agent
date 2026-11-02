import test from 'node:test';
import assert from 'node:assert/strict';
import { startEnvironment } from '../../scripts/e2e/environment.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';

test('isolated environment restores process settings after a successful start and stop', { timeout: 120000 }, async () => {
  const names = ['NODE_ENV', 'SERVICE_RIDE_URL', 'PROVIDER_RTA_CLAIM_SECRET', 'E2E_UNRELATED_SENTINEL'] as const;
  const original = names.map(name => [name, process.env[name]] as const);
  process.env.NODE_ENV = 'e2e-lifecycle-original';
  process.env.SERVICE_RIDE_URL = 'http://original.invalid';
  delete process.env.PROVIDER_RTA_CLAIM_SECRET;
  process.env.E2E_UNRELATED_SENTINEL = 'before';
  try {
    const env = await startEnvironment();
    try {
      assert.equal(process.env.NODE_ENV, 'development');
      assert.notEqual(process.env.SERVICE_RIDE_URL, 'http://original.invalid');
      assert.ok(process.env.PROVIDER_RTA_CLAIM_SECRET);
      process.env.E2E_UNRELATED_SENTINEL = 'after';
    } finally { await env.cleanup(); }
    assert.equal(process.env.NODE_ENV, 'e2e-lifecycle-original');
    assert.equal(process.env.SERVICE_RIDE_URL, 'http://original.invalid');
    assert.equal(process.env.PROVIDER_RTA_CLAIM_SECRET, undefined);
    assert.equal(process.env.E2E_UNRELATED_SENTINEL, 'after');
  } finally {
    for (const [name, value] of original) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});


test('isolated environments restart in one process with fresh Redis namespaces', { timeout: 180000 }, async () => {
  const { redisSessions } = await import('../../services/agent-core/src/session-store.ts');
  let firstKey = '', firstPrefix = '';
  const resident = actorFor({ sub: 'e2e-lifecycle-isolation' });
  for (let run = 0; run < 2; run++) {
    const env = await startEnvironment();
    try {
      const store = redisSessions();
      assert.ok(store?.client.isReady);
      assert.equal((await fetch(`${env.coreUrl}/health`)).status, 200);
      const payments = env.providerStores.get('payments');
      assert.ok(payments); payments.accounts(resident.sub);
      if (run === 0) {
        payments.put(resident.accountId, 'lifecycle-sentinel', { marker: 'first run' }, 'only-first-run');
        firstPrefix = store.prefix; firstKey = `${store.prefix}lifecycle-sentinel`;
        await store.client.set(firstKey, 'first run');
      } else {
        assert.notEqual(store.prefix, firstPrefix);
        assert.equal(await store.client.get(firstKey), null, 'the first run removed its own Redis state');
        assert.equal(payments.get(resident.accountId, 'lifecycle-sentinel', 'only-first-run'), undefined, 'the second provider database has no first-run state');
      }
    } finally { await env.cleanup(); }
  }
});
