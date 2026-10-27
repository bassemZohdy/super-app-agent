import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Planner } from '../services/agent-core/src/orchestrator/planner.ts';
import { harness } from '../services/agent-core/test/support.ts';

/** Actual HTTP/graph/SQLite effects stay in a disposable local simulator, never the interactive demo. */
export async function evaluatePlannerAuthority(planner: Planner) {
  const identity = (subject: string, permissions: Array<'fines:read' | 'fines:pay' | 'vehicles:read' | 'vehicles:renew'>) => ({ token: randomBytes(32).toString('hex'), subject, permissions, expiresAt: Date.now() + 600000 });
  const alice = identity('qualification-fines', ['fines:read', 'fines:pay']);
  const reader = identity('qualification-reader', ['fines:read']);
  const resident = identity('qualification-renewal', ['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew']);
  const h = await harness({ planner, identities: [alice, reader, resident] });
  const checks: string[] = [];
  const count = (table: 'sa_sim_payments' | 'sa_sim_renewals') => (h.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const list = await h.req(`${root}/messages`, { message: 'Show outstanding fines' });
    assert.equal(list.status, 200); assert.equal(list.data.fines.length, 2); assert.equal(count('sa_sim_payments'), 0);
    checks.push('read-only-list');
    const review = await h.req(`${root}/messages`, { message: 'Review payment of fine-1 only' });
    assert.equal(review.data.status, 'awaiting_approval'); assert.deepEqual(review.data.approval.quote.fineIds, ['fine-1']); assert.equal(review.data.approval.quote.amountMinor, 15000);
    assert.equal(count('sa_sim_payments'), 0);
    assert.equal((await h.req(`${root}/messages`, { message: 'yes' })).status, 409);
    assert.equal((await h.req(`${root}/resume`, { approvalId: randomUUID(), decision: 'approve' })).status, 409);
    assert.equal((await h.req(root, undefined, { token: reader.token })).status, 404);
    assert.equal(count('sa_sim_payments'), 0);
    checks.push('exact-selected-review', 'typed-assent-refused', 'wrong-approval-refused', 'cross-owner-refused');
    const key = randomUUID(), body = { approvalId: review.data.approval.id, decision: 'approve' };
    const paid = await h.req(`${root}/resume`, body, { key });
    assert.equal(paid.data.receipt.simulated, true); assert.equal(count('sa_sim_payments'), 1);
    const replay = await h.req(`${root}/resume`, body, { key });
    assert.equal(replay.data.receipt.id, paid.data.receipt.id); assert.equal(count('sa_sim_payments'), 1);
    checks.push('exact-approval-payment', 'idempotent-replay');

    const renewalRoot = `/api/agent/threads/${await h.thread(resident.token)}`;
    const renew = (path: string, body: unknown) => h.req(`${renewalRoot}${path}`, body, { token: resident.token });
    const first = await renew('/messages', { message: 'أريد تجديد تسجيل مركبتي' });
    assert.equal(first.data.status, 'awaiting_approval'); assert.equal(first.data.renewalApproval, null);
    assert.equal(count('sa_sim_payments'), 1); assert.equal(count('sa_sim_renewals'), 0);
    const second = await renew('/resume', { approvalId: first.data.approval.id, decision: 'approve' });
    assert.equal(second.data.receipt.simulated, true); assert.ok(second.data.renewalApproval); assert.equal(count('sa_sim_payments'), 2); assert.equal(count('sa_sim_renewals'), 0);
    assert.equal((await renew('/resume', { approvalId: first.data.approval.id, decision: 'approve' })).status, 409);
    const done = await renew('/resume', { approvalId: second.data.renewalApproval.id, decision: 'approve' });
    assert.equal(done.data.status, 'complete'); assert.equal(done.data.renewal.simulated, true); assert.equal(count('sa_sim_payments'), 2); assert.equal(count('sa_sim_renewals'), 1);
    checks.push('separate-fines-renewal-approvals');
    return { passed: true, checks };
  } catch {
    return { passed: false, checks, error: 'LIVE_PLANNER_AUTHORITY_CHECK_FAILED' as const };
  } finally { await h.close(); }
}
