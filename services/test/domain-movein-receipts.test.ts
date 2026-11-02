import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomain, callDomainAsync, domainHandlers, trackDomainOperations, DomainOperationError, type Step } from '../agent-core/src/domain-operations.ts';

test('move-in confirmation matches the tenancy and reported utility and permit statuses', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  const body = { contractNumber: 'contract-1' };
  const receipt = { success: true, ejariContract: 'contract-1', unit: 'Building, Unit', dewaConnected: { premiseId: 'premise-1', status: 'CONNECTED_ACTIVE', depositWaived: true }, residentialParking: { permitNumber: 'permit-1', status: 'ISSUED' } };
  const cases = [
    [receipt, true],
    [{ ...receipt, ejariContract: 'other' }, false],
    [{ ...receipt, unit: '' }, false],
    [{ ...receipt, dewaConnected: { ...receipt.dewaConnected, status: 'PENDING' } }, false],
    [{ ...receipt, dewaConnected: { ...receipt.dewaConnected, depositWaived: false } }, false],
    [{ ...receipt, dewaConnected: { ...receipt.dewaConnected, premiseId: '' } }, false],
    [{ ...receipt, residentialParking: { ...receipt.residentialParking, status: 'PENDING' } }, false],
    [{ ...receipt, residentialParking: { ...receipt.residentialParking, permitNumber: '' } }, false],
  ] as const;
  for (const [data, valid] of cases) for (const transport of ['local', 'http'] as const) {
    process.env.DOMAIN_TRANSPORT = transport;
    const steps: Step[] = [];
    const local = t.mock.method(domainHandlers, 'catalog', () => ({ status: 200, data }));
    const remote = t.mock.method(globalThis, 'fetch', async () => Response.json(data));
    try {
      const run = () => transport === 'local'
        ? Promise.resolve().then(() => callDomain('catalog', 'POST', '/housing/move-in', {}, body))
        : actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('catalog', 'POST', '/housing/move-in', {}, body));
      const result = trackDomainOperations(steps, run);
      if (valid) { await result; assert.equal(steps[0].state, 'SUCCEEDED'); }
      else { await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN'); assert.equal(steps[0].state, 'UNKNOWN'); }
    } finally { local.mock.restore(); remote.mock.restore(); }
  }
});

test('move-in receipt must match an explicitly reviewed premise', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  process.env.DOMAIN_TRANSPORT = 'local';
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  t.mock.method(domainHandlers, 'catalog', () => ({ status: 200, data: { success: true, ejariContract: 'contract-1', unit: 'Unit', dewaConnected: { premiseId: 'other', status: 'CONNECTED_ACTIVE', depositWaived: true }, residentialParking: { permitNumber: 'permit-1', status: 'ISSUED' } } }));
  const steps: Step[] = [];
  await assert.rejects(trackDomainOperations(steps, async () => callDomain('catalog', 'POST', '/housing/move-in', {}, { contractNumber: 'contract-1', expectedPremiseId: 'premise-1' })), (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
  assert.equal(steps[0].state, 'UNKNOWN');
});

test('the fixture move-in receipt confirms its selected tenancy', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  process.env.DOMAIN_TRANSPORT = 'local';
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  const contract = callDomain('catalog', 'GET', '/housing/ejari').data.contract.contractNumber;
  assert.equal(domainHandlers.catalog('POST', '/housing/move-in', {}, { contractNumber: contract, expectedPremiseId: 'other-premise' }).status, 409);
  const steps: Step[] = [];
  const result = await trackDomainOperations(steps, async () => callDomain('catalog', 'POST', '/housing/move-in', {}, { contractNumber: contract }));
  assert.equal(result.data.ejariContract, contract);
  assert.equal(steps[0].state, 'SUCCEEDED');
});
