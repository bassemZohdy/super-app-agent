import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantStore } from '../delegation/src/store.ts';
import { accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { brokerClient, digest, tokenHash, type GrantInput } from '../delegation/src/policy.ts';
const owner = 'linked-owner';
const read = (): GrantInput => ({ accountId: accountIdFor(owner), provider: 'payments', method: 'GET', path: '/wallet', body: {}, purpose: 'Check the synthetic wallet', expiresInSeconds: 300, maxOperations: 2 });
function binding(store: GrantStore, grant: ReturnType<GrantStore['create']>, key = 'request-0001', fingerprint = tokenHash('controlled-test-bearer')) {
  const { job } = store.start(grant.id, key);
  store.bind(fingerprint, { grantId: grant.id, version: grant.version, sub: grant.owner, actor: brokerClient, exp: Math.floor(Date.now() / 1000) + 60, operationId: job.id, requestDigest: digest({ provider: grant.provider, method: grant.method, path: grant.path, body: grant.body }) });
  return job;
}
test('delegation: binds actual user, actor, account and exact operation, with one use per token', () => {
  const store = new GrantStore(':memory:');
  try {
    const g = store.create(owner, read()); binding(store, g);
    const op = { provider: g.provider, method: g.method, path: g.path, body: g.body };
    for (const [sub, actor, account, operation] of [[owner, 'other-client', g.accountId, op], ['other-user', brokerClient, g.accountId, op], [owner, brokerClient, accountIdFor('other-user'), op], [owner, brokerClient, g.accountId, { ...op, path: '/transactions' }]] as const) assert.throws(() => store.authorize(tokenHash('controlled-test-bearer'), sub, actor, account, operation), /authority/);
    assert.throws(() => store.authorize('unregistered', owner, brokerClient, g.accountId, op));
    store.authorize(tokenHash('controlled-test-bearer'), owner, brokerClient, g.accountId, op);
    assert.equal(store.get(g.id).used, 1);
    assert.throws(() => store.authorize(tokenHash('controlled-test-bearer'), owner, brokerClient, g.accountId, op));
  } finally { store.close(); }
});
test('delegation: grant creation validates ownership, expiry, bounded write and unknown routes', () => {
  const s = new GrantStore(':memory:');
  try {
    for (const change of [{ accountId: accountIdFor('other') }, { expiresInSeconds: 86400 }, { maxOperations: 100 }, { path: '/wallet?owner=other' }, { provider: 'unknown' }, { method: 'POST', path: '/charges' }, { method: 'POST', path: '/topups', maxOperations: 1, body: { amountMinor: 10001, source: 'demo_approved' } }]) assert.throws(() => s.create(owner, { ...read(), ...change } as GrantInput));
    assert.equal(s.create(owner, { ...read(), method: 'POST', path: '/topups', maxOperations: 1, body: { amountMinor: 100, source: 'demo_approved' } }).body.amountMinor, 100);
    assert.throws(() => s.get(s.create(owner, read()).id, 'another-owner'));
  } finally { s.close(); }
});
test('delegation: revocation invalidates already bound credentials; expiry and unknown effects fail closed', () => {
  const s = new GrantStore(':memory:');
  try {
    const g = s.create(owner, read()), job = binding(s, g);
    s.revoke(g.id, owner);
    assert.throws(() => s.authorize(tokenHash('controlled-test-bearer'), owner, brokerClient, g.accountId, g));
    assert.throws(() => s.start(g.id, 'later'));
    const second = s.create(owner, read());
    const uncertain = s.start(second.id, 'timeout').job; s.finish(uncertain, { code: 'UNKNOWN' }, false);
    assert.throws(() => s.start(second.id, 'another'), /reconciliation/);
    assert.equal(s.start(second.id, 'timeout').replay, true);
    assert.ok(s.history(g.id, owner).some(e => e.event === 'consent.revoked'));
    assert.ok(!JSON.stringify(job).includes('access_token'));
  } finally { s.close(); }
});
test('delegation: two database connections serialize limits and retain consent/idempotency after restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-grants-')), path = join(dir, 'grants.sqlite');
  let a = new GrantStore(path); const b = new GrantStore(path);
  try {
    const g = a.create(owner, { ...read(), maxOperations: 1 }); const job = binding(a, g);
    assert.throws(() => b.start(g.id, 'parallel'), /reconciliation/);
    b.authorize(tokenHash('controlled-test-bearer'), owner, brokerClient, g.accountId, { provider: g.provider, method: g.method, path: g.path, body: g.body });
    a.finish(job, { success: true }, true); a.close(); a = new GrantStore(path);
    assert.equal(a.start(g.id, 'request-0001').job.state, 'completed');
    assert.throws(() => b.start(g.id, 'over-limit'));
    b.revoke(g.id, owner); assert.ok(a.get(g.id).revokedAt);
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('delegation: narrowing advances the grant version and never expands authority', () => {
  const s = new GrantStore(':memory:');
  try {
    const g = s.create(owner, read()); binding(s, g);
    const narrowed = s.narrow(g.id, owner, { maxOperations: 1, expiresAt: Date.now() + 60000 });
    assert.equal(narrowed.version, 2);
    assert.throws(() => s.authorize(tokenHash('controlled-test-bearer'), owner, brokerClient, g.accountId, g));
    assert.throws(() => s.narrow(g.id, owner, { maxOperations: 2, expiresAt: narrowed.expiresAt }));
    assert.throws(() => s.narrow(g.id, 'other', { maxOperations: 0, expiresAt: narrowed.expiresAt }));
  } finally { s.close(); }
});
test('delegation: expired consent cannot be used, independently of token expiry', t => {
  const s = new GrantStore(':memory:');
  try {
    const g = s.create(owner, read()); binding(s, g);
    t.mock.method(Date, 'now', () => g.expiresAt + 1);
    assert.throws(() => s.start(g.id, 'expired-request'));
    assert.throws(() => s.authorize(tokenHash('controlled-test-bearer'), owner, brokerClient, g.accountId, g));
  } finally { s.close(); }
});
