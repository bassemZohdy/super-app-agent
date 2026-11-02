import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientCredentials } from '../../packages/backend-kit/src/oauth.ts';

test('service-token responses are bounded and oversized bodies are not cached', async t => {
  let cancelled = false, offset = 0, calls = 0;
  const bytes = new TextEncoder().encode(JSON.stringify({ access_token: 'valid-token', expires_in: 300, padding: 'x'.repeat(2 * 1024 * 1024) }));
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls > 1) return Response.json({ access_token: 'valid-token', expires_in: 300 });
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) { if (offset >= bytes.length) controller.close(); else { controller.enqueue(bytes.subarray(offset, offset + 16384)); offset += 16384; } },
      cancel() { cancelled = true; },
    }));
  });
  const client = new ClientCredentials('test-client', 'test-secret');
  await assert.rejects(() => client.token(), /Invalid service token response/);
  assert.equal(cancelled, true); assert.ok(offset < bytes.length);
  assert.equal(await client.token(), 'valid-token');
  assert.equal(await client.token(), 'valid-token'); assert.equal(calls, 2);
});

test('invalid service tokens and lifetimes are refused without caching or exposing response text', async t => {
  const bodies = [
    JSON.stringify({ access_token: '', expires_in: 300 }),
    JSON.stringify({ access_token: 'bad token', expires_in: 300 }),
    JSON.stringify({ access_token: 'x'.repeat(16385), expires_in: 300 }),
    ...[0, -1, 0.5, 86401].map(expires_in => JSON.stringify({ access_token: 'valid-token', expires_in })),
    '{"access_token":"valid-token","expires_in":1e999}',
    '{private-response-detail',
    'null',
    '[]',
  ];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(bodies[calls++] ?? JSON.stringify({ access_token: 'valid-token', expires_in: 300 })));
  const client = new ClientCredentials('test-client', 'test-secret');
  for (const _ of bodies) await assert.rejects(() => client.token(), (error: unknown) => error instanceof Error && error.message === 'Invalid service token response');
  assert.equal(await client.token(), 'valid-token');
  assert.equal(await client.token(), 'valid-token'); assert.equal(calls, bodies.length + 1);
});

test('an uncooperative oversized response cannot delay token rejection', async t => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  })));
  const client = new ClientCredentials('test-client', 'test-secret');
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error('cancellation blocked rejection')), 1000); });
    await assert.rejects(Promise.race([client.token(), deadline]), /Invalid service token response/);
    assert.equal(cancelled, true);
  } finally { clearTimeout(watchdog); }
});

test('a rejected token response is cancelled without consuming its body', async t => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; },
  }), { status: 401 }));
  await assert.rejects(() => new ClientCredentials('test-client', 'test-secret').token(), /Service authentication failed \(401\)/);
  assert.equal(cancelled, true);
});
