import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { harness } from './support.ts';

test('actual process kill/restart preserves SQLite approval and duplicate payment receipt', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-restart-'));
  const reserve = net.createServer(); await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = (reserve.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`, token = randomBytes(32).toString('hex');
  const env = { ...process.env, NODE_ENV: 'test', AGENT_DB_PATH: join(dir, 'agent.sqlite'), AGENT_PORT: String(port), AGENT_SIMULATOR_URL: `${base}/`, AGENT_AUTH: 'test', AGENT_PLANNER: 'fixture', AGENT_WORKLOAD_KEY: randomBytes(32).toString('hex'), AGENT_TEST_IDENTITIES: JSON.stringify([{ token, subject: 'restart-owner', permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 3600000 }]) };
  let child: ChildProcess | undefined;
  async function start() {
    child = spawn(process.execPath, ['--experimental-strip-types', 'services/agent-core/src/orchestrator/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    child.stdout!.on('data', chunk => { if (String(chunk).includes('agent.ready')) ready = true; });
    // Never publish subprocess logs: configuration or provider failures must not expose secrets.
    child.stderr!.resume();
    const until = Date.now() + 10000;
    while (!ready && child.exitCode === null && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ready, true, 'Agent process did not become ready');
  }
  async function stop() { if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; } }
  async function req(path: string, body?: unknown, key = randomBytes(8).toString('hex')) {
    const res = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(res.status >= 200 && res.status < 300, true);
    return await res.json() as Record<string, any>;
  }
  try {
    await start();
    const id = (await req('/api/agent/threads', {})).threadId, root = `/api/agent/threads/${id}`;
    const review = await req(`${root}/messages`, { message: 'retrieve fines and pay them' });
    assert.equal(review.status, 'awaiting_approval');
    await stop(); await start();
    const restored = await req(root); assert.deepEqual(restored.approval, review.approval);
    const command = { approvalId: restored.approval.id, decision: 'approve' };
    const paid = await req(`${root}/resume`, command, 'approve-once');
    assert.equal(paid.status, 'complete'); assert.equal(paid.receipt.simulated, true);
    await stop(); await start();
    const duplicate = await req(`${root}/resume`, command, 'approve-once');
    assert.deepEqual(duplicate, paid);
    assert.equal((await req(`${root}/messages`, { message: 'list fines' })).fines.length, 0);
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('lost payment response reconciles original operation after reopening SQLite without a second effect', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-unknown-')), file = join(dir, 'agent.sqlite');
  let h = await harness({ file });
  try {
    const identities = h.identities, id = await h.thread(), root = `/api/agent/threads/${id}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const original = h.tools.pay.invoke;
    h.tools.pay.invoke = async (...args) => { await original(...args); throw new Error('response lost after commit'); };
    const unknown = await h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' });
    assert.equal(unknown.data.status, 'unknown');
    assert.equal((await h.req(`${root}/messages`, { message: 'pay fines' })).status, 409);
    assert.equal((await h.req(`${root}/cancel`, {})).status, 409);
    await h.close();
    h = await harness({ file, identities });
    const recovered = await h.req(`${root}/recover`, {});
    assert.equal(recovered.data.status, 'complete');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
    assert.equal(recovered.data.receipt.idempotencyKey, review.data.approval.key);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});
