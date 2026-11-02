import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomain, callDomainAsync, domainHandlers, trackDomainOperations, DomainOperationError, type Step } from '../agent-core/src/domain-operations.ts';

test('unrecognized domain mutations are rejected before local or HTTP dispatch', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  let localCalls = 0, httpCalls = 0;
  t.mock.method(domainHandlers, 'wallet', () => { localCalls++; return { status: 200, data: { success: true } }; });
  t.mock.method(globalThis, 'fetch', async () => { httpCalls++; return Response.json({ success: true }); });
  for (const transport of ['local', 'http'] as const) for (const [method, path] of [['POST', '/wallet/unknown'], ['POST', '/rides/book'], ['PUT', '/wallet/pay'], ['DELETE', '/wallet/pay']] as const) {
    process.env.DOMAIN_TRANSPORT = transport;
    const steps: Step[] = [];
    const run = () => transport === 'local'
      ? Promise.resolve().then(() => callDomain('wallet', method, path))
      : actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('wallet', method, path));
    await assert.rejects(trackDomainOperations(steps, run), (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OPERATION_UNSUPPORTED');
    assert.deepEqual(steps, []);
  }
  assert.equal(localCalls, 0);
  assert.equal(httpCalls, 0);
  process.env.DOMAIN_TRANSPORT = 'http';
  for (const path of ['/telecom/other/bills/bill/payments', '/telecom/du/bills/bill/refunds']) {
    const steps: Step[] = [];
    await assert.rejects(trackDomainOperations(steps, () => actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('telecom', 'POST', path))), (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OPERATION_UNSUPPORTED');
    assert.deepEqual(steps, []);
  }
  assert.equal(httpCalls, 0);
});
