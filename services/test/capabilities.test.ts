import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { capabilities } from '../service-catalog/src/capabilities.ts';
import { executeCatalogRequest } from '../service-catalog/src/index.ts';
import { executeRideRequest } from '../service-ride/src/index.ts';
import { executeFoodRequest } from '../service-food/src/index.ts';
import { executeWalletRequest } from '../service-wallet/src/index.ts';
import { executeProfileRequest } from '../service-profile/src/index.ts';

const ajv = new Ajv({ allErrors: true, strict: true, multipleOfPrecision: 10 });
const executors = {
  'service-ride': executeRideRequest, 'service-food': executeFoodRequest,
  'service-wallet': executeWalletRequest, 'service-profile': executeProfileRequest,
  'service-catalog': executeCatalogRequest,
};

test('capability catalog exposes unique versioned contracts and conservative risk/consent metadata', () => {
  assert.equal(new Set(capabilities.map(c => c.id)).size, capabilities.length);
  assert.equal(new Set(capabilities.map(c => c.name)).size, capabilities.length);
  const listed = executeCatalogRequest('GET', '/capabilities');
  assert.equal(listed.status, 200);
  assert.equal(listed.data.capabilities.length, 32);
  for (const capability of capabilities) {
    assert.match(capability.id, /^[a-z][a-z0-9.-]+$/);
    assert.match(capability.version, /^\d+\.\d+\.\d+$/);
    assert.ok(executors[capability.owner]);
    assert.equal(capability.availability, 'simulation-only');
    assert.equal(capability.risk.mutates, capability.execution.method === 'POST');
    if (capability.risk.mutates) {
      assert.equal(capability.risk.requiresConfirmation, true);
      assert.equal(capability.consent.required, true);
      assert.ok(capability.consent.scopes.length);
      assert.equal(capability.consent.subjectBound, true);
    }
    assert.equal(capability.consent.delegationAllowed, false);
    assert.equal(executeCatalogRequest('GET', '/capabilities/' + capability.id).data.capability.id, capability.id);
  }
  assert.equal(executeCatalogRequest('GET', '/capabilities/unknown').status, 404);
  const tools = executeCatalogRequest('GET', '/tools').data.registeredTools;
  assert.deepEqual(new Set(tools.map(tool => tool.capabilityId)), new Set(capabilities.map(c => c.id)));
});

test('all capability JSON Schemas compile and accept the corresponding simulator response', () => {
  let activeTicket: string | undefined;
  executeWalletRequest('POST', '/wallet/topup', {}, { amount: 1000 });
  for (const capability of capabilities) {
    const input = structuredClone(capability.exampleInput);
    if (capability.id === 'mobility.parking.extend') input.ticketId = activeTicket;
    const validateInput = ajv.compile(capability.inputSchema);
    const validateOutput = ajv.compile(capability.outputSchema);
    assert.ok(validateInput(input), capability.id + ': ' + ajv.errorsText(validateInput.errors));
    const { method, path, inputLocation } = capability.execution;
    const route = path.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(String(input[key])));
    const result = executors[capability.owner](method, route,
      inputLocation === 'query' ? input as Record<string, string> : {},
      inputLocation === 'body' ? input : {});
    assert.equal(result.status, 200, capability.id + ': declared example must succeed');
    assert.equal(result.data.success, true, capability.id + ': successful effect/read required');
    if (capability.id === 'mobility.parking.activate') activeTicket = result.data.meter.ticketId;
    assert.ok(validateOutput(result.data), capability.id + ': ' + ajv.errorsText(validateOutput.errors));
    assert.equal(validateInput({ ...capability.exampleInput, undeclaredField: 'unsafe' }), false);
  }
  const pay = capabilities.find(c => c.id === 'citizenpay.wallet.pay')!;
  const validate = ajv.compile(pay.inputSchema);
  assert.equal(validate({ amount: -1, purpose: 'invalid' }), false);
  assert.equal(validate({ amount: 1 }), false);
});
