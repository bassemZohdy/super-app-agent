import test from 'node:test';
import assert from 'node:assert/strict';
import { startEnvironment } from '../../scripts/e2e/environment.ts';

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
