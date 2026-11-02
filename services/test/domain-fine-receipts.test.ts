import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomain, callDomainAsync, domainHandlers, trackDomainOperations, DomainOperationError, type Step } from '../agent-core/src/domain-operations.ts';

test('fines receipts must match the requested count and reviewed amount in both transports', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  const body = { fineIds: ['fine-one', 'fine-two'], expectedAmountMinor: 115 };
  const valid = { success: true, receiptNumber: 'receipt', amountPaid: 1.15, finesCleared: 2, remainingBalance: 100 };
  const cases = [
    { result: { ...valid, finesCleared: 1 }, accepted: false },
    { result: { ...valid, finesCleared: 3 }, accepted: false },
    { result: { ...valid, amountPaid: 1.16 }, accepted: false },
    { result: { ...valid, amountPaid: 1.151 }, accepted: false },
    { result: { ...valid, amountPaid: -1.15 }, accepted: false },
    { result: valid, accepted: true },
    { result: valid, accepted: true, request: { fineIds: ['fine-one', 'fine-two'] } },
    { result: valid, accepted: false, request: { fineIds: ['fine-one', 'fine-one'] } },
    { result: valid, accepted: false, request: { fineIds: ['fine-one', 'fine-two'], expectedAmountMinor: -1 } },
  ];
  for (const { result, accepted, request = body } of cases) for (const transport of ['local', 'http'] as const) {
    process.env.DOMAIN_TRANSPORT = transport;
    const steps: Step[] = [];
    const local = t.mock.method(domainHandlers, 'wallet', () => ({ status: 200, data: result }));
    const remote = t.mock.method(globalThis, 'fetch', async () => Response.json(result));
    try {
      const run = () => transport === 'local'
        ? Promise.resolve().then(() => callDomain('wallet', 'POST', '/fines/pay', {}, request))
        : actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('wallet', 'POST', '/fines/pay', {}, request));
      if (accepted) { await trackDomainOperations(steps, run); assert.equal(steps[0].state, 'SUCCEEDED'); }
      else { await assert.rejects(trackDomainOperations(steps, run), (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN'); assert.equal(steps[0].state, 'UNKNOWN'); }
    } finally { local.mock.restore(); remote.mock.restore(); }
  }
});
