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
    assert.deepEqual(review.data.fines.map((fine: { id: string }) => fine.id), ['fine-1']);
    assert.deepEqual(review.data.surface.view.children.find((child: { id: string }) => child.id === 'fines').properties.rows.map((row: { id: string }) => row.id), ['fine-1']);
    assert.deepEqual((await h.req(root)).data.fines.map((fine: { id: string }) => fine.id), ['fine-1']);
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

test('duplicate fine IDs from a provider are unavailable for both listing and payment', async () => {
  const h = await harness();
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const initial = await h.req(`${root}/messages`, { message: 'show fines' });
    assert.equal(initial.data.fines.length, 2);
    const original = h.tools.list.invoke, fine = h.store.fines('alice')[0];
    for (const second of [fine, { ...fine, amountMinor: fine.amountMinor + 1 }]) {
      h.tools.list.invoke = async () => [fine, second];
      for (const message of ['show fines', 'pay fines']) {
        const result = await h.req(`${root}/messages`, { message });
        assert.equal(result.data.status, 'service_unavailable');
        assert.deepEqual(result.data.fines, []);
        assert.equal(result.data.approval, null);
      }
    }
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
    h.tools.list.invoke = original;
    assert.equal((await h.req(`${root}/messages`, { message: 'show fines' })).data.fines.length, 2);
  } finally { await h.close(); }
});

test('a fine reference ending in a hyphen is not shortened to another fine', async () => {
  const h = await harness();
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    for (const message of ['pay fine-1-', 'مراجعة دفع المخالفة fine-1-']) {
      const result = await h.req(`${root}/messages`, { message });
      assert.equal(result.data.status, 'invalid_selection');
      assert.equal(result.data.approval, null);
    }
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
    h.store.db.prepare('INSERT INTO sa_sim_fines VALUES(?,?,?,NULL)').run('alice', 'fine-1-', JSON.stringify({ id: 'fine-1-', description: 'Separate fine', amountMinor: 20000, version: 1 }));
    const exact = await h.req(`${root}/messages`, { message: 'pay fine-1-' });
    assert.deepEqual(exact.data.approval.quote.fineIds, ['fine-1-']);
    assert.equal(exact.data.approval.quote.amountMinor, 20000);
  } finally { await h.close(); }
});

test('fine references embedded in a longer ID do not broaden or substitute a payment selection', async () => {
  const h = await harness();
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    for (const message of ['pay prefix-fine-1', 'pay prefix_fine-1', 'pay fine-1 and prefix_fine-1', 'pay fine-']) {
      const result = await h.req(`${root}/messages`, { message });
      assert.equal(result.data.status, 'invalid_selection');
      assert.equal(result.data.approval, null);
    }
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

test('a new request never presents a previous fine snapshot when planning stops early', async () => {
  const h = await harness({ planner: { async plan(messages) {
    const message = messages.at(-1)?.content;
    if (message === 'planner fails') throw new Error('unavailable');
    if (message === 'hello') return { intent: 'clarify', fineIds: [] };
    if (message === 'other service') return { intent: 'out_of_scope', fineIds: [] };
    if (message === 'renew veh-1 and veh-2') return { intent: 'renew_registration', fineIds: [] };
    return { intent: 'list_fines', fineIds: [] };
  } } });
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    for (const [message, status] of [['hello', 'complete'], ['other service', 'complete'], ['planner fails', 'model_unavailable'], ['renew veh-1 and veh-2', 'clarify']]) {
      const listed = await h.req(`${root}/messages`, { message: 'show fine-1' });
      assert.equal(listed.data.fines.length, 1);
      const result = await h.req(`${root}/messages`, { message });
      assert.equal(result.data.status, status);
      assert.deepEqual(result.data.fines, []);
      assert.deepEqual(result.data.surface.view.children.find((child: { id: string }) => child.id === 'fines').properties.rows, []);
      assert.deepEqual((await h.req(root)).data.fines, []);
    }
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

test('pronoun payment requests require an immediately preceding successful fine list', async () => {
  const h = await harness({ planner: { async plan(messages) {
    const text = messages.at(-1)?.content || '';
    return { intent: text.startsWith('show') ? 'list_fines' : text.startsWith('other') ? 'out_of_scope' : text === 'hello' ? 'clarify' : 'pay_fines', fineIds: [] };
  } } });
  try {
    for (const prior of [undefined, 'other fine-1', 'show fine-9', 'hello']) {
      const root = `/api/agent/threads/${await h.thread()}`;
      if (prior) await h.req(`${root}/messages`, { message: prior });
      for (const message of ['pay them', 'أريد دفعها']) {
        const result = await h.req(`${root}/messages`, { message });
        assert.equal(result.data.status, 'clarify');
        assert.equal(result.data.approval, null);
      }
    }
    for (const [prior, expected] of [['show fine-1', ['fine-1']], ['show all fines', ['fine-1', 'fine-2']]] as const) {
      const root = `/api/agent/threads/${await h.thread()}`;
      await h.req(`${root}/messages`, { message: prior });
      if (prior === 'show all fines') h.store.db.prepare('INSERT INTO sa_sim_fines VALUES(?,?,?,NULL)').run('alice', 'fine-3', JSON.stringify({ id: 'fine-3', description: 'New fine', amountMinor: 10000, version: 1 }));
      const result = await h.req(`${root}/messages`, { message: 'pay them' });
      assert.deepEqual(result.data.approval.quote.fineIds, expected);
    }
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
  } finally { await h.close(); }
});

test('a follow-up to an empty list does not include fines that appeared afterwards', async () => {
  const h = await harness({ planner: { async plan(messages) { return { intent: messages.at(-1)?.content === 'show all fines' ? 'list_fines' : 'pay_fines', fineIds: [] }; } } });
  try {
    h.store.fines('alice');
    h.store.db.prepare('UPDATE sa_sim_fines SET receipt_id=? WHERE subject=?').run('earlier-payment', 'alice');
    const root = `/api/agent/threads/${await h.thread()}`;
    const list = await h.req(`${root}/messages`, { message: 'show all fines' });
    assert.deepEqual(list.data.fines, []);
    h.store.db.prepare('INSERT INTO sa_sim_fines VALUES(?,?,?,NULL)').run('alice', 'fine-new', JSON.stringify({ id: 'fine-new', description: 'New fine', amountMinor: 10000, version: 1 }));
    const result = await h.req(`${root}/messages`, { message: 'pay them' });
    assert.equal(result.data.status, 'clarify');
    assert.equal(result.data.approval, null);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
  } finally { await h.close(); }
});

test('more than ten fines asks for a smaller selection instead of failing or reviewing a subset', async () => {
  const h = await harness();
  try {
    h.store.fines('alice');
    for (let n = 3; n <= 11; n++) h.store.db.prepare('INSERT INTO sa_sim_fines VALUES(?,?,?,NULL)').run('alice', `fine-${n}`, JSON.stringify({ id: `fine-${n}`, description: 'Additional fine', amountMinor: 10000, version: 1 }));
    const root = `/api/agent/threads/${await h.thread()}`;
    const direct = await h.req(`${root}/messages`, { message: 'pay fines' });
    assert.equal(direct.status, 200);
    assert.equal(direct.data.status, 'clarify');
    assert.match(direct.data.reply, /10/);
    assert.equal(direct.data.approval, null);
    const tooManyNamed = await h.req(`${root}/messages`, { message: `pay ${Array.from({ length: 11 }, (_, index) => `fine-${index + 1}`).join(' ')}` });
    assert.equal(tooManyNamed.data.status, 'clarify');
    assert.equal(tooManyNamed.data.approval, null);
    const list = await h.req(`${root}/messages`, { message: 'show all fines' });
    assert.equal(list.data.fines.length, 11);
    const followup = await h.req(`${root}/messages`, { message: 'pay them' });
    assert.equal(followup.status, 200);
    assert.equal(followup.data.status, 'clarify');
    assert.match(followup.data.reply, /10/);
    assert.equal(followup.data.approval, null);
    const selected = await h.req(`${root}/messages`, { message: 'pay fine-1' });
    assert.deepEqual(selected.data.approval.quote.fineIds, ['fine-1']);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
  } finally { await h.close(); }
});

test('an Arabic batch review binds exactly the named fines and waits for confirmation', async () => {
  const h = await harness();
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const rejected = await h.req(`${root}/messages`, { message: 'مراجعة دفع المخالفات fine-1 و fine-2 ولا تدفع' });
    assert.equal(rejected.data.approval, null);
    const review = await h.req(`${root}/messages`, { message: 'مراجعة دفع المخالفات fine-1 و fine-2' });
    assert.deepEqual(review.data.approval.quote.fineIds, ['fine-1', 'fine-2']);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
    const paid = await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' });
    assert.deepEqual(paid.data.receipt.quote.fineIds, ['fine-1', 'fine-2']);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
  } finally { await h.close(); }
});

test('explicitly negated English payment requests create no review or effect', async () => {
  const h = await harness();
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    for (const message of ['do not pay fine-1', "show fine-1 but don't pay it", 'no payment for fine-1']) {
      const result = await h.req(`${root}/messages`, { message });
      assert.equal(result.data.approval, null);
      assert.notEqual(result.data.status, 'awaiting_approval');
      assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 0);
    }
    assert.deepEqual((await h.req(`${root}/messages`, { message: 'pay fine-1' })).data.approval.quote.fineIds, ['fine-1']);
  } finally { await h.close(); }
});
