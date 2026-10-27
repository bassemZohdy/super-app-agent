import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness } from './support.ts';
import http from 'node:http';
import { CompatiblePlanner } from '../src/orchestrator/planner.ts';

test('a model-selected payment review pauses for approval and chat assent cannot execute it', async () => {
  const model = http.createServer((request, response) => {
    request.resume(); response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: 'pay_fines', fineIds: [] }) } }] }));
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  const base = new URL(`http://127.0.0.1:${(model.address() as { port: number }).port}/v1/`);
  const h = await harness({ planner: new CompatiblePlanner(base, 'test-model') });
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: 'Retrieve my fines and review paying them' });
    assert.equal(review.status, 200); assert.equal(review.data.status, 'awaiting_approval');
    assert.equal(review.data.approval.quote.amountMinor, 45000);
    const count = () => (h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n;
    assert.equal(count(), 0);
    assert.equal((await h.req(`${root}/messages`, { message: 'yes' })).status, 409);
    assert.equal(count(), 0);
  } finally {
    await h.close();
    await new Promise<void>(resolve => { model.close(() => resolve()); model.closeIdleConnections(); });
  }
});
import { quoteFor, digest } from '../src/orchestrator/contracts.ts';
import { validateAGUISurface } from '../../../packages/protocol-core/src/ag-ui.ts';

test('local comparison shells can preflight the focused API while untrusted browser origins are refused', async () => {
  const h = await harness();
  try {
    for (const origin of ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002']) {
      const preflight = await fetch(new URL('/api/agent/threads', h.base), { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' } });
      assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
      const denied = await fetch(new URL('/api/agent/threads', h.base), { method: 'POST', headers: { Origin: origin }, body: '{}' });
      assert.equal(denied.status, 401, 'CORS never grants identity or authority');
    }
    const untrusted = await h.req('/api/agent/threads', {}, { headers: { Origin: 'https://untrusted.invalid' } });
    assert.equal(untrusted.status, 403);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_threads').get() as { n: number }).n, 0);
  } finally { await h.close(); }
});

test('HTTP vertical slice: list → multi-turn pay → durable interrupt → approval → exactly one simulated effect', async () => {
  const h = await harness();
  try {
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    const list = await h.req(`${root}/messages`, { message: 'show outstanding fines' });
    assert.equal(list.status, 200); assert.equal(list.data.fines.length, 2);
    const review = await h.req(`${root}/messages`, { message: 'pay them' }, { key: 'review' });
    assert.equal(review.data.status, 'awaiting_approval');
    assert.deepEqual(review.data.next, ['approval']);
    assert.equal(review.data.approval.quote.amountMinor, 45000);
    assert.deepEqual(review.data.messages.map((message: { role: string }) => message.role), ['user', 'assistant', 'user']);
    assert.equal(validateAGUISurface(review.data.surface).success, true);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
    const command = { approvalId: review.data.approval.id, decision: 'approve' };
    const paid = await h.req(`${root}/resume`, command, { key: 'approval' });
    assert.equal(paid.status, 200); assert.equal(paid.data.status, 'complete'); assert.equal(paid.data.receipt.simulated, true);
    const duplicate = await h.req(`${root}/resume`, command, { key: 'approval' });
    assert.deepEqual(duplicate.data, paid.data);
    assert.equal((await h.req(`${root}/resume`, command)).status, 409);
    const replay = await h.req('/simulator/v1/payments', { quote: review.data.approval.quote, consentId: review.data.approval.id }, { key: paid.data.receipt.idempotencyKey, headers: { 'X-Agent-Key': h.workloadKey } });
    assert.equal(replay.data.id, paid.data.receipt.id);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
    assert.equal((await h.req(`${root}/messages`, { message: 'pay fines' })).data.status, 'complete');
    assert.equal((await h.req(`${root}/messages`, { message: 'show fines' }, { key: 'review' })).status, 409);
  } finally { await h.close(); }
});

test('the shell review shows only the selected fine set and AED values; cancelled threads stay inspectable', async () => {
  const h = await harness();
  try {
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fine-1' });
    const table = review.data.surface.view.children.find((node: { type: string }) => node.type === 'DataTable');
    assert.deepEqual(table.properties.rows, [{ id: 'fine-1', description: 'Simulated parking fine', amount: '150.00' }]);
    assert.equal(review.data.approval.quote.amountMinor, 15000);
    assert.equal((await h.req(`${root}/cancel`, {})).data.status, 'cancelled');
    assert.equal((await h.req(root)).data.status, 'cancelled');
    assert.equal((await h.req(`${root}/messages`, { message: 'pay fines' })).status, 409);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
  } finally { await h.close(); }
});

test('authority is enforced independently at API, owner, graph and simulator boundaries', async () => {
  const h = await harness();
  try {
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    assert.equal((await h.req(root, undefined, { token: 'invalid' })).status, 401);
    assert.equal((await h.req(root, undefined, { token: h.identities[1].token })).status, 404);
    const bob = await h.thread(h.identities[1].token);
    assert.equal((await h.req(`/api/agent/threads/${bob}/messages`, { message: 'pay fines' }, { token: h.identities[1].token })).status, 403);
    assert.equal((await h.req('/simulator/v1/fines')).status, 403);
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    h.identities[0].permissions = ['fines:read'];
    const denied = await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' });
    assert.equal(denied.data.status, 'denied');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
    h.identities[0].expiresAt = Date.now() - 1;
    assert.equal((await h.req(root)).status, 401);
  } finally { await h.close(); }
});

test('approval tampering, chat assent, rejection and cancellation never execute payment', async () => {
  const h = await harness();
  try {
    for (const decision of ['reject', 'cancel']) {
      const id = await h.thread(), root = `/api/agent/threads/${id}`;
      const review = await h.req(`${root}/messages`, { message: 'pay fine-1' });
      assert.equal((await h.req(`${root}/resume`, { approvalId: randomUUID(), decision: 'approve' })).status, 409);
      assert.equal((await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve', amountMinor: 1 })).status, 400);
      assert.equal((await h.req(`${root}/messages`, { message: 'yes' })).status, 409);
      const done = await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision });
      assert.equal(done.data.status, decision === 'reject' ? 'rejected' : 'cancelled');
    }
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    await h.req(`${root}/messages`, { message: 'pay fines' });
    assert.equal((await h.req(`${root}/cancel`, {})).data.status, 'cancelled');
    assert.equal((await h.req(`${root}/messages`, { message: 'pay fines' })).status, 409);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
  } finally { await h.close(); }
});

test('missing/expired consent, expired approvals and changed server quotes fail closed', async () => {
  const h = await harness({ approvalTtlMs: 5 });
  try {
    const quote = quoteFor(h.store.fines('alice')), key = digest(quote);
    assert.throws(() => h.store.simulatePayment({ subject: 'alice', workload: 'super-app-agent', permissions: ['fines:pay'], expiresAt: Date.now() + 10000 }, key, quote, randomUUID()), /CONSENT_REQUIRED_OR_EXPIRED/);
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' })).data.status, 'expired');
    const principal = { subject: 'alice', workload: 'super-app-agent', permissions: ['fines:pay'], expiresAt: Date.now() + 10000 };
    const consentId = randomUUID();
    h.store.consent(consentId, principal, key, quote, Date.now() + 1000);
    h.store.db.prepare('UPDATE sa_consents SET expires_at=0 WHERE id=?').run(consentId);
    assert.throws(() => h.store.simulatePayment(principal, key, quote, consentId), /CONSENT_REQUIRED_OR_EXPIRED/);
    h.store.db.prepare('UPDATE sa_consents SET expires_at=? WHERE id=?').run(Date.now() + 10000, consentId);
    const changed = { ...quote, amountMinor: quote.amountMinor + 1 };
    assert.throws(() => h.store.simulatePayment(principal, key, changed, consentId), /CONSENT_REQUIRED_OR_EXPIRED/);
    h.store.db.prepare('UPDATE sa_sim_fines SET fine=? WHERE subject=? AND id=?').run(JSON.stringify({ id: 'fine-1', description: 'Changed fine', amountMinor: 1, version: 2 }), 'alice', 'fine-1');
    assert.throws(() => h.store.simulatePayment(principal, key, quote, consentId), /QUOTE_STALE/);
  } finally { await h.close(); }
});

test('invalid/unavailable planner, out-of-scope and bounded plans never invoke consequential tools', async () => {
  const h = await harness({ planner: { plan: async () => { throw new Error('private provider detail'); } } });
  try {
    const id = await h.thread();
    const result = await h.req(`/api/agent/threads/${id}/messages`, { message: 'pay fines' });
    assert.equal(result.data.status, 'model_unavailable');
    assert.equal(JSON.stringify(result.data).includes('private provider detail'), false);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_accounts').get() as { n: number }).n, 0);
  } finally { await h.close(); }
  const bounded = await harness({ planner: { plan: async () => ({ intent: 'pay_fines', fineIds: Array(11).fill('fine-1') }) } });
  try {
    const id = await bounded.thread();
    assert.equal((await bounded.req(`/api/agent/threads/${id}/messages`, { message: 'pay fines' })).data.status, 'model_unavailable');
  } finally { await bounded.close(); }
});

test('credentials stay outside checkpoint tables; streaming reports bounded node events', async () => {
  const h = await harness();
  try {
    const id = await h.thread();
    const res = await fetch(new URL(`/api/agent/threads/${id}/messages`, h.base), { method: 'POST', headers: { Authorization: `Bearer ${h.identities[0].token}`, Accept: 'text/event-stream', 'Idempotency-Key': 'stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'pay fines' }) });
    const text = await res.text(); assert.match(text, /event: progress/); assert.match(text, /event: result/);
    const tables = h.saver.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const rows = h.saver.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all();
      const serialized = JSON.stringify(rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : value]))));
      assert.equal(serialized.includes(h.identities[0].token), false, name);
      assert.equal(serialized.includes(h.workloadKey), false, name);
    }
  } finally { await h.close(); }
});

test('two independently approved threads cannot pay the same fine set twice', async () => {
  const h = await harness();
  try {
    const roots = await Promise.all([h.thread(), h.thread()]).then(ids => ids.map(id => `/api/agent/threads/${id}`));
    const reviews = await Promise.all(roots.map(root => h.req(`${root}/messages`, { message: 'pay fines' })));
    assert.equal(reviews[0].data.approval.key, reviews[1].data.approval.key);
    const payments = await Promise.all(roots.map((root, i) => h.req(`${root}/resume`, { approvalId: reviews[i].data.approval.id, decision: 'approve' })));
    assert.equal(payments[0].data.status, 'complete'); assert.equal(payments[1].data.status, 'complete');
    assert.equal(payments[0].data.receipt.id, payments[1].data.receipt.id);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
  } finally { await h.close(); }
});

test('concurrent transitions on one thread refuse the overlap', async () => {
  let unblock!: () => void;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  const h = await harness({ planner: { plan: async () => { await gate; return { intent: 'list_fines', fineIds: [] }; } } });
  try {
    const id = await h.thread();
    const first = h.req(`/api/agent/threads/${id}/messages`, { message: 'fines' });
    // Wait for the graph to enter the planner, without racing a fixed delay.
    while (!h.saver.db.prepare('SELECT 1 FROM sa_requests WHERE thread_id=?').get(id)) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal((await h.req(`/api/agent/threads/${id}/messages`, { message: 'fines' })).status, 409);
    unblock(); assert.equal((await first).status, 200);
  } finally { unblock(); await h.close(); }
});
