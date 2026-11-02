import test from 'node:test';
import assert from 'node:assert/strict';
import { SuperAppAgentGraph } from '../agent-core/src/langgraph/graph.ts';
import { activeUtilityBill } from '../service-food/src/index.ts';

test('a standalone utility action fences a concurrent composite checkout and releases the guard', async () => {
  const state = { sessionId: 'standalone_first', messages: [], activeDomain: 'food' as const };
  const composite = { sessionId: 'standalone_second', messages: [], activeDomain: 'composite' as const };
  const payment = SuperAppAgentGraph.resumeWithAction(state, 'pay_utilities_bill', { billId: activeUtilityBill.billId });
  const blocked = SuperAppAgentGraph.resumeWithAction(composite, 'confirm_smartcity_checkout', {});
  const results = await Promise.allSettled([payment, blocked]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  if (results[1].status === 'rejected') assert.equal(results[1].reason.status, 409);
  assert.equal(activeUtilityBill.status, 'PAID');
  await assert.rejects(SuperAppAgentGraph.resumeWithAction(composite, 'confirm_smartcity_checkout', {}), { message: 'The checkout changed. Review it again.' });
});
