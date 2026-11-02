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

test('integrated wallet receipts reject USD rather than the expected AED', async t => {
  const previousTransport = process.env.DOMAIN_TRANSPORT, previousIntegration = process.env.PROVIDER_INTEGRATION;
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.PROVIDER_INTEGRATION = 'true';
  t.after(() => { if (previousTransport === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previousTransport; if (previousIntegration === undefined) delete process.env.PROVIDER_INTEGRATION; else process.env.PROVIDER_INTEGRATION = previousIntegration; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, transaction: { id: 'tx1', type: 'PAYMENT', amount: 1, currency: 'USD', status: 'SETTLED' }, remainingBalance: 50 }));
  const steps: Step[] = [];
  await assert.rejects(trackDomainOperations(steps, () => actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('wallet', 'POST', '/wallet/pay', {}, { amount: 1 }))), (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
  assert.equal(steps[0].state, 'UNKNOWN');
});

test('integrated wallet payments require a matching captured charge for this account and request', async t => {
  const previousTransport = process.env.DOMAIN_TRANSPORT, previousIntegration = process.env.PROVIDER_INTEGRATION;
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.PROVIDER_INTEGRATION = 'true';
  t.after(() => { if (previousTransport === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previousTransport; if (previousIntegration === undefined) delete process.env.PROVIDER_INTEGRATION; else process.env.PROVIDER_INTEGRATION = previousIntegration; });
  const actor = actorFor({ sub: 'receipt-owner' }, 'account', 'Bearer test');
  const transaction = { id: 'tx1', type: 'PAYMENT', amount: 1, currency: 'AED', status: 'SETTLED' };
  const charge = { id: 'tx1', accountId: actor.accountId, amountMinor: 100, currency: 'AED', status: 'CAPTURED', refunded: false, merchant: 'superapp', reference: actor.requestId, source: 'wallet' };
  const changes = [null, { id: 'other' }, { accountId: 'other' }, { amountMinor: 101 }, { currency: 'USD' }, { status: 'PENDING' }, { refunded: true }, { merchant: 'other' }, { reference: 'other' }, { source: 'other' }];
  for (const change of changes) {
    const steps: Step[] = [];
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, transaction, charge: change === null ? undefined : { ...charge, ...change }, remainingBalance: 50 }));
    try {
      await assert.rejects(trackDomainOperations(steps, () => actorContext.run(actor, () => callDomainAsync('wallet', 'POST', '/wallet/pay', {}, { amount: 1 }))), (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
      assert.equal(steps[0].state, 'UNKNOWN');
    } finally { fetchMock.mock.restore(); }
  }
  const invalidReference = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, transaction, charge: { ...charge, reference: 'reviewed-reference', operationId: 'wrong-operation' }, remainingBalance: 50 }));
  try {
    await assert.rejects(trackDomainOperations([], () => actorContext.run(actor, () => callDomainAsync('wallet', 'POST', '/wallet/pay', {}, { amount: 1, referenceId: 'reviewed-reference' }))), (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
  } finally { invalidReference.mock.restore(); }
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, transaction: { ...transaction, operationId: actor.requestId }, charge: { ...charge, reference: 'reviewed-reference', operationId: actor.requestId }, remainingBalance: 50 }));
  try {
    const steps: Step[] = [];
    await trackDomainOperations(steps, () => actorContext.run(actor, () => callDomainAsync('wallet', 'POST', '/wallet/pay', {}, { amount: 1, referenceId: 'reviewed-reference' })));
    assert.equal(steps[0].state, 'SUCCEEDED');
  } finally { fetchMock.mock.restore(); }
});
