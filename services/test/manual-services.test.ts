import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executeCoreRequest as core, getOrCreateSession } from '../agent-core/src/index.ts';
import { SuperAppAgentGraph } from '../agent-core/src/langgraph/graph.ts';

test('bundled manual routes prepare without model execution, enforce approval and allow cancellation', async t => {
  const llmPath = t.mock.method(SuperAppAgentGraph, 'executeIntent', () => { throw new Error('Manual navigation must bypass model path'); });
  const listing = await core('GET', '/api/services');
  assert.equal(listing.status, 200);
  assert.equal(listing.data.services.length, 11);
  for (const serviceId of ['wallet', 'parking', 'utilities', 'fines', 'housing', 'etisalat', 'du', 'ride', 'food', 'profile', 'salik']) {
    const sessionId = `manual_${randomUUID()}`;
    const result = await core('POST', '/api/manual/prepare', {}, { sessionId, serviceId });
    if (['etisalat','du'].includes(serviceId)) { assert.equal(result.status, 503, 'Telecom requires the integrated providers'); continue; }
    assert.equal(result.status, 200, serviceId);
    assert.ok(result.data.surface.view, serviceId);
    assert.equal(result.data.inference.provider, 'manual-service');
  }
  assert.equal(llmPath.mock.callCount(), 0);
  assert.equal((await core('POST', '/api/manual/prepare', {}, { sessionId: `manual_${randomUUID()}`, serviceId: 'https://untrusted.example/module.js' })).status, 400);
  const sessionId = `manual_${randomUUID()}`;
  const result = await core('POST', '/api/manual/prepare', {}, { sessionId, serviceId: 'wallet' });
  const revision = result.data.surface.revision;
  const cancelled = await core('POST', '/api/a2ui/cancel', {}, { sessionId, surfaceRevision: revision });
  assert.equal(cancelled.status, 200);
  assert.equal(getOrCreateSession(sessionId).approval, undefined);
  assert.ok(getOrCreateSession(sessionId).approvalHistory?.some(item => item.event === 'cancelled'));
  const replay = await core('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: revision, action: 'topup_wallet', payload: { amount: 50 } });
  assert.equal(replay.status, 409);
});
