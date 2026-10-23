import test from 'node:test';
import assert from 'node:assert/strict';
import { issueApproval, actionIsApproved } from '../agent-core/src/approvals.ts';
import { executeCoreRequest as core, getOrCreateSession } from '../agent-core/src/index.ts';

test('approval requires every offered bound field and rejects extra mutable fields without consuming it', async () => {
  const sessionId = 'approval_preferences_session';
  const initial = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Show my citizen profile and preferences' });
  assert.equal(initial.status, 200);
  const revision = initial.data.surface.revision;
  const dispatch = (payload: object) => core('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: revision, action: 'update_preferences', payload });
  for (const payload of [{}, { dietary: ['Halal'] }, { dietary: ['Vegan', 'Gluten-Free'], ui: { theme: 'dark' } }]) {
    assert.equal((await dispatch(payload)).status, 403);
    assert.equal(getOrCreateSession(sessionId).currentSurface?.revision, revision);
  }
  assert.equal((await dispatch({ dietary: ['Vegan', 'Gluten-Free'] })).status, 200);
});

test('approval expires and detects mutation of the offered surface', async t => {
  const sessionId = 'approval_expiration_session';
  const initial = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Show my wallet balance' });
  const dispatch = () => core('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: initial.data.surface.revision, action: 'topup_wallet', payload: { amount: 50 } });
  const now = Date.now();
  const clock = t.mock.method(Date, 'now', () => now + 300001);
  assert.equal((await dispatch()).status, 403);
  clock.mock.restore();
  const state = getOrCreateSession(sessionId);
  state.currentSurface!.view.children![0].properties!.text = 'Altered quote';
  assert.equal((await dispatch()).status, 403);
  const approval = state.approval!;
  state.currentSurface!.view = { type: 'SurfaceCard', id: 'controls', children: [
    { type: 'Button', id: 'enabled', properties: { label: 'Enabled' }, onEvents: [{ event: 'onPress', actionType: 'AGENT_ACTION_DISPATCH', payload: { action: 'topup_wallet', amount: 50 } }] },
    { type: 'Button', id: 'disabled', properties: { label: 'Disabled', disabled: true }, onEvents: [{ event: 'onPress', actionType: 'AGENT_ACTION_DISPATCH', payload: { action: 'topup_wallet', amount: 60 } }] },
  ] };
  issueApproval(state);
  assert.equal(actionIsApproved(state, 'topup_wallet', { amount: 50 }, approval.subject, approval.accountId), true);
  assert.equal(actionIsApproved(state, 'topup_wallet', { amount: 60 }, approval.subject, approval.accountId), false);
});
