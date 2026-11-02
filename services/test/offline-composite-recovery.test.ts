import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest, getOrCreateSession } from '../agent-core/src/index.ts';
import { domainHandlers } from '../agent-core/src/domain-operations.ts';
import { balance, policeFines, transactions, executeWalletRequest } from '../service-wallet/src/index.ts';
import { activeUtilityBill } from '../service-food/src/index.ts';
import { salikBalance } from '../service-ride/src/index.ts';

async function review(sessionId: string) {
  const response = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag' });
  assert.equal(response.status, 200);
  const button = response.data.surface.view.children.find((node: { id: string }) => node.id === 'btn_confirm_smartcity_checkout');
  return { sessionId, surfaceRevision: getOrCreateSession(sessionId).currentSurface!.revision, action: 'confirm_smartcity_checkout', payload: button.onEvents[0].payload };
}

test('offline composite records unknown and partial outcomes without executing later steps or retrying the session', async t => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  for (const scenario of ['unknown-wallet', 'refused-utility']) {
    const request = await review(`composite_recovery_${scenario}`);
    const wallet = domainHandlers.wallet, food = domainHandlers.food;
    const walletMock = t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
      const result = wallet(method, path, query, body);
      return scenario === 'unknown-wallet' && method === 'POST' && path === '/pay/unified'
        ? { ...result, data: { ...result.data, grandTotal: result.data.grandTotal + 0.01 } } : result;
    });
    const foodMock = t.mock.method(domainHandlers, 'food', (method, path, query, body) =>
      scenario === 'refused-utility' && method === 'POST' && path === '/utilities/pay'
        ? { status: 409, data: { error: 'Fixture refused settlement' } } : food(method, path, query, body));
    try {
      const before = balance, ledger = transactions.length, tollBefore = salikBalance;
      const result = await executeCoreRequest('POST', '/api/a2ui/action', {}, request);
      assert.equal(result.status, scenario === 'unknown-wallet' ? 502 : 409);
      assert.equal(result.data.outcome, scenario === 'unknown-wallet' ? 'UNKNOWN' : 'PARTIALLY_COMPLETED');
      assert.deepEqual(result.data.steps.map((step: { state: string }) => step.state), scenario === 'unknown-wallet' ? ['UNKNOWN'] : ['SUCCEEDED', 'FAILED']);
      assert.equal(Math.round((before - balance) * 100), Math.round((activeUtilityBill.totalAmount + 100) * 100));
      assert.equal(transactions.length, ledger + 1);
      assert.equal(activeUtilityBill.status, 'UNPAID');
      assert.ok(policeFines.every(fine => fine.status === 'UNPAID'));
      assert.equal(salikBalance, tollBefore);
      assert.equal(result.data.retry.allowed, false);
      const retry = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId: request.sessionId, text: 'show my wallet' });
      assert.equal(retry.data.code, 'RECONCILIATION_REQUIRED');
    } finally { walletMock.mock.restore(); foodMock.mock.restore(); }
  }
});
