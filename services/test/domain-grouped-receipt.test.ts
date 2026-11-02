import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomainAsync, domainHandlers, trackDomainOperations, DomainOperationError, type Step } from '../agent-core/src/domain-operations.ts';

test('grouped-payment confirmation matches the requested sum in exact fils', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  const body = { items: [{ agency: 'A', purpose: 'Review', amount: 0.1 }, { agency: 'B', purpose: 'Review', amount: 0.2 }] };
  for (const transport of ['local', 'http']) for (const path of ['/pay/unified', '/pay/multi-agency']) for (const sample of [
    { total: 0.3, balance: 10, valid: true },
    { total: 0.31, balance: 10, valid: false },
    { total: 0.30000000000000004, balance: 10, valid: false },
    { total: -0.3, balance: 10, valid: false },
    { total: 0.3, balance: -1, valid: false },
    { total: 0.3, balance: 1.001, valid: false },
  ]) {
    process.env.DOMAIN_TRANSPORT = transport;
    const data = { success: true, govTransactionHash: 'receipt', settlementPlatform: 'demo', grandTotal: sample.total, remainingBalance: sample.balance };
    const local = t.mock.method(domainHandlers, 'wallet', () => ({ status: 200, data }));
    const remote = t.mock.method(globalThis, 'fetch', async () => Response.json(data));
    const steps: Step[] = [];
    try {
      const run = () => actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('wallet', 'POST', path, {}, body));
      const result = trackDomainOperations(steps, run);
      if (sample.valid) { await result; assert.equal(steps[0].state, 'SUCCEEDED'); }
      else { await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN'); assert.equal(steps[0].state, 'UNKNOWN'); }
    } finally { local.mock.restore(); remote.mock.restore(); }
  }
});
