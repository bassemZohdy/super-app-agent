import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { TestAuthenticator, type Authenticator, type TestIdentity } from '../src/orchestrator/auth.ts';
import { harness } from './support.ts';

test('disconnect during reauthentication stops actions before dispatch', { timeout: 5000 }, async () => {
  const identity: TestIdentity = { token: randomBytes(32).toString('hex'), subject: 'alice', permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 600000 };
  const delegate = new TestAuthenticator([identity], 'super-app-agent');
  let remaining = 0, entered: (() => void) | undefined, release: Promise<void> = Promise.resolve();
  const auth: Authenticator = { async authenticate(header) {
    const principal = await delegate.authenticate(header);
    if (remaining && --remaining === 0) { entered?.(); await release; }
    return principal;
  } };
  const h = await harness({ identities: [identity], authenticator: auth });
  async function disconnect(path: string, body: unknown, extra: Record<string, string> = {}, authAttempt = 2) {
    let unblock!: () => void, reached!: () => void;
    release = new Promise<void>(resolve => { unblock = resolve; });
    const atRecheck = new Promise<void>(resolve => { reached = resolve; }); entered = reached; remaining = authAttempt;
    const closedOnServer = new Promise<void>(resolve => h.server.once('connection', socket => socket.once('close', () => resolve())));
    const request = http.request(new URL(path, h.base), { method: 'POST', agent: false, headers: { Authorization: `Bearer ${identity.token}`, 'Idempotency-Key': 'disconnect', 'Content-Type': 'application/json', ...extra } });
    request.on('error', () => {}); request.end(JSON.stringify(body));
    await atRecheck;
    request.destroy();
    await closedOnServer;
    unblock();
    await new Promise<void>(resolve => setTimeout(resolve, 30));
  }
  try {
    await disconnect('/api/agent/threads', {}, {}, 1);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_threads').get() as { n: number }).n, 0);
    await disconnect('/api/agent/threads', {});
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_threads').get() as { n: number }).n, 0);
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    await disconnect(`${root}/cancel`, {});
    assert.equal((await h.req(root)).data.status, 'new');
    await disconnect(`${root}/messages`, { message: 'pay fines' });
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_requests').get() as { n: number }).n, 0);
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const approval = review.data.approval;
    h.store.consent(approval.id, { subject: 'alice', workload: 'super-app-agent', permissions: identity.permissions, expiresAt: identity.expiresAt }, approval.key, approval.quote, approval.expiresAt);
    await disconnect('/simulator/v1/payments', { quote: approval.quote, consentId: approval.id }, { 'X-Agent-Key': h.workloadKey, 'Idempotency-Key': approval.key });
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
    assert.equal((await h.req(`${root}/resume`, { approvalId: approval.id, decision: 'approve' })).data.status, 'complete');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
  } finally { await h.close(); }
});

test('a disconnected client does not interrupt an already committed payment', { timeout: 5000 }, async () => {
  const h = await harness();
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const invoke = h.tools.pay.invoke.bind(h.tools.pay);
    let committed!: () => void, release!: () => void;
    const afterCommit = new Promise<void>(resolve => { committed = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    h.tools.pay.invoke = async (...args) => { const receipt = await invoke(...args); committed(); await wait; return receipt; };
    const request = http.request(new URL(`${root}/resume`, h.base), { method: 'POST', agent: false, headers: { Authorization: `Bearer ${h.identities[0].token}`, 'Idempotency-Key': 'dispatched', 'Content-Type': 'application/json' } });
    request.on('error', () => {}); request.end(JSON.stringify({ approvalId: review.data.approval.id, decision: 'approve' }));
    await afterCommit;
    request.destroy(); release();
    let status = '';
    for (let i = 0; i < 100 && status !== 'complete'; i++) {
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      status = (await h.req(root)).data.status;
    }
    assert.equal(status, 'complete');
    const replay = await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' }, { key: 'dispatched' });
    assert.equal(replay.data.status, 'complete');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
  } finally { await h.close(); }
});
