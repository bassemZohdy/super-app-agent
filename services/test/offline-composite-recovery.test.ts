import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeCoreRequest, getOrCreateSession } from '../agent-core/src/index.ts';
import { domainHandlers } from '../agent-core/src/domain-operations.ts';
import { balance, policeFines, transactions, executeWalletRequest } from '../service-wallet/src/index.ts';
import { activeUtilityBill } from '../service-food/src/index.ts';
import { salikBalance } from '../service-ride/src/index.ts';

async function review(sessionId: string, text = 'Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag', action = 'confirm_smartcity_checkout') {
  const response = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text });
  assert.equal(response.status, 200);
  const button = response.data.surface.view.children.find((node: { onEvents?: Array<{ payload?: { action?: string } }> }) => node.onEvents?.some(event => event.payload?.action === action));
  assert.ok(button);
  return { sessionId, surfaceRevision: getOrCreateSession(sessionId).currentSurface!.revision, action, payload: button.onEvents[0].payload };
}

const selectedScenario = process.env.CITYSIDE_COMPOSITE_RECOVERY_SCENARIO;
if (!selectedScenario) {
  test('offline composite recovery fences other sessions after uncertain and partial outcomes', () => {
    for (const scenario of ['unknown-wallet', 'refused-utility', 'changed-utility']) {
      const childEnv = { ...process.env, CITYSIDE_COMPOSITE_RECOVERY_SCENARIO: scenario };
      delete childEnv.NODE_TEST_CONTEXT;
      const child = spawnSync(process.execPath, ['--experimental-strip-types', '--import', './scripts/test-env.ts', '--test', fileURLToPath(import.meta.url)], {
        cwd: process.cwd(), env: childEnv, encoding: 'utf8', timeout: 30000,
      });
      assert.equal(child.status, 0, `${scenario}: ${child.stdout} ${child.stderr}`);
    }
  });
} else test('offline composite records unknown and partial outcomes without executing later steps or retrying the session', async t => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  for (const scenario of [selectedScenario]) {
    const request = await review(`composite_recovery_${scenario}`);
    const utility = await review(`utility_${scenario}`, 'Show my DEWA utility bill', 'pay_utilities_bill');
    const fines = await review(`fines_${scenario}`, 'Check my police fines', 'pay_police_fines');
    const wallet = domainHandlers.wallet, food = domainHandlers.food, originalBillAmount = activeUtilityBill.totalAmount;
    const walletMock = t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
      const result = wallet(method, path, query, body);
      if (scenario === 'changed-utility' && method === 'POST' && path === '/pay/unified') activeUtilityBill.totalAmount += 1;
      return scenario === 'unknown-wallet' && method === 'POST' && path === '/pay/unified'
        ? { ...result, data: { ...result.data, grandTotal: result.data.grandTotal + 0.01 } } : result;
    });
    const foodMock = t.mock.method(domainHandlers, 'food', (method, path, query, body) =>
      scenario === 'refused-utility' && method === 'POST' && path === '/utilities/pay'
        ? { status: 409, data: { error: 'Fixture refused settlement' } } : food(method, path, query, body));
    try {
      const before = balance, ledger = transactions.length, tollBefore = salikBalance, reviewedBill = activeUtilityBill.totalAmount;
      const result = await executeCoreRequest('POST', '/api/a2ui/action', {}, request);
      assert.equal(result.status, scenario === 'unknown-wallet' ? 502 : 409);
      assert.equal(result.data.outcome, scenario === 'unknown-wallet' ? 'UNKNOWN' : 'PARTIALLY_COMPLETED');
      assert.deepEqual(result.data.steps.map((step: { state: string }) => step.state), scenario === 'unknown-wallet' ? ['UNKNOWN'] : ['SUCCEEDED', 'FAILED']);
      assert.equal(Math.round((before - balance) * 100), Math.round((reviewedBill + 100) * 100));
      assert.equal(transactions.length, ledger + 1);
      assert.equal(activeUtilityBill.status, 'UNPAID');
      assert.ok(policeFines.every(fine => fine.status === 'UNPAID'));
      assert.equal(salikBalance, tollBefore);
      assert.equal(result.data.retry.allowed, false);
      const retry = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId: request.sessionId, text: 'show my wallet' });
      assert.equal(retry.data.code, 'RECONCILIATION_REQUIRED');
      const other = await review(`other_session_${scenario}`);
      const afterFailure = balance, ledgerAfterFailure = transactions.length;
      for (const pending of [other, utility, fines]) {
        const blocked = await executeCoreRequest('POST', '/api/a2ui/action', {}, pending);
        assert.equal(blocked.status, 409);
      }
      assert.equal(balance, afterFailure);
      assert.equal(transactions.length, ledgerAfterFailure);
    } finally { activeUtilityBill.totalAmount = originalBillAmount; walletMock.mock.restore(); foodMock.mock.restore(); }
  }
});
