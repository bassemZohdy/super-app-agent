import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomain, callDomainAsync, domainHandlers, trackDomainOperations, DomainOperationError, type Step } from '../agent-core/src/domain-operations.ts';

const responses = [
  { status: 409, data: { code: 'PROVIDER_OUTCOME_UNKNOWN', error: 'unconfirmed' } },
  { status: 409, data: { code: 'SETTLEMENT_STATUS_UNKNOWN', error: 'unconfirmed' } },
  { status: 409, data: { code: 'OBLIGATION_RECONCILIATION_REQUIRED', error: 'reconcile' } },
  { status: 409, data: { code: 'SETTLEMENT_NOT_CONFIRMED', error: 'unconfirmed' } },
  { status: 409, data: { success: true, error: 'contradictory' } },
  { status: 409, data: {} },
  { status: 409, data: { code: 'UNCLASSIFIED' } },
  ...['ALREADY_PAID', 'ALREADY_APPLIED', 'ALREADY_CAPTURED', 'ALREADY_DECIDED', 'PAYMENT_ALREADY_USED', 'AUTOMATION_ALREADY_DISPATCHED', 'IDEMPOTENCY_CONFLICT'].map(code => ({ status: 409, data: { success: false, code, error: 'already recorded' } })),
  { status: 401, data: { success: false, code: 'ACTOR_REQUIRED', error: 'unauthorized' } },
  { status: 429, data: { success: false, code: 'RATE_LIMITED', error: 'rate limit exceeded' } },
  { status: 408, data: { success: false, error: 'timeout' } },
];

test('ambiguous mutation responses stay UNKNOWN in both local and HTTP transports', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  for (const response of responses) {
    for (const transport of ['local', 'http'] as const) {
      process.env.DOMAIN_TRANSPORT = transport;
      const steps: Step[] = [];
      const context = t.mock.method(domainHandlers, 'wallet', () => response);
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(response.data, { status: response.status }));
      try {
        const run = () => transport === 'local'
          ? Promise.resolve().then(() => callDomain('wallet', 'POST', '/wallet/pay'))
          : actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('wallet', 'POST', '/wallet/pay'));
        await assert.rejects(trackDomainOperations(steps, run), (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
        assert.equal(steps[0].state, 'UNKNOWN');
      } finally { context.mock.restore(); fetchMock.mock.restore(); }
    }
  }
});

test('an explicit rejection remains FAILED in both local and HTTP transports', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  for (const transport of ['local', 'http'] as const) {
    process.env.DOMAIN_TRANSPORT = transport;
    const steps: Step[] = [];
    const local = t.mock.method(domainHandlers, 'wallet', () => ({ status: 409, data: { error: 'Rejected' } }));
    const remote = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Rejected' }, { status: 409 }));
    try {
      const run = () => transport === 'local'
        ? Promise.resolve().then(() => callDomain('wallet', 'POST', '/wallet/pay'))
        : actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('wallet', 'POST', '/wallet/pay'));
      await assert.rejects(trackDomainOperations(steps, run), (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_REJECTED');
      assert.equal(steps[0].state, 'FAILED');
    } finally { local.mock.restore(); remote.mock.restore(); }
  }
});
