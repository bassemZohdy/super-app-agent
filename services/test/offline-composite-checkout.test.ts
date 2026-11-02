import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest, getOrCreateSession } from '../agent-core/src/index.ts';
import { balance, policeFines, transactions, executeWalletRequest } from '../service-wallet/src/index.ts';
import { activeUtilityBill } from '../service-food/src/index.ts';
import { salikBalance } from '../service-ride/src/index.ts';

const snapshot = () => JSON.stringify({ balance, policeFines, transactions, activeUtilityBill, salikBalance });
const review = async (sessionId: string) => {
  const result = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag' });
  assert.equal(result.status, 200);
  const button = result.data.surface.view.children.find((node: { id: string }) => node.id === 'btn_confirm_smartcity_checkout');
  return { sessionId, surfaceRevision: getOrCreateSession(sessionId).currentSurface!.revision, action: 'confirm_smartcity_checkout', payload: button.onEvents[0].payload };
};

test('offline composite checkout binds current terms, charges each selected amount once and omits settled obligations', async () => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 3000 }).status, 200);
  const request = await review('composite_review_1');
  const initial = snapshot();
  const altered = structuredClone(request);
  altered.payload.offlineReview.tagNumber = 'unreviewed-tag';
  assert.equal((await executeCoreRequest('POST', '/api/a2ui/action', {}, altered)).status, 403);
  assert.equal(snapshot(), initial);
  activeUtilityBill.totalAmount += 1;
  const changedBill = snapshot();
  assert.equal((await executeCoreRequest('POST', '/api/a2ui/action', {}, request)).status, 409);
  assert.equal(snapshot(), changedBill);
  activeUtilityBill.totalAmount -= 1;
  const fine = policeFines.find(item => item.status === 'UNPAID')!;
  const originalAmount = fine.payableAmount;
  fine.payableAmount += 1;
  const beforeStale = snapshot();
  const stale = await executeCoreRequest('POST', '/api/a2ui/action', {}, request);
  assert.equal(stale.status, 409);
  assert.equal(snapshot(), beforeStale);
  fine.payableAmount = originalAmount;

  const fresh = await review('composite_review_2');
  const expected = activeUtilityBill.totalAmount + policeFines.filter(item => item.status === 'UNPAID').reduce((sum, item) => sum + item.payableAmount, 0) + 100;
  const beforeBalance = balance, beforeToll = salikBalance;
  const paid = await executeCoreRequest('POST', '/api/a2ui/action', {}, fresh);
  assert.equal(paid.status, 200);
  assert.equal(Math.round((beforeBalance - balance) * 100), Math.round(expected * 100));
  assert.equal(activeUtilityBill.status, 'PAID');
  assert.ok(policeFines.every(item => item.status === 'PAID'));
  assert.equal(salikBalance - beforeToll, 100);
  const beforeReplay = snapshot();
  assert.notEqual((await executeCoreRequest('POST', '/api/a2ui/action', {}, fresh)).status, 200);
  assert.equal(snapshot(), beforeReplay);

  const repeat = await review('composite_review_3');
  const beforeRepeat = balance;
  assert.equal((await executeCoreRequest('POST', '/api/a2ui/action', {}, repeat)).status, 200);
  assert.equal(Math.round((beforeRepeat - balance) * 100), 10000);
});
