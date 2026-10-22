import test from 'node:test';
import assert from 'node:assert/strict';

import { executeCoreRequest, getOrCreateSession } from '../services/agent-core/src/index.ts';
import { executeRideRequest } from '../services/service-ride/src/index.ts';
import { executeFoodRequest } from '../services/service-food/src/index.ts';
import { executeWalletRequest } from '../services/service-wallet/src/index.ts';
import { executeCatalogRequest } from '../services/service-catalog/src/index.ts';
import { executeProfileRequest } from '../services/service-profile/src/index.ts';
import { generateKeycloakToken } from '../services/agent-core/src/auth.ts';
import {
  validateAGUISurface,
  validateA2UIMessage,
  createA2UIMessage,
  type AGUISurfacePayload,
} from '../packages/protocol-core/src/index.ts';

// ==============================================================================
// SCENARIO 1: Commuter Morning Rush (Ride Hailing & Real-Time Telemetry Tracking)
// ==============================================================================
test('E2E Life Scenario 1: Commuter Morning Rush - Ride Hailing & Tracking', async () => {
  const sessionId = `sess_commuter_${Date.now()}`;

  // 1. Mobile Client Handshake
  const handshake = createA2UIMessage('A2UI_HANDSHAKE', sessionId, {
    platform: 'react',
    viewport: { width: 390, height: 844, category: 'mobile' },
    supportedComponents: ['SurfaceCard', 'ChoiceGroup', 'Button', 'MetricWidget', 'MapViewer'],
    locale: 'en-US',
  });
  assert.strictEqual(validateA2UIMessage(handshake).success, true);

  // 2. User intent: Rush hour cab booking
  const intentRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'I need a cab to SFO Airport Terminal 2',
  });
  assert.strictEqual(intentRes.status, 200);
  assert.strictEqual(intentRes.data.activeDomain, 'ride');
  assert.ok(intentRes.data.surface);

  // 3. Verify AG-UI declarative surface
  const surfaceValidation = validateAGUISurface(intentRes.data.surface);
  assert.strictEqual(surfaceValidation.success, true);
  const root = intentRes.data.surface.view;
  assert.strictEqual(root.type, 'SurfaceCard');
  assert.ok(root.children.some((c: any) => c.type === 'MapViewer'));
  assert.ok(root.children.some((c: any) => c.type === 'ChoiceGroup'));

  // 4. User selects Comfort Sedan and confirms ride
  const confirmAction = await executeCoreRequest('POST', '/api/a2ui/action', {}, {
    sessionId,
    action: 'book_ride',
    payload: { selectedChoice: 'drv_1' },
  });
  assert.strictEqual(confirmAction.status, 200);
  assert.strictEqual(confirmAction.data.surface.view.id, 'ride_confirmed_card');

  // 5. Verify driver telemetry tracking via Ride Microservice
  const trackingRes = executeRideRequest('GET', '/rides/track/active');
  assert.strictEqual(trackingRes.status, 200);
  assert.strictEqual(trackingRes.data.success, true);
  assert.strictEqual(trackingRes.data.status, 'IN_TRANSIT');
  assert.ok(trackingRes.data.currentLocation.lat);
  assert.ok(trackingRes.data.currentLocation.lng);
});

// ==============================================================================
// SCENARIO 2: Evening Dinner Delivery (Food Discovery, Order & Kitchen Prep)
// ==============================================================================
test('E2E Life Scenario 2: Evening Dinner - Food Discovery & Kitchen Prep', async () => {
  const sessionId = `sess_dinner_${Date.now()}`;

  // 1. Handshake from Desktop Shell
  const handshake = createA2UIMessage('A2UI_HANDSHAKE', sessionId, {
    platform: 'web_responsive',
    viewport: { width: 1440, height: 900, category: 'desktop' },
    supportedComponents: ['SurfaceCard', 'Heading', 'ChoiceGroup', 'Button', 'MetricWidget'],
  });
  assert.strictEqual(validateA2UIMessage(handshake).success, true);

  // 2. User intent: Order woodfired pizza
  const intentRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'Order a spicy woodfired pizza diavola for dinner',
  });
  assert.strictEqual(intentRes.status, 200);
  assert.strictEqual(intentRes.data.activeDomain, 'food');

  // 3. Verify AG-UI surface contains menu choices
  const surface: AGUISurfacePayload = intentRes.data.surface;
  assert.strictEqual(validateAGUISurface(surface).success, true);
  const choiceGroup = surface.view.children.find((c: any) => c.type === 'ChoiceGroup');
  assert.ok(choiceGroup);
  assert.ok(choiceGroup.properties.options.length > 0);

  // 4. User confirms food order
  const orderAction = await executeCoreRequest('POST', '/api/a2ui/action', {}, {
    sessionId,
    action: 'order_food',
    payload: { selectedChoice: 'item_diavola' },
  });
  assert.strictEqual(orderAction.status, 200);
  assert.strictEqual(orderAction.data.surface.view.id, 'food_confirmed_card');

  // 5. Verify kitchen tracking via Food Microservice
  const kitchenTracking = executeFoodRequest('GET', '/orders/track/active');
  assert.strictEqual(kitchenTracking.status, 200);
  assert.strictEqual(kitchenTracking.data.status, 'PREPARING');
  assert.strictEqual(kitchenTracking.data.restaurantName, 'Pizza Napoli & Trattoria');
});

// ==============================================================================
// SCENARIO 3: Digital Wallet Management (Balance, Transaction Ledger & Top-Up)
// ==============================================================================
test('E2E Life Scenario 3: Wallet Management - Balance, Ledger & Top-Up', async () => {
  const sessionId = `sess_wallet_mgmt_${Date.now()}`;

  // 1. User asks for wallet status
  const intentRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'What is my wallet balance and recent transaction receipts?',
  });
  assert.strictEqual(intentRes.status, 200);
  assert.strictEqual(intentRes.data.activeDomain, 'wallet');

  // 2. Surface contains balance metric and transaction DataTable
  const surface = intentRes.data.surface;
  assert.strictEqual(validateAGUISurface(surface).success, true);
  assert.ok(surface.view.children.some((c: any) => c.type === 'MetricWidget'));
  assert.ok(surface.view.children.some((c: any) => c.type === 'DataTable'));

  const balanceBefore = executeWalletRequest('GET', '/wallet/balance').data.balance;

  // 3. User performs quick top-up of $50
  const topupRes = await executeCoreRequest('POST', '/api/a2ui/action', {}, {
    sessionId,
    action: 'topup_wallet',
    payload: { amount: 50.0 },
  });
  assert.strictEqual(topupRes.status, 200);
  assert.strictEqual(topupRes.data.surface.view.id, 'wallet_topup_card');

  // 4. Verify wallet balance credited by exactly $50
  const balanceAfter = executeWalletRequest('GET', '/wallet/balance').data.balance;
  assert.strictEqual(balanceAfter, Math.round((balanceBefore + 50.0) * 100) / 100);

  // 5. Verify transaction ledger record
  const ledgerRes = executeWalletRequest('GET', '/wallet/transactions');
  assert.strictEqual(ledgerRes.status, 200);
  const latestTx = ledgerRes.data.transactions[0];
  assert.strictEqual(latestTx.type, 'TOPUP');
  assert.strictEqual(latestTx.amount, 50.0);
  assert.strictEqual(latestTx.status, 'SETTLED');
});

// ==============================================================================
// SCENARIO 4: Composite Multi-Agent Orchestration (Ride + Food + Wallet HITL)
// ==============================================================================
test('E2E Life Scenario 4: Composite Multi-Agent Orchestration with HITL Checkout', async () => {
  const sessionId = `sess_composite_life_${Date.now()}`;

  const startBalance = executeWalletRequest('GET', '/wallet/balance').data.balance;

  // 1. User composite instruction
  const compositeRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'Book a ride to Downtown and order pizza for delivery there, pay with my wallet',
  });
  assert.strictEqual(compositeRes.status, 200);
  assert.strictEqual(compositeRes.data.activeDomain, 'composite');

  // 2. Composite surface contains both services and wallet summary
  const surface = compositeRes.data.surface;
  assert.strictEqual(validateAGUISurface(surface).success, true);
  assert.strictEqual(surface.view.id, 'composite_orchestrator_card');

  const btn = surface.view.children.find((c: any) => c.type === 'Button');
  assert.ok(btn);
  assert.strictEqual(btn.onEvents[0].payload.action, 'confirm_composite_checkout');

  // 3. Human-In-The-Loop: User reviews combined card and taps authorize
  const checkoutRes = await executeCoreRequest('POST', '/api/a2ui/action', {}, {
    sessionId,
    action: 'confirm_composite_checkout',
    payload: {},
  });
  assert.strictEqual(checkoutRes.status, 200);
  assert.strictEqual(checkoutRes.data.surface.view.id, 'composite_success_card');

  // 4. Verify post-settlement wallet ledger deduction
  const endBalance = executeWalletRequest('GET', '/wallet/balance').data.balance;
  assert.strictEqual(endBalance, Math.round((startBalance - 40.0) * 100) / 100);

  // 5. Verify both rides and food orders registered
  const rides = executeRideRequest('GET', '/rides/options');
  assert.strictEqual(rides.status, 200);
  const food = executeFoodRequest('GET', '/restaurants/search');
  assert.strictEqual(food.status, 200);
});

// ==============================================================================
// SCENARIO 5: Catalog Ecosystem Discovery (Greeting / Directory Explorer)
// ==============================================================================
test('E2E Life Scenario 5: Concierge Ecosystem & Mini-App Catalog Exploration', async () => {
  const sessionId = `sess_catalog_${Date.now()}`;

  // User sends greeting / overview request
  const intentRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'Hello, what services are installed in the SuperApp?',
  });
  assert.strictEqual(intentRes.status, 200);
  assert.strictEqual(intentRes.data.activeDomain, 'concierge');

  // Surface contains registered mini-apps
  const surface = intentRes.data.surface;
  assert.strictEqual(validateAGUISurface(surface).success, true);
  assert.strictEqual(surface.view.id, 'catalog_card');

  // Verify catalog service reports installed mini-apps and registered MCP tools
  const catalogRes = executeCatalogRequest('GET', '/miniapps');
  assert.strictEqual(catalogRes.data.count, 3);
  const toolsRes = executeCatalogRequest('GET', '/tools');
  assert.ok(toolsRes.data.registeredTools.length >= 9);
});

// ==============================================================================
// SCENARIO 6: Financial Safety Guardrail (Insufficient Funds Rejection)
// ==============================================================================
test('E2E Life Scenario 6: Financial Guardrail - Insufficient Balance Protection', () => {
  const currentBalance = executeWalletRequest('GET', '/wallet/balance').data.balance;

  // Attempt payment that exceeds balance
  const excessivePayment = currentBalance + 500.0;
  const payAttempt = executeWalletRequest('POST', '/wallet/pay', {}, {
    amount: excessivePayment,
    purpose: 'Unauthorized Luxury Item',
  });

  // Must reject with 400 error and leave balance intact
  assert.strictEqual(payAttempt.status, 400);
  assert.strictEqual(payAttempt.data.error, 'Insufficient wallet balance');

  const balanceAfter = executeWalletRequest('GET', '/wallet/balance').data.balance;
  assert.strictEqual(balanceAfter, currentBalance, 'Balance must remain unchanged after rejected transaction');
});

// ==============================================================================
// SCENARIO 7: Wire Protocol Streaming & Handshake Rejection Guardrails
// ==============================================================================
test('E2E Life Scenario 7: A2-UI Protocol Validation & Rejection Guardrails', () => {
  const validEnvelope = createA2UIMessage('A2UI_STREAM_DELTA', 'sess_wire', {
    phase: 'REASONING',
    text: 'Evaluating traffic patterns...',
  });
  assert.strictEqual(validateA2UIMessage(validEnvelope).success, true);

  // Corrupt envelope missing session ID
  const corruptEnvelope = {
    id: 'msg_bad',
    type: 'A2UI_USER_INTENT',
    // sessionId omitted
    timestamp: Date.now(),
    data: { text: 'test' },
  };
  const validation = validateA2UIMessage(corruptEnvelope);
  assert.strictEqual(validation.success, false);
  assert.ok(validation.errors!.some((e) => e.includes('sessionId')));
});

// ==============================================================================
// SCENARIO 8: User Profile Personalization & Adaptive AG-UI Surfaces
// ==============================================================================
test('E2E Life Scenario 8: User Profile Personalization & Adaptive AG-UI Surfaces', async () => {
  const sessionId = `sess_profile_pers_${Date.now()}`;

  // 1. Verify user profile and prompt-context from profile service
  const promptCtxRes = executeProfileRequest('GET', '/profile/prompt-context');
  assert.strictEqual(promptCtxRes.status, 200);
  assert.strictEqual(promptCtxRes.data.profile.displayName, 'Bassem Zohdy');
  assert.strictEqual(promptCtxRes.data.profile.vipTier, 'Gold VIP');
  assert.strictEqual(promptCtxRes.data.preferences.mobility.preferredTier, 'drv_3'); // Tesla Model Y

  // 2. Personalize Ride Surface: preferred EV sorted to top with eco badge
  const rideIntentRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'Book me a ride downtown',
  });
  assert.strictEqual(rideIntentRes.status, 200);
  assert.strictEqual(rideIntentRes.data.activeDomain, 'ride');
  const rideSurface = rideIntentRes.data.surface;
  assert.strictEqual(validateAGUISurface(rideSurface).success, true);

  const choiceGroup = rideSurface.view.children.find((c: any) => c.type === 'ChoiceGroup');
  assert.ok(choiceGroup);
  // drv_3 (Tesla Model Y) sorted to first position
  assert.strictEqual(choiceGroup.properties.options[0].id, 'drv_3');
  assert.strictEqual(choiceGroup.properties.options[0].badge, '🌱 Eco EV Preferred');

  // 3. Personalize Food Surface: dietary preferences reflected
  const foodIntentRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'Show me restaurant options for lunch',
  });
  assert.strictEqual(foodIntentRes.status, 200);
  assert.strictEqual(foodIntentRes.data.activeDomain, 'food');
  const foodSurface = foodIntentRes.data.surface;
  assert.strictEqual(validateAGUISurface(foodSurface).success, true);
  const session = getOrCreateSession(sessionId);
  assert.ok(session.messages.some((m) => m.content.includes('tailored to your preferences')));

  // 4. Personalize Wallet Surface: Gold VIP tier displayed
  const walletIntentRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'Open my wallet',
  });
  assert.strictEqual(walletIntentRes.status, 200);
  assert.strictEqual(walletIntentRes.data.activeDomain, 'wallet');
  const walletSurface = walletIntentRes.data.surface;
  const vipBadge = walletSurface.view.children.find((c: any) => c.type === 'Badge');
  assert.ok(vipBadge);
  assert.ok(vipBadge.properties.text.includes('Gold VIP Member'));

  // 5. User updates preferences via action
  const updateActionRes = await executeCoreRequest('POST', '/api/a2ui/action', {}, {
    sessionId,
    action: 'update_preferences',
    payload: {
      mobility: { preferredTier: 'drv_1', preferredTierName: 'Comfort Sedan', ecoFriendlyOnly: false },
      dietary: ['Vegetarian', 'Gluten-Free'],
    },
  });
  assert.strictEqual(updateActionRes.status, 200);
  assert.ok(updateActionRes.data.surface);
  assert.strictEqual(updateActionRes.data.surface.view.id, 'profile_card');

  // Reset preferences back to default
  executeProfileRequest('POST', '/profile/preferences', {}, {
    mobility: { preferredTier: 'drv_3', preferredTierName: 'Tesla Model Y (EV)', ecoFriendlyOnly: true },
    dietary: ['Vegetarian', 'Spicy'],
  });
});

// ==============================================================================
// SCENARIO 9: Keycloak OIDC Token Authentication & Security Guardrails
// ==============================================================================
test('E2E Life Scenario 9: Keycloak OIDC Token Authentication & Security Rejection', async () => {
  const sessionId = `sess_sec_${Date.now()}`;

  // 1. Valid Keycloak OIDC JWT token accepted
  const validToken = generateKeycloakToken('bassem', ['superapp-user', 'superapp-vip'], 'Gold VIP');
  const authRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'What can you do for me?',
  }, {
    authorization: `Bearer ${validToken}`,
  });
  assert.strictEqual(authRes.status, 200);
  assert.strictEqual(authRes.data.success, true);
  const session = getOrCreateSession(sessionId);
  assert.strictEqual((session as any).user.preferred_username, 'bassem');
  assert.strictEqual((session as any).user.vipTier, 'Gold VIP');

  // 2. Malformed JWT token rejected with 401
  const malformedRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'Show my balance',
  }, {
    authorization: 'Bearer bad.token.value.extra',
  });
  assert.strictEqual(malformedRes.status, 401);
  assert.ok(malformedRes.data.error.includes('Malformed Keycloak JWT token'));

  // 3. Invalid scheme (non-Bearer) rejected with 401
  const nonBearerRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'Book ride',
  }, {
    authorization: 'Basic dXNlcjpwYXNz',
  });
  assert.strictEqual(nonBearerRes.status, 401);
  assert.ok(nonBearerRes.data.error.includes('Expected Bearer <token>'));

  // 4. Expired Keycloak JWT token rejected with 401
  const expiredPayload = {
    exp: Math.floor(Date.now() / 1000) - 3600,
    sub: 'usr_expired',
    preferred_username: 'expired_user',
    realm_access: { roles: ['superapp-user'] },
  };
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const expiredToken = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify(expiredPayload))}.sig_expired`;

  const expiredRes = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId,
    text: 'Book ride',
  }, {
    authorization: `Bearer ${expiredToken}`,
  });
  assert.strictEqual(expiredRes.status, 401);
  assert.ok(expiredRes.data.error.includes('expired'));
});

