import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest, getOrCreateSession } from '../agent-core/src/index.ts';
import { domainHandlers } from '../agent-core/src/domain-operations.ts';
import { balance, executeWalletRequest } from '../service-wallet/src/index.ts';

async function review(sessionId: string) {
  const result = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag' });
  const button = result.data.surface.view.children.find((node: { id: string }) => node.id === 'btn_confirm_smartcity_checkout');
  return { sessionId, surfaceRevision: getOrCreateSession(sessionId).currentSurface!.revision, action: 'confirm_smartcity_checkout', payload: button.onEvents[0].payload };
}

test('a definite wallet refusal before any checkout effect leaves another session able to proceed', async t => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  const request = await review('refused_wallet_checkout'), original = domainHandlers.wallet, before = balance;
  const mock = t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => method === 'POST' && path === '/pay/unified'
    ? { status: 409, data: { success: false, error: 'Refused before debit' } } : original(method, path, query, body));
  const refused = await executeCoreRequest('POST', '/api/a2ui/action', {}, request);
  assert.equal(refused.status, 409); assert.equal(refused.data.outcome, 'FAILED'); assert.equal(balance, before);
  mock.mock.restore();
  const another = await review('after_refused_wallet_checkout');
  assert.equal((await executeCoreRequest('POST', '/api/a2ui/action', {}, another)).status, 200);
  assert.ok(balance < before);
});
