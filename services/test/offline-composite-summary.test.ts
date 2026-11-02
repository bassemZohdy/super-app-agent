import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest, getOrCreateSession } from '../agent-core/src/index.ts';
import { domainHandlers } from '../agent-core/src/domain-operations.ts';
import { balance, policeFines, transactions, executeWalletRequest } from '../service-wallet/src/index.ts';
import { activeUtilityBill } from '../service-food/src/index.ts';
import { salikBalance } from '../service-ride/src/index.ts';

const snapshot = () => JSON.stringify({ balance, policeFines, transactions, activeUtilityBill, salikBalance });
const intent = (sessionId: string) => executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag' });

test('composite checkout refuses inconsistent fine summaries before review or debit', async t => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 3000 }).status, 200);
  const original = domainHandlers.wallet;
  let mismatch = 'amount';
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
    const result = original(method, path, query, body);
    if (mismatch && method === 'GET' && path === '/fines/check') {
      if (mismatch === 'amount') return { ...result, data: { ...result.data, totalPayable: result.data.totalPayable + 1 } };
      if (mismatch === 'count') return { ...result, data: { ...result.data, count: result.data.count + 1 } };
      if (mismatch === 'duplicate') return { ...result, data: { ...result.data, fines: [result.data.fines[0], result.data.fines[0]] } };
    }
    return result;
  });
  const before = snapshot();
  for (const scenario of ['amount', 'count', 'duplicate']) {
    mismatch = scenario;
    const badReview = await intent(`composite_bad_${scenario}`);
    assert.equal(badReview.status, 503);
    assert.equal(snapshot(), before);
  }

  mismatch = '';
  const sessionId = 'composite_summary_changed';
  const goodReview = await intent(sessionId);
  assert.equal(goodReview.status, 200);
  const button = goodReview.data.surface.view.children.find((node: { id: string }) => node.id === 'btn_confirm_smartcity_checkout');
  mismatch = 'amount';
  const beforeAction = snapshot();
  const refused = await executeCoreRequest('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: getOrCreateSession(sessionId).currentSurface!.revision, action: 'confirm_smartcity_checkout', payload: button.onEvents[0].payload });
  assert.equal(refused.status, 503);
  assert.equal(snapshot(), beforeAction);
});
