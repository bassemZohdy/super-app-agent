import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CompatiblePlanner } from '../agent-core/src/orchestrator/planner.ts';
import { execution, type ExecutionContext } from '../agent-core/src/orchestrator/contracts.ts';

const ctx = (): ExecutionContext => ({ principal: { subject: randomUUID(), workload: 'policy-test', permissions: ['fines:read'], expiresAt: Date.now() + 60000 }, authorization: 'synthetic-user-authorization', correlationId: randomUUID(), revalidate: async () => { throw new Error('No business execution in planner test'); } });
test('focused planning uses the same identifier minimizer and withholds assistant service amounts', async t => {
  const email = 'resident' + '@example.invalid';
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(!JSON.stringify(body).includes(email));
    assert.ok(!JSON.stringify(body).includes('175.25'));
    assert.ok(!JSON.stringify(init).includes('synthetic-user-authorization'));
    assert.match(body.messages.at(-1).content, /selected fine/);
    return Response.json({ choices: [{ message: { content: '{"intent":"list_fines","fineIds":["fine-1"]}' } }] });
  });
  const planner = new CompatiblePlanner(new URL('http://localhost:9000/v1/'), 'test');
  const plan = await execution.run(ctx(), () => planner.plan([{ role: 'assistant', content: 'Fine balance AED 175.25' }, { role: 'user', content: `Show fine-1 for ${email}` }], []));
  assert.deepEqual(plan.fineIds, ['fine-1']);
});
test('redacted fine references remain bound to the exact user selection instead of becoming all fines', async t => {
  const reference = 'fine-' + '12345678';
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.ok(!String(init?.body).includes(reference));
    return Response.json({ choices: [{ message: { content: '{"intent":"pay_fines","fineIds":[]}' } }] });
  });
  const planner = new CompatiblePlanner(new URL('http://localhost:9000/v1/'), 'test');
  const plan = await execution.run(ctx(), () => planner.plan([{ role: 'user', content: `Pay ${reference}` }], []));
  assert.deepEqual(plan.fineIds, [reference]);
});
test('focused and concierge planners enforce the same per-owner call ceiling before transport', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ choices: [{ message: { content: '{"intent":"list_fines","fineIds":[]}' } }] }); });
  const planner = new CompatiblePlanner(new URL('http://localhost:9000/v1/'), 'test');
  const owner = ctx();
  await execution.run(owner, async () => {
    for (let i = 0; i < 30; i++) await planner.plan([{ role: 'user', content: 'Show fines' }], []);
    await assert.rejects(planner.plan([{ role: 'user', content: 'Show fines' }], []));
  });
  assert.equal(calls, 30);
  await execution.run(ctx(), () => planner.plan([{ role: 'user', content: 'Show fines' }], []));
  assert.equal(calls, 31);
});
