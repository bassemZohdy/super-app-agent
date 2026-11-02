import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionError } from '../agent-core/src/session-store.ts';
import { SuperAppAgentGraph } from '../agent-core/src/langgraph/graph.ts';

test('separate-service civic actions refuse dispatch without shared coordination', async t => {
  const previous = { transport: process.env.DOMAIN_TRANSPORT, store: process.env.SESSION_STORE };
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.SESSION_STORE = 'memory';
  t.after(() => { process.env.DOMAIN_TRANSPORT = previous.transport; process.env.SESSION_STORE = previous.store; });
  for (const action of ['confirm_smartcity_checkout', 'pay_utilities_bill', 'pay_police_fines']) {
    await assert.rejects(SuperAppAgentGraph.resumeWithAction({ sessionId: `no-coordination-${action}`, messages: [], activeDomain: 'concierge' }, action, {}),
      (error: unknown) => error instanceof SessionError && error.status === 503 && error.code === 'SESSION_STORE_UNAVAILABLE');
  }
});
