import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedSurface, choiceDefaults, surfaceActionPayload } from '../../packages/protocol-core/src/surface-client.ts';
import type { ActionBinding, UIComponentNode } from '../../packages/protocol-core/src/ag-ui.ts';
import { executeCoreRequest } from '../agent-core/src/index.ts';

const dispatch = (payload: Record<string, unknown>): ActionBinding => ({ event: 'onPress', actionType: 'AGENT_ACTION_DISPATCH', payload });
const choiceGroup = (id: string, optionIds: string[], selectedId?: string): UIComponentNode => ({
  type: 'ChoiceGroup', id, properties: { options: optionIds.map(optionId => ({ id: optionId, title: optionId })), selectedId },
});
const card = (children: UIComponentNode[]): UIComponentNode => ({ type: 'SurfaceCard', id: 'card', children });

test('scoping 1: non-dispatch bindings throw the navigation error', () => {
  const view = card([]);
  for (const actionType of ['HOST_NAVIGATE', 'LAUNCH_MINIAPP'] as const) {
    assert.throws(
      () => surfaceActionPayload(view, { event: 'onPress', actionType, payload: { action: 'open' } }, {}),
      { message: 'This navigation action is not supported in this shell.' },
    );
  }
});

test('scoping 2: a view with zero choice groups returns the payload without selectedChoice', () => {
  const payload = surfaceActionPayload(card([{ type: 'Button', id: 'go' }]), dispatch({ action: 'topup_wallet', amount: 50 }),
    { stale_group: 'stale_option' });
  assert.deepEqual(payload, { action: 'topup_wallet', amount: 50 });
  assert.equal(Object.hasOwn(payload, 'selectedChoice'), false);
});

test('scoping 3: two choice groups throw the multiple-groups error, even when both are valid', () => {
  const view = card([choiceGroup('a', ['one']), choiceGroup('b', ['two'])]);
  assert.throws(
    () => surfaceActionPayload(view, dispatch({ action: 'pay' }), { a: 'one', b: 'two' }),
    { message: 'This surface has multiple choice groups and requires an explicit action binding.' },
  );
});

test('scoping 4: one group rejects options outside that group and copies a valid selection', () => {
  const view = card([choiceGroup('ride', ['economy', 'comfort'])]);
  for (const choices of [{ ride: 'luxury' }, { ride: '' }, { other: 'economy' }, {}]) {
    assert.throws(
      () => surfaceActionPayload(view, dispatch({ action: 'book' }), choices),
      { message: 'Choose an available option before continuing.' },
    );
  }
  const payload = surfaceActionPayload(view, dispatch({ action: 'book' }), { ride: 'comfort' });
  assert.equal(payload.selectedChoice, 'comfort');
  assert.equal(payload.action, 'book');
});

test('scoping 5: client formValues cannot inject selectedChoice', () => {
  const withGroup = card([choiceGroup('ride', ['economy'])]);
  const injected = surfaceActionPayload(withGroup, dispatch({ action: 'book' }), { ride: 'economy' },
    { selectedChoice: 'luxury' });
  assert.equal(injected.selectedChoice, 'economy');

  const noGroup = card([]);
  const stripped = surfaceActionPayload(noGroup, dispatch({ action: 'book' }), {}, { selectedChoice: 'luxury' });
  assert.equal(Object.hasOwn(stripped, 'selectedChoice'), false);
});

test('scoping 6: server-bound payload keys are authoritative over client formValues', () => {
  const binding = dispatch({ action: 'pay_bill', provider: 'dewa', billId: 'bill_123', expectedPayables: 1 });
  const payload = surfaceActionPayload(card([]), binding, {}, {
    action: 'drain_wallet', provider: 'attacker', billId: 'bill_999', expectedPayables: 999, note: 'extra',
  });
  assert.equal(payload.action, 'pay_bill');
  assert.equal(payload.provider, 'dewa');
  assert.equal(payload.billId, 'bill_123');
  assert.equal(payload.expectedPayables, 1);
});

test('scoping 7: choiceDefaults falls back to the first option for an unknown selectedId and sets nothing without options', () => {
  assert.deepEqual(choiceDefaults(card([choiceGroup('size', ['small', 'large'], 'missing')])), { size: 'small' });
  assert.deepEqual(choiceDefaults(card([{ type: 'ChoiceGroup', id: 'empty', properties: { options: [] } }])), {});
  assert.deepEqual(choiceDefaults(card([{ type: 'ChoiceGroup', id: 'bare' }])), {});
});

test('scoping 8: checkedSurface rejects a foreign session and a surface without revision', async () => {
  const sessionId = 'scoping_session_a';
  const { data } = await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId, text: 'show my wallet' });
  const surface = data.surface;
  assert.equal(checkedSurface(surface, sessionId).revision, surface.revision);
  assert.throws(() => checkedSurface(surface, 'scoping_session_b'), { message: 'The gateway returned an invalid surface. Refresh your request.' });
  assert.throws(() => checkedSurface({ ...surface, revision: undefined }, sessionId),
    { message: 'The gateway returned an invalid surface. Refresh your request.' });
});
