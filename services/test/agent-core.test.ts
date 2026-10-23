import test from 'node:test';
import assert from 'node:assert/strict';

import { executeCoreRequest, getOrCreateSession } from '../agent-core/src/index.ts';
import { validateAGUISurface } from '../../packages/protocol-core/src/index.ts';

test('agent-core: health check endpoint', async () => {
  const res = await executeCoreRequest('GET', '/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.service, 'agent-core');
  assert.strictEqual(res.data.agentCore, 'deterministic-demo-router');
});

test('agent-core: ride intent classifies correctly and returns valid AG-UI surface', async () => {
  const sid = `sess_ride_${Date.now()}`;
  const res = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId: sid,
    text: 'I need a cab to Downtown Restaurant',
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.activeDomain, 'ride');
  assert.ok(res.data.surface);

  // Validate AG-UI Schema conformity
  const valid = validateAGUISurface(res.data.surface);
  assert.strictEqual(valid.success, true);
  assert.strictEqual(res.data.surface.view.type, 'SurfaceCard');
  assert.ok(res.data.surface.view.children.some((c: any) => c.type === 'MapViewer'));
  assert.ok(res.data.surface.view.children.some((c: any) => c.type === 'ChoiceGroup'));
});

test('agent-core: food intent classifies correctly and returns valid AG-UI surface', async () => {
  const sid = `sess_food_${Date.now()}`;
  const res = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId: sid,
    text: 'Order a spicy woodfired pizza for dinner',
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.activeDomain, 'food');
  assert.ok(res.data.surface);

  const valid = validateAGUISurface(res.data.surface);
  assert.strictEqual(valid.success, true);
});

test('agent-core: wallet intent classifies correctly and returns valid AG-UI surface', async () => {
  const sid = `sess_wallet_${Date.now()}`;
  const res = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId: sid,
    text: 'Check my current wallet balance and recent transactions',
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.activeDomain, 'wallet');
  assert.ok(res.data.surface);

  const valid = validateAGUISurface(res.data.surface);
  assert.strictEqual(valid.success, true);
  assert.ok(res.data.surface.view.children.some((c: any) => c.type === 'DataTable'));
});

test('agent-core: composite multi-domain intent orchestrates ride, food, and wallet', async () => {
  const sid = `sess_comp_${Date.now()}`;
  const res = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId: sid,
    text: 'Book a ride to Downtown and order pizza for delivery there, pay with my wallet',
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.activeDomain, 'composite');
  assert.ok(res.data.surface);

  const valid = validateAGUISurface(res.data.surface);
  assert.strictEqual(valid.success, true);

  // Check that the composite button action is present
  const confirmBtn = res.data.surface.view.children.find((c: any) => c.type === 'Button');
  assert.ok(confirmBtn);
  assert.strictEqual(confirmBtn.onEvents[0].payload.action, 'confirm_composite_checkout');

  // Now trigger the action loop!
  const actionRes = await executeCoreRequest('POST', '/api/a2ui/action', {}, {
    sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision,
    action: 'confirm_composite_checkout',
    payload: {},
  });

  assert.strictEqual(actionRes.status, 200);
  assert.ok(actionRes.data.surface);
  const actionValid = validateAGUISurface(actionRes.data.surface);
  assert.strictEqual(actionValid.success, true);
  assert.strictEqual(actionRes.data.surface.view.id, 'composite_success_card');
});

test('agent-core: action loop handles book_ride dispatch', async () => {
  const sid = `sess_action_ride_${Date.now()}`;
  await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId: sid, text: 'Find a cab ride to Downtown' });
  const actionRes = await executeCoreRequest('POST', '/api/a2ui/action', {}, {
    sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision,
    action: 'book_ride',
    payload: { selectedChoice: 'drv_1' },
  });

  assert.strictEqual(actionRes.status, 200);
  assert.ok(actionRes.data.surface);
  const valid = validateAGUISurface(actionRes.data.surface);
  assert.strictEqual(valid.success, true);
  assert.strictEqual(actionRes.data.surface.view.id, 'ride_confirmed_card');
});

test('agent-core: action loop handles topup_wallet', async () => {
  const sid = `sess_action_wallet_${Date.now()}`;
  await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId: sid, text: 'Show my wallet balance' });
  const actionRes = await executeCoreRequest('POST', '/api/a2ui/action', {}, {
    sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision,
    action: 'topup_wallet',
    payload: { amount: 50.0 },
  });

  assert.strictEqual(actionRes.status, 200);
  assert.ok(actionRes.data.surface);
  const valid = validateAGUISurface(actionRes.data.surface);
  assert.strictEqual(valid.success, true);
  assert.strictEqual(actionRes.data.surface.view.id, 'wallet_topup_card');
});

