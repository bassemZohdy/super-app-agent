import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { simulatorRequest } from '../agent-core/src/orchestrator/simulator-client.ts';
import { AgentError, type ExecutionContext } from '../agent-core/src/orchestrator/contracts.ts';

const principal = { subject: 'resident', workload: 'focused-agent', permissions: ['fines:pay'], expiresAt: Date.now() + 60_000 };
const ctx: ExecutionContext = { principal, authorization: 'Bearer fixture', correlationId: randomUUID(), revalidate: async () => principal };
const request = () => simulatorRequest(new URL('http://127.0.0.1/'), 'fixture-key', 'simulator/v1/payments', ctx, new AbortController().signal, { body: { quote: 'fixture' }, key: 'a'.repeat(64), reasons: ['QUOTE_STALE'] });

test('focused write refusals require an exact envelope bound to this request', async t => {
  const previous = randomUUID();
  for (const mode of ['matched', 'missing', 'mismatched', 'key', 'extra', 'receipt'] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async (_input, init) => {
      const nonce = new Headers(init?.headers).get('X-Refusal-Nonce');
      assert.match(nonce || '', /^[0-9a-f-]{36}$/);
      const body: Record<string, unknown> = { code: 'QUOTE_STALE', correlationId: randomUUID() };
      if (mode === 'matched' || mode === 'extra' || mode === 'receipt') body.refusalNonce = nonce;
      if (mode === 'mismatched') body.refusalNonce = previous;
      if (mode === 'key') body.operationId = 'a'.repeat(64);
      if (mode === 'extra') body.success = true;
      if (mode === 'receipt') body.receipt = { id: 'existing-effect' };
      return Response.json(body, { status: 409 });
    });
    try { await assert.rejects(request(), (error: unknown) => error instanceof AgentError && error.code === (mode === 'matched' ? 'QUOTE_STALE' : 'PROVIDER_FAILURE')); }
    finally { mock.mock.restore(); }
  }
});

test('focused reads preserve an explicit simulator authority denial', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'PERMISSION_DENIED', correlationId: randomUUID() }, { status: 403 }));
  await assert.rejects(simulatorRequest(new URL('http://127.0.0.1/'), 'fixture-key', 'simulator/v1/fines', ctx, new AbortController().signal), (error: unknown) => error instanceof AgentError && error.code === 'PROVIDER_DENIED');
});

test('each write uses a fresh refusal nonce', async t => {
  const seen = new Set<string>();
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const nonce = new Headers(init?.headers).get('X-Refusal-Nonce');
    assert.ok(nonce); assert.equal(seen.has(nonce), false); seen.add(nonce);
    return Response.json({ code: 'QUOTE_STALE', correlationId: randomUUID(), refusalNonce: nonce }, { status: 409 });
  });
  for (let i = 0; i < 2; i++) await assert.rejects(request(), (error: unknown) => error instanceof AgentError && error.code === 'QUOTE_STALE');
});
