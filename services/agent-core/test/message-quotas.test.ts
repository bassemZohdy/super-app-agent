import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness } from './support.ts';

test('message quota survives restart and preserves replay, approval and unknown-outcome recovery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'message-quota-'));
  const file = join(dir, 'agent.sqlite');
  let h = await harness({ file });
  try {
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    for (let i = 0; i < 126; i++) h.store.beginMessage(id, `seed-${i}`, 'fixture');
    const first = await h.req(`${root}/messages`, { message: 'show fines' }, { key: 'list' });
    assert.equal(first.status, 200);
    const review = await h.req(`${root}/messages`, { message: 'pay fines' }, { key: 'review' });
    assert.equal(review.data.status, 'awaiting_approval');
    const original = h.tools.pay.invoke.bind(h.tools.pay); let calls = 0;
    h.tools.pay.invoke = async (...args) => { calls++; if (calls === 1) throw new Error('unknown'); return original(...args); };
    const approval = review.data.approval;
    const unknown = await h.req(`${root}/resume`, { approvalId: approval.id, decision: 'approve' });
    assert.equal(unknown.data.status, 'unknown');
    assert.equal((await h.req(root)).data.status, 'unknown');
    const recovered = await h.req(`${root}/recover`, {});
    assert.equal(recovered.data.status, 'complete'); assert.equal(calls, 2);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
    const denied = await h.req(`${root}/messages`, { message: 'show fines' }, { key: 'beyond' });
    assert.equal(denied.status, 429); assert.equal(denied.data.code, 'MESSAGE_LIMIT_REACHED');
    assert.deepEqual((await h.req(`${root}/messages`, { message: 'show fines' }, { key: 'list' })).data, first.data);
    const bob = await h.thread(h.identities[1].token);
    assert.equal((await h.req(`/api/agent/threads/${bob}/messages`, { message: 'show fines' }, { token: h.identities[1].token })).status, 200);
    const identities = h.identities;
    await h.close(); h = await harness({ file, identities });
    assert.equal((await h.req(`${root}/messages`, { message: 'show fines' })).data.code, 'MESSAGE_LIMIT_REACHED');
    assert.equal((await h.req(root)).data.status, 'complete');
    assert.deepEqual((await h.req(`${root}/messages`, { message: 'show fines' }, { key: 'list' })).data, first.data);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_message_requests WHERE thread_id=?').get(id) as { n: number }).n, 128);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('competing new messages cannot cross the per-conversation limit', async () => {
  const h = await harness();
  try {
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    for (let i = 0; i < 127; i++) h.store.beginMessage(id, `seed-${i}`, 'fixture');
    const results = await Promise.all(['one', 'two'].map(key => h.req(`${root}/messages`, { message: 'hello' }, { key })));
    assert.equal(results.filter(result => result.status === 200).length, 1);
    const rejected = results.findIndex(result => result.status !== 200);
    assert.ok([409, 429].includes(results[rejected].status));
    const retry = await h.req(`${root}/messages`, { message: 'hello' }, { key: ['one', 'two'][rejected] });
    assert.equal(retry.status, 429); assert.equal(retry.data.code, 'MESSAGE_LIMIT_REACHED');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_message_requests WHERE thread_id=?').get(id) as { n: number }).n, 128);
  } finally { await h.close(); }
});
