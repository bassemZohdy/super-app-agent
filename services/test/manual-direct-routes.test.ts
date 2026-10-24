import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executeCoreRequest as core } from '../agent-core/src/index.ts';
import { SuperAppAgentGraph } from '../agent-core/src/langgraph/graph.ts';

// Direct manual routes must run the same approval-gated adapters as the concierge,
// without a prior model proposal.
test('a direct manual action with an amount the reviewed surface did not offer is rejected', async t => {
  t.mock.method(SuperAppAgentGraph, 'executeIntent', () => { throw new Error('Direct routes must not call the model'); });
  const sessionId = `manual_direct_${randomUUID()}`;
  const prepared = await core('POST', '/api/manual/prepare', {}, { sessionId, serviceId: 'wallet' });
  assert.equal(prepared.status, 200);
  const response = await core('POST', '/api/a2ui/action', {}, {
    sessionId, surfaceRevision: prepared.data.surface.revision, action: 'topup_wallet', payload: { amount: 9999 },
  });
  assert.equal(response.status, 403);
  assert.notEqual(response.data.surface?.view?.id, 'wallet_topup_card');
});

test('a direct manual route confirms its approved action and returns the confirmed result', async t => {
  t.mock.method(SuperAppAgentGraph, 'executeIntent', () => { throw new Error('Direct routes must not call the model'); });
  const sessionId = `manual_direct_${randomUUID()}`;
  const prepared = await core('POST', '/api/manual/prepare', {}, { sessionId, serviceId: 'wallet' });
  assert.equal(prepared.status, 200);
  const confirmed = await core('POST', '/api/a2ui/action', {}, {
    sessionId, surfaceRevision: prepared.data.surface.revision, action: 'topup_wallet', payload: { amount: 50 },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.surface.view.id, 'wallet_topup_card');
  const heading = confirmed.data.surface.view.children.find((node: { id: string }) => node.id === 'topup_title');
  assert.match(heading.properties.text, /Wallet Reloaded Successfully/);
});
