import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAGUISurface,
  validateUIComponentNode,
  createSurfaceCard,
  createHeading,
  createText,
  createButton,
  validateA2UIMessage,
  createA2UIMessage,
  type AGUISurfacePayload,
} from '../src/index.ts';

test('validateUIComponentNode: accepts valid component primitives', () => {
  const card = createSurfaceCard('test_card', [
    createHeading('h1', 'Hello SuperApp', 1),
    createText('t1', 'This is a test description'),
    createButton('b1', 'Confirm Ride', { action: 'book_ride', rideId: '123' }),
  ]);

  const res = validateUIComponentNode(card);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.errors, undefined);
});

test('validateUIComponentNode: rejects invalid component type', () => {
  const invalidNode = {
    type: 'NonExistentWidget',
    id: 'invalid_1',
  };

  const res = validateUIComponentNode(invalidNode);
  assert.strictEqual(res.success, false);
  assert.ok(res.errors && res.errors.length > 0);
  assert.match(res.errors[0], /Invalid component type/);
});

test('validateAGUISurface: accepts valid surface payload', () => {
  const surface: AGUISurfacePayload = {
    version: '1.0.0',
    sessionId: 'sess_123',
    timestamp: Date.now(),
    view: {
      type: 'SurfaceCard',
      id: 'surface_root',
      children: [
        {
          type: 'ChoiceGroup',
          id: 'choices_1',
          properties: {
            options: [
              { id: 'opt_1', title: 'Comfort Sedan', price: '$22.00' },
              { id: 'opt_2', title: 'Premier SUV', price: '$35.00' },
            ],
          },
        },
      ],
    },
  };

  const res = validateAGUISurface(surface);
  assert.strictEqual(res.success, true);
  assert.ok(res.data);
  assert.strictEqual(res.data.sessionId, 'sess_123');
});

test('validateAGUISurface: rejects invalid version', () => {
  const badSurface = {
    version: '2.0.0',
    sessionId: 'sess_123',
    timestamp: Date.now(),
    view: { type: 'SurfaceCard', id: 'c1' },
  };

  const res = validateAGUISurface(badSurface);
  assert.strictEqual(res.success, false);
  assert.match(res.errors![0], /Invalid version/);
});

test('createA2UIMessage: properly wraps A2-UI envelope', () => {
  const envelope = createA2UIMessage('A2UI_STREAM_DELTA', 'sess_test', {
    phase: 'REASONING',
    text: 'Analyzing traffic conditions...',
  });

  assert.strictEqual(envelope.type, 'A2UI_STREAM_DELTA');
  assert.strictEqual(envelope.sessionId, 'sess_test');
  assert.ok(envelope.id.startsWith('msg_'));
  assert.strictEqual(envelope.data.phase, 'REASONING');

  const valid = validateA2UIMessage(envelope);
  assert.strictEqual(valid.success, true);
});

test('validateA2UIMessage: validates nested AG-UI surface on A2UI_RENDER_SURFACE', () => {
  const renderMessage = createA2UIMessage('A2UI_RENDER_SURFACE', 'sess_test', {
    mode: 'REPLACE',
    surface: {
      version: '1.0.0',
      sessionId: 'sess_test',
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'render_card',
        children: [createHeading('h2', 'Ride Confirmed')],
      },
    },
  });

  const res = validateA2UIMessage(renderMessage);
  assert.strictEqual(res.success, true);
});
