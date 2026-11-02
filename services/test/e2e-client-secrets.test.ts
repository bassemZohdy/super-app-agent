import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureClientSecret } from '../../scripts/e2e/client-secrets.ts';
import { readAutomationToken } from '../../scripts/e2e/automation-token.ts';

test('isolated E2E clients use the selected realm credentials and never fall back in qualification', () => {
  const realm = { clients: [{ clientId: 'cityside-verifier', secret: 'seeded-value' }] };
  assert.equal(fixtureClientSecret('cityside-verifier', realm, {}, 0), 'seeded-value');
  assert.equal(fixtureClientSecret('cityside-verifier', realm, { KEYCLOAK_VERIFIER_SECRET: 'stack-specific' }, 30000), 'stack-specific');
  assert.throws(() => fixtureClientSecret('cityside-verifier', realm, {}, 30000), /credential/i);
  assert.throws(() => fixtureClientSecret('cityside-verifier', realm, { KEYCLOAK_VERIFIER_SECRET: '' }, 30000), /credential/i);
  assert.throws(() => fixtureClientSecret('unknown-client', realm, {}, 0), /credential/i);
});

test('automation verification never exposes identity response bodies and bounds successful tokens', async () => {
  const sensitive = 'private-token-or-secret';
  for (const response of [
    new Response(JSON.stringify({ error: sensitive }), { status: 400 }),
    new Response(`not-json ${sensitive}`, { status: 200 }),
    new Response(JSON.stringify({ access_token: sensitive.repeat(5000) }), { status: 200 }),
    new Response(JSON.stringify({ access_token: `abc\n${sensitive}` }), { status: 200 }),
  ]) {
    await assert.rejects(readAutomationToken(response), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /private-token-or-secret/);
      return true;
    });
  }
  assert.equal(await readAutomationToken(Response.json({ access_token: 'valid-example' })), 'valid-example');
});
