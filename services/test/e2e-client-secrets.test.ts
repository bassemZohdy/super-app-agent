import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureClientSecret } from '../../scripts/e2e/client-secrets.ts';

test('isolated E2E clients use the selected realm credentials and never fall back in qualification', () => {
  const realm = { clients: [{ clientId: 'cityside-verifier', secret: 'seeded-value' }] };
  assert.equal(fixtureClientSecret('cityside-verifier', realm, {}, 0), 'seeded-value');
  assert.equal(fixtureClientSecret('cityside-verifier', realm, { KEYCLOAK_VERIFIER_SECRET: 'stack-specific' }, 30000), 'stack-specific');
  assert.throws(() => fixtureClientSecret('cityside-verifier', realm, {}, 30000), /credential/i);
  assert.throws(() => fixtureClientSecret('cityside-verifier', realm, { KEYCLOAK_VERIFIER_SECRET: '' }, 30000), /credential/i);
  assert.throws(() => fixtureClientSecret('unknown-client', realm, {}, 0), /credential/i);
});
