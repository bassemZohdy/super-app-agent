import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { TestAuthenticator, type Authenticator, type TestIdentity } from '../src/orchestrator/auth.ts';
import { harness } from './support.ts';

test('authority changed during upload is checked before actions and simulator writes', async () => {
  const identity: TestIdentity = { token: randomBytes(32).toString('hex'), subject: 'alice', permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 600000 };
  const delegate = new TestAuthenticator([identity], 'super-app-agent');
  let authenticated: (() => void) | undefined;
  const auth: Authenticator = { async authenticate(header) { const principal = await delegate.authenticate(header); authenticated?.(); authenticated = undefined; return principal; } };
  const h = await harness({ identities: [identity], authenticator: auth });
  async function delayed(path: string, body: unknown, change: () => void, extra: Record<string, string> = {}) {
    let ready!: () => void;
    const seen = new Promise<void>(resolve => { ready = resolve; }); authenticated = ready;
    const payload = JSON.stringify(body);
    let request!: http.ClientRequest;
    const response = new Promise<{ status: number | undefined; code?: string }>((resolve, reject) => {
      request = http.request(new URL(path, h.base), { method: 'POST', headers: { Authorization: `Bearer ${identity.token}`, 'Idempotency-Key': 'upload-check', 'Content-Length': Buffer.byteLength(payload), 'Content-Type': 'application/json', ...extra } }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, code: JSON.parse(text).code }));
      });
      request.on('error', reject); request.write(payload.slice(0, 1));
    });
    await seen; change(); request.end(payload.slice(1));
    return response;
  }
  try {
    const expired = await delayed('/api/agent/threads', {}, () => { identity.expiresAt = Date.now() - 1; });
    assert.equal(expired.status, 401);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_threads').get() as { n: number }).n, 0);
    identity.expiresAt = Date.now() + 600000;
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    const changed = await delayed(`${root}/cancel`, {}, () => { identity.subject = 'bob'; });
    assert.equal(changed.status, 403); assert.equal(changed.code, 'AUTHORITY_CHANGED');
    identity.subject = 'alice';
    assert.equal((await h.req(root)).data.status, 'new');
    const noRead = await delayed(`${root}/messages`, { message: 'show fines' }, () => { identity.permissions = ['fines:pay']; });
    assert.equal(noRead.status, 403);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_requests').get() as { n: number }).n, 0);
    identity.permissions = ['fines:read', 'fines:pay'];
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const approval = review.data.approval;
    h.store.consent(approval.id, { subject: 'alice', workload: 'super-app-agent', permissions: identity.permissions, expiresAt: identity.expiresAt }, approval.key, approval.quote, approval.expiresAt);
    const denied = await delayed('/simulator/v1/payments', { quote: approval.quote, consentId: approval.id }, () => { identity.permissions = ['fines:read']; }, { 'X-Agent-Key': h.workloadKey, 'Idempotency-Key': approval.key });
    assert.equal(denied.status, 403);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
    identity.permissions = ['fines:read', 'vehicles:renew'];
    const vehicle = h.store.vehicles('alice')[0];
    const quote = { vehicleId: vehicle.id, amountMinor: vehicle.renewalFeeMinor, currency: 'AED' as const, version: vehicle.version };
    const key = randomBytes(32).toString('hex');
    h.store.renewalConsent(approval.id, { subject: 'alice', workload: 'super-app-agent', permissions: identity.permissions, expiresAt: identity.expiresAt }, key, quote, approval.expiresAt);
    const renewal = await delayed('/simulator/v1/renewals', { quote, consentId: approval.id }, () => { identity.permissions = ['fines:read']; }, { 'X-Agent-Key': h.workloadKey, 'Idempotency-Key': key });
    assert.equal(renewal.status, 403);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_renewals').get() as { n: number }).n, 0);
  } finally { await h.close(); }
});
