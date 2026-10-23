import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { EventJournal, StreamWriter } from '../agent-core/src/event-stream.ts';
import { createA2UIMessage } from '../../packages/protocol-core/src/index.ts';
import { readEventStream } from '../../packages/protocol-core/src/sse-client.ts';
import { server, executeCoreRequest, sseClients } from '../agent-core/src/index.ts';

const message = (sid: string, text: string) => createA2UIMessage('A2UI_STREAM_DELTA', sid, { text });

test('replay is session-bound and bounded by count, TTL, session count and bytes', t => {
  const journal = new EventJournal(2, 1000, 2);
  const a = message('a', 'one'), b = message('a', 'two'), c = message('a', 'three');
  journal.append('a', a); journal.append('a', b);
  assert.deepEqual(journal.after('a', a.id), [b]);
  assert.equal(journal.after('other', a.id), undefined);
  journal.append('a', c);
  assert.equal(journal.after('a', a.id), undefined);
  journal.append('b', message('b', 'x')); journal.append('c', message('c', 'x'));
  assert.equal(journal.after('a', c.id), undefined);
  const expiring = new EventJournal(2, 1000);
  expiring.append('a', a);
  t.mock.method(Date, 'now', () => a.timestamp + 2000);
  assert.equal(expiring.after('a', a.id), undefined);
  const small = new EventJournal(2, 1000, 2, 1);
  small.append('a', a);
  assert.equal(small.after('a', a.id), undefined);
});

test('slow writers wait for drain and disconnect at the byte limit', () => {
  class Sink extends EventEmitter {
    writableLength = 0;
    frames: string[] = [];
    destroyed = false;
    write(frame: string) { this.frames.push(frame); return this.frames.length !== 1; }
    destroy() { this.destroyed = true; this.emit('close'); }
  }
  const sink = new Sink();
  const writer = new StreamWriter(sink as unknown as ServerResponse, 20);
  writer.send('first'); writer.send('second');
  assert.deepEqual(sink.frames, ['first']);
  sink.emit('drain');
  assert.deepEqual(sink.frames, ['first', 'second']);
  writer.send('x'.repeat(21));
  assert.equal(sink.destroyed, true);
});

test('SSE parser preserves multi-line UTF-8 data across CR/LF and byte boundaries', async () => {
  const bytes = new TextEncoder().encode(': comment\r\nid: abc\r\ndata: مرحبا\r\ndata: world\r\n\r\n');
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  }}));
  const events = [];
  for await (const event of readEventStream(response)) events.push(event);
  assert.deepEqual(events, [{ id: 'abc', data: 'مرحبا\nworld' }]);
});

test('real HTTP stream verifies signed bearer, user ownership, origin, replay and expiry', async t => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'stream-key', alg: 'RS256' };
  const originalFetch = globalThis.fetch;
  const issuer = 'https://stream-issuer.example/realms/test';
  const env = { KEYCLOAK_ISSUER: issuer, KEYCLOAK_JWKS_URL: issuer + '/certs',
    KEYCLOAK_AUDIENCE: 'agent-core', DEMO_AUTH: 'false' };
  for (const [key, value] of Object.entries(env)) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  t.mock.method(globalThis, 'fetch', (input: any, init?: RequestInit) =>
    String(input) === issuer + '/certs' ? Promise.resolve(Response.json({ keys: [jwk] })) : originalFetch(input, init));
  const mint = (sub: string, seconds = 60) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'stream-key' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ iss: issuer, aud: 'agent-core', typ: 'Bearer', sub,
      exp: Math.floor(Date.now() / 1000) + seconds })).toString('base64url');
    return h + '.' + p + '.' + sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url');
  };
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const sid = 'stream_http_alice_001';
  const url = base + '/api/a2ui/stream?sessionId=' + sid;
  const alice = mint('alice');
  const headers = { authorization: 'Bearer ' + alice };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/a2ui/intent', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sid, text: 'show my wallet' }) })).status, 200);
  assert.equal((await fetch(url, { headers: { authorization: 'Bearer ' + mint('bob') } })).status, 403);
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  assert.equal(response.status, 200);
  const stream = readEventStream(response);
  assert.equal(JSON.parse((await stream.next()).value!.data).type, 'A2UI_HANDSHAKE_ACK');
  assert.equal(JSON.parse((await stream.next()).value!.data).type, 'A2UI_RENDER_SURFACE');
  await executeCoreRequest('POST', '/api/a2ui/intent', {}, { sessionId: sid, text: 'show my profile' }, headers);
  const first = (await stream.next()).value!;
  assert.ok(first.id);
  controller.abort();
  await stream.return(undefined);
  const reconnect = new AbortController();
  const replayed = readEventStream(await fetch(url, { headers: { ...headers, 'Last-Event-ID': first.id! }, signal: reconnect.signal }));
  await replayed.next(); // handshake
  const next = (await replayed.next()).value!;
  assert.ok(next.id); assert.notEqual(next.id, first.id);
  reconnect.abort(); await replayed.return(undefined);
  assert.equal((await fetch(url, { headers: { ...headers, 'Last-Event-ID': 'foreign-or-expired' } })).status, 409);
  const expiring = readEventStream(await fetch(base + '/api/a2ui/stream?sessionId=stream_expiry_001', {
    headers: { authorization: 'Bearer ' + mint('alice', 2) },
  }));
  await expiring.next();
  assert.equal((await expiring.next()).done, true);
  assert.ok(!sseClients.has('stream_expiry_001') || sseClients.get('stream_expiry_001')!.size === 0);
});

test('browser stream reconnects with bearer headers and cursor, resets stale replay, and stops on 401', async t => {
  const { connectEventStream } = await import('../../packages/protocol-core/src/sse-client.ts');
  const requests: Array<Record<string, string>> = [];
  let delivered = 0, tokens = 0;
  const errorMessages: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.ok(!url.includes('token') && !url.includes('Bearer'));
    requests.push(init.headers as Record<string, string>);
    if (requests.length === 1) return new Response(`id: event-one\ndata: ${JSON.stringify(message('sid', 'one'))}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    if (requests.length === 2) return new Response('', { status: 409 });
    return new Response('', { status: 401 });
  });
  await connectEventStream({ url: 'http://localhost/stream?sessionId=example',
    getToken: () => 'refreshed-' + ++tokens, signal: new AbortController().signal,
    onMessage: () => delivered++, onError: error => errorMessages.push(error.message) });
  assert.equal(delivered, 1);
  assert.equal(requests[0].Authorization, 'Bearer refreshed-1');
  assert.equal(requests[1]['Last-Event-ID'], 'event-one');
  assert.equal(requests[2]['Last-Event-ID'], undefined);
  assert.equal(requests[2].Authorization, 'Bearer refreshed-3');
  assert.match(errorMessages[0], /401/);
});
