import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { agentProcess } from './support.ts';

for (const kind of ['payment', 'renewal'] as const) test(`process death after ${kind} commit recovers the original operation`, { timeout: 60000 }, async () => {
  let agent!: ReturnType<typeof agentProcess>;
  let committed!: () => void, held = false;
  const observed = new Promise<void>(resolve => { committed = resolve; });
  const target = kind === 'payment' ? '/simulator/v1/payments' : '/simulator/v1/renewals';
  const proxy = http.createServer((request, response) => {
    const upstream = http.request(new URL(request.url || '/', agent.base), { method: request.method, headers: request.headers }, reply => {
      if (!held && request.method === 'POST' && request.url === target) {
        held = true;
        reply.resume();
        reply.on('end', () => { if (reply.statusCode === 200) committed(); });
      } else {
        response.writeHead(reply.statusCode || 502, reply.headers);
        reply.pipe(response);
      }
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/`;
  agent = agentProcess(['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew'], { simulatorUrl: proxyUrl });
  try {
    await agent.start();

    const root = `/api/agent/threads/${(await agent.req('/api/agent/threads', {})).threadId}`;
    const review = await agent.req(`${root}/messages`, { message: kind === 'payment' ? 'pay fines' : 'renew my vehicle' });
    const approval = kind === 'payment' ? review.approval : (await agent.req(`${root}/resume`, { approvalId: review.approval.id, decision: 'approve' })).renewalApproval;
    const interrupted = agent.req(`${root}/resume`, { approvalId: approval.id, decision: 'approve' }).then(() => false, () => true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([observed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Simulator commit was not observed')), 15000); })]); }
    finally { if (timer) clearTimeout(timer); }

    await agent.stop();

    assert.equal(await interrupted, true);

    const before = new Database(agent.file, { readonly: true });
    try {
      const table = kind === 'payment' ? 'sa_sim_payments' : 'sa_sim_renewals';
      assert.equal((before.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 1);
      assert.equal((before.prepare('SELECT status FROM sa_operations WHERE key=?').get(approval.key) as { status: string }).status, 'pending');
    } finally { before.close(); }
    await agent.start();

    const other = `/api/agent/threads/${(await agent.req('/api/agent/threads', {})).threadId}`;
    const blocked = await agent.req(`${other}/messages`, { message: kind === 'payment' ? 'pay fines' : 'renew my vehicle' });
    assert.equal(blocked.status, 'reconciliation_required');

    const recovered = await agent.req(`${root}/recover`, {});

    assert.equal(recovered.status, 'complete');
    assert.equal((kind === 'payment' ? recovered.receipt : recovered.renewal).idempotencyKey, approval.key);
    await agent.stop();
    const after = new Database(agent.file, { readonly: true });
    try {
      const table = kind === 'payment' ? 'sa_sim_payments' : 'sa_sim_renewals';
      assert.equal((after.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 1);
      assert.equal((after.prepare('SELECT status FROM sa_operations WHERE key=?').get(approval.key) as { status: string }).status, 'complete');
    } finally { after.close(); }
  } finally {

    await agent.close();

    proxy.closeAllConnections();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
});
