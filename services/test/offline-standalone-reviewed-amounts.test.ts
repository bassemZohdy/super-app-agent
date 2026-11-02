import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest, getOrCreateSession } from '../agent-core/src/index.ts';
import { activeUtilityBill } from '../service-food/src/index.ts';
import { balance, policeFines, transactions, executeWalletRequest } from '../service-wallet/src/index.ts';

async function review(sessionId: string, text: string, action: string) {
  const result = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text });
  assert.equal(result.status, 200);
  const button = result.data.surface.view.children.find((node: { onEvents?: Array<{ payload?: { action?: string } }> }) => node.onEvents?.some(event => event.payload?.action === action));
  assert.ok(button);
  return { sessionId, surfaceRevision: getOrCreateSession(sessionId).currentSurface!.revision, action, payload: button.onEvents[0].payload };
}

test('standalone utility approval refuses a bill amount changed after review', async () => {
  const request = await review('standalone_utility_stale', 'Show my DEWA utility bill', 'pay_utilities_bill');
  assert.equal(request.payload.expectedAmountMinor, Math.round(activeUtilityBill.totalAmount * 100));
  const initial = JSON.stringify(activeUtilityBill);
  const altered = { ...request, payload: { ...request.payload, expectedAmountMinor: request.payload.expectedAmountMinor + 1 } };
  assert.equal((await executeCoreRequest('POST', '/api/a2ui/action', {}, altered)).status, 403);
  assert.equal(JSON.stringify(activeUtilityBill), initial);
  activeUtilityBill.totalAmount += 1;
  const before = JSON.stringify(activeUtilityBill);
  try {
    const result = await executeCoreRequest('POST', '/api/a2ui/action', {}, request);
    assert.equal(result.status, 409);
    assert.equal(JSON.stringify(activeUtilityBill), before);
  } finally { activeUtilityBill.totalAmount -= 1; }
});

test('standalone fine approval refuses an amount changed after review without charging', async () => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 2000 }).status, 200);
  const request = await review('standalone_fines_stale', 'Check my police fines', 'pay_police_fines');
  assert.equal(request.payload.expectedAmountMinor, Math.round(policeFines.reduce((sum, fine) => sum + fine.payableAmount, 0) * 100));
  const initial = JSON.stringify({ balance, transactions, policeFines });
  const altered = { ...request, payload: { ...request.payload, expectedAmountMinor: request.payload.expectedAmountMinor + 1 } };
  assert.equal((await executeCoreRequest('POST', '/api/a2ui/action', {}, altered)).status, 403);
  assert.equal(JSON.stringify({ balance, transactions, policeFines }), initial);
  policeFines[0].payableAmount += 1;
  const before = JSON.stringify({ balance, transactions, policeFines });
  try {
    const result = await executeCoreRequest('POST', '/api/a2ui/action', {}, request);
    assert.equal(result.status, 409);
    assert.equal(JSON.stringify({ balance, transactions, policeFines }), before);
  } finally { policeFines[0].payableAmount -= 1; }
});
