import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../packages/backend-kit/src/http-policy.ts';
import { EligibilityReadError } from '../../packages/backend-kit/src/eligibility-client.ts';
import { executeCoreRequest, getOrCreateSession } from '../agent-core/src/index.ts';
import { SuperAppAgentGraph } from '../agent-core/src/langgraph/graph.ts';
import { callDomain, domainHandlers } from '../agent-core/src/domain-operations.ts';
import { SessionError } from '../agent-core/src/session-store.ts';
import { balance } from '../service-wallet/src/index.ts';

test('controlled errors after a successful effect require reconciliation', async t => {
  const errors = [new HttpError(409, 'internal detail'), new SessionError(409, 'SESSION_LOCK_LOST', 'internal detail'), new EligibilityReadError(403, 'internal detail')];
  for (const [index, failure] of errors.entries()) {
    const sessionId = `partial_controlled_${index}`;
    const intent = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text: 'show my wallet' });
    assert.equal(intent.status, 200);
    const revision = getOrCreateSession(sessionId).currentSurface!.revision;
    const original = balance;
    const mock = t.mock.method(SuperAppAgentGraph, 'resumeWithAction', async () => {
      callDomain('wallet', 'POST', '/wallet/topup', {}, { amount: 50 });
      throw failure;
    });
    try {
      const result = await executeCoreRequest('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: revision, action: 'topup_wallet', payload: { amount: 50 } });
      assert.equal(result.status, 409);
      assert.equal(result.data.code, 'PARTIAL_EXECUTION');
      assert.equal(result.data.outcome, 'PARTIALLY_COMPLETED');
      assert.equal(result.data.steps[0].state, 'SUCCEEDED');
      assert.equal(result.data.retry.allowed, false);
      assert.ok(!JSON.stringify(result).includes('internal detail'));
      assert.equal(balance, original + 50);
      const retry = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text: 'show my wallet' });
      assert.equal(retry.data.code, 'RECONCILIATION_REQUIRED');
    } finally { mock.mock.restore(); }
  }
});

test('a controlled error cannot downgrade an unknown effect to a clean rejection', async t => {
  const sessionId = 'unknown_controlled_error';
  assert.equal((await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text: 'show my wallet' })).status, 200);
  const revision = getOrCreateSession(sessionId).currentSurface!.revision;
  t.mock.method(domainHandlers, 'wallet', () => ({ status: 200, data: { success: true } }));
  t.mock.method(SuperAppAgentGraph, 'resumeWithAction', async () => {
    try { callDomain('wallet', 'POST', '/wallet/topup', {}, { amount: 50 }); } catch { /* a later guard fails */ }
    throw new HttpError(409, 'internal detail');
  });
  const result = await executeCoreRequest('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: revision, action: 'topup_wallet', payload: { amount: 50 } });
  assert.equal(result.status, 502);
  assert.equal(result.data.code, 'DOMAIN_OUTCOME_UNKNOWN');
  assert.equal(result.data.steps[0].state, 'UNKNOWN');
  assert.equal(result.data.retry.allowed, false);
  assert.equal((await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text: 'show my wallet' })).data.code, 'RECONCILIATION_REQUIRED');
});
