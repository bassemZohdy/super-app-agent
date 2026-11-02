import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createProviderServer } from '../provider-simulator/src/index.ts';
import { removeTemp } from '../../test/support/temp-cleanup.ts';

test('preparation inspection is read-only and restricted to the exact run worker', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cityside-auto-'));
  const runId = `autorn_${randomUUID()}`, workerSub = 'inspection-worker';
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: `inspect-${randomUUID()}`, alg: 'RS256', use: 'sig' };
  const jwks = http.createServer((_req, res) => res.end(JSON.stringify({ keys: [jwk] })));
  jwks.listen(0, '127.0.0.1'); await once(jwks, 'listening');
  const previous = { KEYCLOAK_ISSUER: process.env.KEYCLOAK_ISSUER, KEYCLOAK_JWKS_URL: process.env.KEYCLOAK_JWKS_URL };
  process.env.KEYCLOAK_ISSUER = 'http://inspection-issuer';
  process.env.KEYCLOAK_JWKS_URL = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}`;
  const mint = (changes: Record<string, unknown> = {}) => {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ iss: 'http://inspection-issuer', sub: workerSub, typ: 'Bearer', aud: 'provider-api', azp: 'automation-worker', preferred_username: 'service-account-automation-worker', scope: 'automation.execute', exp: Math.floor(Date.now() / 1000) + 300, ...changes })).toString('base64url');
    return `${head}.${claims}.${sign('RSA-SHA256', Buffer.from(`${head}.${claims}`), keys.privateKey).toString('base64url')}`;
  };
  const { server, store } = createProviderServer('payments', join(root, 'payments.sqlite'), {
    automationRun: { root, runId, workerSub, operatorSub: 'inspection-operator' },
    automationIo: { readPayables: () => [], providerStore: () => { throw new Error('No provider read expected'); } },
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close();
    await new Promise<void>(resolve => jwks.close(() => resolve()));
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    removeTemp(root);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/automation-runs/${runId}`;
  const path = '/requests/req_inspection_01';
  const get = (token: string, suffix = path, method = 'GET') => fetch(base + suffix, { method, headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await get(mint({ sub: 'another-worker' }))).status, 403);
  assert.equal((await get(mint({ azp: 'other-client' }))).status, 403);
  assert.equal((await get(mint({ scope: 'openid' }))).status, 403);
  assert.equal((await get(mint(), path, 'POST')).status, 403);
  assert.equal((await get(mint(), `${path}?x=1`)).status, 404);
  assert.deepEqual(await (await get(mint())).json(), { success: true, found: false });
  const stored = { mandateId: 'mandate_1', occurrenceKey: 'occ_1', skipped: true, reason: 'NO_DUE_INVOICE' };
  store.db.prepare('INSERT INTO automation_requests(key,fingerprint,body) VALUES(?,?,?)').run('req_inspection_01', 'test-fingerprint', JSON.stringify(stored));
  assert.deepEqual(await (await get(mint())).json(), { success: true, found: true, preparation: stored });
  assert.equal(Number(store.db.prepare('SELECT count(*) AS n FROM automation_executions').get()?.n), 0);
});
