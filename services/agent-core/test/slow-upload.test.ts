import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { harness } from './support.ts';

test('a continuously trickled request expires without dispatching a transition', { timeout: 5000 }, async () => {
  const h = await harness({ bodyTimeoutMs: 150 });
  try {
    const thread = await h.thread();
    const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const req = http.request(new URL(`/api/agent/threads/${thread}/messages`, h.base), {
        method: 'POST', headers: { Authorization: `Bearer ${h.identities[0].token}`, 'Idempotency-Key': 'slow', 'Content-Type': 'application/json', 'Content-Length': '500' },
      }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
        res.on('end', () => { clearInterval(drip); clearTimeout(deadline); resolve({ status: res.statusCode, body }); });
      });
      const drip = setInterval(() => req.write(' '), 30);
      const deadline = setTimeout(() => { clearInterval(drip); req.destroy(new Error('body deadline was not enforced')); }, 1000);
      req.on('error', error => { clearInterval(drip); clearTimeout(deadline); reject(error); });
      req.write('{');
    });
    assert.equal(response.status, 408);
    assert.equal(JSON.parse(response.body).code, 'BODY_READ_TIMEOUT');
    assert.equal((await h.req(`/api/agent/threads/${thread}`)).data.status, 'new');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_requests').get() as { n: number }).n, 0);
    assert.equal((await h.req(`/api/agent/threads/${thread}/messages`, { message: 'show fines' })).status, 200);
  } finally { await h.close(); }
});

test('an oversized body receives a bounded error and does not start the transition', async () => {
  const h = await harness();
  try {
    const thread = await h.thread();
    const result = await h.req(`/api/agent/threads/${thread}/messages`, { message: 'a'.repeat(10000) });
    assert.equal(result.status, 413);
    assert.equal(result.data.code, 'BODY_TOO_LARGE');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_requests').get() as { n: number }).n, 0);
    assert.equal((await h.req(`/api/agent/threads/${thread}`)).data.status, 'new');
  } finally { await h.close(); }
});
