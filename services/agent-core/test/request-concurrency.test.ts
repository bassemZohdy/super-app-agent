import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { TestAuthenticator, type Authenticator, type TestIdentity } from '../src/orchestrator/auth.ts';
import { harness } from './support.ts';

test('public and trusted simulator request limits are separate and released after work completes', { timeout: 10000 }, async () => {
  const identity: TestIdentity = { token: randomBytes(32).toString('hex'), subject: 'alice', permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 600000 };
  const delegate = new TestAuthenticator([identity], 'super-app-agent');
  let remaining = 0, entered = 0, notify: (() => void) | undefined, release: Promise<void> = Promise.resolve();
  const auth: Authenticator = { async authenticate(header) {
    const principal = await delegate.authenticate(header);
    if (remaining > 0) { remaining--; entered++; if (entered === 2) notify?.(); await release; }
    return principal;
  } };
  const h = await harness({ identities: [identity], authenticator: auth, maxPublicRequests: 2, maxSimulatorRequests: 2 });
  let unblock = () => {};
  function blockTwo() {
    entered = 0; remaining = 2;
    release = new Promise<void>(resolve => { unblock = resolve; });
    return new Promise<void>(resolve => { notify = resolve; });
  }
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const approval = review.data.approval;
    h.store.consent(approval.id, { subject: identity.subject, workload: 'super-app-agent', permissions: identity.permissions, expiresAt: identity.expiresAt }, approval.key, approval.quote, approval.expiresAt);
    let blocked = blockTwo();
    const publicRequests = [h.req('/api/agent/threads', {}), h.req('/api/agent/threads', {})];
    await blocked;
    const overloaded = await h.req('/api/agent/threads', {});
    assert.equal(overloaded.status, 503); assert.equal(overloaded.data.code, 'SERVER_BUSY');
    assert.equal((await h.req('/simulator/v1/fines')).status, 503, 'missing workload key must not use the reserved pool');
    assert.equal((await fetch(new URL('/live', h.base))).status, 200);
    const payment = await h.req('/simulator/v1/payments', { quote: approval.quote, consentId: approval.id }, { key: approval.key, headers: { 'X-Agent-Key': h.workloadKey } });
    assert.equal(payment.status, 200);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
    unblock(); assert.deepEqual((await Promise.all(publicRequests)).map(result => result.status), [201, 201]);

    blocked = blockTwo();
    const simulatorRequests = [h.req('/simulator/v1/fines', undefined, { headers: { 'X-Agent-Key': h.workloadKey } }), h.req('/simulator/v1/fines', undefined, { headers: { 'X-Agent-Key': h.workloadKey } })];
    await blocked;
    const overloadedSimulator = await h.req('/simulator/v1/fines', undefined, { headers: { 'X-Agent-Key': h.workloadKey } });
    assert.equal(overloadedSimulator.status, 503); assert.equal(overloadedSimulator.data.code, 'SERVER_BUSY');
    assert.equal((await h.req('/api/agent/threads', {})).status, 201);
    unblock(); assert.deepEqual((await Promise.all(simulatorRequests)).map(result => result.status), [200, 200]);
    assert.equal((await h.req('/simulator/v1/fines', undefined, { headers: { 'X-Agent-Key': h.workloadKey } })).status, 200);
  } finally { unblock(); await h.close(); }
});

test('a disconnect does not free a slot while authentication is still running', { timeout: 5000 }, async () => {
  const identity: TestIdentity = { token: randomBytes(32).toString('hex'), subject: 'alice', permissions: ['fines:read'], expiresAt: Date.now() + 600000 };
  const delegate = new TestAuthenticator([identity], 'super-app-agent');
  let reached!: () => void, unblock!: () => void, shouldBlock = true;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const release = new Promise<void>(resolve => { unblock = resolve; });
  const auth: Authenticator = { async authenticate(header) { const principal = await delegate.authenticate(header); if (shouldBlock) { shouldBlock = false; reached(); await release; } return principal; } };
  const h = await harness({ identities: [identity], authenticator: auth, maxPublicRequests: 1 });
  try {
    const closed = new Promise<void>(resolve => h.server.once('connection', socket => socket.once('close', () => resolve())));
    const request = http.request(new URL('/api/agent/threads', h.base), { method: 'POST', agent: false, headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' } });
    request.on('error', () => {}); request.end('{}');
    await entered; request.destroy(); await closed;
    assert.equal((await h.req('/api/agent/threads', {})).data.code, 'SERVER_BUSY');
    unblock();
    let status = 503;
    for (let i = 0; i < 100 && status === 503; i++) { await new Promise<void>(resolve => setTimeout(resolve, 10)); status = (await h.req('/api/agent/threads', {})).status; }
    assert.equal(status, 201);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_threads').get() as { n: number }).n, 1);
  } finally { unblock(); await h.close(); }
});


test('one resident cannot consume another resident’s public slots or the simulator reserve', { timeout: 20000 }, async () => {
  const alice: TestIdentity = { token: randomBytes(32).toString('hex'), subject: 'alice', permissions: ['fines:read'], expiresAt: Date.now() + 600000 };
  const aliceOther: TestIdentity = { ...alice, token: randomBytes(32).toString('hex') };
  const bob: TestIdentity = { token: randomBytes(32).toString('hex'), subject: 'bob', permissions: ['fines:read'], expiresAt: Date.now() + 600000 };
  const delegate = new TestAuthenticator([alice, aliceOther, bob], 'super-app-agent');
  let entered!: () => void;
  const authenticated = new Promise<void>(resolve => { entered = resolve; });
  const auth: Authenticator = { async authenticate(header) { const principal = await delegate.authenticate(header); if (principal.subject === 'alice') entered(); return principal; } };
  const h = await harness({ identities: [alice, aliceOther, bob], authenticator: auth, maxPublicRequests: 4, maxSimulatorRequests: 1, maxSubjectPublicRequests: 1 });
  const held = http.request(new URL('/api/agent/threads', h.base), { method: 'POST', agent: false, headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json', 'Content-Length': '2' } });
  held.on('error', () => {});
  const completed = new Promise<number>((resolve, reject) => { held.once('response', response => { response.resume(); response.once('end', () => resolve(response.statusCode!)); }); held.once('error', reject); });
  void completed.catch(() => {});
  try {
    held.write('{'); await authenticated; await new Promise(resolve => setImmediate(resolve));
    const limited = await h.req('/api/agent/threads', {}, { token: aliceOther.token });
    assert.equal(limited.status, 429); assert.equal(limited.data.code, 'SUBJECT_BUSY');
    assert.equal((await h.req('/api/agent/threads', {}, { token: bob.token })).status, 201);
    assert.equal((await h.req('/simulator/v1/fines', undefined, { token: alice.token, headers: { 'X-Agent-Key': h.workloadKey } })).status, 200);
    assert.equal((await fetch(new URL('/live', h.base))).status, 200);
    held.end('}'); assert.equal(await completed, 201);
    const thread = await h.thread();
    const malformed = await fetch(new URL(`/api/agent/threads/${thread}/messages`, h.base), { method: 'POST', headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'invalid-body' }, body: 'invalid' });
    assert.equal(malformed.status, 400, 'failed requests also release the resident slot');
    assert.equal((await h.req('/api/agent/threads', {}, { token: alice.token })).status, 201);
  } finally { held.destroy(); await h.close(); }
});


test('a disconnected payment retains the resident slot until the original effect finishes', { timeout: 20000 }, async () => {
  const alice: TestIdentity = { token: randomBytes(32).toString('hex'), subject: 'alice', permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 600000 };
  const bob: TestIdentity = { token: randomBytes(32).toString('hex'), subject: 'bob', permissions: ['fines:read'], expiresAt: Date.now() + 600000 };
  const h = await harness({ identities: [alice, bob], maxSubjectPublicRequests: 1, timeoutMs: 10000 });
  let entered!: () => void, unblock!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { unblock = resolve; });
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const approval = review.data.approval;
    const original = h.tools.pay.invoke;
    h.tools.pay.invoke = async (...args) => { entered(); await held; return original(...args); };
    const closed = new Promise<void>(resolve => h.server.once('connection', socket => socket.once('close', () => resolve())));
    const request = http.request(new URL(`${root}/resume`, h.base), { method: 'POST', agent: false, headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'resume-original' } });
    request.on('error', () => {});
    request.end(JSON.stringify({ approvalId: approval.id, decision: 'approve' }));
    await reached; request.destroy(); await closed;
    const denied = await h.req('/api/agent/threads', {}, { token: alice.token });
    assert.equal(denied.status, 429); assert.equal(denied.data.code, 'SUBJECT_BUSY');
    assert.equal((await h.req('/api/agent/threads', {}, { token: bob.token })).status, 201);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
    unblock();
    let status = 429;
    for (let i = 0; i < 200 && status === 429; i++) { await new Promise<void>(resolve => setTimeout(resolve, 10)); status = (await h.req('/api/agent/threads', {}, { token: alice.token })).status; }
    assert.equal(status, 201);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
  } finally { unblock(); await h.close(); }
});
