import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPaymentContractVersions } from '../../scripts/payment-contract-docs.ts';

const versions = { payment: '1.15.0', provider: '2.19.0' };
test('payment documentation version checks catch stale or missing current claims', () => {
  const file = 'docs/development/payment-events.md';
  assert.deepEqual(checkPaymentContractVersions(file, 'Payment contract **1.15.0**, payment-provider OpenAPI **2.19.0**.', versions), []);
  assert.match(checkPaymentContractVersions(file, 'Payment contract **1.14.0**, payment-provider OpenAPI **2.18.0**.', versions).join('\n'), /1\.14\.0.*1\.15\.0/);
  assert.match(checkPaymentContractVersions(file, 'Payment contract **1.14.0**, payment-provider OpenAPI **2.18.0**.', versions).join('\n'), /2\.18\.0.*2\.19\.0/);
  assert.match(checkPaymentContractVersions(file, 'Payment contract **1.15.0**.', versions).join('\n'), /missing.*provider/i);
  assert.deepEqual(checkPaymentContractVersions('docs/reports/old.md', 'Payment contract **1.0.0**.', versions), []);
});

test('the checker handles current guide variants and all references in a document', () => {
  const file = 'docs/architecture/service-contracts.md';
  const source = 'payment contract is 1.15.0 and provider OpenAPI 2.19.0. Shared payment contract 1.14.0; payments OpenAPI 2.18.0.';
  const errors = checkPaymentContractVersions(file, source, versions);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /1\.14\.0/); assert.match(errors[1], /2\.18\.0/);
});
