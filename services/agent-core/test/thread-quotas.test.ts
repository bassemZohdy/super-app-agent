import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('creation rate survives cancellation and restart without blocking existing conversations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-rate-'));
  const file = join(dir, 'agent.sqlite');
  let h = await harness({ file });
  try {
    const first = await h.thread();
    const principal = { subject: 'alice', workload: 'super-app-agent', permissions: ['fines:read'], expiresAt: Date.now() + 3600000 };
    for (let i = 0; i < 127; i++) h.store.cancelThread(h.store.createThread(principal));
    let denied = await h.req('/api/agent/threads', {});
    assert.equal(denied.status, 429); assert.equal(denied.data.code, 'THREAD_RATE_LIMIT_REACHED');
    assert.equal((await h.req(`/api/agent/threads/${first}`)).status, 200);
    assert.equal((await h.req('/api/agent/threads', {}, { token: h.identities[1].token })).status, 201);
    const identities = h.identities;
    await h.close();
    h = await harness({ file, identities });
    denied = await h.req('/api/agent/threads', {});
    assert.equal(denied.status, 429); assert.equal(denied.data.code, 'THREAD_RATE_LIMIT_REACHED');
    assert.equal((await h.req(`/api/agent/threads/${first}`)).status, 200);
    h.store.db.prepare('UPDATE sa_thread_creation_events SET created_at=? WHERE subject=?').run(Date.now() - 3600001, 'alice');
    assert.equal((await h.req('/api/agent/threads', {})).status, 201);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_thread_creation_events').get() as { n: number }).n, 2);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('global creation rate is enforced atomically across residents', async () => {
  const h = await harness();
  try {
    const insert = h.store.db.prepare('INSERT INTO sa_thread_creation_events(subject,created_at) VALUES(?,?)');
    h.store.db.transaction(() => { for (let i = 0; i < 4095; i++) insert.run(`seed-${i}`, Date.now()); })();
    const results = await Promise.all([h.req('/api/agent/threads', {}), h.req('/api/agent/threads', {}, { token: h.identities[1].token })]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 429]);
    assert.equal(results.find(result => result.status === 429)?.data.code, 'THREAD_RATE_LIMIT_REACHED');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_thread_creation_events').get() as { n: number }).n, 4096);
  } finally { await h.close(); }
});
