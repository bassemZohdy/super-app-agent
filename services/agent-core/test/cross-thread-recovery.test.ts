import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './support.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError, digest, quoteFor, type Principal } from '../src/orchestrator/contracts.ts';

test('an unresolved payment blocks another conversation across reopen and a previously opened approval', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cross-thread-recovery-')), file = join(dir, 'agent.sqlite');
  let h = await harness({ file });
  try {
    const firstRoot = `/api/agent/threads/${await h.thread()}`;
    const secondRoot = `/api/agent/threads/${await h.thread()}`;
    const first = await h.req(`${firstRoot}/messages`, { message: 'pay fines' });
    const second = await h.req(`${secondRoot}/messages`, { message: 'pay fines' });
    assert.equal(first.data.status, 'awaiting_approval');
    assert.equal(second.data.status, 'awaiting_approval');
    let original = h.tools.pay.invoke;
    let invocations = 0;
    h.tools.pay.invoke = async (...args) => { invocations++; if (invocations === 1) throw new Error('outcome unknown'); return original(...args); };
    const unknown = await h.req(`${firstRoot}/resume`, { approvalId: first.data.approval.id, decision: 'approve' });
    assert.equal(unknown.data.status, 'unknown');
    const identities = h.identities;
    await h.close();
    h = await harness({ file, identities });
    original = h.tools.pay.invoke;
    h.tools.pay.invoke = async (...args) => { invocations++; return original(...args); };
    const blocked = await h.req(`${secondRoot}/resume`, { approvalId: second.data.approval.id, decision: 'approve' });
    assert.equal(blocked.data.status, 'reconciliation_required');
    assert.equal(invocations, 1, 'the other approval does not dispatch a replacement');
    const thirdRoot = `/api/agent/threads/${await h.thread()}`;
    const third = await h.req(`${thirdRoot}/messages`, { message: 'pay fines' });
    assert.equal(third.data.status, 'reconciliation_required');
    assert.equal(third.data.approval, null);
    const readOnly = await h.req(`${thirdRoot}/messages`, { message: 'show fines' });
    assert.equal(readOnly.data.status, 'complete');
    assert.equal(readOnly.data.fines.length, 2);
    const recovered = await h.req(`${firstRoot}/recover`, {});
    assert.equal(recovered.data.status, 'complete');
    assert.equal(invocations, 2);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});


test('a contradictory simulator refusal after payment stays unknown across conversations', async t => {
  const h = await harness();
  try {
    const firstRoot = `/api/agent/threads/${await h.thread()}`, secondRoot = `/api/agent/threads/${await h.thread()}`;
    const first = await h.req(`${firstRoot}/messages`, { message: 'pay fines' });
    const second = await h.req(`${secondRoot}/messages`, { message: 'pay fines' });
    const realFetch = globalThis.fetch;
    const mocked = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const response = await realFetch(input, init);
      if (new URL(String(input)).pathname !== '/simulator/v1/payments') return response;
      const receipt = await response.json();
      return Response.json({ code: 'QUOTE_STALE', correlationId: randomUUID(), receipt }, { status: 409 });
    });
    const result = await h.req(`${firstRoot}/resume`, { approvalId: first.data.approval.id, decision: 'approve' });
    assert.equal(result.data.status, 'unknown');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
    mocked.mock.restore();
    assert.equal((await h.req(`${secondRoot}/resume`, { approvalId: second.data.approval.id, decision: 'approve' })).data.status, 'reconciliation_required');
    assert.equal((await h.req(`${firstRoot}/recover`, {})).data.status, 'complete');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
  } finally { await h.close(); }
});

test('an in-flight payment blocks a previously opened approval for the same subject', async () => {
  const h = await harness();
  try {
    const firstRoot = `/api/agent/threads/${await h.thread()}`, secondRoot = `/api/agent/threads/${await h.thread()}`;
    const first = await h.req(`${firstRoot}/messages`, { message: 'pay fines' });
    const second = await h.req(`${secondRoot}/messages`, { message: 'pay fine-1' });
    assert.notEqual(first.data.approval.key, second.data.approval.key);
    const original = h.tools.pay.invoke;
    let release!: () => void, started!: () => void, invocations = 0;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    h.tools.pay.invoke = async (...args) => { invocations++; started(); await waiting; return original(...args); };
    const executing = h.req(`${firstRoot}/resume`, { approvalId: first.data.approval.id, decision: 'approve' });
    await entered;
    try {
      const blocked = await h.req(`${secondRoot}/resume`, { approvalId: second.data.approval.id, decision: 'approve' });
      assert.equal(blocked.data.status, 'reconciliation_required');
      assert.equal(invocations, 1);
    } finally { release(); }
    assert.equal((await executing).data.status, 'complete');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
  } finally { await h.close(); }
});

test('an unresolved renewal blocks another approval but the original can recover', async () => {
  const identity = { token: randomBytes(32).toString('hex'), subject: 'alice', permissions: ['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew'] as Array<'fines:read' | 'fines:pay' | 'vehicles:read' | 'vehicles:renew'>, expiresAt: Date.now() + 600000 };
  const h = await harness({ identities: [identity] });
  try {
    const principal: Principal = { subject: 'alice', workload: 'super-app-agent', permissions: identity.permissions, expiresAt: identity.expiresAt };
    const quote = quoteFor(h.store.fines('alice')), key = digest({ subject: 'alice', operation: 'fines.pay.v1', quote }), consent = randomUUID();
    h.store.consent(consent, principal, key, quote, Date.now() + 60000);
    h.store.simulatePayment(principal, key, quote, consent);
    const firstRoot = `/api/agent/threads/${await h.thread()}`, secondRoot = `/api/agent/threads/${await h.thread()}`;
    const first = await h.req(`${firstRoot}/messages`, { message: 'renew my vehicle' });
    const second = await h.req(`${secondRoot}/messages`, { message: 'renew my vehicle' });
    const original = h.vehicles.renew.invoke;
    let invocations = 0;
    h.vehicles.renew.invoke = async (...args) => { invocations++; if (invocations === 1) throw new Error('outcome unknown'); return original(...args); };
    assert.equal((await h.req(`${firstRoot}/resume`, { approvalId: first.data.renewalApproval.id, decision: 'approve' })).data.status, 'unknown');
    assert.equal((await h.req(`${secondRoot}/resume`, { approvalId: second.data.renewalApproval.id, decision: 'approve' })).data.status, 'reconciliation_required');
    assert.equal(invocations, 1);
    assert.equal((await h.req(`${firstRoot}/recover`, {})).data.status, 'complete');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_renewals').get() as { n: number }).n, 1);
  } finally { await h.close(); }
});

test('a legacy unresolved operation is bound to its unambiguous consent on reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-operation-owner-')), file = join(dir, 'agent.sqlite');
  let h = await harness({ file });
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    h.tools.pay.invoke = async () => { throw new Error('outcome unknown'); };
    assert.equal((await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' })).data.status, 'unknown');
    h.store.db.prepare('DELETE FROM sa_operation_owners WHERE operation_key=?').run(review.data.approval.key);
    const identities = h.identities;
    await h.close();
    h = await harness({ file, identities });
    const owner = h.store.db.prepare('SELECT consent_id FROM sa_operation_owners WHERE operation_key=?').get(review.data.approval.key) as { consent_id: string };
    assert.equal(owner.consent_id, review.data.approval.id);
    assert.equal((await h.req(`${root}/recover`, {})).data.status, 'complete');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('ambiguous legacy ownership remains unknown until the original consent can be identified', async () => {
  const h = await harness();
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const original = h.tools.pay.invoke;
    h.tools.pay.invoke = async () => { throw new Error('outcome unknown'); };
    assert.equal((await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' })).data.status, 'unknown');
    h.tools.pay.invoke = original;
    h.store.db.prepare('DELETE FROM sa_operation_owners WHERE operation_key=?').run(review.data.approval.key);
    const duplicateId = randomUUID();
    const principal: Principal = { subject: 'alice', workload: 'super-app-agent', permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 600000 };
    h.store.consent(duplicateId, principal, review.data.approval.key, review.data.approval.quote, review.data.approval.expiresAt);
    assert.equal((await h.req(`${root}/recover`, {})).data.status, 'unknown');
    assert.equal((await h.req(`${root}/messages`, { message: 'pay fines' })).status, 409);
    assert.equal((await h.req(`${root}/cancel`, {})).status, 409);
    h.store.db.prepare('DELETE FROM sa_consents WHERE id=?').run(duplicateId);
    assert.equal((await h.req(`${root}/recover`, {})).data.status, 'complete');
  } finally { await h.close(); }
});

test('a definite initial refusal releases its reservation', async () => {
  const h = await harness();
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const original = h.tools.pay.invoke;
    h.tools.pay.invoke = async () => { throw new AgentError('QUOTE_STALE', 409); };
    assert.equal((await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' })).data.status, 'stale');
    h.tools.pay.invoke = original;
    const another = `/api/agent/threads/${await h.thread()}`;
    assert.equal((await h.req(`${another}/messages`, { message: 'pay fines' })).data.status, 'awaiting_approval');
  } finally { await h.close(); }
});

test('one subject’s unresolved payment does not block another subject', async () => {
  const identities = ['alice', 'bob'].map(subject => ({ token: randomBytes(32).toString('hex'), subject, permissions: ['fines:read', 'fines:pay'] as Array<'fines:read' | 'fines:pay'>, expiresAt: Date.now() + 600000 }));
  const h = await harness({ identities });
  try {
    const aliceRoot = `/api/agent/threads/${await h.thread(identities[0].token)}`;
    const review = await h.req(`${aliceRoot}/messages`, { message: 'pay fines' }, { token: identities[0].token });
    const original = h.tools.pay.invoke;
    h.tools.pay.invoke = async () => { throw new Error('outcome unknown'); };
    assert.equal((await h.req(`${aliceRoot}/resume`, { approvalId: review.data.approval.id, decision: 'approve' }, { token: identities[0].token })).data.status, 'unknown');
    h.tools.pay.invoke = original;
    const bobRoot = `/api/agent/threads/${await h.thread(identities[1].token)}`;
    const bobReview = await h.req(`${bobRoot}/messages`, { message: 'pay fines' }, { token: identities[1].token });
    assert.equal(bobReview.data.status, 'awaiting_approval');
    assert.equal((await h.req(`${bobRoot}/resume`, { approvalId: bobReview.data.approval.id, decision: 'approve' }, { token: identities[1].token })).data.status, 'complete');
  } finally { await h.close(); }
});
