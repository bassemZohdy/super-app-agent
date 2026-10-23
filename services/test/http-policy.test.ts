import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { HttpPolicy } from '../../packages/backend-kit/src/http-policy.ts';
import { server } from '../agent-core/src/index.ts';

test('request budgets bound concurrency, rate and new-client cardinality and release only once', t => {
  const policy = new HttpPolicy(1, 2, 2);
  const first = policy.admit('alice');
  assert.throws(() => policy.admit('bob'), /active/);
  first(); first();
  const next = policy.admit('alice'); next();
  assert.throws(() => policy.admit('alice'), /rate/);
  policy.admit('bob')();
  assert.throws(() => policy.admit('carol'), /capacity/);
  const now = Date.now(); t.mock.method(Date, 'now', () => now + 60001);
  policy.admit('carol')();
});

test('HTTP rejects byte-oversized, malformed and wrong-type bodies, times out slow input and survives aborts', async t => {
  const old = process.env.HTTP_BODY_TIMEOUT_MS; process.env.HTTP_BODY_TIMEOUT_MS = '100';
  t.after(() => { if (old === undefined) delete process.env.HTTP_BODY_TIMEOUT_MS; else process.env.HTTP_BODY_TIMEOUT_MS = old; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (body: string, type = 'application/json') => fetch(`${root}/api/a2ui/intent`, { method: 'POST', headers: { 'Content-Type': type }, body });
  assert.equal((await post(JSON.stringify({ text: '界'.repeat(25000) }))).status, 413);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post('{}', 'text/plain')).status, 415);
  const slow = await new Promise<number>(resolve => {
    const upload = request(`${root}/api/a2ui/intent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '100' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode!));
    });
    upload.on('error', () => {}); upload.write('{');
  });
  assert.equal(slow, 408);
  const aborted = request(`${root}/api/a2ui/intent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '100' } });
  aborted.on('error', () => {}); aborted.write('{'); aborted.destroy();
  assert.equal((await fetch(`${root}/health`)).status, 200);
});
