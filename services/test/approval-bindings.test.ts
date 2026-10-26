import test from 'node:test';
import assert from 'node:assert/strict';
import { issueApproval, actionIsApproved } from '../agent-core/src/approvals.ts';
import { executeCoreRequest as core, getOrCreateSession } from '../agent-core/src/index.ts';
import { executeProfileRequest as profileService, currentPreferences } from '../service-profile/src/index.ts';

test('approval requires every offered bound field and rejects extra mutable fields without consuming it', async () => {
  const sessionId = 'approval_preferences_session';
  const initial = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Show my citizen profile and preferences' });
  assert.equal(initial.status, 200);
  const revision = initial.data.surface.revision;
  const dispatch = (payload: object) => core('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: revision, action: 'update_preferences', payload });
  const reviewed = profileService('GET', '/profile').data.revision as number;
  // The confirmation names the profile revision it was reviewed at, so it is one of the bound fields: leaving it out is refused.
  for (const payload of [{}, { dietary: ['Halal'] }, { dietary: ['Vegan', 'Gluten-Free'] }, { dietary: ['Vegan', 'Gluten-Free'], expectedRevision: reviewed + 1 }, { dietary: ['Vegan', 'Gluten-Free'], expectedRevision: reviewed, ui: { theme: 'dark' } }]) {
    assert.equal((await dispatch(payload)).status, 403, JSON.stringify(payload));
    assert.equal(getOrCreateSession(sessionId).currentSurface?.revision, revision);
  }
  assert.equal((await dispatch({ dietary: ['Vegan', 'Gluten-Free'], expectedRevision: reviewed })).status, 200);
  assert.equal(profileService('GET', '/profile').data.revision, reviewed + 1, 'a confirmed change moves the revision');
});

test('P1-18: a profile that changed after review is not overwritten; the resident reviews the current values and confirms again', async () => {
  const sessionId = 'approval_profile_revision_session';
  const before = structuredClone(currentPreferences);
  const initial = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Show my citizen profile and preferences' });
  const revision = initial.data.surface.revision;
  const reviewed = profileService('GET', '/profile').data.revision as number;
  const button = JSON.stringify(initial.data.surface.view);
  assert.ok(button.includes(`reviewed at profile revision ${reviewed}`), 'the confirmation names the reviewed revision');
  assert.ok(button.includes('Vegan and Gluten-Free'), 'and the exact fields');

  // Something else changes the profile between the review and the confirmation.
  assert.equal(profileService('POST', '/profile/preferences', {}, { conciergeTone: 'concise', expectedRevision: reviewed }).status, 200);
  const afterOther = structuredClone(currentPreferences);
  const stale = await core('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: revision, action: 'update_preferences', payload: { dietary: ['Vegan', 'Gluten-Free'], expectedRevision: reviewed } });
  assert.equal(stale.status, 200);
  assert.deepEqual(currentPreferences, afterOther, 'nothing was written over the newer change');
  const fresh = getOrCreateSession(sessionId);
  assert.match(fresh.messages.at(-1)!.content, /changed after you reviewed it, so nothing was changed/);
  assert.ok(JSON.stringify(fresh.currentSurface!.view).includes(`reviewed at profile revision ${reviewed + 1}`), 'a new confirmation at the current revision is offered');
  assert.notEqual(fresh.currentSurface!.revision, revision, 'the old surface and its approval are replaced');

  // The old confirmation cannot be replayed, and the new one works.
  assert.equal((await core('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: revision, action: 'update_preferences', payload: { dietary: ['Vegan', 'Gluten-Free'], expectedRevision: reviewed } })).status, 409);
  const again = await core('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: fresh.currentSurface!.revision, action: 'update_preferences', payload: { dietary: ['Vegan', 'Gluten-Free'], expectedRevision: reviewed + 1 } });
  assert.equal(again.status, 200);
  assert.deepEqual(currentPreferences.dietary, ['Vegan', 'Gluten-Free']);
  Object.assign(currentPreferences, before);
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

test('multi-group surfaces approve an exact per-group selection map and reject substituted or malformed choices', () => {
  const sessionId = 'approval_multigroup_session';
  const state = getOrCreateSession(sessionId);
  const group = (id: string, options: string[]) => ({ type: 'ChoiceGroup', id, properties: { options: options.map(option => ({ id: option, title: option })) } });
  const dispatch = { event: 'onPress', actionType: 'AGENT_ACTION_DISPATCH', payload: { action: 'pay_bill', provider: 'dewa' } };
  (state as { user?: { sub: string } }).user = { sub: 'owner' };
  state.metadata = { accountId: 'household' } as typeof state.metadata;
  state.currentSurface = { revision: 'rev_multigroup', sessionId, view: { type: 'SurfaceCard', id: 'pay', children: [
    group('funding', ['wallet_main', 'card_1']),
    group('challenge', ['approve', 'otp']),
    { type: 'Button', id: 'confirm', onEvents: [dispatch] },
  ] } } as typeof state.currentSurface;
  issueApproval(state);
  const approve = (payload: Record<string, unknown>) => actionIsApproved(state, 'pay_bill', payload, 'owner', 'household');
  assert.equal(approve({ provider: 'dewa', selectedChoices: { funding: 'wallet_main', challenge: 'otp' } }), true);
  for (const payload of [
    { provider: 'dewa', selectedChoices: { funding: 'luxury', challenge: 'otp' } },
    { provider: 'dewa', selectedChoices: { funding: 'wallet_main' } },
    { provider: 'dewa', selectedChoices: { funding: 'wallet_main', challenge: 'otp', extra: 'x' } },
    { provider: 'dewa', selectedChoice: 'wallet_main' },
    { provider: 'dewa', selectedChoices: 'wallet_main' },
    { provider: 'dewa', selectedChoices: { funding: 'wallet_main', challenge: 'otp' }, selectedChoice: 'wallet_main' },
  ]) {
    assert.equal(approve(payload), false);
  }
  state.currentSurface!.view = { type: 'SurfaceCard', id: 'pay2', children: [
    group('funding', ['wallet_main']), { type: 'Button', id: 'c2', onEvents: [dispatch] },
  ] };
  issueApproval(state);
  assert.equal(approve({ provider: 'dewa', selectedChoice: 'wallet_main', selectedChoices: { funding: 'wallet_main' } }), false);
  assert.equal(approve({ provider: 'dewa', selectedChoice: 'wallet_main' }), true);
  assert.equal(approve({ provider: 'dewa' }), false);
});
