import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness } from './support.ts';

test('focused conversation quota preserves unresolved access and isolates residents', async () => {
  const h = await harness();
  try {
    const first = await h.thread(), root = `/api/agent/threads/${first}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    h.tools.pay.invoke = async () => { throw new Error('outcome unknown'); };
    assert.equal((await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' })).data.status, 'unknown');
    h.store.db.prepare('UPDATE sa_threads SET expires_at=0 WHERE id=?').run(first);
    const others: string[] = [];
    for (let i = 0; i < 63; i++) others.push(await h.thread());
    const denied = await h.req('/api/agent/threads', {});
    assert.equal(denied.status, 429); assert.equal(denied.data.code, 'THREAD_LIMIT_REACHED');
    assert.equal((await h.req(root)).data.status, 'unknown');
    assert.equal((await h.req('/api/agent/threads', {}, { token: h.identities[1].token })).status, 201);
    assert.equal((await h.req(`/api/agent/threads/${others[0]}/cancel`, {})).status, 200);
    assert.equal((await h.req('/api/agent/threads', {})).status, 201);
    h.store.db.prepare('UPDATE sa_threads SET expires_at=0 WHERE id=?').run(others[1]);
    assert.equal((await h.req('/api/agent/threads', {})).status, 201);
    assert.equal((await h.req(root)).data.status, 'unknown');
  } finally { await h.close(); }
});

test('focused global active conversation quota rejects new conversations', async () => {
  const h = await harness();
  try {
    const insert = h.store.db.prepare('INSERT INTO sa_threads(id,subject,workload,expires_at) VALUES(?,?,?,?)');
    h.store.db.transaction(() => { for (let i = 0; i < 1024; i++) insert.run(randomUUID(), `resident-${i}`, 'super-app-agent', Date.now() + 600000); })();
    const denied = await h.req('/api/agent/threads', {});
    assert.equal(denied.status, 429); assert.equal(denied.data.code, 'THREAD_LIMIT_REACHED');
  } finally { await h.close(); }
});


test('concurrent conversation creation cannot exceed the resident limit', async () => {
  const h = await harness();
  try {
    for (let i = 0; i < 63; i++) await h.thread();
    const results = await Promise.all([h.req('/api/agent/threads', {}), h.req('/api/agent/threads', {})]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 429]);
  } finally { await h.close(); }
});
