import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executeCoreRequest as core, getOrCreateSession } from '../agent-core/src/index.ts';
import { modelConsentFor } from '../agent-core/src/model-input.ts';

test('P1-17: the resident switches personal context off and on, and the next model call reads the change', async () => {
  const sessionId = `privacy_${randomUUID()}`;
  assert.equal(modelConsentFor(getOrCreateSession(sessionId)).personalContext, true, 'the demo shares until the resident says otherwise');

  const off = await core('POST', '/api/a2ui/model-privacy', {}, { sessionId, modelPersonalContext: false });
  assert.deepEqual([off.status, off.data.modelPersonalContext], [200, false]);
  assert.equal(modelConsentFor(getOrCreateSession(sessionId)).personalContext, false, 'withheld from the very next prompt');
  assert.equal((await core('GET', `/api/sessions/${sessionId}`)).data.modelPersonalContext, false, 'a reload shows the saved choice');

  const on = await core('POST', '/api/a2ui/model-privacy', {}, { sessionId, modelPersonalContext: true });
  assert.deepEqual([on.status, on.data.modelPersonalContext], [200, true]);
  assert.equal(modelConsentFor(getOrCreateSession(sessionId)).personalContext, true);
});

test('P1-17: the switch is its own conversation\'s and accepts only a boolean', async () => {
  const mine = `privacy_${randomUUID()}`, other = `privacy_${randomUUID()}`;
  await core('POST', '/api/a2ui/model-privacy', {}, { sessionId: mine, modelPersonalContext: false });
  assert.equal(modelConsentFor(getOrCreateSession(other)).personalContext, true, 'another conversation is unchanged');
  for (const bad of ['no', 0, null, undefined]) {
    const refused = await core('POST', '/api/a2ui/model-privacy', {}, { sessionId: mine, modelPersonalContext: bad });
    assert.equal(refused.status, 400, `${String(bad)} is not a choice`);
  }
  assert.equal(modelConsentFor(getOrCreateSession(mine)).personalContext, false, 'a refused request changed nothing');
});

test('P1-17: withdrawing consent is never blocked by a pending reconciliation', async () => {
  const sessionId = `privacy_${randomUUID()}`;
  const session = getOrCreateSession(sessionId);
  session.reconciliation = { outcome: 'UNKNOWN', steps: [] } as unknown as typeof session.reconciliation;
  const off = await core('POST', '/api/a2ui/model-privacy', {}, { sessionId, modelPersonalContext: false });
  assert.equal(off.status, 200);
  assert.equal(modelConsentFor(getOrCreateSession(sessionId)).personalContext, false);
  const intent = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'hello' });
  assert.equal(intent.status, 409, 'other requests still wait for reconciliation');
});
