import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { parseModelRoute } from '../../scripts/port-relay.ts';
import { fetchViaModelRelay } from '../agent-core/src/model-relay.ts';

test('the optional model relay has one deployment-selected TLS destination and no credential', () => {
  assert.equal(parseModelRoute({}), undefined);
  assert.equal(parseModelRoute({ CONVERSATION_PROVIDER: 'local', LITELLM_BASE_URL: 'https://unselected.invalid/' }), undefined);
  assert.deepEqual(parseModelRoute({ CONVERSATION_PROVIDER: 'litellm', LITELLM_URL: 'https://gateway.example.invalid/v1/' }), { listen: 4443, host: 'gateway.example.invalid', port: 443 });
  assert.deepEqual(parseModelRoute({ CONVERSATION_PROVIDER: 'litellm', LITELLM_BASE_URL: 'https://gateway.example.invalid:8443/' }), { listen: 4443, host: 'gateway.example.invalid', port: 8443 });
  assert.equal(parseModelRoute({ CONVERSATION_PROVIDER: 'litellm', LITELLM_BASE_URL: 'http://litellm:4000/' }), undefined);
  for (const base of ['http://external.invalid/', 'https://user:credential@external.invalid/', 'https://external.invalid/?key=private', 'https://external.invalid/#fragment']) {
    assert.throws(() => parseModelRoute({ CONVERSATION_PROVIDER: 'litellm', LITELLM_BASE_URL: base }), /Invalid LiteLLM relay endpoint/);
  }
});

test('relay transport retains upstream TLS verification and forwards only model headers', async t => {
  const controller = new AbortController();
  let sent = '';
  t.mock.method(https, 'request', (options: https.RequestOptions, callback: (r: IncomingMessage) => void) => {
    assert.equal(options.hostname, 'edge-relay'); assert.equal(options.port, 4443);
    assert.equal(options.servername, 'gateway.example.invalid'); assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.path, '/v1/chat/completions'); assert.equal(options.signal, controller.signal);
    assert.deepEqual(options.headers, { Host: 'gateway.example.invalid', 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-provider-value' });
    const check = options.checkServerIdentity!;
    assert.ok(check('edge-relay', { subjectaltname: 'DNS:wrong.invalid' } as Parameters<typeof check>[1]), 'a certificate for a different server must be rejected');
    assert.equal(check('edge-relay', { subjectaltname: 'DNS:gateway.example.invalid' } as Parameters<typeof check>[1]), undefined);
    const client = new PassThrough(); client.on('data', chunk => { sent += chunk; });
    queueMicrotask(() => callback(Object.assign(Readable.from([Buffer.from('{"reply":"hello"}')]), { statusCode: 200, headers: { 'content-type': 'application/json' } }) as IncomingMessage));
    return client as unknown as ClientRequest;
  });
  const result = await fetchViaModelRelay(new URL('https://gateway.example.invalid/v1/chat/completions'), { method: 'POST', body: '{"model":"glm-5.3"}', signal: controller.signal, headers: { Authorization: 'Bearer synthetic-provider-value', 'X-User-Token': 'must-not-leave', 'X-Correlation-ID': 'must-not-leave', Host: 'attacker.invalid' } }, 'edge-relay:4443');
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { reply: 'hello' });
  assert.equal(sent, '{"model":"glm-5.3"}');
});

test('relay transport refuses arbitrary relay hosts, unsafe endpoints and oversized replies', async t => {
  let calls = 0;
  t.mock.method(https, 'request', (_options: https.RequestOptions, callback: (r: IncomingMessage) => void) => {
    calls++; const client = new PassThrough(); client.resume();
    queueMicrotask(() => callback(Object.assign(Readable.from([Buffer.alloc(65537)]), { statusCode: 200, headers: {} }) as IncomingMessage));
    return client as unknown as ClientRequest;
  });
  const endpoint = new URL('https://gateway.example.invalid/chat/completions');
  const init = { method: 'POST', body: '{}' };
  for (const relay of ['attacker.invalid:4443', 'edge-relay:443', 'http://edge-relay:4443', '']) await assert.rejects(fetchViaModelRelay(endpoint, init, relay));
  await assert.rejects(fetchViaModelRelay(new URL('http://gateway.example.invalid/'), init, 'edge-relay:4443'));
  await assert.rejects(fetchViaModelRelay(new URL('https://user:credential@gateway.example.invalid/'), init, 'edge-relay:4443'));
  assert.equal(calls, 0);
  await assert.rejects(fetchViaModelRelay(endpoint, init, 'edge-relay:4443'), /Model relay response too large/);
  assert.equal(calls, 1);
});
