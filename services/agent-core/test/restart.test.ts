import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentProcess, harness } from './support.ts';

test('actual process kill/restart preserves SQLite approval and duplicate payment receipt', { timeout: 30000 }, async () => {
  const agent = agentProcess(['fines:read', 'fines:pay']);
  try {
    await agent.start();
    const id = (await agent.req('/api/agent/threads', {})).threadId, root = `/api/agent/threads/${id}`;
    const review = await agent.req(`${root}/messages`, { message: 'retrieve fines and pay them' });
    assert.equal(review.status, 'awaiting_approval');
    await agent.stop(); await agent.start();
    const restored = await agent.req(root); assert.deepEqual(restored.approval, review.approval);
    const command = { approvalId: restored.approval.id, decision: 'approve' };
    const paid = await agent.req(`${root}/resume`, command, 'approve-once');
    assert.equal(paid.status, 'complete'); assert.equal(paid.receipt.simulated, true);
    await agent.stop(); await agent.start();
    const duplicate = await agent.req(`${root}/resume`, command, 'approve-once');
    assert.deepEqual(duplicate, paid);
    assert.equal((await agent.req(`${root}/messages`, { message: 'list fines' })).fines.length, 0);
  } finally { await agent.close(); }
});

test('actual process kill/restart keeps both renewal approvals and the single effect behind each', { timeout: 45000 }, async () => {
  const agent = agentProcess(['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew']);
  try {
    await agent.start();
    const id = (await agent.req('/api/agent/threads', {})).threadId, root = `/api/agent/threads/${id}`;
    const review = await agent.req(`${root}/messages`, { message: 'renew my car registration' });
    assert.deepEqual(review.next, ['approval']);
    await agent.stop(); await agent.start();
    assert.deepEqual((await agent.req(root)).approval, review.approval);
    const paid = await agent.req(`${root}/resume`, { approvalId: review.approval.id, decision: 'approve' }, 'pay-once');
    assert.deepEqual(paid.next, ['renewApproval']); assert.equal(paid.receipt.simulated, true);
    await agent.stop(); await agent.start();
    const restored = await agent.req(root);
    assert.deepEqual(restored.renewalApproval, paid.renewalApproval); assert.equal(restored.approval, null);
    assert.equal(restored.surface.revision, paid.renewalApproval.id);
    const command = { approvalId: restored.renewalApproval.id, decision: 'approve' };
    const renewed = await agent.req(`${root}/resume`, command, 'renew-once');
    assert.equal(renewed.status, 'complete'); assert.equal(renewed.renewal.idempotencyKey, paid.renewalApproval.key);
    await agent.stop(); await agent.start();
    assert.deepEqual(await agent.req(`${root}/resume`, command, 'renew-once'), renewed);
    assert.deepEqual((await agent.req(root)).renewal, renewed.renewal);
    assert.equal((await agent.req(`${root}/messages`, { message: 'renew my car registration' })).status, 'complete', 'an already renewed vehicle is not offered again');
  } finally { await agent.close(); }
});

test('lost payment response reconciles original operation after reopening SQLite without a second effect', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-unknown-')), file = join(dir, 'agent.sqlite');
  let h = await harness({ file });
  try {
    const identities = h.identities, id = await h.thread(), root = `/api/agent/threads/${id}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const original = h.tools.pay.invoke;
    h.tools.pay.invoke = async (...args) => { await original(...args); throw new Error('response lost after commit'); };
    const unknown = await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' });
    assert.equal(unknown.data.status, 'unknown');
    assert.equal((await h.req(`${root}/messages`, { message: 'pay fines' })).status, 409);
    assert.equal((await h.req(`${root}/cancel`, {})).status, 409);
    await h.close();
    h = await harness({ file, identities });
    const recovered = await h.req(`${root}/recover`, {});
    assert.equal(recovered.data.status, 'complete');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
    assert.equal(recovered.data.receipt.idempotencyKey, review.data.approval.key);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});
