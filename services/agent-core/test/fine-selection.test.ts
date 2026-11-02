import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './support.ts';

test('a planner cannot invent or substitute a fine before a review', async () => {
  const h = await harness({ planner: { async plan() { return { intent: 'pay_fines', fineIds: ['fine-2'] }; } } });
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    for (const message of ['pay fine-1', 'pay my fines']) {
      const result = await h.req(`${root}/messages`, { message });
      assert.equal(result.data.status, 'model_unavailable'); assert.equal(result.data.approval, null);
      assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_accounts').get() as { n: number }).n, 0);
    }
  } finally { await h.close(); }
});

test('the graph retains an explicitly named fine even if the planner omits it', async () => {
  const h = await harness({ planner: { async plan(messages) { return { intent: messages.at(-1)?.content === 'show remaining fines' ? 'list_fines' : 'pay_fines', fineIds: [] }; } } });
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fine-1' });
    assert.deepEqual(review.data.approval.quote.fineIds, ['fine-1']);
    assert.equal(review.data.approval.quote.amountMinor, 15000);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
    const paid = await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' });
    assert.equal(paid.data.status, 'complete');
    assert.deepEqual(paid.data.receipt.quote.fineIds, ['fine-1']);
    assert.deepEqual(paid.data.fines.map((fine: { id: string }) => fine.id), ['fine-2']);
    assert.deepEqual(paid.data.surface.view.children.find((child: { id: string }) => child.id === 'fines').properties.rows.map((row: { id: string }) => row.id), ['fine-2']);
    const inspected = await h.req(root);
    assert.deepEqual(inspected.data.fines.map((fine: { id: string }) => fine.id), ['fine-2']);
    assert.deepEqual(inspected.data.surface.view.children.find((child: { id: string }) => child.id === 'fines').properties.rows.map((row: { id: string }) => row.id), ['fine-2']);
    assert.deepEqual(h.store.fines('alice').map(fine => fine.id), ['fine-2']);
    const refreshed = await h.req(`${root}/messages`, { message: 'show remaining fines' });
    assert.deepEqual(refreshed.data.fines.map((fine: { id: string }) => fine.id), ['fine-2']);
  } finally { await h.close(); }
});

test('an unavailable named fine is rejected instead of paying other fines', async () => {
  const h = await harness({ planner: { async plan() { return { intent: 'pay_fines', fineIds: [] }; } } });
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fine-9' });
    assert.equal(review.data.status, 'invalid_selection'); assert.equal(review.data.approval, null);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
  } finally { await h.close(); }
});

test('named fine reads return only the selected fines and reject unavailable selections', async () => {
  const h = await harness({ planner: { async plan() { return { intent: 'list_fines', fineIds: [] }; } } });
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const single = await h.req(`${root}/messages`, { message: 'عرض المخالفة fine-1' });
    assert.equal(single.data.status, 'complete');
    assert.deepEqual(single.data.fines.map((fine: { id: string }) => fine.id), ['fine-1']);
    assert.deepEqual(single.data.surface.view.children.find((child: { id: string }) => child.id === 'fines').properties.rows.map((row: { id: string }) => row.id), ['fine-1']);
    assert.match(single.data.reply, /1 outstanding/);
    const missing = await h.req(`${root}/messages`, { message: 'show fine-1 and fine-9' });
    assert.equal(missing.data.status, 'invalid_selection');
    assert.deepEqual(missing.data.fines, []);
    assert.deepEqual(missing.data.surface.view.children.find((child: { id: string }) => child.id === 'fines').properties.rows, []);
    assert.match(missing.data.reply, /unavailable/i);
    const all = await h.req(`${root}/messages`, { message: 'show all fines' });
    assert.deepEqual(all.data.fines.map((fine: { id: string }) => fine.id), ['fine-1', 'fine-2']);
  } finally { await h.close(); }
});

for (const intermediate of [false, true]) test(`follow-up selection uses only the immediately preceding user turn (intermediate=${intermediate})`, async () => {
  const h = await harness({ planner: { async plan(messages) { return { intent: messages.at(-1)?.content === 'pay them' ? 'pay_fines' : 'list_fines', fineIds: [] }; } } });
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    await h.req(`${root}/messages`, { message: 'show fine-1' });
    if (intermediate) await h.req(`${root}/messages`, { message: 'show all fines' });
    const review = await h.req(`${root}/messages`, { message: 'pay them' });
    assert.deepEqual(review.data.approval.quote.fineIds, intermediate ? ['fine-1', 'fine-2'] : ['fine-1']);
  } finally { await h.close(); }
});
