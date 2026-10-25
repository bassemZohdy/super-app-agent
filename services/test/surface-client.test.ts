import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceDefaults, checkedSurface, readCoreResponse, surfaceActionPayload } from '../../packages/protocol-core/src/surface-client.ts';
import { executeCoreRequest as core } from '../agent-core/src/index.ts';
import { transactions } from '../service-wallet/src/index.ts';
import type { UIComponentNode, ActionBinding } from '../../packages/protocol-core/src/ag-ui.ts';
const binding: ActionBinding = { event: 'onPress', actionType: 'AGENT_ACTION_DISPATCH', payload: { action: 'topup_wallet', amount: 50 } };
const group = (id: string, option: string): UIComponentNode => ({ type: 'ChoiceGroup', id, properties: { options: [{ id: option, title: option }] } });
const card = (children: UIComponentNode[]): UIComponentNode => ({ type: 'SurfaceCard', id: 'card', children });

test('P1-12: absent selections are omitted, bound values preserved and stale selections rejected', () => {
  assert.deepEqual(surfaceActionPayload(card([]), binding, { old_group: 'old_option' }), binding.payload);
  const view = card([group('new_group', 'new_option')]);
  const choices = choiceDefaults(view);
  assert.deepEqual(choices, { new_group: 'new_option' });
  assert.equal(surfaceActionPayload(view, binding, choices).selectedChoice, 'new_option');
  assert.throws(() => surfaceActionPayload(view, binding, { new_group: 'old_option' }), /Choose an available option/);
  assert.deepEqual(surfaceActionPayload(card([group('a', 'one'), group('b', 'two')]), binding, { a: 'one', b: 'two' }),
    { ...binding.payload, selectedChoices: { a: 'one', b: 'two' } });
  assert.throws(() => surfaceActionPayload(view, { ...binding, actionType: 'HOST_NAVIGATE' }, choices), /not supported/);
});

test('P1-12: defaults honor valid advertised choice and replace group state between surfaces', () => {
  const view = group('ride', 'first');
  view.properties!.options.push({ id: 'second', title: 'second' });
  view.properties!.selectedId = 'second';
  assert.equal(choiceDefaults(view).ride, 'second');
  view.properties!.selectedId = 'missing';
  assert.equal(choiceDefaults(view).ride, 'first');
  assert.deepEqual(choiceDefaults(card([])), {});
});

test('P1-12: real wallet surface produces a valid action without an empty selectedChoice', async () => {
  const sessionId = 'surface_client_wallet';
  const result = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'show my wallet' });
  const surface = checkedSurface(result.data.surface, sessionId);
  const button = surface.view.children!.find(node => node.onEvents?.some(event => event.payload.action === 'topup_wallet'))!;
  const payload = surfaceActionPayload(surface.view, button.onEvents![0], choiceDefaults(surface.view));
  assert.equal(Object.hasOwn(payload, 'selectedChoice'), false);
  const count = transactions.length;
  const action = await core('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision: surface.revision, action: payload.action, payload });
  assert.equal(action.status, 200);
  assert.equal(transactions.length, count + 1);
  const response = await readCoreResponse(Response.json(action.data, { status: action.status }), sessionId);
  assert.equal(response.surface?.revision, action.data.surface.revision);
});

test('P1-12: all HTTP error statuses are read and valid warning/stale surfaces remain renderable', async () => {
  const sessionId = 'surface_client_errors';
  const { data } = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'show my wallet' });
  for (const status of [400, 401, 403, 409, 429, 500, 502]) {
    const result = await readCoreResponse(Response.json({ success: false, error: 'Review this request', surface: data.surface }, { status }), sessionId);
    assert.equal(result.error, 'Review this request');
    assert.equal(result.surface?.revision, data.surface.revision);
  }
  assert.match((await readCoreResponse(Response.json({}, { status: 429 }), sessionId)).error!, /429/);
});

test('P1-12: malformed, cross-session and revisionless responses fail closed', async () => {
  const sessionId = 'surface_client_invalid';
  const { data } = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'show my wallet' });
  for (const surface of [null, {}, { ...data.surface, revision: undefined }, { ...data.surface, sessionId: 'other_session' }, { ...data.surface, view: { type: 'BadNode' } }]) {
    await assert.rejects(readCoreResponse(Response.json({ success: true, surface }), sessionId), /invalid surface/);
  }
  await assert.rejects(readCoreResponse(Response.json({ success: true }), sessionId), /no surface/);
  await assert.rejects(readCoreResponse(Response.json([]), sessionId), /Invalid gateway response/);
  await assert.rejects(readCoreResponse(new Response('<html>unavailable</html>', { status: 502 }), sessionId));
});
