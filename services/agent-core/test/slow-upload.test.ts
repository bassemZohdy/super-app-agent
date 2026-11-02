import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { harness } from './support.ts';

async function trickle(base: URL, token: string, path: string) {
  return new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const req = http.request(new URL(path, base), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': 'slow', 'Content-Type': 'application/json', 'Content-Length': '500' },
    }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => { clearInterval(drip); clearTimeout(deadline); req.destroy(); resolve({ status: res.statusCode, body }); });
    });
    const drip = setInterval(() => req.write(' '), 30);
    const deadline = setTimeout(() => { clearInterval(drip); req.destroy(new Error('body deadline was not enforced')); }, 1000);
    req.on('error', error => { clearInterval(drip); clearTimeout(deadline); reject(error); });
    req.write('{');
  });
}

test('a continuously trickled request expires without dispatching a transition', { timeout: 5000 }, async () => {
  const h = await harness({ bodyTimeoutMs: 150 });
  try {
    const thread = await h.thread();
    const response = await trickle(h.base, h.identities[0].token, `/api/agent/threads/${thread}/messages`);
    assert.equal(response.status, 408);
    assert.equal(JSON.parse(response.body).code, 'BODY_READ_TIMEOUT');
    assert.equal((await h.req(`/api/agent/threads/${thread}`)).data.status, 'new');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_requests').get() as { n: number }).n, 0);
    assert.equal((await h.req(`/api/agent/threads/${thread}/messages`, { message: 'show fines' })).status, 200);
  } finally { await h.close(); }
});

test('incomplete creation, cancellation and recovery bodies do not trigger actions', { timeout: 5000 }, async () => {
  const h = await harness({ bodyTimeoutMs: 150 });
  try {
    const countThreads = () => (h.store.db.prepare('SELECT count(*) AS n FROM sa_threads').get() as { n: number }).n;
    assert.equal((await trickle(h.base, h.identities[0].token, '/api/agent/threads')).status, 408);
    assert.equal(countThreads(), 0);
    const thread = await h.thread(), root = `/api/agent/threads/${thread}`;
    assert.equal((await trickle(h.base, h.identities[0].token, `${root}/cancel`)).status, 408);
    assert.equal((await h.req(root)).data.status, 'new');
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const invoke = h.tools.pay.invoke.bind(h.tools.pay); let calls = 0;
    h.tools.pay.invoke = async (...args) => { calls++; if (calls === 1) throw new Error('outcome unknown'); return invoke(...args); };
    assert.equal((await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' })).data.status, 'unknown');
    assert.equal((await trickle(h.base, h.identities[0].token, `${root}/recover`)).status, 408);
    assert.equal(calls, 1);
    assert.equal((await h.req(root)).data.status, 'unknown');
    assert.equal((await h.req(`${root}/recover`, {})).data.status, 'complete');
    assert.equal(calls, 2);
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

test('bodyless actions accept empty bodies and reject oversized ignored bodies before dispatch', async () => {
  const h = await harness();
  try {
    const path = '/api/agent/threads';
    const oversized = await h.req(path, { ignored: 'x'.repeat(10000) });
    assert.equal(oversized.status, 413);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_threads').get() as { n: number }).n, 0);
    const headers = { Authorization: `Bearer ${h.identities[0].token}`, 'Idempotency-Key': 'empty' };
    const created = await fetch(new URL(path, h.base), { method: 'POST', headers });
    assert.equal(created.status, 201);
    const { threadId } = await created.json() as { threadId: string };
    const cancelled = await fetch(new URL(`${path}/${threadId}/cancel`, h.base), { method: 'POST', headers });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json() as { status: string }).status, 'cancelled');
  } finally { await h.close(); }
});
