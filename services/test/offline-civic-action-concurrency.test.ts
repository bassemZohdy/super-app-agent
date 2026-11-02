import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest, getOrCreateSession } from '../agent-core/src/index.ts';
import { SuperAppAgentGraph } from '../agent-core/src/langgraph/graph.ts';
import { balance, policeFines, executeWalletRequest } from '../service-wallet/src/index.ts';
import { activeUtilityBill } from '../service-food/src/index.ts';
import { salikBalance } from '../service-ride/src/index.ts';

async function review(sessionId: string, text: string, action: string) {
  const result = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text });
  assert.equal(result.status, 200);
  const button = result.data.surface.view.children.find((node: { onEvents?: Array<{ payload?: { action?: string } }> }) => node.onEvents?.some(event => event.payload?.action === action));
  assert.ok(button);
  return { sessionId, surfaceRevision: getOrCreateSession(sessionId).currentSurface!.revision, action, payload: button.onEvents[0].payload };
}

test('standalone fines and utility actions cannot interrupt a composite fixture checkout', async () => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  const composite = await review('civic_composite_review', 'Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag', 'confirm_smartcity_checkout');
  const fines = await review('civic_fines_review', 'Check my police fines', 'pay_police_fines');
  const bill = await review('civic_utility_review', 'Show my DEWA utility bill', 'pay_utilities_bill');
  const total = activeUtilityBill.totalAmount + policeFines.filter(fine => fine.status === 'UNPAID').reduce((sum, fine) => sum + fine.payableAmount, 0) + 100;
  const before = balance, tollBefore = salikBalance;
  // Enter the composite action synchronously so the other sessions hit its in-flight guard.
  const running = SuperAppAgentGraph.resumeWithAction(getOrCreateSession(composite.sessionId), composite.action, composite.payload);
  const results = await Promise.allSettled([running,
    SuperAppAgentGraph.resumeWithAction(getOrCreateSession(fines.sessionId), fines.action, fines.payload),
    SuperAppAgentGraph.resumeWithAction(getOrCreateSession(bill.sessionId), bill.action, bill.payload)]);
  assert.equal(results[0].status, 'fulfilled');
  for (const result of results.slice(1)) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.equal(result.reason.status, 409);
  }
  assert.equal(Math.round((before - balance) * 100), Math.round(total * 100));
  assert.equal(salikBalance - tollBefore, 100);
  assert.equal(activeUtilityBill.status, 'PAID');
  assert.ok(policeFines.every(fine => fine.status === 'PAID'));
});
