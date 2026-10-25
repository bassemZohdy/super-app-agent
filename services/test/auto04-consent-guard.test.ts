import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';

// AUTO-04: draft chat or voice text cannot activate a rule. Activation is the explicit approve call with the reviewed digest.
// Only the authenticated HTTP route in payment-accounts.ts may reach it; conversational code must never call it.
const agentSrc = join(import.meta.dirname, '../agent-core/src');
const reachesApproval = (source: string) => /approve(?!d)/i.test(source) && /mandate/i.test(source);
const approvers = readdirSync(agentSrc)
  .filter(name => name.endsWith('.ts'))
  .filter(name => reachesApproval(readFileSync(join(agentSrc, name), 'utf8')));

test('AUTO-04: only the explicit approve route in agent-core can activate a rule, never conversational code', () => {
  assert.deepEqual(approvers, ['payment-accounts.ts'], `approval reachable from: ${approvers.join(', ')}`);
});

test('AUTO-04: an approval without the reviewed digest or version is refused before it reaches the provider', () => {
  const body = { accountId: 'acct_1', requestKey: 'approve-0001', mandateId: 'mandate_1', expectedVersion: 2 };
  assert.ok(validateRequest('agent-core', 'POST', '/api/payments/mandates/approve', {}, body), 'the digest is required');
  assert.equal(validateRequest('agent-core', 'POST', '/api/payments/mandates/approve', {}, { ...body, approvalDigest: 'a'.repeat(64) }), undefined);
});
