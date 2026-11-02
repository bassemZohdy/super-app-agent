import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { invokeTool } from '../src/orchestrator/fines-adapter.ts';
import { AgentError, type ExecutionContext } from '../src/orchestrator/contracts.ts';
import { harness } from './support.ts';

test('a read tool that ignores its abort signal cannot hold the caller indefinitely', { timeout: 3000 }, async () => {
  const h = await harness();
  try {
    const ctx: ExecutionContext = { principal: { subject: 'alice', workload: 'super-app-agent', permissions: ['fines:read'], expiresAt: Date.now() + 60000 }, authorization: `Bearer ${h.identities[0].token}`, correlationId: randomUUID(), revalidate: async () => ctx.principal };
    let aborted = false;
    const tool = { ...h.tools.list, timeoutMs: 80, invoke: async (_input: unknown, _ctx: unknown, signal: AbortSignal) => {
      signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      return new Promise<never>(() => {});
    } };
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const failure = new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error('tool did not time out')), 1000); });
      await assert.rejects(Promise.race([invokeTool(tool, {}, ctx), failure]), /TOOL_TIMEOUT_OR_INVALID_RESPONSE/);
      assert.equal(aborted, true);
      const lateRefusal = { ...h.tools.list, timeoutMs: 80, invoke: async (_input: unknown, _ctx: unknown, signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new AgentError('PROVIDER_DENIED', 403)), { once: true });
      }) };
      await assert.rejects(Promise.race([invokeTool(lateRefusal, {}, ctx), failure]), /TOOL_TIMEOUT_OR_INVALID_RESPONSE/);
    } finally { clearTimeout(watchdog); }
  } finally { await h.close(); }
});

test('a noncooperative payment response remains unknown and recovers the original effect', { timeout: 15000 }, async () => {
  const h = await harness();
  let release = () => {};
  try {
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: 'pay fines' });
    const invoke = h.tools.pay.invoke.bind(h.tools.pay);
    let committed!: () => void;
    const afterCommit = new Promise<void>(resolve => { committed = resolve; });
    const withheld = new Promise<void>(resolve => { release = resolve; });
    h.tools.pay.timeoutMs = 2500;
    h.tools.pay.invoke = async (...args) => { const receipt = await invoke(...args); committed(); await withheld; return receipt; };
    const pending = h.req(`${root}/resume`, { approvalId: review.data.approval.id, decision: 'approve' });
    await afterCommit;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const failure = new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error('payment did not time out')), 6000); });
      const unknown = await Promise.race([pending, failure]);
      assert.equal(unknown.data.status, 'unknown');
    } finally { clearTimeout(watchdog); }
    const other = `/api/agent/threads/${await h.thread()}`;
    assert.equal((await h.req(`${other}/messages`, { message: 'pay fines' })).data.status, 'reconciliation_required');
    assert.equal((await h.req(`${root}/cancel`, {})).data.code, 'RECONCILIATION_REQUIRED');
    release();
    const recovered = await h.req(`${root}/recover`, {});
    assert.equal(recovered.data.status, 'complete');
    assert.equal(recovered.data.receipt.idempotencyKey, review.data.approval.key);
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get() as { n: number }).n, 1);
  } finally { release(); await h.close(); }
});
