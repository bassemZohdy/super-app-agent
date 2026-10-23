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

test('validateA2UIMessage: malformed JSON envelopes fail without throwing', () => {
  const valid = createA2UIMessage('A2UI_RENDER_SURFACE', 'sess_test', {
    mode: 'REPLACE',
    surface: { version: '1.0.0', sessionId: 'sess_test', timestamp: Date.now(),
      view: { type: 'SurfaceCard', id: 'root' } },
  });
  for (const payload of [null, [], 'text', 1, true]) {
    assert.equal(validateA2UIMessage({ ...valid, data: payload }).success, false);
  }
  for (const timestamp of [NaN, Infinity, -1]) {
    assert.equal(validateA2UIMessage({ ...valid, timestamp }).success, false);
  }
  assert.equal(validateA2UIMessage({ ...valid, id: 'x'.repeat(129) }).success, false);
  assert.equal(validateA2UIMessage({ ...valid, sessionId: 'x'.repeat(129) }).success, false);
  assert.equal(validateA2UIMessage({ ...valid, data: { ...valid.data, mode: 'EXECUTE' } }).success, false);
  assert.equal(validateA2UIMessage({ ...valid, data: { ...valid.data,
    surface: { ...valid.data.surface, sessionId: 'another_session' } } }).success, false);
  for (const mode of ['REPLACE', 'PATCH', 'APPEND']) {
    assert.equal(validateA2UIMessage({ ...valid, data: { ...valid.data, mode } }).success, true);
  }
});

test('component budgets reject duplicate IDs, invalid coordinates, malformed rows and cyclic trees', () => {
  const badTrees = [
    { type: 'SurfaceCard', id: 'root', children: [{ type: 'Text', id: 'same', properties: { text: 'A' } }, { type: 'Text', id: 'same', properties: { text: 'B' } }] },
    { type: 'MapViewer', id: 'map', properties: { center: { lat: 91, lng: 0 } } },
    { type: 'DataTable', id: 'table', properties: { columns: [{ key: 'a', title: 'A' }], rows: [null] } },
    { type: 'SurfaceCard', id: 'root', children: Array.from({ length: 100 }, (_, i) => ({ type: 'SurfaceCard', id: `parent_${i}`, children: Array.from({ length: 10 }, (_, j) => ({ type: 'Text', id: `leaf_${i}_${j}`, properties: { text: 'A' } })) })) },
  ];
  const cyclic: any = { type: 'SurfaceCard', id: 'root', children: [] }; cyclic.children.push(cyclic);
  for (const tree of [...badTrees, cyclic]) assert.equal(validateUIComponentNode(tree).success, false);
});

test('every custom event rejects missing required payloads without throwing', () => {
  for (const type of ['A2UI_HANDSHAKE','A2UI_HANDSHAKE_ACK','A2UI_USER_INTENT','A2UI_STREAM_DELTA','A2UI_EVENT_TRIGGER','A2UI_LAUNCH_MINIAPP','A2UI_CLIENT_ERROR'] as const) {
    for (const data of [{}, { text: [], viewport: null }, null, []]) {
      assert.equal(validateA2UIMessage({ id: 'test', sessionId: 'session', timestamp: 0, type, data }).success, false, type);
    }
  }
});
