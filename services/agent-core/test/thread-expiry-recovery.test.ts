import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness } from './support.ts';
import { digest, quoteFor, type Principal } from '../src/orchestrator/contracts.ts';

for (const kind of ['payment', 'renewal'] as const) for (const legacy of [false, true]) test(`expired ${kind} conversation remains accessible only for its unresolved operation (legacy=${legacy})`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unresolved-thread-')), file = join(dir, 'agent.sqlite');
  const permissions = ['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew'] as Array<'fines:read' | 'fines:pay' | 'vehicles:read' | 'vehicles:renew'>;
  const identities = ['alice', 'bob'].map(subject => ({ token: randomBytes(32).toString('hex'), subject, permissions: [...permissions], expiresAt: Date.now() + 600000 }));
  let h = await harness({ file, identities });
  try {
    if (kind === 'renewal') {
      const principal: Principal = { subject: 'alice', workload: 'super-app-agent', permissions, expiresAt: identities[0].expiresAt };
      const quote = quoteFor(h.store.fines('alice')), key = digest({ subject: 'alice', operation: 'fines.pay.v1', quote }), consent = randomUUID();
      h.store.consent(consent, principal, key, quote, Date.now() + 60000);
      h.store.simulatePayment(principal, key, quote, consent);
    }
    const id = await h.thread(), unrelated = await h.thread(), competitor = await h.thread(), root = `/api/agent/threads/${id}`;
    const message = kind === 'payment' ? 'pay fines' : 'renew my vehicle';
    const review = await h.req(`${root}/messages`, { message });
    const competingReview = await h.req(`/api/agent/threads/${competitor}/messages`, { message });
    const approval = kind === 'payment' ? review.data.approval : review.data.renewalApproval;
    const competingApproval = kind === 'payment' ? competingReview.data.approval : competingReview.data.renewalApproval;
    const tool = kind === 'payment' ? h.tools.pay : h.vehicles.renew;
    const original = tool.invoke;
    if (kind === 'payment') h.tools.pay.invoke = async (...args) => { await (original as typeof h.tools.pay.invoke)(...args); throw new Error('lost response'); };
    else h.vehicles.renew.invoke = async (...args) => { await (original as typeof h.vehicles.renew.invoke)(...args); throw new Error('lost response'); };
    assert.equal((await h.req(`${root}/resume`, { approvalId: approval.id, decision: 'approve' })).data.status, 'unknown');
    assert.equal((await h.req(`/api/agent/threads/${competitor}/resume`, { approvalId: competingApproval.id, decision: 'approve' })).data.status, 'reconciliation_required');
    if (legacy) h.store.db.prepare('DELETE FROM sa_thread_operations WHERE thread_id=?').run(id);
    h.store.db.prepare('UPDATE sa_threads SET expires_at=0 WHERE id IN (?,?,?)').run(id, unrelated, competitor);
    h.store.db.prepare('UPDATE sa_consents SET expires_at=0 WHERE id=?').run(approval.id);
    await h.close(); h = await harness({ file, identities });
    assert.equal((await h.req(root, undefined, { token: identities[1].token })).status, 404);
    assert.equal((await h.req(`/api/agent/threads/${unrelated}`)).status, 410);
    assert.equal((await h.req(`/api/agent/threads/${competitor}`)).status, 410);
    assert.equal((await h.req(root)).data.status, 'unknown');
    assert.equal((await h.req(root, undefined, { token: identities[1].token })).status, 404);
    assert.equal((await h.req(`${root}/recover`, {})).data.status, 'unknown');
    assert.equal((await h.req(`${root}/cancel`, {})).status, 409);
    h.store.db.prepare('UPDATE sa_consents SET expires_at=? WHERE id=?').run(approval.expiresAt, approval.id);
    const recovered = await h.req(`${root}/recover`, {});
    assert.equal(recovered.data.status, 'complete');
    const receipt = kind === 'payment' ? recovered.data.receipt : recovered.data.renewal;
    assert.equal(receipt.idempotencyKey, approval.key);
    const table = kind === 'payment' ? 'sa_sim_payments' : 'sa_sim_renewals';
    assert.equal((h.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 1);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});


test('legacy unresolved operation without a saved approval is not guessed onto an expired thread', async () => {
  const h = await harness();
  try {
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    h.tools.pay.invoke = async () => { throw new Error('unknown outcome'); };
    assert.equal((await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' })).data.status, 'unknown');
    h.store.db.prepare('DELETE FROM sa_thread_operations WHERE thread_id=?').run(id);
    h.store.db.prepare('DELETE FROM sa_message_requests WHERE thread_id=?').run(id);
    h.store.db.prepare('DELETE FROM sa_requests WHERE thread_id=?').run(id);
    h.store.db.prepare('UPDATE sa_threads SET expires_at=0 WHERE id=?').run(id);
    h.store.setup();
    assert.equal((await h.req(root)).status, 410);
    const otherRoot = `/api/agent/threads/${await h.thread()}`;
    assert.equal((await h.req(`${otherRoot}/messages`, { message: 'pay fines' })).data.status, 'reconciliation_required');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
  } finally { await h.close(); }
});
