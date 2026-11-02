import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomain, callDomainAsync, domainHandlers, trackDomainOperations, DomainOperationError, type Step } from '../agent-core/src/domain-operations.ts';

test('wallet payment and top-up confirmations match the requested amount and settled transaction', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  for (const path of ['/wallet/pay', '/wallet/topup']) {
    const type = path === '/wallet/pay' ? 'PAYMENT' : 'TOPUP';
    const balanceKey = path === '/wallet/pay' ? 'remainingBalance' : 'newBalance';
    const transaction = { id: 'tx1', type, amount: 40.01, currency: 'USD', status: 'SETTLED' };
    const good = { success: true, transaction, [balanceKey]: 50 };
    for (const [reply, valid] of [
      [good, true],
      ...[{ amount: 40 }, { amount: 40.011 }, { amount: '40.01' }, { type: 'OTHER' }, { currency: 'AED' }, { status: 'PENDING' }, { id: '' }].map(change => [{ ...good, transaction: { ...transaction, ...change } }, false]),
      [{ ...good, [balanceKey]: -1 }, false],
    ] as const) {
      for (const transport of ['local', 'http'] as const) {
        process.env.DOMAIN_TRANSPORT = transport;
        const steps: Step[] = [];
        const local = t.mock.method(domainHandlers, 'wallet', () => ({ status: 200, data: reply }));
        const remote = t.mock.method(globalThis, 'fetch', async () => Response.json(reply));
        try {
          const run = () => transport === 'local'
            ? Promise.resolve().then(() => callDomain('wallet', 'POST', path, {}, { amount: 40.01 }))
            : actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('wallet', 'POST', path, {}, { amount: 40.01 }));
          const result = trackDomainOperations(steps, run);
          if (valid) { await result; assert.equal(steps[0].state, 'SUCCEEDED'); }
          else { await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN'); assert.equal(steps[0].state, 'UNKNOWN'); }
        } finally { local.mock.restore(); remote.mock.restore(); }
      }
    }
  }
});
