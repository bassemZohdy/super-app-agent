import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness } from './support.ts';

test('recovery rate limit survives reopen without losing the original operation or replay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'recovery-rate-'));
  const file = join(dir, 'agent.sqlite');
  let h = await harness({ file });
  try {
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    h.tools.pay.invoke = async () => { throw new Error('unknown'); };
    assert.equal((await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' })).data.status, 'unknown');
    for (let i = 0; i < 15; i++) h.store.admitRecovery(id);
    const first = await h.req(`${root}/recover`, {}, { key: 'first-retry' });
    assert.equal(first.data.status, 'unknown');
    const denied = await h.req(`${root}/recover`, {}, { key: 'later-retry' });
    assert.equal(denied.status, 429); assert.equal(denied.data.code, 'RECOVERY_RATE_LIMIT_REACHED');
    const limited = await fetch(new URL(`${root}/recover`, h.base), { method: 'POST', headers: { Authorization: `Bearer ${h.identities[0].token}`, 'Idempotency-Key': 'another-retry', 'Content-Type': 'application/json', Origin: 'http://localhost:3002' }, body: '{}' });
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
    assert.equal(limited.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
    const streamed = await fetch(new URL(`${root}/recover`, h.base), { method: 'POST', headers: { Authorization: `Bearer ${h.identities[0].token}`, 'Idempotency-Key': 'stream-retry', 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: '{}' });
    assert.equal(streamed.status, 200); assert.match(await streamed.text(), /event: error\ndata: .*RECOVERY_RATE_LIMIT_REACHED/);
    assert.deepEqual((await h.req(`${root}/recover`, {}, { key: 'first-retry' })).data, first.data);
    assert.equal((await h.req(`${root}/messages`, { message: 'show fines' }, { key: 'first-retry' })).data.code, 'REQUEST_ID_CONFLICT');
    assert.equal((await h.req(root)).data.status, 'unknown');
    const other = await h.thread(h.identities[1].token);
    assert.equal((await h.req(`/api/agent/threads/${other}/recover`, {}, { token: h.identities[1].token })).status, 200);
    const identities = h.identities;
    await h.close(); h = await harness({ file, identities });
    assert.equal((await h.req(`${root}/recover`, {}, { key: 'later-retry' })).data.code, 'RECOVERY_RATE_LIMIT_REACHED');
    h.store.db.prepare('UPDATE sa_recovery_events SET created_at=? WHERE thread_id=?').run(Date.now() - 60001, id);
    const recovered = await h.req(`${root}/recover`, {}, { key: 'later-retry' });
    assert.equal(recovered.data.status, 'complete');
    assert.equal(recovered.data.receipt.idempotencyKey, review.data.approval.key);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_recovery_events WHERE thread_id=?').get(id) as { n: number }).n, 1);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});
