import test from 'node:test';
import assert from 'node:assert/strict';
import { validateA2UIMessage } from '../../packages/protocol-core/src/a2-ui.ts';
import { validateAGUISurface, validateUIComponentNode } from '../../packages/protocol-core/src/ag-ui.ts';
import { checkedSurface } from '../../packages/protocol-core/src/surface-client.ts';

// Deterministic fuzzing of the protocol validators. Every case is derived from a
// fixed seed, so a failing case can be reproduced from its reported case seed.

type Container = Record<string, unknown>;
type Rng = ReturnType<typeof createRng>;
type Slot = { holder: Container; key: string };
type ValidationOutcome = { success: boolean; data?: unknown; errors?: unknown };

const CASES_PER_TARGET = 2000;
const FUZZ_SEED = 0x5eed1414;
const SESSION_ID = 'session-fuzz-1';
const REVISION = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7';
const TIMESTAMP = 1_700_000_000_000;
const GATEWAY_ERROR = 'The gateway returned an invalid surface. Refresh your request.';
const UI_BYTE_BUDGET = 262144;

// Keys that JSON input can legitimately carry, including prototype-related names.
const HOSTILE_KEYS = [
  '__proto__', 'constructor', 'prototype', 'toString', 'valueOf',
  'id', 'type', 'sessionId', 'properties', 'children', 'data', 'text',
  'label', 'surface', 'view', 'onEvents', 'style', 'timestamp', 'version',
];

const HOSTILE_PRIMITIVES: readonly unknown[] = [
  null, undefined, NaN, Infinity, -Infinity, -0, 0, 1, -1, 1.5,
  Number.MAX_SAFE_INTEGER, 2 ** 53, true, false,
  '', ' ', 'x', 'REPLACE', 'PATCH', 'APPEND', 'connected', 'onPress',
  'AGENT_ACTION_DISPATCH', 'Button', 'Text', '1.0.0', '/route', '//evil.example',
  'react', 'mobile', '2024-13-45', 'é', '日本語', '😀', 'a\u0000b', '\uD800',
  'x'.repeat(129), 'x'.repeat(4001), 'x'.repeat(5000),
];

// Small seeded PRNG (mulberry32). Inline to avoid dependencies and Math.random.
function createRng(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (max: number): number => Math.floor(next() * max),
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
  };
}

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null;
}

// defineProperty creates an own property even for "__proto__", unlike assignment.
function setOwn(target: Container, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function hostileValue(rng: Rng, depth = 0): unknown {
  switch (rng.int(depth >= 3 ? 3 : 8)) {
    case 0:
    case 1:
    case 2:
      return rng.pick(HOSTILE_PRIMITIVES);
    case 3: {
      const items: unknown[] = [];
      for (let i = rng.int(4); i > 0; i--) items.push(hostileValue(rng, depth + 1));
      return items;
    }
    case 4: {
      const length = rng.pick([100, 101, 501]);
      return Array.from({ length }, (_, i) => ({ id: `n${i}`, type: 'Text', properties: { text: 'x' } }));
    }
    default: {
      const object: Container = {};
      for (let i = 1 + rng.int(4); i > 0; i--) {
        setOwn(object, rng.pick(HOSTILE_KEYS), hostileValue(rng, depth + 1));
      }
      return object;
    }
  }
}

// Collects every (holder, key) pair in a fixture so one field can be mutated.
function collectSlots(value: unknown, depth = 0, out: Slot[] = []): Slot[] {
  if (!isContainer(value) || depth > 4) return out;
  for (const key of Object.keys(value)) {
    out.push({ holder: value, key });
    collectSlots(value[key], depth + 1, out);
  }
  return out;
}

// Mutates at most one field of a valid-looking fixture. Some cases stay unmutated
// so the success path is exercised as well.
function mutateOnce(rng: Rng, base: unknown): unknown {
  const roll = rng.int(10);
  if (roll === 0) return base;
  if (roll === 1) return hostileValue(rng);
  const slots = collectSlots(base);
  if (slots.length === 0) return hostileValue(rng);
  const { holder, key } = rng.pick(slots);
  if (roll === 2) {
    setOwn(holder, rng.pick(HOSTILE_KEYS), hostileValue(rng, 1));
  } else if (roll === 3) {
    delete holder[key];
  } else {
    setOwn(holder, key, hostileValue(rng, 1));
  }
  return base;
}

function componentBase(): Container {
  return {
    id: 'root',
    type: 'Text',
    properties: { text: 'Hello' },
    children: [
      {
        id: 'go',
        type: 'Button',
        properties: { label: 'Go' },
        onEvents: [{ event: 'onPress', actionType: 'AGENT_ACTION_DISPATCH', payload: { action: 'go' } }],
      },
    ],
  };
}

function surfaceBase(): Container {
  return {
    version: '1.0.0',
    revision: REVISION,
    sessionId: SESSION_ID,
    timestamp: TIMESTAMP,
    assistantMessage: { id: 'msg-1', text: 'Hello' },
    view: componentBase(),
  };
}

function envelopeBase(type: string, data: unknown): Container {
  return { id: 'msg-1', type, sessionId: SESSION_ID, timestamp: TIMESTAMP, data };
}

const A2UI_BASES: ReadonlyArray<() => Container> = [
  () => envelopeBase('A2UI_HANDSHAKE', {
    platform: 'web_responsive',
    viewport: { width: 390, height: 844, category: 'mobile' },
    supportedComponents: ['Text', 'Button'],
  }),
  () => envelopeBase('A2UI_HANDSHAKE_ACK', { status: 'connected', sessionId: SESSION_ID, supportedProtocols: ['a2ui/1'] }),
  () => envelopeBase('A2UI_STREAM_DELTA', { phase: 'REASONING', text: 'thinking', activeTool: 'search' }),
  () => envelopeBase('A2UI_USER_INTENT', { sessionId: SESSION_ID, text: 'hi' }),
  () => envelopeBase('A2UI_EVENT_TRIGGER', { originComponentId: 'go', action: 'go', payload: {} }),
  () => envelopeBase('A2UI_LAUNCH_MINIAPP', { miniAppId: 'app-1', entryRoute: '/home' }),
  () => envelopeBase('A2UI_CLIENT_ERROR', { code: 'E_CLIENT', message: 'failed' }),
  () => envelopeBase('A2UI_RENDER_SURFACE', { mode: 'REPLACE', surface: surfaceBase() }),
];

// Asserts the shape of a { success, data | errors } result and that a success
// returns the input by reference without mutating it.
function verifyValidationOutcome(args: unknown[], pristine: unknown[], outcome: unknown): 'success' | 'failure' {
  const result = outcome as ValidationOutcome;
  assert.ok(result !== null && typeof result === 'object', 'result must be an object');
  assert.equal(typeof result.success, 'boolean', 'success must be a boolean');
  if (result.success) {
    assert.deepStrictEqual(Object.keys(result).sort(), ['data', 'success']);
    assert.equal(result.data, args[0], 'success must return the input by reference');
    assert.deepStrictEqual(args, pristine, 'validator must not mutate its input');
    return 'success';
  }
  assert.deepStrictEqual(Object.keys(result).sort(), ['errors', 'success']);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, 'failure must carry errors');
  assert.ok(
    (result.errors as unknown[]).every((message) => typeof message === 'string' && message.length > 0),
    'every error must be a non-empty string',
  );
  return 'failure';
}

type Outcome = { returned: unknown } | { rejected: string };

interface FuzzTarget {
  name: string;
  build: (rng: Rng) => unknown[];
  invoke: (args: unknown[]) => unknown;
  verify: (args: unknown[], pristine: unknown[], outcome: unknown) => 'success' | 'failure';
}

const TARGETS: FuzzTarget[] = [
  {
    name: 'validateA2UIMessage',
    build: (rng) => [mutateOnce(rng, rng.pick(A2UI_BASES)())],
    invoke: ([envelope]) => validateA2UIMessage(envelope),
    verify: verifyValidationOutcome,
  },
  {
    name: 'validateUIComponentNode',
    build: (rng) => [mutateOnce(rng, componentBase())],
    invoke: ([node]) => validateUIComponentNode(node),
    verify: verifyValidationOutcome,
  },
  {
    name: 'validateAGUISurface',
    build: (rng) => [mutateOnce(rng, surfaceBase())],
    invoke: ([surface]) => validateAGUISurface(surface),
    verify: verifyValidationOutcome,
  },
  {
    // checkedSurface throws one documented Error on invalid input; that is the only accepted throw.
    name: 'checkedSurface',
    build: (rng) => [mutateOnce(rng, surfaceBase()), rng.int(5) === 0 ? hostileValue(rng, 1) : SESSION_ID],
    invoke: ([surface, sessionId]) => {
      try {
        return { returned: checkedSurface(surface, sessionId as string) } satisfies Outcome;
      } catch (error) {
        if (error instanceof Error && error.message === GATEWAY_ERROR) return { rejected: error.message } satisfies Outcome;
        throw error;
      }
    },
    verify: (args, pristine, outcome) => {
      const result = outcome as Outcome;
      if ('rejected' in result) {
        assert.equal(result.rejected, GATEWAY_ERROR);
        return 'failure';
      }
      const payload = result.returned as Container;
      assert.equal(payload, args[0], 'checkedSurface must return the input by reference');
      assert.equal(payload.sessionId, args[1], 'returned surface must match the requested session');
      assert.ok(payload.revision, 'returned surface must carry a revision');
      assert.deepStrictEqual(args, pristine, 'checkedSurface must not mutate its input');
      return 'success';
    },
  },
];

// Renders a bounded, throw-free description of a case input. Template coercion is avoided on purpose.
function describeShape(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (depth > 3) return `array(len=${value.length})`;
    const head = value.slice(0, 3).map((item) => describeShape(item, depth + 1)).join(', ');
    return `[${head}${value.length > 3 ? ', ...' : ''}] (len=${value.length})`;
  }
  if (typeof value === 'object') {
    if (depth > 3) return 'object';
    const entries = Object.keys(value).map((key) => `${JSON.stringify(key)}: ${describeShape((value as Container)[key], depth + 1)}`);
    return `{${entries.join(', ')}}`;
  }
  if (typeof value === 'string') return `string(len=${value.length}) ${JSON.stringify(value.slice(0, 24))}`;
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  return typeof value;
}

function topFrame(error: unknown): string {
  if (error instanceof Error && error.stack) return error.stack.split('\n')[1]?.trim() ?? '(no frame)';
  return '(not an Error)';
}

// Runs one seeded case. The pristine copy is rebuilt from the same seed to detect mutation.
function runCase(target: FuzzTarget, caseSeed: number): 'success' | 'failure' {
  const args = target.build(createRng(caseSeed));
  const pristine = target.build(createRng(caseSeed));
  try {
    const outcome = target.invoke(args);
    return target.verify(args, pristine, outcome);
  } catch (error) {
    const reason = error instanceof assert.AssertionError ? 'assertion failed' : 'validator threw';
    const message = error instanceof Error ? error.message.split('\n')[0] : 'non-Error value';
    throw new Error(
      `${target.name} case seed ${caseSeed}: ${reason}: ${message}\n` +
      `  input shape: ${describeShape(args)}\n` +
      `  top frame: ${topFrame(error)}`,
    );
  }
}

for (const target of TARGETS) {
  test(`protocol fuzz: ${target.name} never throws and returns well-formed results`, () => {
    let successes = 0;
    let failures = 0;
    for (let index = 0; index < CASES_PER_TARGET; index++) {
      const caseSeed = (FUZZ_SEED ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
      if (runCase(target, caseSeed) === 'success') successes++;
      else failures++;
    }
    assert.equal(successes + failures, CASES_PER_TARGET);
    // Both discriminants must be exercised, otherwise the fuzzer is not testing anything useful.
    assert.ok(successes > 0, `${target.name}: no case produced a success result`);
    assert.ok(failures > 0, `${target.name}: no case produced a failure result`);
  });
}

test('protocol fuzz: valid fixtures used as mutation bases are accepted', () => {
  for (const base of A2UI_BASES) {
    assert.equal(validateA2UIMessage(base()).success, true);
  }
  assert.equal(validateUIComponentNode(componentBase()).success, true);
  assert.equal(validateAGUISurface(surfaceBase()).success, true);
  assert.equal(checkedSurface(surfaceBase(), SESSION_ID).sessionId, SESSION_ID);
});

// Boundary cases: each asserts the exact rejection message from the source.

function fanOutTree(nodeCount: number): Container {
  const root: Container = { id: 'root', type: 'Text', properties: { text: 'root' }, children: [] };
  const rootChildren = root.children as Container[];
  let created = 1;
  while (created < nodeCount) {
    const group: Container = { id: `g${rootChildren.length}`, type: 'Text', properties: { text: 'g' }, children: [] };
    rootChildren.push(group);
    created++;
    const leaves = group.children as Container[];
    for (let i = 0; i < 100 && created < nodeCount; i++) {
      leaves.push({ id: `g${rootChildren.length - 1}-${i}`, type: 'Text', properties: { text: 'leaf' } });
      created++;
    }
  }
  return root;
}

test('boundary: 500 total UI nodes are accepted', () => {
  assert.equal(validateUIComponentNode(fanOutTree(500)).success, true);
});

test('boundary: 501st UI node is rejected with the exact budget message', () => {
  // Node 501 is the 95th leaf (index 94) of the fifth group (index 4) in traversal order.
  const result = validateUIComponentNode(fanOutTree(501));
  assert.deepStrictEqual(result, {
    success: false,
    errors: ['root.children[4].children[94]: Maximum total UI nodes exceeded'],
  });
});

function sizedRoot(paddingLength: number): Container {
  const root: Container = { id: 'root', type: 'Text', properties: { text: 'Hello' }, pad: '' };
  const emptyBytes = new TextEncoder().encode(JSON.stringify(root)).byteLength;
  root.pad = 'p'.repeat(paddingLength - emptyBytes);
  return root;
}

function encodedBytes(node: unknown): number {
  return new TextEncoder().encode(JSON.stringify(node)).byteLength;
}

test('boundary: UI payload of exactly 256 KiB is accepted', () => {
  const root = sizedRoot(UI_BYTE_BUDGET);
  assert.equal(encodedBytes(root), UI_BYTE_BUDGET);
  assert.equal(validateUIComponentNode(root).success, true);
});

test('boundary: UI payload one byte over 256 KiB is rejected with the exact budget message', () => {
  const root = sizedRoot(UI_BYTE_BUDGET + 1);
  assert.equal(encodedBytes(root), UI_BYTE_BUDGET + 1);
  assert.deepStrictEqual(validateUIComponentNode(root), { success: false, errors: ['UI byte budget exceeded'] });
});

test('boundary: 128-character component id is accepted and 129 is rejected with the exact message', () => {
  const accepted = { ...componentBase(), id: 'i'.repeat(128) };
  const rejected = { ...componentBase(), id: 'i'.repeat(129) };
  assert.equal(validateUIComponentNode(accepted).success, true);
  assert.deepStrictEqual(validateUIComponentNode(rejected), {
    success: false,
    errors: ["root: Missing or invalid 'id' string"],
  });
});

test('boundary: 129-character envelope id and sessionId are rejected with the exact messages', () => {
  const base = () => envelopeBase('A2UI_LAUNCH_MINIAPP', { miniAppId: 'app-1' });
  assert.deepStrictEqual(validateA2UIMessage({ ...base(), id: 'i'.repeat(129) }), {
    success: false,
    errors: ["Missing or invalid 'id' string"],
  });
  assert.deepStrictEqual(validateA2UIMessage({ ...base(), sessionId: 's'.repeat(129) }), {
    success: false,
    errors: ["Missing or invalid 'sessionId'"],
  });
});
