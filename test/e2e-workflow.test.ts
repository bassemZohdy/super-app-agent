import test from 'node:test';
import assert from 'node:assert/strict';

import { executeCoreRequest, getOrCreateSession } from '../services/agent-core/src/index.ts';
import { executeWalletRequest } from '../services/service-wallet/src/index.ts';
import { validateAGUISurface, validateA2UIMessage, createA2UIMessage } from '../packages/protocol-core/src/index.ts';

test('E2E SuperApp Agent Journey: Complete Composite Multi-Service User Flow', async () => {
  const sessionId = `sess_e2e_${Date.now()}`;

  // 1. Handshake Phase
  const handshakeMsg = createA2UIMessage('A2UI_HANDSHAKE', sessionId, {
    platform: 'react',
    viewport: { width: 1440, height: 900, category: 'desktop' },
    supportedComponents: [
      'SurfaceCard',
      'Heading',
      'Text',
      'Badge',
      'ChoiceGroup',
      'Button',
      'MetricWidget',
      'MapViewer',
      'DataTable',
    ],
    locale: 'en-US',
  });
  const handshakeValid = validateA2UIMessage(handshakeMsg);
  assert.strictEqual(handshakeValid.success, true);

  // 2. Initial Balance Verification
  const initialWalletRes = executeWalletRequest('GET', '/wallet/balance');
  assert.strictEqual(initialWalletRes.status, 200);
  const startBalance = initialWalletRes.data.balance;
  assert.ok(startBalance >= 40.0, 'Wallet has sufficient balance for test');

  // 3. User expresses multi-service intent: "Book ride to Downtown and order pizza"
  const intentRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'Book a ride to Downtown Restaurant and order pizza for delivery there',
  });

  assert.strictEqual(intentRes.status, 200);
  assert.strictEqual(intentRes.data.activeDomain, 'composite');
  assert.ok(intentRes.data.surface);

  // Validate that the returned surface complies strictly with AG-UI v1.0.0 schema
  const surfaceValidation = validateAGUISurface(intentRes.data.surface);
  assert.strictEqual(surfaceValidation.success, true);
  assert.strictEqual(intentRes.data.surface.view.type, 'SurfaceCard');
  assert.strictEqual(intentRes.data.surface.view.id, 'composite_orchestrator_card');

  // Verify the surface contains components for both cab and food metrics
  const children = intentRes.data.surface.view.children;
  assert.ok(children.some((c: any) => c.id === 'metric_cab'));
  assert.ok(children.some((c: any) => c.id === 'metric_dinner'));
  assert.ok(children.some((c: any) => c.id === 'metric_wallet_status'));

  // 4. Human-In-The-Loop Confirmation Action
  const confirmBtn = children.find((c: any) => c.type === 'Button');
  assert.ok(confirmBtn);
  const actionName = confirmBtn.onEvents[0].payload.action;
  assert.strictEqual(actionName, 'confirm_composite_checkout');

  // User taps confirmation button in AG-UI
  const actionRes = await executeCoreRequest('POST', '/api/a2ui/action', {}, {
    sessionId, surfaceRevision: getOrCreateSession(sessionId).currentSurface?.revision,
    action: actionName,
    payload: {},
  });

  assert.strictEqual(actionRes.status, 200);
  assert.ok(actionRes.data.surface);
  assert.strictEqual(actionRes.data.surface.view.id, 'composite_success_card');

  // 5. Post-Checkout Settlement & Ledger Verification
  const finalWalletRes = executeWalletRequest('GET', '/wallet/balance');
  assert.strictEqual(finalWalletRes.status, 200);
  assert.strictEqual(
    finalWalletRes.data.balance,
    Math.round((startBalance - 40.0) * 100) / 100,
    'Wallet balance deducted exactly $40.00'
  );

  const txLedgerRes = executeWalletRequest('GET', '/wallet/transactions');
  assert.strictEqual(txLedgerRes.status, 200);
  const latestTx = txLedgerRes.data.transactions[0];
  assert.strictEqual(latestTx.amount, 40.0);
  assert.strictEqual(latestTx.type, 'PAYMENT');
  assert.strictEqual(latestTx.status, 'SETTLED');

  // 6. Session Persistence Check
  const session = getOrCreateSession(sessionId);
  assert.strictEqual(session.activeDomain, 'composite');
  assert.ok(session.messages.length >= 2);
  assert.strictEqual(session.messages[0].role, 'user');
  assert.strictEqual(session.messages[1].role, 'assistant');
});
