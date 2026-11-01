import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advertisedActions, validateRequest } from '../../packages/protocol-core/src/request-validation.ts';

// P1-12: a button on a surface sends the action it advertises back to the gateway. Every action the gateway puts on a button must have
// a payload schema at the gateway edge, so a payload a client has mangled or an adversary has built is refused with a 400 before any
// handler sees it, instead of being forwarded and refused (or not) further in.
const sources = ['services/agent-core/src/langgraph/graph.ts', 'services/agent-core/src/payment-surfaces.ts']
  .map(path => readFileSync(path, 'utf8')).join('\n');

test('P1-12: every action a gateway surface advertises has a payload schema at the gateway edge', () => {
  const emitted = [...new Set([...sources.matchAll(/payload:\s*\{\s*action:\s*'([a-z_]+)'/g)].map(match => match[1]))];
  assert.ok(emitted.length >= 10, `the advertised actions are enumerated (${emitted.length}: ${emitted.join(', ')})`);
  const unvalidated = emitted.filter(action => !advertisedActions().includes(action));
  assert.deepEqual(unvalidated, [], `these advertised actions have no payload schema: ${unvalidated.join(', ')}`);
});

test('P1-12: a mangled payload for an advertised action is refused at the gateway edge', () => {
  const envelope = { sessionId: 'session_1', surfaceRevision: '00000000-0000-4000-8000-000000000001' };
  for (const action of ['pay_police_fines', 'confirm_movein']) {
    const refused = validateRequest('agent-core', 'POST', '/api/a2ui/action', {}, { ...envelope, action, payload: { zz_unknown_field: 1 } });
    assert.equal(refused?.status, 400, `${action} refuses a field it does not name`);
  }
  const wrongType = validateRequest('agent-core', 'POST', '/api/a2ui/action', {}, { ...envelope, action: 'pay_police_fines', payload: { fineIds: 'FINE-1' } });
  assert.equal(wrongType?.status, 400, 'pay_police_fines refuses fineIds that is not a list');
  const valid = validateRequest('agent-core', 'POST', '/api/a2ui/action', {}, { ...envelope, action: 'pay_police_fines', payload: { fineIds: ['FINE-1'] } });
  assert.equal(valid, undefined, 'a well-formed pay_police_fines payload is accepted');
  assert.equal(validateRequest('agent-core', 'POST', '/api/a2ui/action', {}, { ...envelope, action: 'confirm_movein', payload: {} }), undefined, 'an empty confirm_movein payload is accepted');
});
