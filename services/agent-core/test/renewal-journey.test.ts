import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness } from './support.ts';
import { digest, quoteFor, type Principal } from '../src/orchestrator/contracts.ts';

const all = ['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew'] as const;
const identity = (subject: string, granted: readonly string[] = all) => ({ token: randomBytes(32).toString('hex'), subject, permissions: [...granted] as typeof all[number][], expiresAt: Date.now() + 3600000 });
const count = (h: Awaited<ReturnType<typeof harness>>, table: string) => (h.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

async function journey(options: Parameters<typeof harness>[0] = {}) {
  const alice = identity('alice');
  const h = await harness({ identities: [alice], ...options });
  const id = await h.thread(), root = `/api/agent/threads/${id}`;
  const say = (message: string, key?: string) => h.req(`${root}/messages`, { message }, { key });
  const decide = (approvalId: string, decision: 'approve' | 'reject' | 'cancel', key?: string) => h.req(`${root}/resume`, { approvalId, decision }, { key });
  const principal: Principal = { subject: 'alice', workload: 'super-app-agent', permissions: [...all], expiresAt: alice.expiresAt };
  const payFinesDirectly = () => {
    const quote = quoteFor(h.store.fines('alice')), key = digest({ subject: 'alice', operation: 'fines.pay.v1', quote }), consentId = randomUUID();
    h.store.consent(consentId, principal, key, quote, Date.now() + 60000);
    h.store.simulatePayment(principal, key, quote, consentId);
  };
  return { h, alice, id, root, say, decide, payFinesDirectly };
}

test('renewal journey: fines first, then a second approval, each with exactly one effect', async () => {
  const { h, say, decide, root } = await journey();
  try {
    const review = await say('renew my car registration');
    assert.equal(review.data.status, 'awaiting_approval'); assert.deepEqual(review.data.next, ['approval']);
    assert.equal(review.data.approval.quote.amountMinor, 45000); assert.equal(review.data.renewalApproval, null);
    assert.equal(count(h, 'sa_sim_payments'), 0); assert.equal(count(h, 'sa_sim_renewals'), 0);
    const paid = await decide(review.data.approval.id, 'approve', 'pay-fines');
    assert.equal(paid.data.status, 'awaiting_approval'); assert.deepEqual(paid.data.next, ['renewApproval']);
    assert.equal(paid.data.receipt.simulated, true); assert.equal(paid.data.renewalApproval.quote.amountMinor, 40000);
    assert.equal(paid.data.approval, null);
    assert.match(paid.data.reply, /Simulated fines payment completed: AED 450\.00/);
    assert.equal(count(h, 'sa_sim_payments'), 1); assert.equal(count(h, 'sa_sim_renewals'), 0);
    // The fines approval cannot be replayed to authorize the renewal.
    assert.equal((await decide(review.data.approval.id, 'approve')).status, 409);
    const renewed = await decide(paid.data.renewalApproval.id, 'approve', 'renew');
    assert.equal(renewed.data.status, 'complete'); assert.equal(renewed.data.renewal.simulated, true);
    assert.equal(renewed.data.renewal.idempotencyKey, paid.data.renewalApproval.key);
    assert.equal(count(h, 'sa_sim_payments'), 1); assert.equal(count(h, 'sa_sim_renewals'), 1);
    assert.deepEqual((await decide(paid.data.renewalApproval.id, 'approve', 'renew')).data, renewed.data);
    assert.equal((await decide(paid.data.renewalApproval.id, 'approve')).status, 409);
    assert.equal((await h.req(root)).data.status, 'complete');
    assert.equal((await say('show fines')).data.fines.length, 0);
  } finally { await h.close(); }
});

test('renewal journey: with no fines outstanding it goes straight to the renewal approval', async () => {
  const { h, say, decide, payFinesDirectly } = await journey();
  try {
    payFinesDirectly();
    const review = await say('renew my vehicle');
    assert.equal(review.data.status, 'awaiting_approval'); assert.deepEqual(review.data.next, ['renewApproval']);
    assert.equal(review.data.approval, null); assert.equal(review.data.receipt, null);
    const done = await decide(review.data.renewalApproval.id, 'approve');
    assert.equal(done.data.status, 'complete'); assert.equal(count(h, 'sa_sim_renewals'), 1);
    assert.doesNotMatch(done.data.reply, /fines payment/);
  } finally { await h.close(); }
});

test('renewal journey: declining the renewal after paying fines is a truthful partial outcome', async () => {
  const { h, say, decide } = await journey();
  try {
    const review = await say('renew my car registration');
    const paid = await decide(review.data.approval.id, 'approve');
    const declined = await decide(paid.data.renewalApproval.id, 'reject');
    assert.equal(declined.data.status, 'partial');
    assert.match(declined.data.reply, /Simulated fines payment completed: AED 450\.00/); assert.match(declined.data.reply, /not renewed/);
    assert.equal(count(h, 'sa_sim_payments'), 1); assert.equal(count(h, 'sa_sim_renewals'), 0);
    // The conversation is not stuck: a new request starts a fresh renewal review.
    const again = await say('renew my car registration');
    assert.equal(again.data.status, 'awaiting_approval'); assert.deepEqual(again.data.next, ['renewApproval']);
  } finally { await h.close(); }
});

test('renewal journey: declining the fines payment stops everything and changes nothing', async () => {
  const { h, say, decide } = await journey();
  try {
    const review = await say('renew my car registration');
    const rejected = await decide(review.data.approval.id, 'reject');
    assert.equal(rejected.data.status, 'rejected'); assert.deepEqual(rejected.data.next, []);
    assert.equal(count(h, 'sa_sim_payments'), 0); assert.equal(count(h, 'sa_sim_renewals'), 0);
  } finally { await h.close(); }
});

test('renewal journey: a refusal after fines are paid is reported as partial with its real reason, and no renewal exists', async () => {
  const { h, say, decide } = await journey();
  try {
    const review = await say('renew my car registration');
    const paid = await decide(review.data.approval.id, 'approve');
    // A new fine appears between the two approvals; the simulator must still refuse the renewal.
    h.store.db.prepare('INSERT INTO sa_sim_fines VALUES(?,?,?,NULL)').run('alice', 'fine-9', JSON.stringify({ id: 'fine-9', description: 'Simulated new fine', amountMinor: 5000, version: 1 }));
    const refused = await decide(paid.data.renewalApproval.id, 'approve');
    assert.equal(refused.data.status, 'partial');
    assert.match(refused.data.reply, /FINES_OUTSTANDING/); assert.match(refused.data.reply, /Simulated fines payment completed/);
    assert.equal(count(h, 'sa_sim_payments'), 1); assert.equal(count(h, 'sa_sim_renewals'), 0);
  } finally { await h.close(); }
});

test('renewal journey: authority revoked between the approvals stops the renewal but keeps the fines receipt', async () => {
  const { h, alice, say, decide } = await journey();
  try {
    const review = await say('renew my car registration');
    const paid = await decide(review.data.approval.id, 'approve');
    alice.permissions = ['fines:read', 'fines:pay', 'vehicles:read'];
    const denied = await decide(paid.data.renewalApproval.id, 'approve');
    assert.equal(denied.data.status, 'partial'); assert.match(denied.data.reply, /PERMISSION_DENIED/);
    assert.equal(count(h, 'sa_sim_payments'), 1); assert.equal(count(h, 'sa_sim_renewals'), 0);
  } finally { await h.close(); }
});

test('renewal journey: a user without the renew permission is refused before any payment', async () => {
  const bob = identity('bob', ['fines:read', 'fines:pay', 'vehicles:read']);
  const { h, id } = await journey({ identities: [identity('alice'), bob] });
  try {
    const refused = await h.req(`/api/agent/threads/${await h.thread(bob.token)}/messages`, { message: 'renew my car registration' }, { token: bob.token });
    assert.equal(refused.status, 403);
    assert.equal(count(h, 'sa_sim_payments'), 0); assert.equal(count(h, 'sa_sim_renewals'), 0);
    assert.ok(id);
  } finally { await h.close(); }
});

test('renewal journey: a lost renewal response is an unknown outcome that recovers only the original operation after a reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'renewal-unknown-')), file = join(dir, 'agent.sqlite');
  const alice = identity('alice');
  let h = await harness({ file, identities: [alice] });
  try {
    const id = await h.thread(), root = `/api/agent/threads/${id}`;
    const review = await h.req(`${root}/messages`, { message: 'renew my car registration' });
    const paid = await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' });
    const original = h.vehicles.renew.invoke;
    h.vehicles.renew.invoke = async (...args) => { await original(...args); throw new Error('response lost after commit'); };
    const unknown = await h.req(`${root}/resume`, { approvalId: paid.data.renewalApproval.id, decision: 'approve' });
    assert.equal(unknown.data.status, 'unknown'); assert.match(unknown.data.reply, /never create a replacement renewal/);
    assert.match(unknown.data.reply, /fines payment is complete/i);
    assert.equal((await h.req(`${root}/messages`, { message: 'renew my car registration' })).status, 409);
    assert.equal((await h.req(`${root}/cancel`, {})).status, 409);
    assert.equal(count(h, 'sa_sim_renewals'), 1);
    await h.close();
    h = await harness({ file, identities: [alice] });
    const recovered = await h.req(`${root}/recover`, {});
    assert.equal(recovered.data.status, 'complete');
    assert.equal(recovered.data.renewal.idempotencyKey, paid.data.renewalApproval.key);
    assert.equal(count(h, 'sa_sim_renewals'), 1); assert.equal(count(h, 'sa_sim_payments'), 1);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});
