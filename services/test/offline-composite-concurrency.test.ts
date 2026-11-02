import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest, getOrCreateSession } from '../agent-core/src/index.ts';
import { balance, policeFines, executeWalletRequest } from '../service-wallet/src/index.ts';
import { activeUtilityBill } from '../service-food/src/index.ts';
import { salikBalance } from '../service-ride/src/index.ts';

async function review(sessionId: string) {
  const response = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag' });
  assert.equal(response.status, 200);
  const button = response.data.surface.view.children.find((node: { id: string }) => node.id === 'btn_confirm_smartcity_checkout');
  return { sessionId, surfaceRevision: getOrCreateSession(sessionId).currentSurface!.revision, action: 'confirm_smartcity_checkout', payload: button.onEvents[0].payload };
}

test('overlapping offline composite confirmations cannot both charge the shared fixtures', async () => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  const first = await review('composite_concurrent_1'), second = await review('composite_concurrent_2');
  const total = activeUtilityBill.totalAmount + policeFines.filter(fine => fine.status === 'UNPAID').reduce((sum, fine) => sum + fine.payableAmount, 0) + 100;
  const before = balance, tollBefore = salikBalance;
  const results = await Promise.all([first, second].map(body => executeCoreRequest('POST', '/api/a2ui/action', {}, body)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(Math.round((before - balance) * 100), Math.round(total * 100));
  assert.equal(salikBalance - tollBefore, 100);
  assert.ok(policeFines.every(fine => fine.status === 'PAID'));
  assert.equal(activeUtilityBill.status, 'PAID');
});
